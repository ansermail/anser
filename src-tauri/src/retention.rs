//! Folder overrides affect future receiving; existing archives remain intact.
use crate::{models::*, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderRetention {
    pub folder: String,
    pub save_locally: bool,
}
pub(crate) fn effective_save(
    db: &rusqlite::Connection,
    account: &Account,
    folder: &str,
) -> Result<bool> {
    if account.protocol != "imap" {
        return Ok(account.save_locally);
    }
    let value: Option<bool> = db
        .prepare_cached(
            "SELECT save_locally FROM folder_retention WHERE account_id=?1 AND folder=?2",
        )
        .map_err(err)?
        .query_row(params![account.id, folder], |r| r.get(0))
        .optional()
        .map_err(err)?;
    Ok(value.unwrap_or(account.save_locally))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        archive,
        tests::{account, raw},
    };
    fn fixture() -> (tempfile::TempDir, Store, Account) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let folders = ["INBOX", "Junk"]
            .into_iter()
            .map(|name| RemoteFolder {
                account_id: a.id.clone(),
                name: name.into(),
                display_name: name.into(),
                delimiter: Some("/".into()),
                selectable: true,
                sync_error: None,
                roles: Vec::new(),
                detected_roles: None,
            })
            .collect::<Vec<_>>();
        store.save_remote_folders(&a.id, &folders).unwrap();
        (dir, store, a)
    }
    fn item(name: &str, save: bool) -> FolderRetention {
        FolderRetention {
            folder: name.into(),
            save_locally: save,
        }
    }
    #[test]
    fn overrides_are_scoped_persistent_and_inherit_latest_account_default() {
        let (dir, store, a) = fixture();
        store.save_retention(&a, &[item("INBOX", false)]).unwrap();
        assert!(!store.should_save_folder(&a, "INBOX").unwrap());
        assert!(store.should_save_folder(&a, "Junk").unwrap());
        let mut other = a.clone();
        other.id = "other".into();
        assert!(store.should_save_folder(&other, "INBOX").unwrap());
        drop(store);
        let store = Store::new(dir.path().into()).unwrap();
        assert!(!store.should_save_folder(&a, "INBOX").unwrap());
        store.save_retention(&a, &[]).unwrap();
        let mut online = a.clone();
        online.save_locally = false;
        store.edit_account_preferences(&online).unwrap();
        assert!(!store.retention_settings(&a.id).unwrap().default_save);
        assert!(!store.should_save_folder(&online, "INBOX").unwrap());
    }
    #[test]
    fn reused_receive_lookup_sees_committed_preferences_and_isolation_without_snapshot_locks() {
        let (_dir, store, mut a) = fixture();
        store.save_retention(&a, &[item("INBOX", false)]).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        let lookup = crate::remote::ReceiveLookup::new(&store).unwrap();
        assert!(lookup
            .source_available(&lookup.account(&a.id).unwrap(), "INBOX", "7:1")
            .unwrap());
        // These separate-connection writers must commit while lookup remains
        // alive, and the very next lookup must see the new policy.
        store.save_retention(&a, &[item("INBOX", true)]).unwrap();
        assert!(!lookup
            .source_available(&lookup.account(&a.id).unwrap(), "INBOX", "7:1")
            .unwrap());
        a.save_locally = false;
        store.edit_account_preferences(&a).unwrap();
        store.save_retention(&a, &[]).unwrap();
        assert!(!lookup.account(&a.id).unwrap().save_locally);
        assert!(lookup
            .source_available(&lookup.account(&a.id).unwrap(), "INBOX", "7:1")
            .unwrap());
        store
            .isolate_folder(&a, "INBOX", "test quarantine", &Default::default())
            .unwrap();
        assert!(!lookup.source_available(&a, "INBOX", "7:1").unwrap());
        a.enabled = false;
        store.save_account(&a).unwrap();
        assert!(!lookup.account(&a.id).unwrap().enabled);
        assert!(lookup.account("missing-account").is_err());
    }
    #[test]
    fn invalid_changed_or_pop3_configuration_cannot_partially_replace_scope() {
        let (_dir, store, a) = fixture();
        store.save_retention(&a, &[item("INBOX", false)]).unwrap();
        for invalid in [
            vec![item("INBOX", true), item("INBOX", false)],
            vec![item("missing", true)],
            vec![item("bad\r\n", true)],
        ] {
            assert!(store.save_retention(&a, &invalid).is_err());
        }
        let mut stale = a.clone();
        stale.incoming_host = "changed.example.com".into();
        assert!(store.save_retention(&stale, &[]).is_err());
        assert!(!store.should_save_folder(&a, "INBOX").unwrap());
        let mut pop = a.clone();
        pop.protocol = "pop3".into();
        store.edit_account(&pop).unwrap();
        assert!(store.retention_overrides(&a.id).unwrap().is_empty());
        assert!(store.save_retention(&pop, &[]).is_err());
    }
    #[test]
    fn turning_off_folder_retention_during_fetch_never_erases_existing_archive() {
        let (_dir, store, a) = fixture();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        store.save_retention(&a, &[item("INBOX", false)]).unwrap();
        let next = String::from_utf8(raw())
            .unwrap()
            .replace("Project invoice", "Different invoice");
        store
            .ingest(&a, "INBOX", "7:2", next.as_bytes(), false)
            .unwrap();
        let mut query = crate::tests::query();
        query.view = "inbox".into();
        let mails = store.snapshot(&query).unwrap().messages;
        let saved = mails
            .iter()
            .find(|m| m.subject == "Project invoice")
            .unwrap();
        assert!(saved.saved_locally);
        assert_eq!(store.message_raw(saved).unwrap(), raw());
        let online = mails.iter().find(|m| m.id != saved.id).unwrap();
        assert!(!online.saved_locally);
        assert!(online.body.is_empty());
        assert!(!store
            .root
            .join("archive")
            .join(format!("{}.eml", online.hash))
            .exists());
        assert!(store.source_available(&a, "INBOX", "7:2").unwrap());
        store.save_retention(&a, &[]).unwrap();
        assert!(!store.source_available(&a, "INBOX", "7:2").unwrap());
    }
    #[test]
    fn server_sent_folder_obeys_scope_but_confirmed_smtp_copy_is_independent() {
        let (_dir, store, a) = fixture();
        let mut folders = store.remote_folders(Some(&a.id)).unwrap();
        let mut sent = folders[0].clone();
        sent.name = "Sent".into();
        sent.display_name = "已发送".into();
        folders.push(sent);
        store.save_remote_folders(&a.id, &folders).unwrap();
        store.save_retention(&a, &[item("Sent", false)]).unwrap();
        store.ingest(&a, "Sent", "7:1", &raw(), false).unwrap();
        let id = store
            .db()
            .unwrap()
            .query_row(
                "SELECT mail_id FROM sources WHERE folder='Sent' AND remote_id='7:1'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        assert!(!store.mail(&id).unwrap().saved_locally);
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO outbox(id,status,data) VALUES('local-send','sent',?1)",
                [serde_json::json!({"accountId":a.id}).to_string()],
            )
            .unwrap();
        let local = String::from_utf8(raw())
            .unwrap()
            .replace("Project invoice", "Local sent invoice");
        store
            .ingest(&a, "Sent", "local-send", local.as_bytes(), true)
            .unwrap();
        let id = store
            .db()
            .unwrap()
            .query_row(
                "SELECT mail_id FROM sources WHERE folder='Sent' AND remote_id='local-send'",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        assert!(store.mail(&id).unwrap().saved_locally);
        assert_eq!(
            store.message_raw(&store.mail(&id).unwrap()).unwrap(),
            local.as_bytes()
        );
    }
    #[test]
    fn deletion_stop_saving_clears_overrides_and_old_full_fetch_cannot_republish() {
        let (_dir, store, a) = fixture();
        store.save_retention(&a, &[item("INBOX", true)]).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        let preview = store.archive_deletion_preview(&a.id).unwrap();
        store
            .delete_local_archives(&a.id, true, preview.count, &preview.review_token)
            .unwrap();
        assert!(store.retention_overrides(&a.id).unwrap().is_empty());
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        assert!(store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .iter()
            .all(|m| !m.saved_locally));
    }
    #[test]
    fn backups_and_account_removal_do_not_restore_folder_preferences() {
        let (_dir, store, a) = fixture();
        store.save_retention(&a, &[item("INBOX", false)]).unwrap();
        store.ingest(&a, "Sent", "sent", &raw(), true).unwrap();
        let output = tempfile::tempdir().unwrap();
        let path = store.backup(output.path()).unwrap();
        let snapshot =
            rusqlite::Connection::open(std::path::Path::new(&path).join("snapshot.sqlite3"))
                .unwrap();
        assert_eq!(
            snapshot
                .query_row("SELECT COUNT(*) FROM folder_retention", [], |r| r
                    .get::<_, u32>(0))
                .unwrap(),
            0
        );
        store.remove_account(&a.id).unwrap();
        assert!(store.retention_overrides(&a.id).unwrap().is_empty());
        assert_eq!(
            archive::read_raw(&store.root, &archive::digest(&raw())).unwrap(),
            raw()
        );
    }
    #[test]
    fn pending_summary_deduplicates_locations_and_respects_scope_and_isolation() {
        let (_dir, store, mut a) = fixture();
        a.save_locally = false;
        store.edit_account_preferences(&a).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        store.ingest(&a, "Junk", "7:2", &raw(), false).unwrap();
        let summary = store.retention_settings(&a.id).unwrap().summary;
        assert_eq!((summary.known, summary.saved, summary.pending), (1, 0, 0));
        let mut full = a.clone();
        full.save_locally = true;
        store.edit_account_preferences(&full).unwrap();
        assert_eq!(store.retention_settings(&a.id).unwrap().summary.pending, 1);
        store
            .save_retention(&full, &[item("INBOX", false)])
            .unwrap();
        // Junk inherits full but is not auto-received unless explicitly included.
        assert_eq!(store.retention_settings(&a.id).unwrap().summary.pending, 0);
        store
            .save_retention(&full, &[item("INBOX", true), item("Junk", true)])
            .unwrap();
        assert_eq!(store.retention_settings(&a.id).unwrap().summary.pending, 1);
        store
            .isolate_folder(&full, "INBOX", "quarantine", &Default::default())
            .unwrap();
        assert_eq!(store.retention_settings(&a.id).unwrap().summary.pending, 1);
        store
            .isolate_folder(&full, "Junk", "quarantine", &Default::default())
            .unwrap();
        assert_eq!(store.retention_settings(&a.id).unwrap().summary.pending, 0);
        assert_eq!(store.retention_settings(&a.id).unwrap().summary.known, 1);
    }
    #[test]
    fn retention_days_are_atomic_preserved_by_sync_and_usable_for_pop() {
        let (_dir, store, mut a) = fixture();
        let old = a.clone();
        a.server_retention_days = Some(3);
        store
            .save_retention_preferences(&a, &[item("INBOX", false)])
            .unwrap();
        store.save_sync_status(&old).unwrap();
        store.edit_account_preferences(&old).unwrap();
        store.edit_account(&old).unwrap();
        assert_eq!(store.account(&a.id).unwrap().server_retention_days, Some(3));
        let mut recent = a.clone();
        recent.last_sync = Some("2026-10-09T02:00:00Z".into());
        store.save_sync_status(&recent).unwrap();
        let mut slow = a.clone();
        slow.last_sync = Some("2026-10-09T01:00:00Z".into());
        slow.error = Some("old sweep failed".into());
        store.save_sync_status(&slow).unwrap();
        assert_eq!(
            store.retention_settings(&a.id).unwrap().summary.last_sync,
            recent.last_sync
        );
        a.server_retention_days = Some(10);
        assert!(store
            .save_retention_preferences(&a, &[item("missing", true)])
            .is_err());
        assert_eq!(store.account(&a.id).unwrap().server_retention_days, Some(3));
        a.server_retention_days = Some(0);
        assert!(store.save_retention_preferences(&a, &[]).is_err());
        assert_eq!(store.retention_overrides(&a.id).unwrap().len(), 1);
        a.server_retention_days = Some(3);
        a.protocol = "pop3".into();
        store.edit_account(&a).unwrap();
        a.server_retention_days = Some(5);
        store.save_retention_preferences(&a, &[]).unwrap();
        assert_eq!(store.account(&a.id).unwrap().server_retention_days, Some(5));
        assert!(store
            .save_retention_preferences(&a, &[item("INBOX", true)])
            .is_err());
    }
    #[test]
    fn retention_warning_is_an_estimate_and_handles_unknown_dates_and_near_deadline() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-09T00:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        assert!(retention_warning(None, 1, None, now).is_none());
        assert!(retention_warning(Some(3), 0, None, now).is_none());
        assert!(retention_warning(Some(3), 1, None, now)
            .unwrap()
            .contains("时间未知"));
        assert!(retention_warning(Some(3), 1, Some("2026-10-07T00:00:00Z"), now).is_some());
        assert!(retention_warning(Some(3), 1, Some("2026-10-08T00:00:00Z"), now).is_none());
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionSettings {
    pub account: Account,
    pub default_save: bool,
    pub folders: Vec<RemoteFolder>,
    pub overrides: Vec<FolderRetention>,
    pub summary: RetentionSummary,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionSummary {
    pub data_dir: String,
    pub known: u64,
    pub saved: u64,
    pub saved_bytes: u64,
    pub pending: u64,
    pub failed_jobs: u64,
    pub last_sync: Option<String>,
    pub receive_error: Option<String>,
    pub warning: Option<String>,
}
fn retention_warning(
    days: Option<u32>,
    pending: u64,
    oldest: Option<&str>,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<String> {
    let days = days?;
    if pending == 0 {
        return None;
    }
    match oldest.and_then(|date| chrono::DateTime::parse_from_rfc3339(date).ok()) {
        Some(date) if date + chrono::Duration::days(days as i64) <= now + chrono::Duration::days(1) =>
            Some("按填写的服务器保留期估算，部分待保存邮件接近或超过保留期，请尽快检查收取与保存任务。".into()),
        None => Some("部分待保存邮件的服务器时间未知，无法估算删除期限，请尽快完成保存。".into()),
        _ => None,
    }
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS folder_retention(account_id TEXT NOT NULL,folder TEXT NOT NULL,save_locally INTEGER NOT NULL,PRIMARY KEY(account_id,folder));").map_err(err)
}
impl Store {
    pub fn retention_overrides(&self, account: &str) -> Result<Vec<FolderRetention>> {
        let db = self.db()?;
        let mut q = db.prepare("SELECT folder,save_locally FROM folder_retention WHERE account_id=?1 ORDER BY folder").map_err(err)?;
        let rows = q
            .query_map([account], |r| {
                Ok(FolderRetention {
                    folder: r.get(0)?,
                    save_locally: r.get(1)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }
    pub fn retention_settings(&self, id: &str) -> Result<RetentionSettings> {
        let a = self.account(id)?;
        let folders = self.remote_folders(Some(id))?;
        let overrides = self.retention_overrides(id)?;
        let wanted = folders
            .iter()
            .filter(|folder| folder.selectable)
            .filter(|folder| {
                overrides
                    .iter()
                    .find(|o| o.folder == folder.name)
                    .map_or(a.save_locally, |o| o.save_locally)
            })
            .filter(|folder| {
                !crate::remote::excluded_from_auto_sync(folder)
                    || overrides
                        .iter()
                        .any(|o| o.folder == folder.name && o.save_locally)
            })
            .map(|folder| folder.name.clone())
            .collect::<Vec<_>>();
        let wanted = if a.protocol == "pop3" && a.save_locally {
            vec!["INBOX".to_string()]
        } else {
            wanted
        };
        let db = self.db()?;
        // Counts share a short local read snapshot, so background ingest cannot
        // publish a pending total larger than the known unsaved population.
        // No filesystem or network work runs while this transaction is alive.
        let db = db.unchecked_transaction().map_err(err)?;
        let (known, saved, saved_bytes) = db.query_row("SELECT COUNT(*),COALESCE(SUM(COALESCE(json_extract(data,'$.savedLocally'),1)),0),COALESCE(SUM(CASE WHEN COALESCE(json_extract(data,'$.savedLocally'),1)=1 THEN json_extract(data,'$.size') ELSE 0 END),0) FROM message_listing WHERE account_id=?1", [id], |r| Ok((r.get::<_, u64>(0)?,r.get::<_, u64>(1)?,r.get::<_, u64>(2)?))).map_err(err)?;
        let (pending, oldest): (u64, Option<String>) = db.query_row("WITH waiting AS (SELECT COALESCE(NULLIF(json_extract(m.data,'$.serverDate'),''),json_extract(m.data,'$.date')) AS mail_date FROM message_listing m WHERE m.account_id=?1 AND COALESCE(json_extract(m.data,'$.savedLocally'),1)=0 AND EXISTS(SELECT 1 FROM trusted_sources s WHERE s.mail_id=m.id AND s.account_id=m.account_id AND s.active=1 AND s.folder IN (SELECT value FROM json_each(?2)))) SELECT COUNT(*),CASE WHEN COUNT(*)>COUNT(julianday(mail_date)) THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ',MIN(julianday(mail_date))) END FROM waiting", params![id, serde_json::to_string(&wanted).map_err(err)?], |r| Ok((r.get(0)?,r.get(1)?))).map_err(err)?;
        let failed_jobs = db.query_row("SELECT COUNT(*) FROM archive_jobs WHERE json_extract(data,'$.accountId')=?1 AND status='blocked'", [id], |r| r.get::<_, u64>(0)).map_err(err)?;
        let warning = retention_warning(
            a.server_retention_days,
            pending,
            oldest.as_deref(),
            chrono::Utc::now(),
        );
        Ok(RetentionSettings {
            default_save: a.save_locally,
            folders,
            overrides,
            summary: RetentionSummary {
                data_dir: crate::archive_location::display_path(&self.root),
                known,
                saved,
                saved_bytes,
                pending,
                failed_jobs,
                last_sync: a.last_sync.clone(),
                receive_error: a.error.as_deref().map(crate::remote::display_activity),
                warning,
            },
            account: a,
        })
    }
    pub fn should_save_folder(&self, account: &Account, folder: &str) -> Result<bool> {
        effective_save(&self.db()?, account, folder)
    }
    #[cfg(test)]
    pub fn save_retention(&self, expected: &Account, overrides: &[FolderRetention]) -> Result<()> {
        self.save_retention_inner(expected, overrides, false)
    }
    pub fn save_retention_preferences(
        &self,
        expected: &Account,
        overrides: &[FolderRetention],
    ) -> Result<()> {
        self.save_retention_inner(expected, overrides, true)
    }
    fn save_retention_inner(
        &self,
        expected: &Account,
        overrides: &[FolderRetention],
        allow_pop: bool,
    ) -> Result<()> {
        expected.validate()?;
        // Saving an override completes after any earlier in-flight archive
        // write. Future ingestion observes the committed scope under this gate.
        let _archive = self.archive_gate.write().map_err(err)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: String = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&expected.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let mut current: Account = serde_json::from_str(&data).map_err(err)?;
        if current.protocol != "imap" && !(allow_pop && overrides.is_empty()) {
            return Err("POP3 只支持账号保存设置".into());
        }
        if !current.same_connection(expected) {
            return Err("账号连接配置已修改，请重新打开保存范围".into());
        }
        let mut names = std::collections::HashSet::new();
        for item in overrides {
            if item.folder.is_empty()
                || item.folder.bytes().any(|b| b < 32 || b == 127)
                || !names.insert(&item.folder)
            {
                return Err("文件夹保存配置无效或重复".into());
            }
            let data: Option<String> = tx
                .query_row(
                    "SELECT data FROM remote_folders WHERE account_id=?1 AND name=?2",
                    params![current.id, item.folder],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            let folder: RemoteFolder =
                serde_json::from_str(&data.ok_or("文件夹已失效，请刷新后重新选择")?)
                    .map_err(err)?;
            if !folder.selectable {
                return Err("不能为不可读取的目录设置保存范围".into());
            }
        }
        tx.execute(
            "DELETE FROM folder_retention WHERE account_id=?1",
            [&current.id],
        )
        .map_err(err)?;
        for item in overrides {
            tx.execute(
                "INSERT INTO folder_retention VALUES(?1,?2,?3)",
                params![current.id, item.folder, item.save_locally],
            )
            .map_err(err)?;
        }
        current.server_retention_days = expected.server_retention_days;
        tx.execute(
            "UPDATE accounts SET data=?2 WHERE id=?1",
            params![current.id, serde_json::to_string(&current).map_err(err)?],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }
}
