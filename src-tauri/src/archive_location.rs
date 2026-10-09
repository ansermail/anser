//! Keep the index in app data while moving complete MIME archives to a chosen disk.
use crate::{archive, models::*, store::Store};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, RwLock},
};
#[derive(Default)]
pub struct Runtime {
    pub gate: RwLock<()>,
    progress: Mutex<Progress>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    migrating: bool,
    completed: usize,
    total: usize,
}
static RUNTIMES: OnceLock<Mutex<HashMap<PathBuf, Arc<Runtime>>>> = OnceLock::new();
pub fn runtime(root: &Path) -> Arc<Runtime> {
    RUNTIMES
        .get_or_init(Default::default)
        .lock()
        .expect("archive runtime lock")
        .entry(root.to_path_buf())
        .or_default()
        .clone()
}
#[derive(Serialize, Deserialize)]
struct Location {
    path: PathBuf,
    token: String,
}
#[derive(Serialize, Deserialize)]
struct Cleanup {
    from: PathBuf,
    destination: PathBuf,
    token: String,
    hashes: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationStatus {
    pub path: String,
    pub default_path: String,
    pub available: bool,
    pub error: String,
    pub external: bool,
    pub cleanup_pending: bool,
    #[serde(flatten)]
    progress: Progress,
}
fn configured(root: &Path) -> Result<Option<Location>> {
    let path = root.join("archive-location.json");
    match fs::read(path) {
        Ok(data) => serde_json::from_slice(&data).map(Some).map_err(err),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}
fn check_marker(path: &Path, token: &str) -> Result<()> {
    let marker = path.join(".anser-archive-store");
    let metadata = fs::symlink_metadata(&marker)
        .map_err(|_| "存档磁盘未连接或存档目录不可用，请连接原磁盘；不会改存到本机".to_string())?;
    if !metadata.is_file() || fs::read_to_string(marker).map_err(err)? != token {
        return Err("存档目录标识不匹配，请重新连接原存档磁盘".into());
    }
    Ok(())
}
pub fn physical_root(root: &Path) -> Result<PathBuf> {
    if let Some(location) = configured(root)? {
        check_marker(&location.path, &location.token)?;
        Ok(location.path)
    } else {
        Ok(root.to_path_buf())
    }
}
pub fn display_path(root: &Path) -> String {
    configured(root)
        .ok()
        .flatten()
        .map(|l| l.path)
        .unwrap_or_else(|| root.into())
        .join("archive")
        .to_string_lossy()
        .into_owned()
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}
fn checked_file(root: &Path, hash: &str) -> Result<Vec<u8>> {
    if !valid_hash(hash) {
        return Err("无效存档文件标识".into());
    }
    let path = root.join("archive").join(format!("{hash}.eml"));
    if !fs::symlink_metadata(&path).map_err(err)?.is_file() {
        return Err("存档原件不是普通文件".into());
    }
    let bytes = fs::read(path).map_err(err)?;
    if archive::digest(&bytes) != hash {
        return Err("存档原件校验失败，迁移未提交".into());
    }
    Ok(bytes)
}
fn identity(root: &Path) -> Result<String> {
    let path = root.join("archive-store-id");
    if path.exists() {
        return fs::read_to_string(path).map_err(err);
    }
    let id = uuid::Uuid::new_v4().to_string();
    archive::atomic_write(&path, id.as_bytes())?;
    Ok(id)
}
impl Store {
    pub fn archive_location(&self) -> LocationStatus {
        let rt = runtime(&self.root);
        let configured = configured(&self.root);
        let path = configured
            .as_ref()
            .ok()
            .and_then(|l| l.as_ref())
            .map(|l| l.path.clone())
            .unwrap_or_else(|| self.root.clone());
        let error = physical_root(&self.root).err().unwrap_or_default();
        let progress = rt.progress.lock().expect("archive progress lock").clone();
        let cleanup_pending = fs::read(self.root.join(".archive-migration-cleanup.json"))
            .ok()
            .and_then(|data| serde_json::from_slice::<Cleanup>(&data).ok())
            .is_some_and(|cleanup| cleanup.destination == path);
        LocationStatus {
            path: path.join("archive").to_string_lossy().into_owned(),
            default_path: self.root.join("archive").to_string_lossy().into_owned(),
            available: error.is_empty(),
            error,
            external: path != self.root,
            cleanup_pending,
            progress,
        }
    }
    pub fn move_archive_location(&self, parent: &str) -> Result<LocationStatus> {
        let _local = self.archive_gate.write().map_err(err)?;
        let rt = runtime(&self.root);
        if self.root.join(".archive-migration-cleanup.json").exists() {
            let _cleanup = rt.gate.write().map_err(err)?;
            self.cleanup_archive_migration_inner()?;
        }
        self.recover_archive_deletion()?;
        let _guard = rt.gate.write().map_err(err)?;
        let from = physical_root(&self.root)?;
        let token = identity(&self.root)?;
        let destination = if parent.is_empty() {
            self.root.clone()
        } else {
            let parent = Path::new(parent);
            if !parent.is_absolute() || !parent.is_dir() {
                return Err("请选择已连接磁盘上的现有文件夹".into());
            }
            let parent = fs::canonicalize(parent).map_err(err)?;
            if parent.starts_with(from.join("archive")) {
                return Err("不能将存档目录移动到它自己的内部".into());
            }
            parent.join("Anser-Archive")
        };
        if destination == from {
            return Ok(self.archive_location());
        }
        if destination.exists() {
            if destination == self.root { /* built-in app data */
            } else {
                check_marker(&destination, &token)?;
            }
        } else {
            fs::create_dir(&destination).map_err(err)?;
        }
        archive::atomic_write(&destination.join(".anser-archive-store"), token.as_bytes())?;
        fs::create_dir_all(destination.join("archive")).map_err(err)?;
        let mut hashes = Vec::new();
        if from.join("archive").exists() {
            for entry in fs::read_dir(from.join("archive")).map_err(err)? {
                let entry = entry.map_err(err)?;
                let name = entry.file_name().to_string_lossy().into_owned();
                if let Some(hash) = name.strip_suffix(".eml") {
                    if !valid_hash(hash) || !entry.file_type().map_err(err)?.is_file() {
                        return Err("原存档目录含无效文件，迁移未提交".into());
                    }
                    hashes.push(hash.to_string());
                }
            }
        }
        let known: std::collections::HashSet<_> = hashes.iter().collect();
        let db = self.db()?;
        let mut stmt=db.prepare("SELECT DISTINCT hash FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1").map_err(err)?;
        for hash in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
            let hash = hash.map_err(err)?;
            if !known.contains(&hash) {
                return Err(
                    "有已保存邮件缺少原件，迁移未提交；请先连接原存档磁盘或恢复备份".into(),
                );
            }
        }
        *rt.progress.lock().map_err(err)? = Progress {
            migrating: true,
            total: hashes.len(),
            completed: 0,
        };
        let result = (|| -> Result<()> {
            for (index, hash) in hashes.iter().enumerate() {
                let bytes = checked_file(&from, hash)?;
                let target = destination.join("archive").join(format!("{hash}.eml"));
                if target.exists() {
                    checked_file(&destination, hash)?;
                } else {
                    archive::atomic_write(&target, &bytes)?;
                }
                checked_file(&destination, hash)?;
                rt.progress.lock().map_err(err)?.completed = index + 1;
            }
            // Record cleanup before switching. Recovery only deletes after config
            // points at this verified destination; interruption never deletes source.
            let cleanup = Cleanup {
                from: from.clone(),
                destination: destination.clone(),
                token: token.clone(),
                hashes,
            };
            archive::atomic_write(
                &self.root.join(".archive-migration-cleanup.json"),
                &serde_json::to_vec(&cleanup).map_err(err)?,
            )?;
            archive::atomic_write(
                &self.root.join("archive-location.json"),
                &serde_json::to_vec(&Location {
                    path: destination,
                    token,
                })
                .map_err(err)?,
            )?;
            self.cleanup_archive_migration_inner()
                .map_err(|error| format!("存档路径已切换，原位置清理待完成：{error}"))?;
            Ok(())
        })();
        rt.progress.lock().map_err(err)?.migrating = false;
        result?;
        Ok(self.archive_location())
    }
    fn cleanup_archive_migration_inner(&self) -> Result<()> {
        let journal = self.root.join(".archive-migration-cleanup.json");
        let data = match fs::read(&journal) {
            Ok(data) => data,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(err(e)),
        };
        let cleanup: Cleanup = serde_json::from_slice(&data).map_err(err)?;
        if physical_root(&self.root)? != cleanup.destination {
            fs::remove_file(journal).map_err(err)?;
            return Ok(());
        }
        if cleanup.from != self.root {
            check_marker(&cleanup.from, &cleanup.token)?;
        }
        if cleanup.destination == cleanup.from {
            return Err("存档迁移记录无效".into());
        }
        for hash in cleanup.hashes {
            checked_file(&cleanup.destination, &hash)?;
            let source = cleanup.from.join("archive").join(format!("{hash}.eml"));
            if source.exists() {
                checked_file(&cleanup.from, &hash)?;
                fs::remove_file(source).map_err(err)?;
            }
        }
        fs::remove_file(journal).map_err(err)
    }
    pub fn cleanup_archive_migration(&self) -> Result<LocationStatus> {
        let _local = self.archive_gate.write().map_err(err)?;
        let rt = runtime(&self.root);
        let _guard = rt.gate.write().map_err(err)?;
        self.cleanup_archive_migration_inner()?;
        Ok(self.archive_location())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (tempfile::TempDir, Store, Vec<u8>, String) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::new(d.path().into()).unwrap();
        let a = crate::tests::account();
        s.save_account(&a).unwrap();
        let raw=b"From: sender@example.com\r\nTo: test@example.com\r\nSubject: External storage\r\n\r\noriginal".to_vec();
        s.ingest(&a, "INBOX", "1:1", &raw, false).unwrap();
        let hash = archive::digest(&raw);
        (d, s, raw, hash)
    }
    #[test]
    fn migration_reopen_backup_restore_and_missing_disk_preserve_index_and_bytes() {
        let (d, s, raw, hash) = setup();
        let disk = tempfile::tempdir().unwrap();
        let status = s
            .move_archive_location(disk.path().to_str().unwrap())
            .unwrap();
        assert!(status.external);
        assert!(!d
            .path()
            .join("archive")
            .join(format!("{hash}.eml"))
            .exists());
        assert_eq!(archive::read_raw(&s.root, &hash).unwrap(), raw);
        let reopened = Store::new(d.path().into()).unwrap();
        assert_eq!(archive::read_raw(&reopened.root, &hash).unwrap(), raw);
        let backup = tempfile::tempdir().unwrap();
        let copy = s.backup(backup.path()).unwrap();
        assert_eq!(archive::read_raw(Path::new(&copy), &hash).unwrap(), raw);
        let location = disk.path().join("Anser-Archive");
        let offline = disk.path().join("Disconnected");
        fs::rename(&location, &offline).unwrap();
        assert!(!s.archive_location().available);
        assert!(archive::store_raw(&s.root, b"new").is_err());
        assert!(!s
            .root
            .join("archive")
            .join(format!("{}.eml", archive::digest(b"new")))
            .exists());
        let offline_start = Store::new(d.path().into()).unwrap();
        assert_eq!(offline_start.accounts().unwrap().len(), 1);
        fs::rename(&offline, &location).unwrap();
        assert_eq!(archive::read_raw(&s.root, &hash).unwrap(), raw);
        assert!(!s.move_archive_location("").unwrap().external);
        assert_eq!(archive::read_raw(&s.root, &hash).unwrap(), raw);
    }
    #[test]
    fn deletion_after_migration_uses_external_staging_and_retains_online_metadata() {
        let (_d, s, _raw, hash) = setup();
        let disk = tempfile::tempdir().unwrap();
        s.move_archive_location(disk.path().to_str().unwrap())
            .unwrap();
        let a = crate::tests::account();
        let preview = s.archive_deletion_preview(&a.id).unwrap();
        let result = s
            .delete_local_archives(&a.id, true, preview.count, &preview.review_token)
            .unwrap();
        assert_eq!(result.deleted, 1);
        assert!(!result.cleanup_pending);
        assert!(result.freed_bytes > 0);
        assert!(archive::read_raw(&s.root, &hash).is_err());
        assert!(!disk.path().join("Anser-Archive/.archive-deletion").exists());
        let mut query = crate::tests::query();
        query.view = "all".into();
        assert_eq!(s.snapshot(&query).unwrap().messages.len(), 1);
        assert!(!s.snapshot(&query).unwrap().messages[0].saved_locally);
    }
    #[test]
    fn raw_writes_wait_for_location_switch_and_resolve_after_the_gate() {
        let (_d, s, _raw, _hash) = setup();
        let disk = tempfile::tempdir().unwrap();
        let dest = disk.path().join("Anser-Archive");
        fs::create_dir(&dest).unwrap();
        let token = identity(&s.root).unwrap();
        archive::atomic_write(&dest.join(".anser-archive-store"), token.as_bytes()).unwrap();
        let rt = runtime(&s.root);
        let guard = rt.gate.write().unwrap();
        let root = s.root.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            tx.send(archive::store_raw(&root, b"new MIME bytes"))
                .unwrap();
        });
        assert!(rx
            .recv_timeout(std::time::Duration::from_millis(25))
            .is_err());
        archive::atomic_write(
            &s.root.join("archive-location.json"),
            &serde_json::to_vec(&Location {
                path: dest.clone(),
                token,
            })
            .unwrap(),
        )
        .unwrap();
        drop(guard);
        let hash = rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap()
            .unwrap();
        worker.join().unwrap();
        assert!(dest.join("archive").join(format!("{hash}.eml")).exists());
        assert!(!s.root.join("archive").join(format!("{hash}.eml")).exists());
    }
    #[test]
    fn corruption_or_foreign_destination_never_switches_or_removes_source() {
        let (d, s, raw, hash) = setup();
        let disk = tempfile::tempdir().unwrap();
        fs::create_dir(disk.path().join("Anser-Archive")).unwrap();
        assert!(s
            .move_archive_location(disk.path().to_str().unwrap())
            .is_err());
        assert_eq!(archive::read_raw(&s.root, &hash).unwrap(), raw);
        let disk2 = tempfile::tempdir().unwrap();
        fs::write(
            d.path().join("archive").join(format!("{hash}.eml")),
            b"broken",
        )
        .unwrap();
        assert!(s
            .move_archive_location(disk2.path().to_str().unwrap())
            .is_err());
        assert!(!s.root.join("archive-location.json").exists());
        assert!(d
            .path()
            .join("archive")
            .join(format!("{hash}.eml"))
            .exists());
        assert!(!s.archive_location().progress.migrating);
    }
    #[test]
    fn interrupted_before_switch_keeps_original_and_after_switch_finishes_cleanup() {
        let (d, s, raw, hash) = setup();
        let disk = tempfile::tempdir().unwrap();
        let dest = disk.path().join("Anser-Archive");
        fs::create_dir(&dest).unwrap();
        let token = identity(&s.root).unwrap();
        archive::atomic_write(&dest.join(".anser-archive-store"), token.as_bytes()).unwrap();
        archive::atomic_write(&dest.join("archive").join(format!("{hash}.eml")), &raw).unwrap();
        let journal = Cleanup {
            from: s.root.clone(),
            destination: dest.clone(),
            token: token.clone(),
            hashes: vec![hash.clone()],
        };
        let path = s.root.join(".archive-migration-cleanup.json");
        archive::atomic_write(&path, &serde_json::to_vec(&journal).unwrap()).unwrap();
        s.cleanup_archive_migration().unwrap();
        assert_eq!(archive::read_raw(&s.root, &hash).unwrap(), raw);
        archive::atomic_write(&path, &serde_json::to_vec(&journal).unwrap()).unwrap();
        archive::atomic_write(
            &s.root.join("archive-location.json"),
            &serde_json::to_vec(&Location { path: dest, token }).unwrap(),
        )
        .unwrap();
        let reopened = Store::new(d.path().into()).unwrap();
        assert_eq!(archive::read_raw(&reopened.root, &hash).unwrap(), raw);
        assert!(!d
            .path()
            .join("archive")
            .join(format!("{hash}.eml"))
            .exists());
        assert!(!path.exists());
    }
}
