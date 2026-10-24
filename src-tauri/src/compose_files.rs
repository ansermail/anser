//! Durable draft-owned attachment copies. Original archives are never changed.
use crate::{archive, models::*, store::Store};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};
const MAX_BYTES: usize = 50 * 1024 * 1024;
const MARKER: &[u8] = b"Anser managed compose attachments v1\n";
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearDraftsResult {
    pub deleted: usize,
    pub cleanup_pending: usize,
}
type Gates = Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>;
fn gate(root: &Path) -> Result<Arc<Mutex<()>>> {
    static GATES: OnceLock<Gates> = OnceLock::new();
    let root = root.canonicalize().map_err(err)?;
    let mut gates = GATES.get_or_init(Default::default).lock().map_err(err)?;
    if let Some(existing) = gates.get(&root).and_then(Weak::upgrade) {
        return Ok(existing);
    }
    let value = Arc::new(Mutex::new(()));
    gates.insert(root, Arc::downgrade(&value));
    Ok(value)
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS compose_sessions(draft_id TEXT PRIMARY KEY,token TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS compose_files(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,hash TEXT NOT NULL,created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS compose_file_owner ON compose_files(draft_id);
        DELETE FROM compose_sessions;").map_err(err)
}
fn permissions(path: &Path, mode: u32) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(err)?;
    }
    Ok(())
}
fn regular(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(err)?;
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err("写信附件文件无效，未读取或清理".into());
    }
    Ok(())
}
fn directory(path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path).map_err(err)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("写信附件目录无效，未读取或清理".into());
    }
    Ok(())
}
fn root_folder(root: &Path) -> Result<PathBuf> {
    let folder = root
        .canonicalize()
        .map_err(err)?
        .join("compose-attachments");
    match fs::create_dir(&folder) {
        Ok(()) => {
            permissions(&folder, 0o700)?;
            archive::atomic_write(&folder.join(".anser-owned"), MARKER)?;
            permissions(&folder.join(".anser-owned"), 0o600)?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => return Err(err(e)),
    }
    directory(&folder)?;
    regular(&folder.join(".anser-owned"))?;
    if fs::read(folder.join(".anser-owned")).map_err(err)? != MARKER {
        return Err("写信附件目录标识不匹配，未读取或清理".into());
    }
    Ok(folder)
}
fn id_valid(id: &str) -> Result<()> {
    if uuid::Uuid::parse_str(id)
        .ok()
        .map(|id| id.to_string())
        .as_deref()
        != Some(id)
    {
        return Err("写信附件标识无效".into());
    }
    Ok(())
}
fn payload(root: &Path, id: &str) -> Result<PathBuf> {
    id_valid(id)?;
    let folder = root_folder(root)?.join(id);
    directory(&folder)?;
    regular(&folder.join(".anser-owned"))?;
    if fs::read(folder.join(".anser-owned")).map_err(err)? != id.as_bytes() {
        return Err("写信附件归属不匹配".into());
    }
    Ok(folder.join("payload"))
}
fn delete_payload(root: &Path, id: &str) -> Result<()> {
    id_valid(id)?;
    let folder = root_folder(root)?.join(id);
    match fs::symlink_metadata(&folder) {
        Ok(_) => directory(&folder)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(err(e)),
    }
    if !folder.join(".anser-owned").exists() && fs::read_dir(&folder).map_err(err)?.next().is_none()
    {
        return fs::remove_dir(&folder).map_err(err);
    }
    let path = payload(root, id)?;
    if path.exists() {
        regular(&path)?;
    }
    // Never recursive-delete: unexpected files cause an error and remain intact.
    let folder = path.parent().ok_or("写信附件路径无效")?;
    for entry in fs::read_dir(folder).map_err(err)? {
        let entry = entry.map_err(err)?;
        if !["payload", ".anser-owned"].contains(&entry.file_name().to_string_lossy().as_ref()) {
            return Err("写信附件目录存在其他文件，未清理".into());
        }
    }
    match fs::remove_file(&path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(err(e)),
    }
    fs::remove_file(folder.join(".anser-owned")).map_err(err)?;
    fs::remove_dir(folder).map_err(err)
}
struct Prepared {
    file: ForwardFile,
    hash: String,
}
#[derive(Debug)]
pub struct AttachmentBytes {
    pub name: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}
#[derive(serde::Serialize)]
pub struct BodyImage {
    pub src: String,
    pub name: String,
}
fn raster_mime(bytes: &[u8]) -> Result<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Ok("image/webp")
    } else {
        Err("请选择 PNG、JPEG、GIF 或 WebP 图片".into())
    }
}
fn write_file(
    root: &Path,
    name: String,
    mime: String,
    bytes: &[u8],
    included: bool,
) -> Result<Prepared> {
    if name.is_empty() || name.chars().any(char::is_control) {
        return Err("原附件名称无效，请先另存并重命名".into());
    }
    lettre::message::header::ContentType::parse(&mime).map_err(|_| "原附件类型无效")?;
    let id = uuid::Uuid::new_v4().to_string();
    let folder = root_folder(root)?.join(&id);
    fs::create_dir(&folder).map_err(err)?;
    let saved = (|| -> Result<()> {
        permissions(&folder, 0o700)?;
        archive::atomic_write(&folder.join(".anser-owned"), id.as_bytes())?;
        permissions(&folder.join(".anser-owned"), 0o600)?;
        archive::atomic_write(&folder.join("payload"), bytes)?;
        permissions(&folder.join("payload"), 0o600)
    })();
    if let Err(error) = saved {
        let _ = fs::remove_file(folder.join("payload"));
        let _ = fs::remove_file(folder.join(".anser-owned"));
        let _ = fs::remove_dir(&folder);
        return Err(error);
    }
    Ok(Prepared {
        file: ForwardFile {
            id,
            name,
            mime,
            size: bytes.len(),
            included,
        },
        hash: archive::digest(bytes),
    })
}
fn prepare(root: &Path, raw: &[u8], account: &Account) -> Result<Vec<Prepared>> {
    let (_, _, infos) = archive::parse(raw, account, "")?;
    let projection = crate::mail_formats::mime(raw)?;
    let parsed = mailparse::parse_mail(&projection).map_err(err)?;
    let mut parts = Vec::new();
    archive::leaves(&parsed, &mut parts);
    let mut files = Vec::new();
    let mut total = 0;
    let saved = (|| -> Result<()> {
        for info in infos {
            if !info.error.is_empty() {
                return Err("原附件解码失败，请先核查原邮件；没有跳过附件".into());
            }
            let bytes = archive::decoded_bytes(parts.get(info.index).ok_or("原附件索引无效")?)?;
            total += bytes.len();
            if total > MAX_BYTES {
                return Err("开发版单封附件总大小上限为50 MB".into());
            }
            files.push(write_file(root, info.name, info.mime, &bytes, true)?);
        }
        Ok(())
    })();
    if let Err(error) = saved {
        for p in &files {
            let _ = delete_payload(root, &p.file.id);
        }
        return Err(error);
    }
    Ok(files)
}
fn insert(db: &rusqlite::Connection, owner: &str, files: &[Prepared]) -> Result<()> {
    for p in files {
        db.execute(
            "INSERT INTO compose_files VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                p.file.id,
                owner,
                p.file.name,
                p.file.mime,
                p.file.size,
                p.hash,
                chrono::Utc::now().timestamp()
            ],
        )
        .map_err(err)?;
    }
    Ok(())
}
fn metadata(db: &rusqlite::Connection, owner: &str, file: &ForwardFile) -> Result<String> {
    id_valid(&file.id)?;
    let data: Option<(String, String, usize, String)> = db
        .query_row(
            "SELECT name,mime,size,hash FROM compose_files WHERE id=?1 AND draft_id=?2",
            params![file.id, owner],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(err)?;
    let (name, mime, size, hash) = data.ok_or("原附件副本不属于这份草稿，请重新准备")?;
    if name != file.name || mime != file.mime || size != file.size {
        return Err("原附件副本信息已变化，请重新准备".into());
    }
    Ok(hash)
}
impl Store {
    pub fn read_body_images(
        &self,
        owner: &str,
        token: &str,
        paths: &[String],
    ) -> Result<Vec<BodyImage>> {
        use base64::Engine;
        use std::io::Read;
        let check = || -> Result<()> {
            let allowed: bool = self.db()?.query_row(
                "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1 AND token=?2) AND NOT EXISTS(SELECT 1 FROM outbox WHERE id=?1 AND status IN ('scheduled','overdue','paused','sending','sent','uncertain'))",
                params![owner, token], |r| r.get(0)).map_err(err)?;
            if allowed {
                Ok(())
            } else {
                Err("写信窗口已关闭或提交，图片读取已取消".into())
            }
        };
        check()?;
        if paths.is_empty() || paths.len() > 20 {
            return Err("每次请选择1至20张正文图片".into());
        }
        let mut result = Vec::new();
        let mut total = 0;
        for path in paths {
            regular(Path::new(path))?;
            let file = fs::File::open(path).map_err(err)?;
            let max = 10 * 1024 * 1024;
            if !file.metadata().map_err(err)?.is_file() || file.metadata().map_err(err)?.len() > max
            {
                return Err("单张正文图片不能超过10 MB".into());
            }
            let mut bytes = Vec::new();
            file.take(max + 1).read_to_end(&mut bytes).map_err(err)?;
            if bytes.len() as u64 > max {
                return Err("正文图片读取期间变大，请重新选择".into());
            }
            total += bytes.len();
            if total > MAX_BYTES {
                return Err("正文图片总大小超过50 MB".into());
            }
            let mime = raster_mime(&bytes)?;
            result.push(BodyImage {
                src: format!(
                    "data:{mime};base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                ),
                name: Path::new(path)
                    .file_name()
                    .ok_or("图片名称无效")?
                    .to_string_lossy()
                    .into(),
            });
        }
        check()?;
        Ok(result)
    }
    pub fn open_compose_session(&self, owner: &str) -> Result<String> {
        if owner.is_empty() || owner.len() > 512 {
            return Err("草稿标识无效".into());
        }
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let locked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1 AND status IN ('scheduled','overdue','paused','sending','sent','uncertain'))",[owner],|r|r.get(0)).map_err(err)?;
        if locked {
            return Err("此邮件已进入发送记录，不能准备附件".into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO compose_sessions VALUES(?1,?2) ON CONFLICT(draft_id) DO UPDATE SET token=excluded.token",params![owner,token]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(token)
    }
    pub fn close_compose_session(&self, owner: &str, token: &str) -> Result<()> {
        self.db()?
            .execute(
                "DELETE FROM compose_sessions WHERE draft_id=?1 AND token=?2",
                params![owner, token],
            )
            .map_err(err)?;
        self.collect_compose_files(owner)?;
        Ok(())
    }
    pub fn prepare_forward_files(
        &self,
        owner: &str,
        token: &str,
        source: &ForwardSource,
    ) -> Result<Vec<ForwardFile>> {
        self.prepare_forward_files_then(owner, token, source, || {})
    }
    fn prepare_forward_files_then(
        &self,
        owner: &str,
        token: &str,
        source: &ForwardSource,
        before_publish: impl FnOnce(),
    ) -> Result<Vec<ForwardFile>> {
        if source.hash.len() != 64 || !source.hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("原邮件快照缺失，请重新打开原邮件".into());
        }
        let allowed: bool = self
            .db()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1 AND token=?2)",
                params![owner, token],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !allowed {
            return Err("写信窗口已关闭或切换，附件准备已取消".into());
        }
        let initial = self.mail(&source.id)?;
        let raw = self.message_raw(&initial)?;
        if archive::digest(&raw) != source.hash {
            return Err("原邮件内容已变化，请重新打开后转发".into());
        }
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        let db = self.db()?;
        let live: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1 AND token=?2)",
                params![owner, token],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !live {
            return Err("写信窗口已关闭或切换，附件准备已取消".into());
        }
        let files = prepare(&self.root, &raw, &self.account_for_mail(&initial))?;
        before_publish();
        let publish = (|| -> Result<()> {
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(err)?;
            let live: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1 AND token=?2)",
                    params![owner, token],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !live {
                return Err("写信窗口已关闭或切换，附件准备已取消".into());
            }
            let current: Option<(String, String)> = tx
                .query_row(
                    "SELECT account_id,hash FROM messages WHERE id=?1",
                    [&source.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .map_err(err)?;
            if current != Some((initial.account_id.clone(), initial.hash.clone())) {
                return Err("原邮件身份已变化，附件准备已取消".into());
            }
            insert(&tx, owner, &files)?;
            tx.commit().map_err(err)
        })();
        if let Err(error) = publish {
            for p in &files {
                let _ = delete_payload(&self.root, &p.file.id);
            }
            return Err(error);
        }
        Ok(files.into_iter().map(|p| p.file).collect())
    }
    pub fn prepare_external_forward_files(
        &self,
        owner: &str,
        token: &str,
        raw: &[u8],
    ) -> Result<Vec<ForwardFile>> {
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        let db = self.db()?;
        let live: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1 AND token=?2)",
                params![owner, token],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !live {
            return Err("写信窗口已关闭或切换，附件准备已取消".into());
        }
        let files = prepare(&self.root, raw, &crate::eml_files::account())?;
        let publish = (|| -> Result<()> {
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(err)?;
            let live: bool = tx
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1 AND token=?2)",
                    params![owner, token],
                    |r| r.get(0),
                )
                .map_err(err)?;
            if !live {
                return Err("写信窗口已关闭或切换，附件准备已取消".into());
            }
            insert(&tx, owner, &files)?;
            tx.commit().map_err(err)
        })();
        if let Err(error) = publish {
            for p in &files {
                let _ = delete_payload(&self.root, &p.file.id);
            }
            return Err(error);
        }
        Ok(files.into_iter().map(|p| p.file).collect())
    }
    pub(crate) fn recover_forward_files(
        &self,
        owner: &str,
        raw: &[u8],
    ) -> Result<Vec<ForwardFile>> {
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        let files = prepare(&self.root, raw, &crate::eml_files::account())?;
        let publish = (|| -> Result<()> {
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(err)?;
            insert(&tx, owner, &files)?;
            tx.commit().map_err(err)
        })();
        if let Err(error) = publish {
            for p in &files {
                let _ = delete_payload(&self.root, &p.file.id);
            }
            return Err(error);
        }
        Ok(files.into_iter().map(|p| p.file).collect())
    }
    pub(crate) fn recover_excluded_files(
        &self,
        old: &Compose,
        new_owner: &str,
    ) -> Result<Vec<ForwardFile>> {
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        let db = self.db()?;
        let mut files = Vec::new();
        let saved = (|| -> Result<()> {
            for file in old.forward_files.iter().filter(|f| !f.included) {
                let hash = metadata(&db, &old.id, file)?;
                let path = payload(&self.root, &file.id)?;
                regular(&path)?;
                if fs::metadata(&path).map_err(err)?.len() != file.size as u64
                    || file.size > MAX_BYTES
                {
                    return Err("原附件副本大小变化，未恢复草稿".into());
                }
                let bytes = fs::read(&path).map_err(err)?;
                if bytes.len() != file.size || archive::digest(&bytes) != hash {
                    return Err("未选原附件副本校验失败，未恢复草稿".into());
                }
                files.push(write_file(
                    &self.root,
                    file.name.clone(),
                    file.mime.clone(),
                    &bytes,
                    false,
                )?);
            }
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(err)?;
            insert(&tx, new_owner, &files)?;
            tx.commit().map_err(err)
        })();
        if let Err(error) = saved {
            for p in &files {
                let _ = delete_payload(&self.root, &p.file.id);
            }
            return Err(error);
        }
        Ok(files.into_iter().map(|p| p.file).collect())
    }
    pub(crate) fn validate_forward_files(&self, draft: &Compose) -> Result<()> {
        let db = self.db()?;
        let mut seen = HashSet::new();
        for file in &draft.forward_files {
            if !seen.insert(&file.id) {
                return Err("原附件副本重复，请重新准备".into());
            }
            metadata(&db, &draft.id, file)?;
        }
        Ok(())
    }
    pub(crate) fn forward_payloads(&self, draft: &Compose) -> Result<Vec<AttachmentBytes>> {
        if draft.forward_source.is_some() {
            return Err("原附件尚未准备完成，请重试或选择不携带原附件".into());
        }
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        self.validate_forward_files(draft)?;
        let db = self.db()?;
        let mut total = 0;
        let mut result = Vec::new();
        for file in draft.forward_files.iter().filter(|f| f.included) {
            let hash = metadata(&db, &draft.id, file)?;
            let path = payload(&self.root, &file.id)?;
            regular(&path)?;
            if fs::metadata(&path).map_err(err)?.len() != file.size as u64 {
                return Err("原附件副本大小变化，未发送".into());
            }
            total += file.size;
            if total > MAX_BYTES {
                return Err("开发版单封附件总大小上限为50 MB".into());
            }
            let bytes = fs::read(path).map_err(err)?;
            if archive::digest(&bytes) != hash {
                return Err("原附件副本校验失败，未发送".into());
            }
            result.push(AttachmentBytes {
                name: file.name.clone(),
                mime: file.mime.clone(),
                bytes,
            });
        }
        Ok(result)
    }
    pub(crate) fn collect_compose_files(&self, owner: &str) -> Result<()> {
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        let db = self.db()?;
        let active: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1)",
                [owner],
                |r| r.get(0),
            )
            .map_err(err)?;
        if active {
            return Ok(());
        }
        let held:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1 AND status NOT IN ('sent','cancelled'))",[owner],|r|r.get(0)).map_err(err)?;
        if held {
            return Ok(());
        }
        let frozen: Option<(Vec<u8>, String)> = db
            .query_row(
                "SELECT raw,raw_hash FROM outbox WHERE id=?1",
                [owner],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(err)?;
        if frozen
            .as_ref()
            .is_some_and(|(raw, hash)| raw.is_empty() || archive::digest(raw) != *hash)
        {
            return Ok(());
        }
        let ids = db
            .prepare("SELECT id FROM compose_files WHERE draft_id=?1")
            .map_err(err)?
            .query_map([owner], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        for id in ids {
            let referenced:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM drafts d,json_each(d.data,'$.forwardFiles') f WHERE json_extract(f.value,'$.id')=?1)",[&id],|r|r.get(0)).map_err(err)?;
            if referenced {
                continue;
            }
            delete_payload(&self.root, &id)?;
            db.execute("DELETE FROM compose_files WHERE id=?1", [&id])
                .map_err(err)?;
        }
        Ok(())
    }
    pub(crate) fn cleanup_old_compose_files(&self) -> Result<()> {
        let owners = self
            .db()?
            .prepare("SELECT DISTINCT draft_id FROM compose_files WHERE created_at<?1")
            .map_err(err)?
            .query_map([chrono::Utc::now().timestamp() - 24 * 3600], |r| {
                r.get::<_, String>(0)
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        for owner in owners {
            self.collect_compose_files(&owner)?;
        }
        let folder = self
            .root
            .canonicalize()
            .map_err(err)?
            .join("compose-attachments");
        if folder.exists() {
            let g = gate(&self.root)?;
            let _guard = g.lock().map_err(err)?;
            let folder = root_folder(&self.root)?;
            let db = self.db()?;
            for entry in fs::read_dir(folder).map_err(err)? {
                let entry = entry.map_err(err)?;
                let id = entry.file_name().to_string_lossy().into_owned();
                if id_valid(&id).is_err() {
                    continue;
                }
                let info = fs::symlink_metadata(entry.path()).map_err(err)?;
                if !info.is_dir() || info.file_type().is_symlink() {
                    continue;
                }
                let aged = info
                    .modified()
                    .ok()
                    .and_then(|time| time.elapsed().ok())
                    .is_some_and(|age| age.as_secs() > 24 * 3600);
                let tracked: bool = db
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM compose_files WHERE id=?1)",
                        [&id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                if aged && !tracked {
                    delete_payload(&self.root, &id)?;
                }
            }
        }
        Ok(())
    }
    pub(crate) fn save_draft_with_files(&self, draft: &Compose) -> Result<()> {
        let g = gate(&self.root)?;
        let _guard = g.lock().map_err(err)?;
        self.validate_forward_files(draft)?;
        self.save_draft_record(draft)
    }
    pub fn delete_compose_draft(&self, id: &str) -> Result<()> {
        self.db()?
            .execute("DELETE FROM drafts WHERE id=?1", [id])
            .map_err(err)?;
        self.collect_compose_files(id)
    }
    pub fn clear_compose_drafts(&self, drafts: &[Compose]) -> Result<ClearDraftsResult> {
        let mut ids = HashSet::new();
        for draft in drafts {
            if draft.id.is_empty() || draft.id.len() > 512 || !ids.insert(draft.id.clone()) {
                return Err("草稿列表无效，请刷新后重试".into());
            }
        }
        {
            // Serialize against autosave, editor leases and managed attachments.
            // Validate the entire confirmation snapshot before deleting anything.
            let g = gate(&self.root)?;
            let _guard = g.lock().map_err(err)?;
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(err)?;
            for expected in drafts {
                let stored: Option<String> = tx
                    .query_row("SELECT data FROM drafts WHERE id=?1", [&expected.id], |r| {
                        r.get(0)
                    })
                    .optional()
                    .map_err(err)?;
                let current: Compose =
                    serde_json::from_str(&stored.ok_or("草稿列表已变化，请刷新后重新清空")?)
                        .map_err(err)?;
                if serde_json::to_value(&current).map_err(err)?
                    != serde_json::to_value(expected).map_err(err)?
                {
                    return Err("草稿内容已变化，请刷新后重新清空".into());
                }
                let editing: bool = tx
                    .query_row(
                        "SELECT EXISTS(SELECT 1 FROM compose_sessions WHERE draft_id=?1)",
                        [&expected.id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                if editing {
                    return Err("有草稿正在编辑，请先关闭写信窗口再清空".into());
                }
                let locked: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1 AND status IN ('scheduled','overdue','paused','sending','sent','uncertain'))", [&expected.id], |r| r.get(0)).map_err(err)?;
                if locked {
                    return Err("有草稿已进入发送记录，请刷新后重新核对".into());
                }
            }
            for id in &ids {
                tx.execute("DELETE FROM drafts WHERE id=?1", [id])
                    .map_err(err)?;
            }
            tx.commit().map_err(err)?;
        }
        // Draft removal is committed. Cleanup can safely retry independently;
        // do not report it as a failed deletion or discard held outbox files.
        let cleanup_pending = ids
            .iter()
            .filter(|id| self.collect_compose_files(id).is_err())
            .count();
        Ok(ClearDraftsResult {
            deleted: ids.len(),
            cleanup_pending,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        network,
        tests::{account, draft},
    };
    #[test]
    fn body_images_are_snapshots_bound_to_live_editor_and_kept_in_drafts_and_mime() {
        use base64::Engine;
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let mut d = draft();
        let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=").unwrap();
        let file = dir.path().join("picture.dat");
        fs::write(&file, &png).unwrap();
        let paths = vec![file.to_string_lossy().into_owned()];
        assert!(store.read_body_images(&d.id, "stale", &paths).is_err());
        let token = store.open_compose_session(&d.id).unwrap();
        let image = store
            .read_body_images(&d.id, &token, &paths)
            .unwrap()
            .pop()
            .unwrap();
        d.format = "rich".into();
        d.html = format!("<p><span style=\"font-family:SimSun;font-size:10.5pt\">Test</span><img src=\"{}\"><img src=\"{}\"></p>",image.src,image.src);
        store.save_draft(&d).unwrap();
        store.close_compose_session(&d.id, &token).unwrap();
        assert!(store.read_body_images(&d.id, &token, &paths).is_err());
        assert_eq!(fs::read(&file).unwrap(), png);
        fs::remove_file(&file).unwrap();
        let reopened = Store::new(dir.path().into()).unwrap();
        let saved = reopened.drafts().unwrap().pop().unwrap();
        assert_eq!(saved.html, d.html);
        let raw = network::build_message(&a, &saved).unwrap().formatted();
        let parsed = mailparse::parse_mail(&raw).unwrap();
        let mut parts = vec![];
        archive::leaves(&parsed, &mut parts);
        let images: Vec<_> = parts
            .iter()
            .filter(|p| p.ctype.mimetype == "image/png")
            .collect();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].get_body_raw().unwrap(), png);
        let html = parts
            .iter()
            .find(|p| p.ctype.mimetype == "text/html")
            .unwrap()
            .get_body()
            .unwrap();
        assert!(
            html.contains("font-size:10.5pt")
                && html.contains("cid:anser-")
                && !html.contains("data:image/")
        );
    }
    #[test]
    fn body_image_reader_rejects_non_images_large_files_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let d = draft();
        let token = store.open_compose_session(&d.id).unwrap();
        let file = dir.path().join("fake.png");
        fs::write(&file, b"<svg/>").unwrap();
        let paths = vec![file.to_string_lossy().into_owned()];
        assert!(store.read_body_images(&d.id, &token, &paths).is_err());
        fs::File::create(&file)
            .unwrap()
            .set_len(10 * 1024 * 1024 + 1)
            .unwrap();
        assert!(store.read_body_images(&d.id, &token, &paths).is_err());
        #[cfg(unix)]
        {
            let link = dir.path().join("link.png");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            assert!(store
                .read_body_images(&d.id, &token, &[link.to_string_lossy().into_owned()])
                .is_err());
        }
    }
    fn raw() -> Vec<u8> {
        b"From: alice@example.com\r\nTo: test@example.com\r\nSubject: Fictional files\r\nMessage-ID: <files@example.com>\r\nDate: Thu, 1 Oct 2026 08:00:00 +0800\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nBody\r\n--x\r\nContent-Type: application/pdf; name=report.pdf\r\nContent-Disposition: attachment; filename=report.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nAP/+AQ==\r\n--x\r\nContent-Type: text/plain; name=report.pdf\r\nContent-Disposition: attachment; filename=report.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--x--\r\n".to_vec()
    }
    fn fixture() -> (tempfile::TempDir, Store, Compose, ForwardSource, String) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        store.save_account(&account()).unwrap();
        store
            .ingest(&account(), "INBOX", "7:1", &raw(), false)
            .unwrap();
        let id = store.snapshot(&crate::tests::query()).unwrap().messages[0]
            .id
            .clone();
        let detail = store.detail(&id).unwrap();
        let d = draft();
        let token = store.open_compose_session(&d.id).unwrap();
        (
            dir,
            store,
            d,
            ForwardSource {
                id,
                hash: detail.original_hash,
            },
            token,
        )
    }
    #[test]
    fn external_forward_uses_read_only_snapshot_without_mailbox_record() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let mut d = draft();
        let token = store.open_compose_session(&d.id).unwrap();
        let original = raw();
        d.forward_files = store
            .prepare_external_forward_files(&d.id, &token, &original)
            .unwrap();
        assert_eq!(d.forward_files.len(), 2);
        assert_eq!(d.forward_files[0].name, "report.pdf");
        assert_eq!(d.forward_files[0].size, 4);
        assert_eq!(d.forward_files[1].size, 5);
        assert_eq!(raw(), original);
        store.close_compose_session(&d.id, &token).unwrap();
        assert!(store
            .prepare_external_forward_files(&d.id, &token, &original)
            .is_err());
    }
    #[test]
    fn bulk_draft_clear_only_removes_confirmed_drafts_and_owned_files() {
        let (_dir, store, mut d, source, token) = fixture();
        d.forward_files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        let paths = d
            .forward_files
            .iter()
            .map(|f| payload(&store.root, &f.id).unwrap())
            .collect::<Vec<_>>();
        store.save_draft(&d).unwrap();
        store.close_compose_session(&d.id, &token).unwrap();
        let mut second = draft();
        second.id = "bulk-two".into();
        store.save_draft(&second).unwrap();
        let mut newer = draft();
        newer.id = "created-after-confirmation".into();
        store.save_draft(&newer).unwrap();
        let result = store.clear_compose_drafts(&[d, second]).unwrap();
        assert_eq!(result.deleted, 2);
        assert_eq!(result.cleanup_pending, 0);
        assert_eq!(store.drafts().unwrap()[0].id, newer.id);
        assert_eq!(store.drafts().unwrap().len(), 1);
        assert!(paths.iter().all(|path| !path.exists()));
        assert_eq!(
            store.message_raw(&store.mail(&source.id).unwrap()).unwrap(),
            raw()
        );
    }
    #[test]
    fn bulk_draft_clear_rejects_editing_changed_and_frozen_drafts_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let first = draft();
        let mut second = draft();
        second.id = "bulk-two".into();
        store.save_draft(&first).unwrap();
        store.save_draft(&second).unwrap();
        let expected = vec![first.clone(), second.clone()];
        let token = store.open_compose_session(&second.id).unwrap();
        assert!(store
            .clear_compose_drafts(&expected)
            .unwrap_err()
            .contains("正在编辑"));
        assert_eq!(store.drafts().unwrap().len(), 2);
        store.close_compose_session(&second.id, &token).unwrap();
        second.subject = "Changed while confirming".into();
        store.save_draft(&second).unwrap();
        assert!(store
            .clear_compose_drafts(&expected)
            .unwrap_err()
            .contains("内容已变化"));
        assert_eq!(store.drafts().unwrap().len(), 2);
        let expected = vec![first, second.clone()];
        for status in ["scheduled", "sending", "uncertain"] {
            store.db().unwrap().execute("INSERT INTO outbox(id,status,data,raw) VALUES(?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET status=excluded.status", params![second.id, status, serde_json::to_string(&second).unwrap(), raw()]).unwrap();
            assert!(store
                .clear_compose_drafts(&expected)
                .unwrap_err()
                .contains("发送记录"));
            assert_eq!(store.drafts().unwrap().len(), 2);
            assert_eq!(
                store
                    .db()
                    .unwrap()
                    .query_row("SELECT status FROM outbox WHERE id=?1", [&second.id], |r| r
                        .get::<_, String>(0))
                    .unwrap(),
                status
            );
        }
    }
    #[test]
    fn bulk_draft_clear_database_failure_rolls_back_every_deletion() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let first = draft();
        let mut second = draft();
        second.id = "bulk-two".into();
        store.save_draft(&first).unwrap();
        store.save_draft(&second).unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER reject_bulk_delete BEFORE DELETE ON drafts WHEN OLD.id='bulk-two' BEGIN SELECT RAISE(ABORT,'fixture failure'); END").unwrap();
        assert!(store.clear_compose_drafts(&[first, second]).is_err());
        assert_eq!(store.drafts().unwrap().len(), 2);
    }
    #[cfg(unix)]
    #[test]
    fn bulk_draft_clear_reports_pending_cleanup_without_following_symlinks() {
        let (dir, store, mut d, source, token) = fixture();
        d.forward_files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        store.save_draft(&d).unwrap();
        store.close_compose_session(&d.id, &token).unwrap();
        let path = payload(&store.root, &d.forward_files[0].id).unwrap();
        fs::remove_file(&path).unwrap();
        let external = dir.path().join("user-owned.txt");
        fs::write(&external, b"keep me").unwrap();
        std::os::unix::fs::symlink(&external, &path).unwrap();
        let result = store.clear_compose_drafts(&[d]).unwrap();
        assert_eq!(result.deleted, 1);
        assert_eq!(result.cleanup_pending, 1);
        assert!(store.drafts().unwrap().is_empty());
        assert_eq!(fs::read(&external).unwrap(), b"keep me");
        assert_eq!(
            store.message_raw(&store.mail(&source.id).unwrap()).unwrap(),
            raw()
        );
    }
    #[test]
    fn forward_copies_preserve_same_names_distinct_bytes_types_and_original_after_restart() {
        let (dir, store, mut d, source, token) = fixture();
        d.forward_files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        assert_eq!(d.forward_files.len(), 2);
        assert_ne!(d.forward_files[0].id, d.forward_files[1].id);
        let parts = store.forward_payloads(&d).unwrap();
        assert_eq!(parts[0].name, parts[1].name);
        assert_eq!(parts[0].mime, "application/pdf");
        assert_eq!(parts[1].mime, "text/plain");
        assert_eq!(parts[0].bytes, [0, 255, 254, 1]);
        assert_eq!(parts[1].bytes, b"hello");
        let sent = network::build_prepared_message(&store, &account(), &d)
            .unwrap()
            .formatted();
        let (_, _, infos) = archive::parse(&sent, &account(), "Sent").unwrap();
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].name, "report.pdf");
        assert_eq!(infos[0].mime, "application/pdf");
        assert_eq!(
            archive::attachment(&sent, infos[0].index).unwrap(),
            [0, 255, 254, 1]
        );
        store.save_draft(&d).unwrap();
        store.close_compose_session(&d.id, &token).unwrap();
        let reopened = Store::new(dir.path().into()).unwrap();
        let restored = reopened.drafts().unwrap().remove(0);
        assert_eq!(
            reopened.forward_payloads(&restored).unwrap()[1].bytes,
            b"hello"
        );
        assert_eq!(
            reopened
                .message_raw(&reopened.mail(&source.id).unwrap())
                .unwrap(),
            raw()
        );
    }
    #[test]
    fn stale_source_and_cancelled_publication_never_publish_or_change_original() {
        let (dir, store, d, mut source, token) = fixture();
        source.hash = "0".repeat(64);
        assert!(store
            .prepare_forward_files(&d.id, &token, &source)
            .unwrap_err()
            .contains("内容已变化"));
        source.hash = archive::digest(&raw());
        let failed = store.prepare_forward_files_then(&d.id, &token, &source, || {
            store
                .db()
                .unwrap()
                .execute("DELETE FROM compose_sessions WHERE draft_id=?1", [&d.id])
                .unwrap();
        });
        assert!(failed.unwrap_err().contains("已取消"));
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM compose_files", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            fs::read_dir(dir.path().join("compose-attachments"))
                .unwrap()
                .count(),
            1
        );
        assert_eq!(
            store.message_raw(&store.mail(&source.id).unwrap()).unwrap(),
            raw()
        );
    }
    #[test]
    fn cross_draft_metadata_tampering_and_modified_bytes_are_rejected() {
        let (_dir, store, mut d, source, token) = fixture();
        d.forward_files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        let mut other = d.clone();
        other.id = "another-draft".into();
        assert!(store.forward_payloads(&other).is_err());
        other = d.clone();
        other.forward_files[0].mime = "text/html".into();
        assert!(store.forward_payloads(&other).is_err());
        fs::write(
            payload(&store.root, &d.forward_files[0].id).unwrap(),
            [1, 1, 1, 1],
        )
        .unwrap();
        assert!(store.forward_payloads(&d).unwrap_err().contains("校验失败"));
        d.forward_files[0].included = false;
        assert_eq!(store.forward_payloads(&d).unwrap().len(), 1);
    }
    #[test]
    fn draft_and_session_references_control_cleanup_and_empty_discard_leaves_archive() {
        let (_dir, store, mut d, source, token) = fixture();
        d.forward_files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        store.save_draft(&d).unwrap();
        store.close_compose_session(&d.id, &token).unwrap();
        assert!(payload(&store.root, &d.forward_files[0].id)
            .unwrap()
            .exists());
        let token = store.open_compose_session(&d.id).unwrap();
        store.delete_compose_draft(&d.id).unwrap();
        assert!(payload(&store.root, &d.forward_files[0].id)
            .unwrap()
            .exists());
        store.close_compose_session(&d.id, &token).unwrap();
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM compose_files", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            store.message_raw(&store.mail(&source.id).unwrap()).unwrap(),
            raw()
        );
    }
    #[test]
    fn cancelling_frozen_schedule_preserves_selected_and_unselected_choices_with_new_ownership() {
        let (_dir, store, mut d, source, token) = fixture();
        d.forward_files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        d.forward_files[1].included = false;
        let raw = network::build_prepared_message(&store, &account(), &d)
            .unwrap()
            .formatted();
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-01T02:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        store
            .schedule_mail(&d, &raw, "2026-10-01T02:01:00Z", now)
            .unwrap();
        store.close_compose_session(&d.id, &token).unwrap();
        let restored = store.cancel_schedule(&d.id).unwrap();
        assert_ne!(restored.id, d.id);
        assert_eq!(restored.forward_files.len(), 2);
        assert!(!restored.forward_files[1].included);
        assert_eq!(
            store.forward_payloads(&restored).unwrap()[0].bytes,
            [0, 255, 254, 1]
        );
        let mut selected = restored.clone();
        selected.forward_files[1].included = true;
        assert_eq!(
            store.forward_payloads(&selected).unwrap()[1].bytes,
            b"hello"
        );
        let before = store.outbox().unwrap()[0].status.clone();
        assert_eq!(before, "cancelled");
    }
    #[cfg(unix)]
    #[test]
    fn symlink_payload_is_not_read_or_removed_and_user_file_is_untouched() {
        let (dir, store, d, source, token) = fixture();
        let files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        let p = payload(&store.root, &files[0].id).unwrap();
        fs::remove_file(&p).unwrap();
        let external = dir.path().join("user-file");
        fs::write(&external, b"keep me").unwrap();
        std::os::unix::fs::symlink(&external, &p).unwrap();
        assert!(store.close_compose_session(&d.id, &token).is_err());
        assert_eq!(fs::read(&external).unwrap(), b"keep me");
    }
    #[test]
    fn stale_unreferenced_copies_are_recovered_and_partial_cleanup_is_idempotent() {
        let (dir, store, d, source, token) = fixture();
        let files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        fs::remove_file(payload(&store.root, &files[0].id).unwrap()).unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE compose_files SET created_at=?1",
                [chrono::Utc::now().timestamp() - 48 * 3600],
            )
            .unwrap();
        let reopened = Store::new(dir.path().into()).unwrap();
        assert_eq!(
            reopened
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM compose_files", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            fs::read_dir(dir.path().join("compose-attachments"))
                .unwrap()
                .count(),
            1
        );
        assert_eq!(
            reopened
                .message_raw(&reopened.mail(&source.id).unwrap())
                .unwrap(),
            raw()
        );
    }
    #[test]
    fn archive_backup_excludes_compose_sessions_and_managed_file_metadata() {
        let (dir, store, mut d, source, token) = fixture();
        d.forward_files = store.prepare_forward_files(&d.id, &token, &source).unwrap();
        store.save_draft(&d).unwrap();
        let backup = store.backup(&dir.path().join("backups")).unwrap();
        let db = rusqlite::Connection::open(Path::new(&backup).join("snapshot.sqlite3")).unwrap();
        for table in ["drafts", "compose_files", "compose_sessions"] {
            assert_eq!(
                db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert!(payload(&store.root, &d.forward_files[0].id)
            .unwrap()
            .exists());
    }
}
