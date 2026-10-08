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
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetentionSettings {
    pub default_save: bool,
    pub folders: Vec<RemoteFolder>,
    pub overrides: Vec<FolderRetention>,
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
        Ok(RetentionSettings {
            default_save: a.save_locally,
            folders: self.remote_folders(Some(id))?,
            overrides: self.retention_overrides(id)?,
        })
    }
    pub fn should_save_folder(&self, account: &Account, folder: &str) -> Result<bool> {
        if account.protocol != "imap" {
            return Ok(account.save_locally);
        }
        let value: Option<bool> = self
            .db()?
            .query_row(
                "SELECT save_locally FROM folder_retention WHERE account_id=?1 AND folder=?2",
                params![account.id, folder],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        Ok(value.unwrap_or(account.save_locally))
    }
    pub fn save_retention(&self, expected: &Account, overrides: &[FolderRetention]) -> Result<()> {
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
        let current: Account = serde_json::from_str(&data).map_err(err)?;
        if current.protocol != "imap" {
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
        tx.commit().map_err(err)
    }
}
