//! Move old complete originals to an attached archive disk while keeping the
//! index local. A copied file is verified before it is published or removed.
use crate::{archive, archive_location, models::*, store::Store};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, RwLock,
    },
    time::Duration,
};

const DEFAULT_RETENTION_DAYS: u32 = 7;
const MAX_RETENTION_DAYS: u32 = 3650;
const MAX_RECORDS: usize = 50;
const AUTO_START_DELAY: Duration = Duration::from_secs(10 * 60);
const AUTO_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Serialize, Deserialize)]
struct Config {
    path: PathBuf,
    token: String,
    #[serde(default = "default_retention")]
    retention_days: u32,
}

fn default_retention() -> u32 {
    DEFAULT_RETENTION_DAYS
}

#[derive(Clone)]
struct Candidate {
    hash: String,
    mail_date: String,
    subject: String,
    sender: String,
    size: u64,
}

#[derive(Default, Clone)]
struct State {
    running: bool,
    action: String,
    completed: usize,
    total: usize,
    error: String,
}

#[derive(Clone, Default)]
struct RuntimeRef {
    state: Arc<Mutex<State>>,
    busy: Arc<AtomicBool>,
    gate: Arc<RwLock<()>>,
    maintenance: Arc<Mutex<()>>,
}

static RUNTIMES: OnceLock<Mutex<HashMap<PathBuf, RuntimeRef>>> = OnceLock::new();

fn runtime(root: &Path) -> RuntimeRef {
    RUNTIMES
        .get_or_init(Default::default)
        .lock()
        .expect("archive tier runtime lock")
        .entry(root.to_path_buf())
        .or_default()
        .clone()
}

