use crate::{archive, archive_location, models::*, store::Store};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};

const MAX_PROBLEMS: usize = 200;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Fast,
    Deep,
}

struct Row {
    id: String,
    hash: String,
    subject: String,
    size: u64,
}

#[derive(Default)]
struct State {
    loaded: bool,
    status: Option<ArchiveHealth>,
}

#[derive(Clone, Default)]
struct Runtime {
    state: Arc<Mutex<State>>,
    cancel: Arc<AtomicBool>,
}

static RUNTIMES: OnceLock<Mutex<HashMap<PathBuf, Runtime>>> = OnceLock::new();

fn runtime(root: &Path) -> Runtime {
    RUNTIMES
        .get_or_init(Default::default)
        .lock()
        .expect("archive verification runtime lock")
        .entry(root.to_path_buf())
        .or_default()
        .clone()
}

fn parse_mode(value: &str) -> Result<Mode> {
    match value {
        "fast" => Ok(Mode::Fast),
        "deep" => Ok(Mode::Deep),
        _ => Err("请选择快速或深度校验".into()),
    }
}

fn mode_name(mode: Mode) -> &'static str {
    match mode {
        Mode::Fast => "fast",
        Mode::Deep => "deep",
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn base_status(mode: Mode, total: usize, started_at: String) -> ArchiveHealth {
    ArchiveHealth {
        checked: 0,
        healthy: 0,
        problems: Vec::new(),
        checked_at: String::new(),
        mode: mode_name(mode).into(),
        running: true,
        total,
        completed: false,
        cancelled: false,
        started_at,
        problem_count: 0,
        error: String::new(),
    }
}

fn persisted_path(root: &Path) -> PathBuf {
    root.join("archive-verification.json")
}

fn load_persisted(root: &Path) -> Option<ArchiveHealth> {
    let data = fs::read(persisted_path(root)).ok()?;
    let mut status: ArchiveHealth = serde_json::from_slice(&data).ok()?;
    if status.running {
        status.running = false;
        status.completed = false;
        status.cancelled = true;
        status.error = "上次校验未完成，应用已退出".into();
    }
    if status.problem_count < status.problems.len() {
        status.problem_count = status.problems.len();
    }
    Some(status)
}

fn ensure_loaded(runtime: &Runtime, root: &Path) -> Result<()> {
    let mut state = runtime.state.lock().map_err(err)?;
    if !state.loaded {
        state.status = load_persisted(root);
        state.loaded = true;
    }
    Ok(())
}

fn current(runtime: &Runtime) -> Result<Option<ArchiveHealth>> {
    Ok(runtime.state.lock().map_err(err)?.status.clone())
}

fn empty_status() -> ArchiveHealth {
    let mut status = base_status(Mode::Fast, 0, String::new());
    status.running = false;
    status
}

fn publish(runtime: &Runtime, status: &ArchiveHealth) -> Result<()> {
    let mut state = runtime.state.lock().map_err(err)?;
    state.loaded = true;
    state.status = Some(status.clone());
    Ok(())
}

fn save_result(root: &Path, status: &ArchiveHealth) -> Result<()> {
    archive::atomic_write(
        &persisted_path(root),
        &serde_json::to_vec(status).map_err(err)?,
    )
}

fn collect_rows(store: &Store) -> Result<Vec<Row>> {
    let db = store.db()?;
    let mut query = db
        .prepare(
            "SELECT l.id,m.hash,COALESCE(json_extract(l.data,'$.subject'),''),
                    COALESCE(json_extract(l.data,'$.size'),0)
             FROM message_listing l JOIN messages m ON m.id=l.id
             WHERE COALESCE(json_extract(l.data,'$.savedLocally'),1)=1
             ORDER BY l.id",
        )
        .map_err(err)?;
    let rows = query
        .query_map([], |row| {
            Ok(Row {
                id: row.get(0)?,
                hash: row.get(1)?,
                subject: row.get(2)?,
                size: row.get(3)?,
            })
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(rows)
}

fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn fast_check_file(path: &Path, hash: &str, size: u64) -> std::result::Result<(), String> {
    if !valid_hash(hash) {
        return Err("无效存档标识".into());
    }
    let metadata =
        fs::symlink_metadata(&path).map_err(|error| format!("存档原件无法读取：{error}"))?;
    if !metadata.is_file() {
        return Err("存档原件不是普通文件".into());
    }
    if size > 0 && metadata.len() != size {
        return Err(format!(
            "原件大小与索引不一致：索引 {size} 字节，实际 {} 字节",
            metadata.len()
        ));
    }
    Ok(())
}

fn deep_check_file(path: &Path, hash: &str) -> std::result::Result<(), String> {
    if !valid_hash(hash) {
        return Err("无效存档标识".into());
    }
    let raw = fs::read(path).map_err(|error| format!("存档原件无法读取：{error}"))?;
    deep_check_bytes(hash, &raw)
}

fn deep_check_bytes(hash: &str, raw: &[u8]) -> std::result::Result<(), String> {
    if archive::digest(&raw) != hash {
        return Err("存档内容校验失败".into());
    }
    let projection = crate::mail_formats::mime(&raw).map_err(|error| error.to_string())?;
    let parsed = mailparse::parse_mail(&projection).map_err(|error| error.to_string())?;
    let mut parts = Vec::new();
    archive::leaves(&parsed, &mut parts);
    for part in parts {
        archive::decoded_bytes(part).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn check_row(
    actual: &Path,
    tier: Option<&crate::archive_tier::Reader>,
    hash: &str,
    size: u64,
    mode: Mode,
) -> std::result::Result<(), String> {
    let local = actual.join("archive").join(format!("{hash}.eml"));
    match fs::symlink_metadata(&local) {
        Ok(metadata) if metadata.is_file() => {
            return match mode {
                Mode::Fast => fast_check_file(&local, hash, size),
                Mode::Deep => deep_check_file(&local, hash),
            };
        }
        Ok(_) => return Err("存档原件不是普通文件".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("存档原件无法读取：{error}")),
    }
    let Some(reader) = tier else {
        return Err("存档原件不存在，且未配置附加存档".into());
    };
    if reader.entry(hash).is_none() {
        return match reader.marker_error() {
            Some(error) => Err(error.to_string()),
            None => Err("存档原件不存在".into()),
        };
    }
    match mode {
        Mode::Fast => match reader.size(hash) {
            Ok(Some(actual)) if size > 0 && actual != size => Err(format!(
                "附加存档原件大小与索引不一致：索引 {size} 字节，实际 {actual} 字节"
            )),
            Ok(Some(_)) => Ok(()),
            Ok(None) => Err("附加存档索引中没有该邮件".into()),
            Err(error) => Err(error),
        },
        Mode::Deep => reader
            .read(hash)
            .and_then(|raw| deep_check_bytes(hash, &raw).map_err(|error| error.to_string())),
    }
    .map_err(|error| error.to_string())
}

fn verify_rows(
    store: &Store,
    rows: Vec<Row>,
    mode: Mode,
    cancel: &AtomicBool,
    mut publish_progress: impl FnMut(&ArchiveHealth),
) -> ArchiveHealth {
    let started_at = now();
    let total = rows.len();
    let mut status = base_status(mode, total, started_at);
    publish_progress(&status);

    let maintenance = crate::archive_tier::maintenance(&store.root);
    let _maintenance = match maintenance.try_lock() {
        Ok(guard) => guard,
        Err(_) => {
            status.running = false;
            status.checked_at = now();
            status.error = "附加存档任务正在进行，请稍后再校验".into();
            return status;
        }
    };
    let _archive = match store.archive_gate.read() {
        Ok(guard) => guard,
        Err(_) => {
            status.running = false;
            status.checked_at = now();
            status.error = "存档校验无法获取存档锁".into();
            return status;
        }
    };
    let location = archive_location::runtime(&store.root);
    let _location = match location.gate.read() {
        Ok(guard) => guard,
        Err(_) => {
            status.running = false;
            status.checked_at = now();
            status.error = "存档校验无法获取存档位置锁".into();
            return status;
        }
    };
    let actual = match archive_location::physical_root(&store.root) {
        Ok(actual) => actual,
        Err(error) => {
            status.running = false;
            status.checked_at = now();
            status.error = error;
            return status;
        }
    };
    let tier = match crate::archive_tier::Reader::load(&store.root) {
        Ok(reader) => {
            if reader.has_entries() {
                if let Some(error) = reader.marker_error() {
                    status.error = error.to_string();
                }
            }
            Some(reader)
        }
        Err(error) => {
            status.error = error;
            None
        }
    };
    let mut results = HashMap::<String, std::result::Result<(), String>>::new();
    for row in rows {
        if cancel.load(Ordering::Relaxed) {
            status.cancelled = true;
            break;
        }
        let result = results
            .entry(row.hash.clone())
            .or_insert_with(|| check_row(&actual, tier.as_ref(), &row.hash, row.size, mode))
            .clone();
        status.checked += 1;
        match result {
            Ok(()) => status.healthy += 1,
            Err(error) => {
                status.problem_count += 1;
                if status.problems.len() < MAX_PROBLEMS {
                    status.problems.push(ArchiveProblem {
                        mail_id: row.id,
                        subject: row.subject,
                        error,
                    });
                }
            }
        }
        if status.checked % 32 == 0 || status.checked == total {
            publish_progress(&status);
        }
    }
    status.running = false;
    status.cancelled = cancel.load(Ordering::Relaxed);
    status.completed = !status.cancelled && status.checked == total && status.error.is_empty();
    status.checked_at = now();
    publish_progress(&status);
    status
}

fn finish(store: &Store, runtime: &Runtime, mut status: ArchiveHealth) {
    if let Err(error) = save_result(&store.root, &status) {
        let suffix = format!("校验结果保存失败：{error}");
        status.error = if status.error.is_empty() {
            suffix
        } else {
            format!("{}；{suffix}", status.error)
        };
    }
    status.running = false;
    let _ = publish(runtime, &status);
}

fn run_worker(store: Store, rows: Vec<Row>, mode: Mode, runtime: Runtime) {
    let total = rows.len();
    let started_at = now();
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        verify_rows(&store, rows, mode, &runtime.cancel, |status| {
            let _ = publish(&runtime, status);
        })
    }));
    let status = result.unwrap_or_else(|_| {
        let mut status = base_status(mode, total, started_at);
        status.running = false;
        status.checked_at = now();
        status.error = "校验线程异常退出".into();
        status
    });
    finish(&store, &runtime, status);
}

pub fn status(store: &Store) -> Result<ArchiveHealth> {
    let runtime = runtime(&store.root);
    ensure_loaded(&runtime, &store.root)?;
    Ok(current(&runtime)?.unwrap_or_else(empty_status))
}

pub fn start(store: &Store, mode: &str) -> Result<ArchiveHealth> {
    let mode = parse_mode(mode)?;
    let rows = collect_rows(store)?;
    let runtime = runtime(&store.root);
    ensure_loaded(&runtime, &store.root)?;
    {
        let mut state = runtime.state.lock().map_err(err)?;
        if state.status.as_ref().is_some_and(|status| status.running) {
            return Err("已有存档校验正在进行".into());
        }
        runtime.cancel.store(false, Ordering::Relaxed);
        state.loaded = true;
        state.status = Some(base_status(mode, rows.len(), now()));
    }
    let pending = current(&runtime)?.ok_or("校验状态初始化失败")?;
    let worker_store = store.clone();
    std::thread::spawn(move || run_worker(worker_store, rows, mode, runtime));
    Ok(pending)
}

pub fn cancel(store: &Store) -> Result<ArchiveHealth> {
    let runtime = runtime(&store.root);
    ensure_loaded(&runtime, &store.root)?;
    runtime.cancel.store(true, Ordering::Relaxed);
    Ok(current(&runtime)?.unwrap_or_else(empty_status))
}

pub fn check_now(store: &Store, mode: &str) -> Result<ArchiveHealth> {
    let mode = parse_mode(mode)?;
    let rows = collect_rows(store)?;
    let runtime = runtime(&store.root);
    runtime.cancel.store(false, Ordering::Relaxed);
    let result = verify_rows(store, rows, mode, &runtime.cancel, |_| {});
    save_result(&store.root, &result)?;
    publish(&runtime, &result)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, raw};

    fn fixture() -> (tempfile::TempDir, Store, Mail, Vec<u8>) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let account = account();
        store.save_account(&account).unwrap();
        let bytes = raw();
        store
            .ingest(&account, "INBOX", "1:1", &bytes, false)
            .unwrap();
        let mail = store.snapshot(&crate::tests::query()).unwrap().messages[0].clone();
        (dir, store, mail, bytes)
    }

    #[test]
    fn fast_check_uses_presence_and_size_while_deep_check_verifies_bytes() {
        let (dir, store, mail, bytes) = fixture();
        let fast = check_now(&store, "fast").unwrap();
        assert_eq!((fast.checked, fast.healthy), (1, 1));
        assert!(fast.completed);
        assert_eq!(status(&store).unwrap().mode, "fast");

        std::fs::write(
            dir.path()
                .join("archive")
                .join(format!("{}.eml", mail.hash)),
            vec![b'X'; bytes.len()],
        )
        .unwrap();
        let fast = check_now(&store, "fast").unwrap();
        assert_eq!((fast.checked, fast.healthy), (1, 1));
        let deep = check_now(&store, "deep").unwrap();
        assert_eq!((deep.checked, deep.healthy), (1, 0));
        assert_eq!(deep.problem_count, 1);
        assert!(deep.problems[0].error.contains("校验失败"));
        assert_eq!(status(&store).unwrap().mode, "deep");
        assert_eq!(store.mail(&mail.id).unwrap().hash, mail.hash);
    }

    #[test]
    fn cancelled_check_stops_before_reading_the_next_message() {
        let (_dir, store, _mail, _bytes) = fixture();
        let cancel = AtomicBool::new(true);
        let result = verify_rows(
            &store,
            collect_rows(&store).unwrap(),
            Mode::Deep,
            &cancel,
            |_| {},
        );
        assert!(result.cancelled);
        assert!(!result.completed);
        assert_eq!(result.checked, 0);
    }

    #[test]
    fn interrupted_persisted_result_is_reported_as_cancelled_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let mut status = base_status(Mode::Deep, 12, now());
        status.checked = 4;
        save_result(dir.path(), &status).unwrap();
        let loaded = load_persisted(dir.path()).unwrap();
        assert!(!loaded.running);
        assert!(!loaded.completed);
        assert!(loaded.cancelled);
        assert_eq!(loaded.checked, 4);
        assert!(loaded.error.contains("上次校验未完成"));
    }

    #[test]
    fn unavailable_external_archive_fails_without_falling_back_to_local_files() {
        let (dir, store, mail, _bytes) = fixture();
        let missing = dir.path().join("disconnected");
        std::fs::write(
            dir.path().join("archive-location.json"),
            serde_json::to_vec(&serde_json::json!({
                "path": missing,
                "token": "expected-token",
            }))
            .unwrap(),
        )
        .unwrap();
        let result = check_now(&store, "fast").unwrap();
        assert!(!result.running);
        assert!(!result.completed);
        assert_eq!(result.healthy, 0);
        assert!(result.error.contains("存档磁盘未连接"));
        assert_eq!(store.mail(&mail.id).unwrap().hash, mail.hash);
    }

    #[test]
    fn problem_count_keeps_the_full_total_while_details_are_bounded() {
        let (_dir, store, _mail, _bytes) = fixture();
        let rows = (0..(MAX_PROBLEMS + 1))
            .map(|index| Row {
                id: format!("missing-{index}"),
                hash: String::new(),
                subject: String::new(),
                size: 0,
            })
            .collect();
        let result = verify_rows(&store, rows, Mode::Fast, &AtomicBool::new(false), |_| {});
        assert_eq!(result.checked, MAX_PROBLEMS + 1);
        assert_eq!(result.problem_count, MAX_PROBLEMS + 1);
        assert_eq!(result.problems.len(), MAX_PROBLEMS);
        assert!(result.completed);
    }
}
