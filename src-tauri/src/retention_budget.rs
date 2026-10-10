//! Read-only, cancellable server inventory. Never publishes sources or saved state.
use crate::{idle::ConnectionControl, models::*, retention::FolderRetention, store::Store};
use rusqlite::params;
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Default)]
pub(crate) struct Inventory {
    pub rows: Vec<(String, u64)>,
    pub stable: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderBudget {
    pub folder: String,
    pub display_name: String,
    pub total: Option<u64>,
    pub uncached: Option<u64>,
    pub pending: Option<u64>,
    pub pending_bytes: Option<u64>,
    pub conservative: bool,
    pub error: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionBudget {
    pub checked_at: String,
    pub data_dir: String,
    pub available_bytes: Option<u64>,
    pub disk_error: Option<String>,
    pub folders: Vec<FolderBudget>,
    pub complete: bool,
    pub required_bytes: Option<u64>,
    pub low_space: bool,
}
struct Slot {
    control: Arc<ConnectionControl>,
    updated: Instant,
    active: bool,
}
type Key = (PathBuf, String);
static REQUESTS: OnceLock<Mutex<HashMap<Key, Slot>>> = OnceLock::new();
fn requests() -> &'static Mutex<HashMap<Key, Slot>> {
    REQUESTS.get_or_init(Default::default)
}
pub struct Inspection {
    key: Key,
    pub control: Arc<ConnectionControl>,
    _deadline: std::sync::mpsc::Sender<()>,
}
fn request_key(store: &Store, request: &str) -> Result<Key> {
    uuid::Uuid::parse_str(request).map_err(|_| "无效保存预算检查编号".to_string())?;
    Ok((store.root.clone(), request.into()))
}
fn prune(slots: &mut HashMap<Key, Slot>) {
    slots.retain(|_, s| s.active || s.updated.elapsed() < Duration::from_secs(300));
}
pub fn begin(store: &Store, request: &str) -> Result<Inspection> {
    let key = request_key(store, request)?;
    let mut slots = requests().lock().map_err(err)?;
    prune(&mut slots);
    if slots.contains_key(&key) {
        return Err("保存预算检查已取消或已执行，请重新检查".into());
    }
    if slots.len() >= 128 {
        return Err("保存预算检查过多，请稍后重试".into());
    }
    let control = Arc::new(ConnectionControl::default());
    slots.insert(
        key.clone(),
        Slot {
            control: control.clone(),
            updated: Instant::now(),
            active: true,
        },
    );
    let (sender, receiver) = std::sync::mpsc::channel();
    let timed = control.clone();
    // Drop of the lease cancels this timer; the absolute deadline also interrupts
    // sockets stuck inside a library read instead of only checking between batches.
    std::thread::spawn(move || {
        if receiver.recv_timeout(Duration::from_secs(90))
            == Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        {
            timed.stop();
        }
    });
    Ok(Inspection {
        key,
        control,
        _deadline: sender,
    })
}
pub fn cancel(store: &Store, request: &str) -> Result<()> {
    let key = request_key(store, request)?;
    let mut slots = requests().lock().map_err(err)?;
    prune(&mut slots);
    if let Some(slot) = slots.get_mut(&key) {
        slot.control.stop();
        slot.updated = Instant::now();
    } else if slots.len() < 128 {
        let control = Arc::new(ConnectionControl::default());
        control.stop();
        slots.insert(
            key,
            Slot {
                control,
                updated: Instant::now(),
                active: false,
            },
        );
    }
    Ok(())
}
impl Drop for Inspection {
    fn drop(&mut self) {
        self.control.stop();
        if let Ok(mut slots) = requests().lock() {
            if let Some(slot) = slots.get_mut(&self.key) {
                slot.active = false;
                slot.updated = Instant::now();
            }
        }
    }
}
pub(crate) fn check_account(
    store: &Store,
    expected: &Account,
    control: &ConnectionControl,
) -> Result<()> {
    if control.stopped() {
        return Err("保存预算检查已取消或超时，请重新检查".into());
    }
    let current = store.account(&expected.id)?;
    if !current.enabled
        || !current.same_connection(expected)
        || current.save_locally != expected.save_locally
    {
        return Err("账号已暂停或配置变化，请重新打开保存设置".into());
    }
    Ok(())
}
pub fn selected_folders(
    store: &Store,
    a: &Account,
    overrides: &[FolderRetention],
) -> Result<Vec<RemoteFolder>> {
    let folders = store.remote_folders(Some(&a.id))?;
    let mut seen = HashSet::new();
    for item in overrides {
        if !seen.insert(&item.folder)
            || !folders
                .iter()
                .any(|f| f.selectable && f.name == item.folder)
        {
            return Err("保存范围含重复或失效目录，请刷新目录".into());
        }
    }
    if a.protocol == "pop3" {
        return Ok(if a.save_locally {
            vec![RemoteFolder {
                account_id: a.id.clone(),
                name: "INBOX".into(),
                display_name: "收件箱".into(),
                delimiter: None,
                selectable: true,
                sync_error: None,
                roles: vec![FolderRole::Inbox],
                detected_roles: None,
            }]
        } else {
            vec![]
        });
    }
    Ok(folders
        .into_iter()
        .filter(|f| f.selectable)
        .filter(|f| {
            let explicit = overrides
                .iter()
                .find(|o| o.folder == f.name)
                .map(|o| o.save_locally);
            explicit.unwrap_or(a.save_locally)
                && (!crate::remote::excluded_from_auto_sync(f) || explicit == Some(true))
        })
        .collect())
}
fn count_folder(
    store: &Store,
    a: &Account,
    folder: &RemoteFolder,
    inventory: Inventory,
) -> Result<FolderBudget> {
    let db = store.db()?;
    let mut q = db.prepare("SELECT s.remote_id,COALESCE(json_extract(m.data,'$.savedLocally'),1) FROM trusted_sources s JOIN message_listing m ON m.id=s.mail_id AND m.account_id=s.account_id WHERE s.account_id=?1 AND s.folder=?2 AND s.active=1").map_err(err)?;
    let known = q
        .query_map(params![a.id, folder.name], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?))
        })
        .map_err(err)?
        .collect::<std::result::Result<HashMap<_, _>, _>>()
        .map_err(err)?;
    let mut uncached = 0;
    let mut pending = 0;
    let mut bytes = 0u64;
    for (remote, size) in &inventory.rows {
        if !inventory.stable || !known.contains_key(remote) {
            uncached += 1;
        }
        if !inventory.stable || !known.get(remote).copied().unwrap_or(false) {
            pending += 1;
            bytes = bytes.checked_add(*size).ok_or("服务器大小统计溢出")?;
        }
    }
    Ok(FolderBudget {
        folder: folder.name.clone(),
        display_name: folder.display_name.clone(),
        total: Some(inventory.rows.len() as u64),
        uncached: Some(uncached),
        pending: Some(pending),
        pending_bytes: Some(bytes),
        conservative: !inventory.stable,
        error: None,
    })
}
fn disk_space(store: &Store) -> Result<(String, u64)> {
    let runtime = crate::archive_location::runtime(&store.root);
    let _guard = runtime
        .gate
        .try_read()
        .map_err(|_| "正在迁移存档，请完成后重新检查空间".to_string())?;
    let actual = crate::archive_location::physical_root(&store.root)?;
    let available = fs2::available_space(&actual).map_err(err)?;
    Ok((
        actual.join("archive").to_string_lossy().into_owned(),
        available,
    ))
}
pub(crate) fn with_reserve(bytes: u64) -> Option<u64> {
    if bytes == 0 {
        Some(0)
    } else {
        bytes
            .checked_add(bytes / 10)?
            .checked_add(128 * 1024 * 1024)
    }
}
pub fn inspect(
    store: &Store,
    a: &Account,
    overrides: &[FolderRetention],
    lease: &Inspection,
) -> Result<RetentionBudget> {
    inspect_using(store, a, overrides, lease, |folder| {
        crate::network::saving_inventory(store, a, &folder.name, &lease.control)
    })
}
fn inspect_using(
    store: &Store,
    a: &Account,
    overrides: &[FolderRetention],
    lease: &Inspection,
    mut inventory: impl FnMut(&RemoteFolder) -> Result<Inventory>,
) -> Result<RetentionBudget> {
    check_account(store, a, &lease.control)?;
    let scope = selected_folders(store, a, overrides)?;
    if a.protocol == "imap"
        && store
            .remote_folders(Some(&a.id))?
            .iter()
            .all(|f| !f.selectable)
    {
        return Err("服务器目录尚未发现，请先刷新目录后检查".into());
    }
    let expected_scope = scope.iter().map(|f| f.name.clone()).collect::<HashSet<_>>();
    let mut folders = Vec::new();
    for folder in scope {
        check_account(store, a, &lease.control)?;
        let result = match store.folder_isolated_reason(&a.id, &folder.name)? {
            Some(reason) => Err(format!("目录来源已隔离：{reason}")),
            None => inventory(&folder),
        };
        check_account(store, a, &lease.control)?;
        let result = result.and_then(|inventory| {
            if store.folder_isolated_reason(&a.id, &folder.name)?.is_some() {
                return Err("目录来源检查期间已变化，请重新核查".into());
            }
            count_folder(store, a, &folder, inventory)
        });
        folders.push(result.unwrap_or_else(|reason| FolderBudget {
            folder: folder.name,
            display_name: folder.display_name,
            total: None,
            uncached: None,
            pending: None,
            pending_bytes: None,
            conservative: false,
            error: Some(crate::remote::display_activity(&reason)),
        }));
    }
    check_account(store, a, &lease.control)?;
    let latest_scope = selected_folders(store, a, overrides)?
        .into_iter()
        .map(|f| f.name)
        .collect::<HashSet<_>>();
    if latest_scope != expected_scope {
        return Err("服务器目录或保存范围检查期间变化，请刷新后重新检查".into());
    }
    // No DB transaction remains while reading the actual configured disk.
    let disk = disk_space(store);
    let complete = folders.iter().all(|f| f.error.is_none());
    let required_bytes = if complete {
        folders
            .iter()
            .try_fold(0u64, |n, f| n.checked_add(f.pending_bytes?))
            .and_then(with_reserve)
    } else {
        None
    };
    let complete = complete && required_bytes.is_some();
    let (data_dir, available_bytes, disk_error) = match disk {
        Ok((path, bytes)) => (path, Some(bytes), None),
        Err(reason) => (
            crate::archive_location::display_path(&store.root),
            None,
            Some(reason),
        ),
    };
    let low_space = required_bytes
        .zip(available_bytes)
        .is_some_and(|(needed, available)| needed > available);
    Ok(RetentionBudget {
        checked_at: chrono::Utc::now().to_rfc3339(),
        data_dir,
        available_bytes,
        disk_error,
        folders,
        complete,
        required_bytes,
        low_space,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Store, Account) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = crate::tests::account();
        store.save_account(&a).unwrap();
        store
            .save_remote_folders(&a.id, &[folder(&a, "INBOX"), folder(&a, "Junk")])
            .unwrap();
        (dir, store, a)
    }
    fn folder(a: &Account, name: &str) -> RemoteFolder {
        RemoteFolder {
            account_id: a.id.clone(),
            name: name.into(),
            display_name: name.into(),
            delimiter: None,
            selectable: true,
            sync_error: None,
            roles: if name == "Junk" {
                vec![FolderRole::Junk]
            } else {
                vec![FolderRole::Inbox]
            },
            detected_roles: None,
        }
    }
    fn lease(store: &Store) -> Inspection {
        begin(store, &uuid::Uuid::new_v4().to_string()).unwrap()
    }
    #[test]
    fn scope_honors_unsaved_overrides_and_never_implicitly_includes_trash_or_junk() {
        let (_dir, store, a) = fixture();
        assert_eq!(selected_folders(&store, &a, &[]).unwrap().len(), 1);
        assert_eq!(
            selected_folders(
                &store,
                &a,
                &[FolderRetention {
                    folder: "Junk".into(),
                    save_locally: true
                }]
            )
            .unwrap()
            .len(),
            2
        );
        assert!(selected_folders(
            &store,
            &a,
            &[FolderRetention {
                folder: "missing".into(),
                save_locally: true
            }]
        )
        .is_err());
        let mut online = a.clone();
        online.save_locally = false;
        store.save_account(&online).unwrap();
        assert!(selected_folders(&store, &online, &[]).unwrap().is_empty());
    }
    #[test]
    fn budget_subtracts_only_saved_active_trusted_matching_namespace_and_does_not_ingest() {
        let (_dir, store, a) = fixture();
        store
            .ingest(&a, "INBOX", "7:12", &crate::tests::raw(), false)
            .unwrap();
        let initial = store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .len();
        let budget = inspect_using(&store, &a, &[], &lease(&store), |_| {
            Ok(Inventory {
                rows: vec![("7:12".into(), 100), ("7:13".into(), 1024)],
                stable: true,
            })
        })
        .unwrap();
        assert_eq!(budget.folders[0].total, Some(2));
        assert_eq!(budget.folders[0].uncached, Some(1));
        assert_eq!(budget.folders[0].pending_bytes, Some(1024));
        assert_eq!(budget.required_bytes, with_reserve(1024));
        assert!(budget.available_bytes.is_some());
        assert_eq!(
            store
                .snapshot(&crate::tests::query())
                .unwrap()
                .messages
                .len(),
            initial
        );
        let budget = count_folder(
            &store,
            &a,
            &folder(&a, "INBOX"),
            Inventory {
                rows: vec![("8:12".into(), 100)],
                stable: true,
            },
        )
        .unwrap();
        assert_eq!(budget.pending, Some(1));
    }
    #[test]
    fn missing_namespace_is_conservative_and_duplicate_directory_locations_are_not_deduplicated() {
        let (_dir, store, a) = fixture();
        let f = count_folder(
            &store,
            &a,
            &folder(&a, "INBOX"),
            Inventory {
                rows: vec![("unknown:12".into(), 100)],
                stable: false,
            },
        )
        .unwrap();
        assert!(f.conservative);
        assert_eq!(f.pending_bytes, Some(100));
        assert_eq!(with_reserve(0), Some(0));
        assert_eq!(with_reserve(u64::MAX), None);
    }
    #[test]
    fn partial_errors_and_isolation_never_produce_zero_or_claim_complete_budget() {
        let (_dir, store, a) = fixture();
        let b = inspect_using(&store, &a, &[], &lease(&store), |_| {
            Err("服务器未返回全部邮件大小".into())
        })
        .unwrap();
        assert!(!b.complete);
        assert!(b.required_bytes.is_none());
        assert!(b.folders[0].total.is_none());
        store
            .isolate_folder(&a, "INBOX", "矛盾目录", &Default::default())
            .unwrap();
        let b = inspect_using(&store, &a, &[], &lease(&store), |_| {
            panic!("isolated folder must not contact server")
        })
        .unwrap();
        assert!(b.folders[0].error.as_deref().unwrap().contains("隔离"));
    }
    #[test]
    fn cancellation_before_begin_and_during_inspection_rejects_late_results() {
        let (_dir, store, a) = fixture();
        let id = uuid::Uuid::new_v4().to_string();
        cancel(&store, &id).unwrap();
        assert!(begin(&store, &id).is_err());
        let l = lease(&store);
        let result = inspect_using(&store, &a, &[], &l, |_| {
            l.control.stop();
            Ok(Inventory::default())
        });
        assert!(result.unwrap_err().contains("取消"));
    }
    #[test]
    fn account_and_folder_changes_do_not_publish_a_stale_snapshot() {
        let (_dir, store, a) = fixture();
        let l = lease(&store);
        let result = inspect_using(&store, &a, &[], &l, |_| {
            let mut changed = a.clone();
            changed.enabled = false;
            store.save_account(&changed).unwrap();
            Ok(Inventory::default())
        });
        assert!(result.is_err());
        store.save_account(&a).unwrap();
        let result = inspect_using(&store, &a, &[], &lease(&store), |_| {
            store.save_remote_folders(&a.id, &[]).unwrap();
            Ok(Inventory::default())
        });
        assert!(result.is_err());
    }
    #[test]
    fn disconnected_archive_returns_unknown_space_without_falling_back_to_local_disk() {
        let (_dir, store, a) = fixture();
        let external = tempfile::tempdir().unwrap();
        store
            .move_archive_location(external.path().to_str().unwrap())
            .unwrap();
        std::fs::remove_file(external.path().join("Anser-Archive/.anser-archive-store")).unwrap();
        let b = inspect_using(
            &store,
            &a,
            &[],
            &lease(&store),
            |_| Ok(Inventory::default()),
        )
        .unwrap();
        assert!(b.available_bytes.is_none());
        assert!(b.disk_error.is_some());
        assert!(b.data_dir.contains("Anser-Archive"));
    }
    #[test]
    fn migration_gate_returns_unavailable_promptly_without_waiting_or_holding_db_transaction() {
        let (_dir, store, a) = fixture();
        let rt = crate::archive_location::runtime(&store.root);
        let _guard = rt.gate.write().unwrap();
        let b = inspect_using(&store, &a, &[], &lease(&store), |_| {
            let mut change = a.clone();
            change.name = "local change during inventory".into();
            store.edit_account_preferences(&change).unwrap();
            Ok(Inventory::default())
        })
        .unwrap();
        assert!(b.disk_error.as_deref().unwrap().contains("迁移"));
        assert!(b.available_bytes.is_none());
    }
}
