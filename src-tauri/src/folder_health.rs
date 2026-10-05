//! Quarantine unreliable directory provenance without deleting messages or MIME.
use crate::{models::*, operations, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionEvidence {
    pub exists: Option<u32>,
    pub uid_count: Option<usize>,
    pub inbox_uid_overlap: Option<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderHealth {
    pub account_id: String,
    pub account_email: String,
    pub folder: String,
    pub display_name: String,
    pub reason: String,
    pub checked_at: String,
    pub evidence: SelectionEvidence,
    pub sources: usize,
    pub alternate_sources: usize,
    pub saved: usize,
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS folder_health(
        account_id TEXT NOT NULL,folder TEXT NOT NULL,identity TEXT NOT NULL,reason TEXT NOT NULL,
        checked_at TEXT NOT NULL,evidence TEXT NOT NULL,PRIMARY KEY(account_id,folder));
        CREATE VIEW IF NOT EXISTS trusted_sources AS SELECT s.* FROM sources s
        WHERE NOT EXISTS(SELECT 1 FROM folder_health h WHERE h.account_id=s.account_id AND h.folder=s.folder);
        CREATE TRIGGER IF NOT EXISTS health_source_insert AFTER INSERT ON sources BEGIN
            UPDATE conversation_revision SET version=version+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS health_source_delete AFTER DELETE ON sources BEGIN
            UPDATE conversation_revision SET version=version+1 WHERE id=1; END;
        CREATE TRIGGER IF NOT EXISTS health_source_update AFTER UPDATE OF active,mail_id,folder,account_id ON sources
            WHEN OLD.active IS NOT NEW.active OR OLD.mail_id IS NOT NEW.mail_id OR OLD.folder IS NOT NEW.folder OR OLD.account_id IS NOT NEW.account_id BEGIN
            UPDATE conversation_revision SET version=version+1 WHERE id=1; END;
        CREATE VIEW IF NOT EXISTS readable_listing AS SELECT m.* FROM message_listing m WHERE
            COALESCE(json_extract(m.data,'$.savedLocally'),1)=1 OR
            NOT EXISTS(SELECT 1 FROM sources s JOIN folder_health h ON h.account_id=s.account_id AND h.folder=s.folder WHERE s.mail_id=m.id AND s.active=1) OR
            EXISTS(SELECT 1 FROM trusted_sources t WHERE t.mail_id=m.id AND t.active=1);") .map_err(err)
}
impl Store {
    /// A fully consumed contradictory selection is synchronized enough to
    /// quarantine. Transport failures alone never declare a source invalid.
    pub(crate) fn isolate_folder(
        &self,
        a: &Account,
        folder: &str,
        reason: &str,
        evidence: &SelectionEvidence,
    ) -> Result<bool> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let current: Option<String> = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [&a.id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        let Some(current) = current else {
            return Ok(false);
        };
        let current: Account = serde_json::from_str(&current).map_err(err)?;
        if !current.enabled || operations::identity(a) != operations::identity(&current) {
            return Ok(false);
        }
        let was_isolated: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM folder_health WHERE account_id=?1 AND folder=?2)",
                params![a.id, folder],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !was_isolated {
            tx.execute(
                "UPDATE conversation_revision SET version=version+1 WHERE id=1",
                [],
            )
            .map_err(err)?;
        }
        tx.execute("INSERT INTO folder_health VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(account_id,folder) DO UPDATE SET identity=excluded.identity,reason=excluded.reason,checked_at=excluded.checked_at,evidence=excluded.evidence", params![a.id,folder,operations::identity(a),reason,chrono::Utc::now().to_rfc3339(),serde_json::to_string(evidence).map_err(err)?]).map_err(err)?;
        // Invalidate an in-flight completion by revision. The folder gate
        // serializes this with the worker; completed writes remain historical.
        tx.execute("UPDATE server_operations SET status='isolated',revision=revision+1,error=?3 WHERE account_id=?1 AND folder=?2 AND status IN ('queued','running','blocked')", params![a.id,folder,format!("目录来源已隔离：{reason}")]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(true)
    }
    /// Only a complete successful scan reconciles old provenance. A successful
    /// EXAMINE/SEARCH probe alone must never restore old locations or writes.
    pub(crate) fn restore_folder_trust(&self, a: &Account, folder: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let current: Option<String> = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [&a.id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if !current
            .as_deref()
            .and_then(|v| serde_json::from_str::<Account>(v).ok())
            .is_some_and(|c| c.enabled && operations::identity(&c) == operations::identity(a))
        {
            return Ok(());
        }
        let restored = tx
            .execute(
                "DELETE FROM folder_health WHERE account_id=?1 AND folder=?2 AND identity=?3",
                params![a.id, folder, operations::identity(a)],
            )
            .map_err(err)?;
        if restored > 0 {
            tx.execute(
                "UPDATE conversation_revision SET version=version+1 WHERE id=1",
                [],
            )
            .map_err(err)?;
        }
        // Requeue only a still-current intent on a location verified by the
        // completed scan. Stale sources stay isolated for review, never replay.
        tx.execute("UPDATE server_operations SET status='queued',revision=revision+1,next_attempt=0,error='' WHERE account_id=?1 AND folder=?2 AND status='isolated' AND json_extract(data,'$.identity')=?3 AND EXISTS(SELECT 1 FROM trusted_sources s JOIN messages m ON m.id=s.mail_id AND m.account_id=s.account_id WHERE s.account_id=?1 AND s.folder=?2 AND s.remote_id=server_operations.remote_id AND s.active=1 AND m.id=json_extract(server_operations.data,'$.mailId') AND json_extract(m.data,CASE server_operations.action WHEN 'read' THEN '$.isRead' ELSE '$.starred' END)=json_extract(server_operations.data,'$.value'))",params![a.id,folder,operations::identity(a)]).map_err(err)?;
        tx.commit().map_err(err)
    }
    pub fn folder_health(&self) -> Result<Vec<FolderHealth>> {
        let db = self.db()?;
        let mut stmt=db.prepare("SELECT h.account_id,json_extract(a.data,'$.email'),h.folder,h.reason,h.checked_at,h.evidence,
            (SELECT COUNT(*) FROM sources s WHERE s.account_id=h.account_id AND s.folder=h.folder AND s.active=1),
            (SELECT COUNT(*) FROM sources s WHERE s.account_id=h.account_id AND s.folder=h.folder AND s.active=1 AND EXISTS(SELECT 1 FROM trusted_sources t WHERE t.mail_id=s.mail_id AND t.account_id=s.account_id AND t.active=1)),
            (SELECT COUNT(*) FROM sources s JOIN message_listing m ON m.id=s.mail_id WHERE s.account_id=h.account_id AND s.folder=h.folder AND s.active=1 AND json_extract(m.data,'$.savedLocally')=1)
            FROM folder_health h JOIN accounts a ON a.id=h.account_id ORDER BY h.checked_at DESC").map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, usize>(6)?,
                    r.get::<_, usize>(7)?,
                    r.get::<_, usize>(8)?,
                ))
            })
            .map_err(err)?;
        rows.map(|r| {
            let (
                account_id,
                account_email,
                folder,
                reason,
                checked_at,
                evidence,
                sources,
                alternate_sources,
                saved,
            ) = r.map_err(err)?;
            Ok(FolderHealth {
                account_id,
                account_email,
                display_name: crate::remote::display_name(&folder),
                folder,
                reason,
                checked_at,
                evidence: serde_json::from_str(&evidence).map_err(err)?,
                sources,
                alternate_sources,
                saved,
            })
        })
        .collect()
    }
    pub(crate) fn folder_isolated_reason(
        &self,
        account: &str,
        folder: &str,
    ) -> Result<Option<String>> {
        self.db()?
            .query_row(
                "SELECT reason FROM folder_health WHERE account_id=?1 AND folder=?2",
                params![account, folder],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Store, Account, String) {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let a = crate::tests::account();
        store.save_account(&a).unwrap();
        store
            .ingest(&a, "INBOX", "7:12", &crate::tests::raw(), false)
            .unwrap();
        store
            .ingest(
                &a,
                "Container",
                "content:12:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                &crate::tests::raw(),
                false,
            )
            .unwrap();
        let id = store.snapshot(&crate::tests::query()).unwrap().messages[0]
            .id
            .clone();
        (temp, store, a, id)
    }
    fn isolate(store: &Store, a: &Account) {
        assert!(store
            .isolate_folder(
                a,
                "Container",
                "目录响应矛盾",
                &SelectionEvidence {
                    exists: Some(0),
                    uid_count: Some(1),
                    inbox_uid_overlap: Some(1)
                }
            )
            .unwrap());
    }
    #[test]
    fn quarantine_preserves_mime_and_old_provenance_but_excludes_reads_lists_and_new_writes() {
        let (_temp, store, a, id) = fixture();
        let before = store.message_raw(&store.mail(&id).unwrap()).unwrap();
        isolate(&store, &a);
        let health = store.folder_health().unwrap();
        assert_eq!(
            (
                health[0].sources,
                health[0].alternate_sources,
                health[0].saved
            ),
            (1, 1, 1)
        );
        assert_eq!(store.source(&id).unwrap().0, "INBOX");
        let mut q = crate::tests::query();
        q.remote_folder = "Container".into();
        assert!(store.snapshot(&q).unwrap().messages.is_empty());
        assert_eq!(
            store.message_raw(&store.mail(&id).unwrap()).unwrap(),
            before
        );
        store.change_mail(&id, "star", "true").unwrap();
        let ops = store.due_operations(&a.id).unwrap();
        assert_eq!(ops.len(), 1);
        assert_eq!(ops[0].folder, "INBOX");
        let count: usize = store
            .db()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sources WHERE active=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
        // With no trusted online source, a local archive remains readable.
        store.reconcile_folder(&a.id, "INBOX", &[]).unwrap();
        assert!(store.source(&id).is_err());
        assert_eq!(
            store.message_raw(&store.mail(&id).unwrap()).unwrap(),
            before
        );
    }
    #[test]
    fn isolated_intent_survives_restart_and_stale_ack_but_only_valid_intents_resume() {
        let (temp, store, a, id) = fixture();
        store.change_mail(&id, "star", "true").unwrap();
        let old = store
            .due_operations(&a.id)
            .unwrap()
            .into_iter()
            .find(|o| o.folder == "Container")
            .unwrap();
        assert!(store.claim_operation(&old).unwrap());
        isolate(&store, &a);
        store.finish_operation(&old, Ok(())).unwrap();
        assert_eq!(store.server_operations().unwrap().isolated, 1);
        let store = Store::new(temp.path().into()).unwrap();
        assert_eq!(store.folder_health().unwrap().len(), 1);
        assert_eq!(store.server_operations().unwrap().isolated, 1);
        assert!(store
            .retry_server_operation(&old.id)
            .unwrap_err()
            .contains("隔离"));
        // Complete reconciliation precedes restoring trust. A missing UID must
        // remain isolated and cannot be replayed onto another message.
        store.reconcile_folder(&a.id, "Container", &[]).unwrap();
        store.restore_folder_trust(&a, "Container").unwrap();
        assert_eq!(store.server_operations().unwrap().isolated, 1);
        assert!(store
            .due_operations(&a.id)
            .unwrap()
            .iter()
            .all(|o| o.folder != "Container"));
        // A later verified identical source may resume the exact current flag.
        store
            .ingest(&a, "Container", &old.remote_id, &crate::tests::raw(), false)
            .unwrap();
        store.restore_folder_trust(&a, "Container").unwrap();
        assert_eq!(store.server_operations().unwrap().isolated, 0);
        assert!(store
            .due_operations(&a.id)
            .unwrap()
            .iter()
            .any(|o| o.folder == "Container"));
    }
    #[test]
    fn obsolete_intent_and_stale_connection_never_revive_and_account_scope_is_separate() {
        let (_temp, store, a, id) = fixture();
        store.change_mail(&id, "star", "true").unwrap();
        isolate(&store, &a);
        store.change_mail(&id, "star", "false").unwrap();
        store.restore_folder_trust(&a, "Container").unwrap();
        assert_eq!(store.server_operations().unwrap().isolated, 1);
        let mut other = a.clone();
        other.id = "another-account".into();
        store.save_account(&other).unwrap();
        isolate(&store, &a);
        assert!(store
            .folder_isolated_reason(&other.id, "Container")
            .unwrap()
            .is_none());
        let mut stale = a.clone();
        stale.incoming_host = "changed.example.com".into();
        assert!(!store
            .isolate_folder(&stale, "INBOX", "stale", &Default::default())
            .unwrap());
        store.restore_folder_trust(&stale, "Container").unwrap();
        assert!(store
            .folder_isolated_reason(&a.id, "Container")
            .unwrap()
            .is_some());
        let mut paused = a.clone();
        paused.enabled = false;
        store.save_account(&paused).unwrap();
        assert!(!store
            .isolate_folder(&a, "INBOX", "paused", &Default::default())
            .unwrap());
        store.restore_folder_trust(&a, "Container").unwrap();
        assert!(store
            .folder_isolated_reason(&a.id, "Container")
            .unwrap()
            .is_some());
    }
    #[test]
    fn online_only_untrusted_turns_are_preserved_but_do_not_pollute_lists_or_threads() {
        let (_temp, store, mut a, _) = fixture();
        a.save_locally = false;
        store.save_account(&a).unwrap();
        let raw=b"From: fixture@example.com\r\nTo: test@example.com\r\nSubject: Untrusted turn\r\nMessage-ID: <isolated-only@example.com>\r\nIn-Reply-To: <notice@example.com>\r\n\r\n";
        store.ingest(&a, "Container", "7:99", raw, false).unwrap();
        let id = store
            .db()
            .unwrap()
            .query_row(
                "SELECT id FROM messages WHERE hash=?1",
                [crate::archive::digest(raw)],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        let before = store.conversation_index(&a.id).unwrap();
        assert!(before.roots.contains_key(&id));
        isolate(&store, &a);
        let after = store.conversation_index(&a.id).unwrap();
        assert!(!after.roots.contains_key(&id));
        assert!(!std::sync::Arc::ptr_eq(&before, &after));
        assert!(store.mail(&id).is_ok());
        assert!(store.has_source(&a.id, "Container", "7:99").unwrap());
        assert!(store.conversation(&id).unwrap_err().contains("核查"));
        let mut q = crate::tests::query();
        q.view = "unread".into();
        assert!(store
            .snapshot(&q)
            .unwrap()
            .messages
            .iter()
            .all(|m| m.id != id));
        // A verified alternative makes the same online record readable again.
        store.ingest(&a, "INBOX", "7:99", raw, false).unwrap();
        assert!(store
            .conversation_index(&a.id)
            .unwrap()
            .roots
            .contains_key(&id));
        assert_eq!(store.source(&id).unwrap().0, "INBOX");
    }

    #[test]
    fn isolation_transaction_failure_does_not_half_cancel_intents() {
        let (_temp, store, a, id) = fixture();
        store.change_mail(&id, "read", "true").unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER fail_health BEFORE UPDATE ON server_operations BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        assert!(store
            .isolate_folder(&a, "Container", "bad", &Default::default())
            .is_err());
        assert!(store.folder_health().unwrap().is_empty());
        assert_eq!(store.server_operations().unwrap().pending, 2);
    }
}