pub(crate) fn maintenance(root: &Path) -> Arc<Mutex<()>> {
    runtime(root).maintenance
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierRecord {
    pub id: i64,
    pub time: String,
    pub action: String,
    pub moved: u64,
    pub bytes: u64,
    pub error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TierStatus {
    pub configured: bool,
    pub path: String,
    pub available: bool,
    pub error: String,
    pub retention_days: u32,
    pub archived_count: u64,
    pub archived_bytes: u64,
    pub pending_count: u64,
    pub pending_bytes: u64,
    pub running: bool,
    pub action: String,
    pub completed: usize,
    pub total: usize,
    pub recent: Vec<TierRecord>,
}

#[derive(Default)]
struct Summary {
    total: usize,
    moved: u64,
    bytes: u64,
    errors: Vec<String>,
}

impl Summary {
    fn error_text(&self) -> String {
        let mut text = self.errors.join("；");
        if text.chars().count() > 1_000 {
            text = text.chars().take(1_000).collect();
        }
        text
    }
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS archive_tier(
            hash TEXT PRIMARY KEY,
            rel_path TEXT NOT NULL,
            mail_date TEXT NOT NULL,
            subject TEXT NOT NULL,
            sender TEXT NOT NULL,
            size INTEGER NOT NULL,
            archived_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS archive_tier_restored(
            hash TEXT PRIMARY KEY,
            restored_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS archive_tier_log(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            time TEXT NOT NULL,
            action TEXT NOT NULL,
            moved INTEGER NOT NULL,
            bytes INTEGER NOT NULL,
            error TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS archive_tier_log_time ON archive_tier_log(id DESC);",
    )
    .map_err(err)
}

fn config_path(root: &Path) -> PathBuf {
    root.join("archive-tier.json")
}

fn marker_path(root: &Path) -> PathBuf {
    root.join(".anser-tier-store")
}

fn index_path(root: &Path) -> PathBuf {
    root.join("index.html")
}

fn configured(root: &Path) -> Result<Option<Config>> {
    match fs::read(config_path(root)) {
        Ok(data) => serde_json::from_slice(&data).map(Some).map_err(err),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(err(error)),
    }
}

fn check_marker(config: &Config) -> Result<()> {
    let marker = config.path.join(".anser-tier-store");
    let metadata = fs::symlink_metadata(&marker).map_err(|_| {
        "附加存档盘未连接或目录不可用，请连接原磁盘；本地近期邮件仍可读取".to_string()
    })?;
    if !metadata.is_file() || fs::read_to_string(marker).map_err(err)? != config.token {
        return Err("附加存档目录标识不匹配，请重新选择原目录".into());
    }
    Ok(())
}

fn identity(root: &Path) -> Result<String> {
    let path = root.join("archive-tier-id");
    if path.exists() {
        return fs::read_to_string(path).map_err(err);
    }
    let id = uuid::Uuid::new_v4().to_string();
    archive::atomic_write(&path, id.as_bytes())?;
    Ok(id)
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn local_date_parts(value: &str) -> (String, String) {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .or_else(|| chrono::DateTime::parse_from_rfc2822(value).ok())
        .map(|date| {
            let date = date.with_timezone(&chrono::Local);
            (date.format("%Y").to_string(), date.format("%m").to_string())
        })
        .unwrap_or_else(|| ("unsorted".into(), "unknown".into()))
}

fn relative_path(mail_date: &str, hash: &str) -> String {
    let (year, month) = local_date_parts(mail_date);
    format!("{year}/{month}/{hash}.eml")
}

fn checked_relative(rel: &str, hash: &str) -> Option<PathBuf> {
    if !valid_hash(hash) {
        return None;
    }
    if !rel.ends_with(&format!("/{hash}.eml")) {
        return None;
    }
    let path = Path::new(rel);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return None;
    }
    Some(path.to_path_buf())
}

fn tier_file(config: &Config, hash: &str, rel: &str) -> Option<PathBuf> {
    checked_relative(rel, hash).map(|path| config.path.join(path))
}

fn open_db(root: &Path) -> Result<Option<Connection>> {
    let path = root.join("mail.sqlite3");
    if !path.is_file() {
        return Ok(None);
    }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    db.busy_timeout(Duration::from_secs(2)).map_err(err)?;
    Ok(Some(db))
}

fn indexed_rel(root: &Path, hash: &str) -> Result<Option<String>> {
    let Some(db) = open_db(root)? else {
        return Ok(None);
    };
    db.query_row(
        "SELECT rel_path FROM archive_tier WHERE hash=?1",
        [hash],
        |row| row.get(0),
    )
    .optional()
    .map_err(err)
}

fn checked_file(path: &Path) -> Result<u64> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "附加存档中缺少该原件，请连接原磁盘或恢复备份".to_string())?;
    if !metadata.is_file() {
        return Err("附加存档原件不是普通文件".into());
    }
    Ok(metadata.len())
}

/// A per-run snapshot of the attached archive index. Verification uses this
/// instead of opening the database and re-reading the marker for every mail.
pub(crate) struct Reader {
    root: PathBuf,
    config: Option<Config>,
    marker_error: Option<String>,
    entries: HashMap<String, String>,
}

impl Reader {
    pub(crate) fn load(root: &Path) -> Result<Self> {
        let config = configured(root)?;
        let marker_error = config
            .as_ref()
            .and_then(|config| check_marker(config).err());
        let entries = match open_db(root)? {
            Some(db) => {
                let mut query = db
                    .prepare("SELECT hash,rel_path FROM archive_tier")
                    .map_err(err)?;
                let entries = query
                    .query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map_err(err)?
                    .collect::<std::result::Result<HashMap<_, _>, _>>()
                    .map_err(err)?;
                entries
            }
            None => HashMap::new(),
        };
        Ok(Self {
            root: root.to_path_buf(),
            config,
            marker_error,
            entries,
        })
    }

    pub(crate) fn marker_error(&self) -> Option<&str> {
        self.marker_error.as_deref()
    }

    pub(crate) fn entry(&self, hash: &str) -> Option<&str> {
        self.entries.get(hash).map(String::as_str)
    }

    pub(crate) fn has_entries(&self) -> bool {
        !self.entries.is_empty()
    }

    pub(crate) fn stage_root(&self) -> Result<PathBuf> {
        let config = self.config.as_ref().ok_or("未配置附加存档")?;
        if let Some(error) = &self.marker_error {
            return Err(error.clone());
        }
        let root = config.path.join(".archive-tier-deletion");
        let stage = root.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&stage).map_err(err)?;
        Ok(stage)
    }

    pub(crate) fn stage_deletion(&self, hash: &str, stage: &Path) -> Result<u64> {
        let config = self.config.as_ref().ok_or("未配置附加存档")?;
        if let Some(error) = &self.marker_error {
            return Err(error.clone());
        }
        let rel = self.entries.get(hash).ok_or("附加存档索引中没有该邮件")?;
        let path = tier_file(config, hash, rel).ok_or("附加存档路径无效")?;
        let gate = runtime(&self.root).gate;
        let _write = gate.write().map_err(err)?;
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() => {
                let bytes = metadata.len();
                fs::rename(&path, stage.join(format!("{hash}.eml"))).map_err(err)?;
                Ok(bytes)
            }
            Ok(_) => Err("附加存档原件不是普通文件".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
            Err(error) => Err(err(error)),
        }
    }

    pub(crate) fn size(&self, hash: &str) -> Result<Option<u64>> {
        let (Some(config), Some(rel)) = (self.config.as_ref(), self.entries.get(hash)) else {
            return Ok(None);
        };
        if let Some(error) = &self.marker_error {
            return Err(error.clone());
        }
        let path = tier_file(config, hash, rel).ok_or("附加存档路径无效")?;
        let gate = runtime(&self.root).gate;
        let _read = gate.read().map_err(err)?;
        checked_file(&path).map(Some)
    }

    pub(crate) fn read(&self, hash: &str) -> Result<Vec<u8>> {
        let (Some(config), Some(rel)) = (self.config.as_ref(), self.entries.get(hash)) else {
            return Err("附加存档索引中没有该邮件".into());
        };
        if let Some(error) = &self.marker_error {
            return Err(error.clone());
        }
        let path = tier_file(config, hash, rel).ok_or("附加存档路径无效")?;
        let gate = runtime(&self.root).gate;
        let _read = gate.read().map_err(err)?;
        checked_file(&path)?;
        let raw = fs::read(path).map_err(err)?;
        if archive::digest(&raw) != hash {
            return Err("附加存档原件校验失败，请从备份恢复".into());
        }
        Ok(raw)
    }
}

pub fn read_raw(root: &Path, hash: &str) -> Result<Vec<u8>> {
    if !valid_hash(hash) {
        return Err("无效存档标识".into());
    }
    let config = configured(root)?.ok_or("本地原件不存在，且未配置附加存档")?;
    check_marker(&config)?;
    let rel = indexed_rel(root, hash)?.ok_or("附加存档索引中没有该邮件")?;
    let path = tier_file(&config, hash, &rel).ok_or("附加存档路径无效")?;
    let gate = runtime(root).gate;
    let _read = gate.read().map_err(err)?;
    checked_file(&path)?;
    let raw = fs::read(path).map_err(err)?;
    if archive::digest(&raw) != hash {
        return Err("附加存档原件校验失败，请从备份恢复".into());
    }
    Ok(raw)
}

fn pending_counts(db: &Connection, days: u32) -> Result<(u64, u64)> {
    let modifier = format!("-{days} days");
    db.query_row(
        "SELECT COUNT(*),COALESCE(SUM(size),0) FROM (
            SELECT DISTINCT m.hash,COALESCE(json_extract(m.data,'$.size'),0) AS size
            FROM search_documents d JOIN messages m ON m.id=d.mail_id
            WHERE d.saved_locally=1 AND d.instant IS NOT NULL
              AND d.instant < julianday('now',?1)
              AND NOT EXISTS(SELECT 1 FROM archive_tier t WHERE t.hash=m.hash)
              AND NOT EXISTS(SELECT 1 FROM archive_tier_restored r WHERE r.hash=m.hash)
        )",
        [modifier],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .map_err(err)
}

fn recent_records(db: &Connection) -> Result<Vec<TierRecord>> {
    let mut query = db
        .prepare(
            "SELECT id,time,action,moved,bytes,error FROM archive_tier_log
             ORDER BY id DESC LIMIT ?1",
        )
        .map_err(err)?;
    let records = query
        .query_map([MAX_RECORDS as i64], |row| {
            Ok(TierRecord {
                id: row.get(0)?,
                time: row.get(1)?,
                action: row.get(2)?,
                moved: row.get(3)?,
                bytes: row.get(4)?,
                error: row.get(5)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(records)
}

pub fn status(store: &Store) -> Result<TierStatus> {
    let rt = runtime(&store.root);
    let state = rt.state.lock().map_err(err)?.clone();
    let mut error = state.error.clone();
    let config = match configured(&store.root) {
        Ok(config) => config,
        Err(value) => {
            if error.is_empty() {
                error = value;
            }
            None
        }
    };
    let available = config
        .as_ref()
        .map(|config| match check_marker(config) {
            Ok(()) => true,
            Err(value) => {
                if error.is_empty() {
                    error = value;
                }
                false
            }
        })
        .unwrap_or(false);
    let retention_days = config
        .as_ref()
        .map(|config| config.retention_days)
        .unwrap_or(DEFAULT_RETENTION_DAYS);
    let db = store.db()?;
    let (archived_count, archived_bytes) = db
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(size),0) FROM archive_tier",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(err)?;
    let (pending_count, pending_bytes) = if config.is_some() {
        pending_counts(&db, retention_days)?
    } else {
        (0, 0)
    };
    Ok(TierStatus {
        configured: config.is_some(),
        path: config
            .as_ref()
            .map(|config| config.path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        available,
        error,
        retention_days,
        archived_count,
        archived_bytes,
        pending_count,
        pending_bytes,
        running: state.running,
        action: state.action,
        completed: state.completed,
        total: state.total,
        recent: recent_records(&db)?,
    })
}

fn validate_retention(days: u32) -> Result<u32> {
    if (1..=MAX_RETENTION_DAYS).contains(&days) {
        Ok(days)
    } else {
        Err(format!("保留天数需在 1 到 {MAX_RETENTION_DAYS} 天之间"))
    }
}

fn directory_has_entries(path: &Path) -> Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    for entry in fs::read_dir(path).map_err(err)? {
        let entry = entry.map_err(err)?;
        let name = entry.file_name();
        if name != ".DS_Store" {
            return Ok(true);
        }
    }
    Ok(false)
}

fn sample_matches(root: &Path, config: &Config) -> Result<bool> {
    let db = match open_db(root)? {
        Some(db) => db,
        None => return Ok(false),
    };
    let mut query = db
        .prepare("SELECT hash,rel_path FROM archive_tier ORDER BY archived_at DESC LIMIT 5")
        .map_err(err)?;
    let rows = query
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    if rows.is_empty() {
        return Ok(true);
    }
    for (hash, rel) in rows {
        let Some(path) = tier_file(config, &hash, &rel) else {
            return Ok(false);
        };
        let Ok(raw) = fs::read(path) else {
            return Ok(false);
        };
        if archive::digest(&raw) != hash {
            return Ok(false);
        }
    }
    Ok(true)
}

pub fn configure(store: &Store, path: &str, days: u32) -> Result<TierStatus> {
    let days = validate_retention(days)?;
    let rt = runtime(&store.root);
    let _maintenance = rt.maintenance.lock().map_err(err)?;
    let _store = store.archive_gate.write().map_err(err)?;
    let requested = Path::new(path);
    if !requested.is_absolute() {
        return Err("请选择附加存档磁盘上的绝对路径".into());
    }
    if requested.exists() && !requested.is_dir() {
        return Err("附加存档路径不是文件夹".into());
    }
    fs::create_dir_all(requested).map_err(err)?;
    let destination = fs::canonicalize(requested).map_err(err)?;
    let primary = archive_location::physical_root(&store.root)?;
    if destination == primary
        || destination.starts_with(primary.join("archive"))
        || primary.starts_with(&destination)
    {
        return Err("附加存档目录不能与本机存档目录重叠".into());
    }
    let current = configured(&store.root)?;
    let db = store.db()?;
    let archived: u64 = db
        .query_row("SELECT COUNT(*) FROM archive_tier", [], |row| row.get(0))
        .map_err(err)?;
    let token = identity(&store.root)?;
    let marker = marker_path(&destination);
    let marker_token = fs::read_to_string(&marker).ok();
    let sample = Config {
        path: destination.clone(),
        token: token.clone(),
        retention_days: days,
    };
    let same_path = current
        .as_ref()
        .is_some_and(|config| fs::canonicalize(&config.path).ok() == Some(destination.clone()));
    if marker_token.is_some() && marker_token.as_deref() != Some(token.as_str()) {
        return Err("该目录属于另一台雁信存档，请选择空文件夹或原附加存档目录".into());
    }
    let marker_matches = marker_token.as_deref() == Some(token.as_str());
    if !same_path {
        if archived > 0 {
            if !marker_matches || !sample_matches(&store.root, &sample)? {
                return Err(
                    "已有外置存档时请选择保存该存档的原目录；如需换盘，请先“取回本地”再更改目录"
                        .into(),
                );
            }
        } else if !marker_matches && directory_has_entries(&destination)? {
            return Err("请选择空文件夹，或已有雁信附加存档的目录".into());
        }
    } else if !marker_matches && !sample_matches(&store.root, &sample)? {
        return Err("附加存档目录中的原件不完整，请连接原磁盘并重新规范目录".into());
    }
    let config = Config {
        path: destination,
        token,
        retention_days: days,
    };
    let _write = rt.gate.write().map_err(err)?;
    archive::atomic_write(&marker, config.token.as_bytes())?;
    archive::atomic_write(
        &config_path(&store.root),
        &serde_json::to_vec(&config).map_err(err)?,
    )?;
    write_index(store, &config)?;
    drop(_write);
    drop(_maintenance);
    drop(_store);
    status(store)
}

fn candidates(store: &Store, days: u32, manual: bool) -> Result<Vec<Candidate>> {
    let db = store.db()?;
    let modifier = format!("-{days} days");
    let mut query = db
        .prepare(
            "SELECT m.hash,
                    COALESCE(json_extract(m.data,'$.date'),''),
                    COALESCE(json_extract(m.data,'$.subject'),''),
                    COALESCE(json_extract(m.data,'$.sender'),''),
                    COALESCE(json_extract(m.data,'$.size'),0)
             FROM search_documents d JOIN messages m ON m.id=d.mail_id
             WHERE d.saved_locally=1 AND d.instant IS NOT NULL
               AND d.instant < julianday('now',?1)
               AND NOT EXISTS(SELECT 1 FROM archive_tier t WHERE t.hash=m.hash)
               AND (?2=1 OR NOT EXISTS(
                    SELECT 1 FROM archive_tier_restored r WHERE r.hash=m.hash))
             GROUP BY m.hash
             ORDER BY d.instant ASC,m.hash",
        )
        .map_err(err)?;
    let rows = query
        .query_map(params![modifier, manual], |row| {
            Ok(Candidate {
                hash: row.get(0)?,
                mail_date: row.get(1)?,
                subject: row.get(2)?,
                sender: row.get(3)?,
                size: row.get(4)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

fn archive_one(
    store: &Store,
    config: &Config,
    rt: &RuntimeRef,
    candidate: &Candidate,
) -> Result<(u64, Option<String>)> {
    if !valid_hash(&candidate.hash) {
        return Err("存档标识无效，请先校验存档".into());
    }
    let rel = relative_path(&candidate.mail_date, &candidate.hash);
    let target = tier_file(config, &candidate.hash, &rel).ok_or("附加存档路径无效")?;
    let raw;
    {
        let _store = store.archive_gate.read().map_err(err)?;
        let _tier = rt.gate.write().map_err(err)?;
        let primary = archive_location::physical_root(&store.root)?;
        let source = primary
            .join("archive")
            .join(format!("{}.eml", candidate.hash));
        raw = fs::read(&source).map_err(err)?;
        if archive::digest(&raw) != candidate.hash {
            return Err("本地原件校验失败，未移动".into());
        }
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_file() => {
                let existing = fs::read(&target).map_err(err)?;
                if archive::digest(&existing) != candidate.hash {
                    return Err("附加存档已有同名但内容不同的文件".into());
                }
            }
            Ok(_) => return Err("附加存档目标位置不是普通文件".into()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                archive::atomic_write(&target, &raw)?;
            }
            Err(error) => return Err(err(error)),
        }
    }
    {
        let _store = store.archive_gate.write().map_err(err)?;
        let _tier = rt.gate.write().map_err(err)?;
        let primary = archive_location::physical_root(&store.root)?;
        let source = primary
            .join("archive")
            .join(format!("{}.eml", candidate.hash));
        if source.exists() {
            let current = fs::read(&source).map_err(err)?;
            if archive::digest(&current) != candidate.hash {
                return Err("本地原件在移动期间发生变化，已取消该封".into());
            }
        }
        let current = fs::read(&target).map_err(err)?;
        if archive::digest(&current) != candidate.hash {
            return Err("附加存档复制校验失败，未移除本地原件".into());
        }
        let mut db = store.db()?;
        let tx = db.transaction().map_err(err)?;
        tx.execute(
            "INSERT INTO archive_tier(hash,rel_path,mail_date,subject,sender,size,archived_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(hash) DO UPDATE SET
               rel_path=excluded.rel_path,mail_date=excluded.mail_date,
               subject=excluded.subject,sender=excluded.sender,
               size=excluded.size,archived_at=excluded.archived_at",
            params![
                candidate.hash,
                rel,
                candidate.mail_date,
                candidate.subject,
                candidate.sender,
                candidate.size,
                now()
            ],
        )
        .map_err(err)?;
        tx.execute(
            "DELETE FROM archive_tier_restored WHERE hash=?1",
            [&candidate.hash],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        if source.exists() {
            if let Err(error) = fs::remove_file(&source) {
                return Ok((
                    raw.len() as u64,
                    Some(format!("已归档，但删除本机副本失败：{error}")),
                ));
            }
        }
    }
    Ok((raw.len() as u64, None))
}

fn archive_operation(
    store: &Store,
    config: &Config,
    rt: &RuntimeRef,
    manual: bool,
) -> Result<Summary> {
    let rows = candidates(store, config.retention_days, manual)?;
    let mut summary = Summary {
        total: rows.len(),
        ..Default::default()
    };
    {
        let mut state = rt.state.lock().map_err(err)?;
        state.running = true;
        state.action = "archive".into();
        state.total = rows.len();
        state.completed = 0;
        state.error.clear();
    }
    for (index, candidate) in rows.iter().enumerate() {
        match archive_one(store, config, rt, candidate) {
            Ok((bytes, warning)) => {
                summary.moved += 1;
                summary.bytes += bytes;
                if let Some(warning) = warning {
                    summary.errors.push(warning);
                }
            }
            Err(error) => summary.errors.push(format!(
                "{}：{error}",
                if candidate.subject.is_empty() {
                    candidate.hash.as_str()
                } else {
                    candidate.subject.as_str()
                }
            )),
        }
        rt.state.lock().map_err(err)?.completed = index + 1;
    }
    write_index(store, config)?;
    Ok(summary)
}

fn retrieve_one(store: &Store, config: &Config, rt: &RuntimeRef, hash: &str) -> Result<u64> {
    let rel = indexed_rel(&store.root, hash)?.ok_or("附加存档索引中没有该邮件")?;
    let tier = tier_file(config, hash, &rel).ok_or("附加存档路径无效")?;
    let raw;
    {
        let _store = store.archive_gate.read().map_err(err)?;
        let _tier = rt.gate.read().map_err(err)?;
        checked_file(&tier)?;
        raw = fs::read(&tier).map_err(err)?;
        if archive::digest(&raw) != hash {
            return Err("附加存档原件校验失败，未取回".into());
        }
        let primary = archive_location::physical_root(&store.root)?;
        let target = primary.join("archive").join(format!("{hash}.eml"));
        if target.exists() {
            let existing = fs::read(&target).map_err(err)?;
            if archive::digest(&existing) != hash {
                return Err("本机已有同名但内容不同的原件，未覆盖".into());
            }
        } else {
            archive::atomic_write(&target, &raw)?;
        }
    }
    {
        let _store = store.archive_gate.write().map_err(err)?;
        let _tier = rt.gate.write().map_err(err)?;
        let primary = archive_location::physical_root(&store.root)?;
        let target = primary.join("archive").join(format!("{hash}.eml"));
        let current = fs::read(&target).map_err(err)?;
        if archive::digest(&current) != hash {
            return Err("取回的本机副本校验失败，未移除附加存档".into());
        }
        let current = fs::read(&tier).map_err(err)?;
        if archive::digest(&current) != hash {
            return Err("附加存档原件校验失败，未删除".into());
        }
        let mut db = store.db()?;
        let tx = db.transaction().map_err(err)?;
        tx.execute("DELETE FROM archive_tier WHERE hash=?1", [hash])
            .map_err(err)?;
        tx.execute(
            "INSERT INTO archive_tier_restored(hash,restored_at) VALUES(?1,?2)
             ON CONFLICT(hash) DO UPDATE SET restored_at=excluded.restored_at",
            params![hash, now()],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        fs::remove_file(&tier).map_err(err)?;
    }
    Ok(raw.len() as u64)
}

fn retrieve_operation(store: &Store, config: &Config, rt: &RuntimeRef) -> Result<Summary> {
    let db = store.db()?;
    let hashes = {
        let mut query = db
            .prepare("SELECT hash FROM archive_tier ORDER BY archived_at,hash")
            .map_err(err)?;
        let hashes = query
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        hashes
    };
    let mut summary = Summary {
        total: hashes.len(),
        ..Default::default()
    };
    {
        let mut state = rt.state.lock().map_err(err)?;
        state.running = true;
        state.action = "retrieve".into();
        state.total = hashes.len();
        state.completed = 0;
        state.error.clear();
    }
    for (index, hash) in hashes.iter().enumerate() {
        match retrieve_one(store, config, rt, hash) {
            Ok(bytes) => {
                summary.moved += 1;
                summary.bytes += bytes;
            }
            Err(error) => summary.errors.push(format!("{hash}：{error}")),
        }
        rt.state.lock().map_err(err)?.completed = index + 1;
    }
    write_index(store, config)?;
    Ok(summary)
}

fn collect_eml_files(
    root: &Path,
    files: &mut HashMap<String, PathBuf>,
    depth: usize,
) -> Result<()> {
    if depth > 8 {
        return Ok(());
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(err(error)),
    };
    for entry in entries {
        let entry = entry.map_err(err)?;
        let file_type = entry.file_type().map_err(err)?;
        if file_type.is_dir() {
            collect_eml_files(&entry.path(), files, depth + 1)?;
        } else if file_type.is_file() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(hash) = name.strip_suffix(".eml") {
                if valid_hash(hash) {
                    files
                        .entry(hash.to_string())
                        .or_insert_with(|| entry.path());
                }
            }
        }
    }
    Ok(())
}

fn normalize_operation(store: &Store, config: &Config, rt: &RuntimeRef) -> Result<Summary> {
    let db = store.db()?;
    let rows = {
        let mut query = db
            .prepare("SELECT hash,mail_date,rel_path FROM archive_tier ORDER BY hash")
            .map_err(err)?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    let mut existing = HashMap::new();
    collect_eml_files(&config.path, &mut existing, 0)?;
    let mut summary = Summary {
        total: rows.len(),
        ..Default::default()
    };
    {
        let mut state = rt.state.lock().map_err(err)?;
        state.running = true;
        state.action = "normalize".into();
        state.total = rows.len();
        state.completed = 0;
        state.error.clear();
    }
    for (index, (hash, mail_date, current_rel)) in rows.iter().enumerate() {
        let desired = relative_path(mail_date, hash);
        let desired_path = tier_file(config, hash, &desired).ok_or("附加存档路径无效")?;
        let current = tier_file(config, hash, current_rel)
            .filter(|path| path.is_file())
            .or_else(|| existing.get(hash).cloned());
        let result = (|| -> Result<Option<u64>> {
            let Some(current) = current else {
                return Err("附加存档中缺少该原件".into());
            };
            let _write = rt.gate.write().map_err(err)?;
            let raw = fs::read(&current).map_err(err)?;
            if archive::digest(&raw) != *hash {
                return Err("附加存档原件校验失败".into());
            }
            if current != desired_path {
                if desired_path.exists() {
                    let existing = fs::read(&desired_path).map_err(err)?;
                    if archive::digest(&existing) != *hash {
                        return Err("规范目录时遇到同名但内容不同的文件".into());
                    }
                } else {
                    archive::atomic_write(&desired_path, &raw)?;
                }
                if current.exists() {
                    fs::remove_file(&current).map_err(err)?;
                }
            }
            if current_rel != &desired {
                db.execute(
                    "UPDATE archive_tier SET rel_path=?2 WHERE hash=?1",
                    params![hash, desired],
                )
                .map_err(err)?;
            }
            Ok((current != desired_path).then_some(raw.len() as u64))
        })();
        match result {
            Ok(Some(bytes)) => {
                summary.moved += 1;
                summary.bytes += bytes;
            }
            Ok(None) => {}
            Err(error) => summary.errors.push(format!("{hash}：{error}")),
        }
        rt.state.lock().map_err(err)?.completed = index + 1;
    }
    write_index(store, config)?;
    Ok(summary)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn display_date(value: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .or_else(|| chrono::DateTime::parse_from_rfc2822(value).ok())
        .map(|date| {
            date.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H:%M")
                .to_string()
        })
        .unwrap_or_else(|| value.to_string())
}

fn display_size(bytes: u64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    const KB: f64 = 1024.0;
    if bytes as f64 >= MB {
        format!("{:.1} MB", bytes as f64 / MB)
    } else if bytes as f64 >= KB {
        format!("{:.0} KB", bytes as f64 / KB)
    } else {
        format!("{bytes} B")
    }
}

fn write_index(store: &Store, config: &Config) -> Result<()> {
    let db = store.db()?;
    let rows = {
        let mut query = db
            .prepare(
                "SELECT rel_path,mail_date,subject,sender,size FROM archive_tier
                 ORDER BY julianday(mail_date) IS NULL,julianday(mail_date) DESC,
                          subject,rel_path",
            )
            .map_err(err)?;
        let rows = query
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, u64>(4)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    let mut html = String::from(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
         <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\
         <title>雁信附加存档</title><style>\
         :root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}\
         body{margin:0;padding:28px;background:#f6f7f9;color:#17191c}\
         main{max-width:1180px;margin:auto}h1{font-size:24px;margin:0 0 8px}\
         p{color:#666;margin:0 0 18px}input{box-sizing:border-box;width:100%;max-width:460px;\
         padding:9px 12px;border:1px solid #c8ccd2;border-radius:8px;background:white;font:inherit}\
         table{width:100%;border-collapse:collapse;background:white;margin-top:18px;border-radius:10px;overflow:hidden}\
         th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #e7e9ed;font-size:13px}\
         th{position:sticky;top:0;background:#f0f2f5}td a{color:#075ecf;text-decoration:none}\
         td.num{text-align:right;white-space:nowrap;color:#666}\
         @media(prefers-color-scheme:dark){body{background:#16181c;color:#e9eaec}table{background:#202329}\
         th{background:#282c33}td{border-color:#34383f}p,td.num{color:#a9aeb6}input{background:#202329;color:#e9eaec;border-color:#444a53}\
         td a{color:#7bb3ff}}</style></head><body><main>\
         <h1>雁信附加存档</h1><p>按邮件日期保存的完整原始邮件。用浏览器打开此文件即可检索；共 ",
    );
    html.push_str(&rows.len().to_string());
    html.push_str(
        " 封。</p><input id=\"q\" type=\"search\" placeholder=\"搜索主题或发件人\">\
         <table><thead><tr><th>日期</th><th>主题</th><th>发件人</th><th class=\"num\">大小</th></tr>\
         </thead><tbody id=\"rows\">",
    );
    for (rel, date, subject, sender, size) in rows {
        html.push_str("<tr><td>");
        html.push_str(&escape_html(&display_date(&date)));
        html.push_str("</td><td><a href=\"");
        html.push_str(&escape_html(&rel));
        html.push_str("\">");
        html.push_str(&escape_html(if subject.is_empty() {
            "（无主题）"
        } else {
            &subject
        }));
        html.push_str("</a></td><td>");
        html.push_str(&escape_html(&sender));
        html.push_str("</td><td class=\"num\">");
        html.push_str(&escape_html(&display_size(size)));
        html.push_str("</td></tr>");
    }
    html.push_str(
        "</tbody></table></main><script>\
         const q=document.getElementById('q'),rows=[...document.querySelectorAll('#rows tr')];\
         q.addEventListener('input',()=>{const v=q.value.trim().toLocaleLowerCase();\
         for(const row of rows)row.hidden=!!v&&!row.textContent.toLocaleLowerCase().includes(v)});\
         </script></body></html>",
    );
    archive::atomic_write(&index_path(&config.path), html.as_bytes())
}

fn record_operation(store: &Store, action: &str, summary: &Summary) {
    let Ok(db) = store.db() else {
        return;
    };
    let _ = db.execute(
        "INSERT INTO archive_tier_log(time,action,moved,bytes,error) VALUES(?1,?2,?3,?4,?5)",
        params![
            now(),
            action,
            summary.moved,
            summary.bytes,
            summary.error_text()
        ],
    );
}

fn finish_operation(
    store: &Store,
    rt: &RuntimeRef,
    action: &str,
    result: std::result::Result<Summary, String>,
) {
    let summary = result.unwrap_or_else(|error| Summary {
        errors: vec![error],
        ..Default::default()
    });
    if summary.total > 0 || !summary.errors.is_empty() {
        record_operation(store, action, &summary);
    }
    let mut state = rt
        .state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    state.running = false;
    state.action = action.into();
    state.total = summary.total;
    state.completed = summary.total;
    state.error = summary.error_text();
    rt.busy.store(false, Ordering::Release);
}

enum Operation {
    Archive { manual: bool },
    Retrieve,
    Normalize,
}

fn start_operation(store: Store, operation: Operation) -> Result<TierStatus> {
    let rt = runtime(&store.root);
    let config = configured(&store.root)?.ok_or("请先设置附加存档目录")?;
    check_marker(&config)?;
    if rt
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("附加存档任务正在进行".into());
    }
    let action = match operation {
        Operation::Archive { .. } => "archive",
        Operation::Retrieve => "retrieve",
        Operation::Normalize => "normalize",
    };
    {
        let mut state = rt.state.lock().map_err(err)?;
        state.running = true;
        state.action = action.into();
        state.completed = 0;
        state.total = 0;
        state.error.clear();
    }
    let worker_store = store.clone();
    let worker_runtime = rt.clone();
    std::thread::spawn(move || {
        let _maintenance = worker_runtime
            .maintenance
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let config = configured(&worker_store.root)?.ok_or("请先设置附加存档目录")?;
            check_marker(&config)?;
            match operation {
                Operation::Archive { manual } => {
                    archive_operation(&worker_store, &config, &worker_runtime, manual)
                }
                Operation::Retrieve => retrieve_operation(&worker_store, &config, &worker_runtime),
                Operation::Normalize => {
                    normalize_operation(&worker_store, &config, &worker_runtime)
                }
            }
        }))
        .unwrap_or_else(|_| Err("附加存档任务异常退出".into()));
        finish_operation(&worker_store, &worker_runtime, action, result);
    });
    status(&store)
}

pub fn archive_now(store: &Store, manual: bool) -> Result<TierStatus> {
    start_operation(store.clone(), Operation::Archive { manual })
}

pub fn retrieve_local(store: &Store) -> Result<TierStatus> {
    start_operation(store.clone(), Operation::Retrieve)
}

pub fn normalize(store: &Store) -> Result<TierStatus> {
    start_operation(store.clone(), Operation::Normalize)
}

pub fn start_automatic(store: Store) {
    static STARTED: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    let mut started = STARTED
        .get_or_init(Default::default)
        .lock()
        .expect("archive tier scheduler lock");
    if !started.insert(store.root.clone()) {
        return;
    }
    drop(started);
    std::thread::spawn(move || {
        std::thread::sleep(AUTO_START_DELAY);
        loop {
            if configured(&store.root)
                .ok()
                .flatten()
                .is_some_and(|config| check_marker(&config).is_ok())
            {
                let rt = runtime(&store.root);
                if !rt.busy.load(Ordering::Acquire) {
                    let _ = start_operation(store.clone(), Operation::Archive { manual: false });
                }
            }
            std::thread::sleep(AUTO_INTERVAL);
        }
    });
}

pub(crate) fn recover_deletions(store: &Store) -> Result<()> {
    let Some(config) = configured(&store.root)? else {
        return Ok(());
    };
    let staging = config.path.join(".archive-tier-deletion");
    if !staging.exists() {
        return Ok(());
    }
    check_marker(&config)?;
    let rt = runtime(&store.root);
    let _gate = rt.gate.write().map_err(err)?;
    let db = store.db()?;
    for entry in fs::read_dir(&staging).map_err(err)? {
        let entry = entry.map_err(err)?;
        if !entry.file_type().map_err(err)?.is_dir() {
            return Err("附加存档删除暂存目录无效".into());
        }
        for file in fs::read_dir(entry.path()).map_err(err)? {
            let file = file.map_err(err)?;
            let name = file.file_name().to_string_lossy().into_owned();
            let hash = name
                .strip_suffix(".eml")
                .filter(|hash| valid_hash(hash))
                .ok_or("附加存档删除暂存文件无效")?;
            if !file.file_type().map_err(err)?.is_file() {
                return Err("附加存档删除暂存文件类型无效".into());
            }
            let rel: Option<String> = db
                .query_row(
                    "SELECT rel_path FROM archive_tier WHERE hash=?1",
                    [hash],
                    |row| row.get(0),
                )
                .optional()
                .map_err(err)?;
            if let Some(rel) = rel {
                let target = tier_file(&config, hash, &rel).ok_or("附加存档路径无效")?;
                if target.exists() {
                    checked_file(&target)?;
                    let raw = fs::read(&target).map_err(err)?;
                    if archive::digest(&raw) != hash {
                        return Err("附加存档恢复目标已存在但内容不一致".into());
                    }
                    fs::remove_file(file.path()).map_err(err)?;
                } else {
                    fs::create_dir_all(target.parent().ok_or("附加存档路径无效")?).map_err(err)?;
                    fs::rename(file.path(), &target).map_err(err)?;
                }
            } else {
                fs::remove_file(file.path()).map_err(err)?;
            }
        }
        fs::remove_dir(entry.path()).map_err(err)?;
    }
    fs::remove_dir(staging).map_err(err)
}

pub fn open_index(store: &Store) -> Result<()> {
    let config = configured(&store.root)?.ok_or("请先设置附加存档目录")?;
    check_marker(&config)?;
    if !index_path(&config.path).is_file() {
        write_index(store, &config)?;
    }
    open::that(index_path(&config.path)).map_err(err)
}

pub fn tier_hashes(root: &Path) -> Result<HashSet<String>> {
    let Some(db) = open_db(root)? else {
        return Ok(HashSet::new());
    };
    let mut query = db.prepare("SELECT hash FROM archive_tier").map_err(err)?;
    let hashes = query
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(err)?
        .collect::<std::result::Result<HashSet<_>, _>>()
        .map_err(err)?;
    Ok(hashes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, raw};

    fn dated_raw(date: chrono::DateTime<chrono::Local>, subject: &str) -> Vec<u8> {
        String::from_utf8(raw())
            .unwrap()
            .replace("Tue, 29 Sep 2026 10:00:00 +0800", &date.to_rfc2822())
            .replace("Project invoice", subject)
            .into_bytes()
    }

    fn fixture(
        date: chrono::DateTime<chrono::Local>,
        subject: &str,
    ) -> (tempfile::TempDir, Store, Account, Vec<u8>, String) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let account = account();
        store.save_account(&account).unwrap();
        let raw = dated_raw(date, subject);
        store.ingest(&account, "INBOX", "1:1", &raw, false).unwrap();
        let hash = archive::digest(&raw);
        (dir, store, account, raw, hash)
    }

    fn old_fixture() -> (tempfile::TempDir, Store, Account, Vec<u8>, String) {
        fixture(
            chrono::Local::now() - chrono::Duration::days(30),
            "Project invoice",
        )
    }

    fn configured_for(store: &Store, disk: &tempfile::TempDir) -> (PathBuf, Config) {
        let path = disk.path().join("Attached");
        configure(store, path.to_str().unwrap(), 7).unwrap();
        let config = configured(&store.root).unwrap().unwrap();
        (path, config)
    }

    fn finish(rt: &RuntimeRef, action: &str, summary: &Summary) {
        let mut state = rt.state.lock().unwrap();
        state.running = false;
        state.action = action.into();
        state.total = summary.total;
        state.completed = summary.total;
        state.error = summary.error_text();
    }

    fn run_archive(store: &Store, disk: &tempfile::TempDir, manual: bool) -> Summary {
        let _ = disk;
        let config = configured(&store.root).unwrap().unwrap();
        let rt = runtime(&store.root);
        let summary = archive_operation(store, &config, &rt, manual).unwrap();
        finish(&rt, "archive", &summary);
        summary
    }

    fn run_retrieve(store: &Store) -> Summary {
        let config = configured(&store.root).unwrap().unwrap();
        let rt = runtime(&store.root);
        let summary = retrieve_operation(store, &config, &rt).unwrap();
        finish(&rt, "retrieve", &summary);
        summary
    }

    fn run_normalize(store: &Store) -> Summary {
        let config = configured(&store.root).unwrap().unwrap();
        let rt = runtime(&store.root);
        let summary = normalize_operation(store, &config, &rt).unwrap();
        finish(&rt, "normalize", &summary);
        summary
    }

    fn local_path(store: &Store, hash: &str) -> PathBuf {
        store.root.join("archive").join(format!("{hash}.eml"))
    }

    #[test]
    fn old_originals_move_once_and_read_through_the_attached_archive() {
        let (_dir, store, _account, raw, hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        assert_eq!(status(&store).unwrap().pending_count, 1);

        let summary = run_archive(&store, &disk, false);
        assert_eq!((summary.total, summary.moved), (1, 1));
        assert!(!local_path(&store, &hash).exists());
        let rel: String = store
            .db()
            .unwrap()
            .query_row(
                "SELECT rel_path FROM archive_tier WHERE hash=?1",
                [&hash],
                |r| r.get(0),
            )
            .unwrap();
        assert!(rel.ends_with(&format!("/{hash}.eml")));
        assert!(path.join(&rel).is_file());
        assert_eq!(archive::read_raw(&store.root, &hash).unwrap(), raw);

        let state = status(&store).unwrap();
        assert_eq!((state.archived_count, state.pending_count), (1, 0));
        let index = fs::read_to_string(path.join("index.html")).unwrap();
        assert!(index.contains(&format!("href=\"{rel}\"")));
        assert!(index.contains("Project invoice"));

        let fast = crate::archive_verification::check_now(&store, "fast").unwrap();
        assert_eq!((fast.checked, fast.healthy), (1, 1));
        let deep = crate::archive_verification::check_now(&store, "deep").unwrap();
        assert_eq!((deep.checked, deep.healthy), (1, 1));
    }

    #[test]
    fn recent_messages_stay_local_until_retention_expires() {
        let (_dir, store, _account, raw, hash) = fixture(
            chrono::Local::now() - chrono::Duration::days(1),
            "Recent invoice",
        );
        let disk = tempfile::tempdir().unwrap();
        configured_for(&store, &disk);
        assert_eq!(status(&store).unwrap().pending_count, 0);
        let summary = run_archive(&store, &disk, false);
        assert_eq!((summary.total, summary.moved), (0, 0));
        assert_eq!(fs::read(local_path(&store, &hash)).unwrap(), raw);
        assert_eq!(status(&store).unwrap().archived_count, 0);
    }

    #[test]
    fn disconnected_attached_disk_keeps_recent_mail_readable_and_explains_old_mail() {
        let (_dir, store, account, old_raw, old_hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        run_archive(&store, &disk, false);
        let recent = dated_raw(chrono::Local::now() - chrono::Duration::days(1), "Recent");
        store
            .ingest(&account, "INBOX", "1:2", &recent, false)
            .unwrap();
        let recent_hash = archive::digest(&recent);

        let offline = disk.path().join("Offline");
        fs::rename(&path, &offline).unwrap();
        let error = archive::read_raw(&store.root, &old_hash).unwrap_err();
        assert!(error.contains("附加存档盘未连接"));
        assert_eq!(
            archive::read_raw(&store.root, &recent_hash).unwrap(),
            recent
        );
        fs::rename(&offline, &path).unwrap();
        assert_eq!(archive::read_raw(&store.root, &old_hash).unwrap(), old_raw);
    }

    #[test]
    fn retrieve_restores_local_files_and_manual_archive_can_move_them_again() {
        let (_dir, store, _account, raw, hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        run_archive(&store, &disk, false);
        let summary = run_retrieve(&store);
        assert_eq!((summary.total, summary.moved), (1, 1));
        assert_eq!(fs::read(local_path(&store, &hash)).unwrap(), raw);
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM archive_tier", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM archive_tier_restored", [], |r| {
                    r.get::<_, u64>(0)
                })
                .unwrap(),
            1
        );
        assert!(fs::read_dir(&path)
            .unwrap()
            .all(|entry| entry.unwrap().path().extension() != Some(std::ffi::OsStr::new("eml"))));

        assert_eq!(run_archive(&store, &disk, false).total, 0);
        assert!(local_path(&store, &hash).exists());
        assert_eq!(run_archive(&store, &disk, true).moved, 1);
        assert!(!local_path(&store, &hash).exists());
    }

    #[test]
    fn normalize_rebuilds_the_year_month_layout_and_index() {
        let (_dir, store, _account, _raw, hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        run_archive(&store, &disk, false);
        let rel: String = store
            .db()
            .unwrap()
            .query_row(
                "SELECT rel_path FROM archive_tier WHERE hash=?1",
                [&hash],
                |r| r.get(0),
            )
            .unwrap();
        let misc = path.join("misc");
        fs::create_dir_all(&misc).unwrap();
        let loose = misc.join(format!("{hash}.eml"));
        fs::rename(path.join(&rel), &loose).unwrap();

        let summary = run_normalize(&store);
        assert_eq!(summary.moved, 1);
        assert!(!loose.exists());
        assert!(path.join(&rel).is_file());
        let saved: String = store
            .db()
            .unwrap()
            .query_row(
                "SELECT rel_path FROM archive_tier WHERE hash=?1",
                [&hash],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(saved, rel);
        let index = fs::read_to_string(path.join("index.html")).unwrap();
        assert!(index.contains(&format!("href=\"{rel}\"")));
    }

    #[test]
    fn shared_hash_is_moved_once_and_deleted_only_after_the_last_saved_reference() {
        let (_dir, store, account, raw, hash) = old_fixture();
        let mut second = account.clone();
        second.id = "second".into();
        second.email = "second@example.com".into();
        store.save_account(&second).unwrap();
        store.ingest(&second, "INBOX", "2:1", &raw, false).unwrap();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        let summary = run_archive(&store, &disk, false);
        assert_eq!((summary.total, summary.moved), (1, 1));
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM archive_tier", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            1
        );
        assert!(archive::read_raw(&store.root, &hash).is_ok());

        let preview = store.archive_deletion_preview(&account.id).unwrap();
        store
            .delete_local_archives(&account.id, true, preview.count, &preview.review_token)
            .unwrap();
        assert!(archive::read_raw(&store.root, &hash).is_ok());
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM archive_tier", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            1
        );
        let rel: String = store
            .db()
            .unwrap()
            .query_row(
                "SELECT rel_path FROM archive_tier WHERE hash=?1",
                [&hash],
                |r| r.get(0),
            )
            .unwrap();
        assert!(path.join(&rel).is_file());

        let preview = store.archive_deletion_preview(&second.id).unwrap();
        store
            .delete_local_archives(&second.id, true, preview.count, &preview.review_token)
            .unwrap();
        assert!(archive::read_raw(&store.root, &hash).is_err());
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM archive_tier", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            0
        );
        assert!(!path.join(&rel).exists());
    }

    #[test]
    fn failed_deletion_restores_staged_attached_files() {
        let (_dir, store, account, _raw, hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        run_archive(&store, &disk, false);
        let preview = store.archive_deletion_preview(&account.id).unwrap();
        store
            .db()
            .unwrap()
            .execute_batch("CREATE TRIGGER fail_tier_cleanup BEFORE INSERT ON logs BEGIN SELECT RAISE(ABORT,'test failure'); END;")
            .unwrap();
        assert!(store
            .delete_local_archives(&account.id, true, preview.count, &preview.review_token)
            .is_err());
        assert!(archive::read_raw(&store.root, &hash).is_ok());
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM archive_tier", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            1
        );
        assert!(!path.join(".archive-tier-deletion").exists());
    }

    #[test]
    fn fast_verification_reports_attached_size_mismatch() {
        let (_dir, store, _account, _raw, hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        run_archive(&store, &disk, false);
        let rel: String = store
            .db()
            .unwrap()
            .query_row(
                "SELECT rel_path FROM archive_tier WHERE hash=?1",
                [&hash],
                |r| r.get(0),
            )
            .unwrap();
        fs::write(path.join(&rel), b"short").unwrap();
        let result = crate::archive_verification::check_now(&store, "fast").unwrap();
        assert_eq!((result.checked, result.healthy), (1, 0));
        assert_eq!(result.problem_count, 1);
        assert!(result.problems[0].error.contains("大小与索引不一致"));
    }

    #[test]
    fn deleting_archived_mail_requires_the_attached_disk_and_leaves_the_index_intact() {
        let (_dir, store, account, _raw, hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, _) = configured_for(&store, &disk);
        run_archive(&store, &disk, false);
        let preview = store.archive_deletion_preview(&account.id).unwrap();
        let offline = disk.path().join("Offline");
        fs::rename(&path, &offline).unwrap();
        let error = store
            .delete_local_archives(&account.id, true, preview.count, &preview.review_token)
            .unwrap_err();
        assert!(error.contains("附加存档盘未连接"));
        assert!(store.account(&account.id).unwrap().save_locally);
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row("SELECT COUNT(*) FROM archive_tier", [], |r| r
                    .get::<_, u64>(0))
                .unwrap(),
            1
        );
        fs::rename(&offline, &path).unwrap();
        assert!(archive::read_raw(&store.root, &hash).is_ok());
    }

    #[test]
    fn index_escapes_metadata_and_remains_a_standalone_document() {
        let (_dir, store, _account, _raw, _hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        let (path, config) = configured_for(&store, &disk);
        let hash = "a".repeat(64);
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO archive_tier(hash,rel_path,mail_date,subject,sender,size,archived_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![
                    hash,
                    format!("2026/11/{hash}.eml"),
                    "2026-11-01T10:00:00+08:00",
                    "A & <B> \"C\"",
                    "sender@example.com",
                    12u64,
                    now()
                ],
            )
            .unwrap();
        write_index(&store, &config).unwrap();
        let index = fs::read_to_string(path.join("index.html")).unwrap();
        assert!(index.contains("A &amp; &lt;B&gt; &quot;C&quot;"));
        assert!(!index.contains("A & <B> \"C\""));
        assert!(index.contains("<!doctype html>"));
        assert!(index.contains("type=\"search\""));
    }

    #[test]
    fn changing_the_primary_archive_location_accepts_messages_kept_on_the_attached_disk() {
        let (_dir, store, _account, raw, hash) = old_fixture();
        let disk = tempfile::tempdir().unwrap();
        configured_for(&store, &disk);
        run_archive(&store, &disk, false);
        let destination = tempfile::tempdir().unwrap();
        let status = store
            .move_archive_location(destination.path().to_str().unwrap())
            .unwrap();
        assert!(status.external);
        assert_eq!(archive::read_raw(&store.root, &hash).unwrap(), raw);
    }

    #[test]
    #[ignore = "manual real-data copy; set ANSER_REAL_ARCHIVE_COPY to a disposable copy"]
    fn manual_real_archive_copy_round_trip() {
        let source = std::env::var("ANSER_REAL_ARCHIVE_COPY").unwrap();
        let store = Store::new(PathBuf::from(source)).unwrap();
        let before = store.snapshot(&crate::tests::query()).unwrap().stats;
        assert!(before.saved > 0);
        let disk = tempfile::tempdir().unwrap();
        let (path, config) = configured_for(&store, &disk);
        let rt = runtime(&store.root);

        let archived = archive_operation(&store, &config, &rt, false).unwrap();
        finish(&rt, "archive", &archived);
        assert!(archived.moved > 0);
        let fast = crate::archive_verification::check_now(&store, "fast").unwrap();
        assert!(fast.completed);
        assert_eq!(fast.healthy as u64, before.saved);
        let deep = crate::archive_verification::check_now(&store, "deep").unwrap();
        assert!(!deep.running);
        assert_eq!(deep.checked as u64, before.saved);

        let archived_hash: String = store
            .db()
            .unwrap()
            .query_row("SELECT hash FROM archive_tier LIMIT 1", [], |row| {
                row.get(0)
            })
            .unwrap();
        let local_hash: Option<String> = store
            .db()
            .unwrap()
            .query_row(
                "SELECT m.hash FROM messages m
                 WHERE COALESCE(json_extract(m.data,'$.savedLocally'),1)=1
                   AND NOT EXISTS(SELECT 1 FROM archive_tier t WHERE t.hash=m.hash)
                 LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .unwrap();
        let offline = disk.path().join("Offline");
        fs::rename(&path, &offline).unwrap();
        assert!(archive::read_raw(&store.root, &archived_hash)
            .unwrap_err()
            .contains("附加存档盘未连接"));
        if let Some(hash) = local_hash {
            assert!(archive::read_raw(&store.root, &hash).is_ok());
        }
        fs::rename(&offline, &path).unwrap();

        let normalized = normalize_operation(&store, &config, &rt).unwrap();
        finish(&rt, "normalize", &normalized);
        let retrieved = retrieve_operation(&store, &config, &rt).unwrap();
        finish(&rt, "retrieve", &retrieved);
        assert_eq!(retrieved.moved as u64, archived.moved);
        let left: u64 = store
            .db()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM archive_tier", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 0);
        let local_files = fs::read_dir(store.root.join("archive"))
            .unwrap()
            .filter(|entry| {
                entry.as_ref().ok().is_some_and(|entry| {
                    entry.path().extension() == Some(std::ffi::OsStr::new("eml"))
                })
            })
            .count();
        let saved_hashes: u64 = store
            .db()
            .unwrap()
            .query_row(
                "SELECT COUNT(DISTINCT hash) FROM messages
                 WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(local_files as u64, saved_hashes);
    }
}
