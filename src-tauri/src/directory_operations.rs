//! Non-idempotent directory actions have their own durable journal.
//! Submitted COPY is never automatically replayed after an interruption.
use crate::{models::*, operations, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyReceipt {
    pub validity: u32,
    pub uid: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryOperation {
    pub id: String,
    pub account_id: String,
    pub account_email: String,
    pub mail_id: String,
    pub subject: String,
    pub folder: String,
    pub remote_id: String,
    pub target: String,
    pub identity: String,
    pub status: String,
    pub error: String,
    pub content_hash: String,
    pub receipt: Option<CopyReceipt>,
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS directory_operations(
        id TEXT PRIMARY KEY,account_id TEXT NOT NULL,folder TEXT NOT NULL,remote_id TEXT NOT NULL,
        target TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',receipt TEXT,next_attempt INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,UNIQUE(account_id,folder,remote_id,target));
        CREATE INDEX IF NOT EXISTS directory_due ON directory_operations(account_id,status,next_attempt);
        UPDATE directory_operations SET status='queued' WHERE status='preparing';
        UPDATE directory_operations SET status='uncertain',error='复制请求已提交但确认未保存；请核对目标目录，不会自动重复复制' WHERE status='submitted';
        UPDATE directory_operations SET status='confirmed' WHERE status='verifying';").map_err(err)
}
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<DirectoryOperation> {
    let data: String = row.get(0)?;
    let mut op: DirectoryOperation = serde_json::from_str(&data).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    op.status = row.get(1)?;
    op.error = row.get(2)?;
    op.content_hash = row.get(3)?;
    let receipt: Option<String> = row.get(4)?;
    op.receipt = receipt
        .map(|s| serde_json::from_str(&s))
        .transpose()
        .map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?;
    Ok(op)
}
const COLUMNS: &str = "data,status,error,content_hash,receipt";
fn check(db: &rusqlite::Connection, op: &DirectoryOperation) -> Result<Account> {
    let data: String = db
        .query_row(
            "SELECT data FROM accounts WHERE id=?1",
            [&op.account_id],
            |r| r.get(0),
        )
        .map_err(|_| "账号已移除，请核对目标目录")?;
    let a: Account = serde_json::from_str(&data).map_err(err)?;
    if !a.enabled || a.protocol != "imap" || operations::identity(&a) != op.identity {
        return Err("账号已暂停或连接配置已变化，请重新收取后操作".into());
    }
    for folder in [&op.folder, &op.target] {
        let isolated: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM folder_health WHERE account_id=?1 AND folder=?2)",
                params![a.id, folder],
                |r| r.get(0),
            )
            .map_err(err)?;
        if isolated {
            return Err("来源或目标目录已隔离，请在设置中重新核查".into());
        }
    }
    let target: Option<String> = db
        .query_row(
            "SELECT data FROM remote_folders WHERE account_id=?1 AND name=?2",
            params![a.id, op.target],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let folder: RemoteFolder = target
        .and_then(|v| serde_json::from_str(&v).ok())
        .ok_or("目标目录已不存在，请刷新服务器目录")?;
    if !folder.selectable {
        return Err("目标目录不能存放邮件，请选择子文件夹".into());
    }
    if !matches!(op.status.as_str(), "confirmed" | "verifying") {
        let active: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM trusted_sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND mail_id=?4 AND active=1)", params![a.id,op.folder,op.remote_id,op.mail_id], |r| r.get(0)).map_err(err)?;
        if !active {
            return Err("原服务器来源已失效，请重新收取后操作".into());
        }
    }
    Ok(a)
}
impl Store {
    pub fn queue_copy(&self, mail_id: &str, source: &str, target: &str) -> Result<String> {
        if source.eq_ignore_ascii_case(target) {
            return Err("请选择不同的服务器目标目录".into());
        }
        if target.bytes().any(|b| b < 32 || b == 127) {
            return Err("目标目录名称无效".into());
        }
        let mail = self.mail(mail_id)?;
        let a = self.account(&mail.account_id)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let remote_id: String = tx.query_row("SELECT remote_id FROM trusted_sources WHERE account_id=?1 AND mail_id=?2 AND folder=?3 AND active=1 ORDER BY remote_id LIMIT 1", params![a.id,mail_id,source], |r| r.get(0)).map_err(|_| "该邮件在所选目录没有可用的服务器来源")?;
        operations::remote_identity(&remote_id).ok_or("仅本地邮件不能复制到服务器")?;
        let op = DirectoryOperation {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: a.id.clone(),
            account_email: a.email.clone(),
            mail_id: mail_id.into(),
            subject: mail.subject,
            folder: source.into(),
            remote_id,
            target: target.into(),
            identity: operations::identity(&a),
            status: "queued".into(),
            error: String::new(),
            content_hash: String::new(),
            receipt: None,
        };
        check(&tx, &op)?;
        let existing: Option<(String,String)> = tx.query_row("SELECT id,status FROM directory_operations WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND target=?4",params![a.id,source,op.remote_id,target],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
        if let Some((id, status)) = existing {
            if status == "cancelled" {
                tx.execute("DELETE FROM directory_operations WHERE id=?1", [id])
                    .map_err(err)?;
            } else {
                return Ok(id);
            }
        }
        tx.execute("INSERT INTO directory_operations(id,account_id,folder,remote_id,target,data,status,updated_at) VALUES(?1,?2,?3,?4,?5,?6,'queued',?7)",params![op.id,a.id,source,op.remote_id,target,serde_json::to_string(&op).map_err(err)?,chrono::Utc::now().timestamp()]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(op.id)
    }
    pub fn directory_operation(&self, id: &str) -> Result<DirectoryOperation> {
        self.db()?
            .query_row(
                &format!("SELECT {COLUMNS} FROM directory_operations WHERE id=?1"),
                [id],
                decode,
            )
            .map_err(err)
    }
    pub fn directory_operations(&self) -> Result<Vec<DirectoryOperation>> {
        let db = self.db()?;
        let mut st=db.prepare(&format!("SELECT {COLUMNS} FROM directory_operations ORDER BY CASE status WHEN 'uncertain' THEN 0 WHEN 'blocked' THEN 1 WHEN 'completed' THEN 3 ELSE 2 END,updated_at DESC LIMIT 50")).map_err(err)?;
        let mut result = st
            .query_map([], decode)
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        // Display names belong only in the UI snapshot. Worker records retain
        // exact wire paths so translated labels can never become IMAP commands.
        for op in &mut result {
            let label = |name: &str| -> Result<String> {
                let data: Option<String> = db
                    .query_row(
                        "SELECT data FROM remote_folders WHERE account_id=?1 AND name=?2",
                        params![op.account_id, name],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(err)?;
                Ok(data
                    .and_then(|v| serde_json::from_str::<RemoteFolder>(&v).ok())
                    .map(|f| f.display_name)
                    .unwrap_or_else(|| crate::remote::display_name(name)))
            };
            op.folder = label(&op.folder)?;
            op.target = label(&op.target)?;
        }
        Ok(result)
    }
    pub fn copy_sources(&self, id: &str) -> Result<Vec<String>> {
        let db = self.db()?;
        let mut st=db.prepare("SELECT folder,remote_id FROM trusted_sources WHERE mail_id=?1 AND active=1 ORDER BY folder='INBOX' COLLATE NOCASE DESC,folder").map_err(err)?;
        let rows = st
            .query_map([id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut folders = Vec::new();
        for (folder, remote) in rows {
            if operations::remote_identity(&remote).is_some() && !folders.contains(&folder) {
                folders.push(folder);
            }
        }
        Ok(folders)
    }
    pub fn directory_action(&self, id: &str, action: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let op = tx
            .query_row(
                &format!("SELECT {COLUMNS} FROM directory_operations WHERE id=?1"),
                [id],
                decode,
            )
            .map_err(err)?;
        let status = match (action, op.status.as_str()) {
            ("cancel", "queued" | "blocked") => "cancelled",
            ("retry", "blocked") => {
                check(&tx, &op)?;
                "queued"
            }
            ("verify", "confirmed") => "confirmed",
            _ => return Err("此任务不能重发；结果未确认时请先核对目标目录".into()),
        };
        tx.execute("UPDATE directory_operations SET status=?2,error='',next_attempt=0,updated_at=?3 WHERE id=?1",params![id,status,chrono::Utc::now().timestamp()]).map_err(err)?;
        tx.commit().map_err(err)
    }
    pub(crate) fn claim_copy(&self, op: &DirectoryOperation) -> Result<bool> {
        let next = if op.status == "confirmed" {
            "verifying"
        } else {
            "preparing"
        };
        Ok(self
            .db()?
            .execute(
                "UPDATE directory_operations SET status=?3 WHERE id=?1 AND status=?2",
                params![op.id, op.status, next],
            )
            .map_err(err)?
            == 1)
    }
    pub(crate) fn validate_copy(&self, op: &DirectoryOperation) -> Result<Account> {
        check(&self.db()?, op)
    }
    pub(crate) fn submit_copy(&self, op: &DirectoryOperation, hash: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        check(&tx, op)?;
        if tx.execute("UPDATE directory_operations SET status='submitted',content_hash=?2 WHERE id=?1 AND status='preparing'",params![op.id,hash]).map_err(err)?!=1 {return Err("复制任务状态已变化，停止提交".into());}
        tx.commit().map_err(err)
    }
    pub(crate) fn save_copy_receipt(
        &self,
        op: &DirectoryOperation,
        receipt: &CopyReceipt,
    ) -> Result<()> {
        if self.db()?.execute("UPDATE directory_operations SET status='confirmed',receipt=?2 WHERE id=?1 AND status='submitted'",params![op.id,serde_json::to_string(receipt).map_err(err)?]).map_err(err)?!=1 {return Err("复制确认无法保存，请核对目标目录，不要重复复制".into());}
        Ok(())
    }
    pub(crate) fn complete_copy(&self, op: &DirectoryOperation) -> Result<()> {
        let receipt = op.receipt.as_ref().ok_or("复制确认缺失")?;
        let remote = format!("{}:{}", receipt.validity, receipt.uid);
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        check(&tx, op)?;
        let status: String = tx
            .query_row(
                "SELECT status FROM directory_operations WHERE id=?1",
                [&op.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !matches!(status.as_str(), "confirmed" | "verifying") {
            return Err("复制任务状态已变化".into());
        }
        let exists: Option<String> = tx
            .query_row(
                "SELECT mail_id FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![op.account_id, op.target, remote],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if exists.as_ref().is_some_and(|id| id != &op.mail_id) {
            return Err("目标邮件编号已指向其他本地记录，请重新收取核对".into());
        }
        if tx.execute("INSERT INTO sources(account_id,folder,remote_id,mail_id,active) SELECT ?1,?2,?3,id,1 FROM messages WHERE id=?4 AND account_id=?1 ON CONFLICT(account_id,folder,remote_id) DO UPDATE SET active=1",params![op.account_id,op.target,remote,op.mail_id]).map_err(err)? != 1 {
            return Err("原本地邮件记录已不存在；服务器确认保留，请核对目标目录".into());
        }
        tx.execute(
            "UPDATE directory_operations SET status='completed',error='',updated_at=?2 WHERE id=?1",
            params![op.id, chrono::Utc::now().timestamp()],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }
    pub(crate) fn fail_copy(&self, id: &str, reason: &str, definite_rejection: bool) -> Result<()> {
        // A saved receipt can be verified again with read-only commands. A
        // missing receipt after submission cannot be safely resent.
        self.db()?.execute("UPDATE directory_operations SET status=CASE WHEN status IN ('confirmed','verifying') THEN 'confirmed' WHEN status='submitted' AND ?3=0 THEN 'uncertain' ELSE 'blocked' END,error=?2,next_attempt=?4,updated_at=?5 WHERE id=?1 AND status IN ('preparing','submitted','confirmed','verifying')",params![id,reason,definite_rejection,chrono::Utc::now().timestamp()+60,chrono::Utc::now().timestamp()]).map_err(err)?;
        Ok(())
    }
    pub(crate) fn due_copies(&self, account: &str) -> Result<Vec<DirectoryOperation>> {
        let db = self.db()?;
        let mut st=db.prepare(&format!("SELECT {COLUMNS} FROM directory_operations WHERE account_id=?1 AND status IN ('queued','confirmed') AND next_attempt<=?2 ORDER BY updated_at LIMIT 20")).map_err(err)?;
        let result = st
            .query_map(params![account, chrono::Utc::now().timestamp()], decode)
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err);
        result
    }
}
pub fn start(store: Store, app: tauri::AppHandle) {
    let active = Arc::new(Mutex::new(HashSet::<String>::new()));
    std::thread::spawn(move || loop {
        if let Ok(accounts) = store.accounts() {
            for a in accounts
                .into_iter()
                .filter(|a| a.enabled && a.protocol == "imap")
            {
                let Ok(mut busy) = active.lock() else {
                    continue;
                };
                if busy.contains(&a.id) {
                    continue;
                }
                let Ok(jobs) = store.due_copies(&a.id) else {
                    continue;
                };
                if jobs.is_empty() {
                    continue;
                }
                busy.insert(a.id.clone());
                drop(busy);
                let (store, app, active) = (store.clone(), app.clone(), active.clone());
                std::thread::spawn(move || {
                    for op in jobs {
                        let Ok(source) =
                            crate::sync_control::folder_gate(&store.root, &a.id, &op.folder)
                        else {
                            continue;
                        };
                        let Ok(target) =
                            crate::sync_control::folder_gate(&store.root, &a.id, &op.target)
                        else {
                            continue;
                        };
                        let (Ok(_source), Ok(_target)) = (source.try_lock(), target.try_lock())
                        else {
                            continue;
                        };
                        if !store.claim_copy(&op).unwrap_or(false) {
                            continue;
                        }
                        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            crate::network::apply_copy(&store, &op)
                        }));
                        if !matches!(result, Ok(Ok(()))) {
                            let error = match result {
                                Ok(Err(e)) => e,
                                _ => "复制过程已中断，请查看任务记录".into(),
                            };
                            let _ = store.fail_copy(&op.id, &error, false);
                        }
                        let _ = app.emit("directory-operations-updated", ());
                        let _ = app.emit("mail-updated", ());
                        break;
                    }
                    if let Ok(mut busy) = active.lock() {
                        busy.remove(&a.id);
                    }
                });
            }
        }
        std::thread::sleep(Duration::from_secs(1));
    });
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) fn fixture() -> (tempfile::TempDir, Store, Account, String) {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let a = crate::tests::account();
        store.save_account(&a).unwrap();
        store
            .ingest(&a, "INBOX", "7:12", &crate::tests::raw(), false)
            .unwrap();
        store
            .save_remote_folders(
                &a.id,
                &[RemoteFolder {
                    account_id: a.id.clone(),
                    name: "Archive".into(),
                    display_name: "归档".into(),
                    delimiter: None,
                    selectable: true,
                    roles: vec![],
                    detected_roles: None,
                    sync_error: None,
                }],
            )
            .unwrap();
        let id = store.snapshot(&crate::tests::query()).unwrap().messages[0]
            .id
            .clone();
        (temp, store, a, id)
    }
    #[test]
    fn copy_is_deduplicated_and_cancel_is_only_allowed_before_submission() {
        let (_temp, store, _a, id) = fixture();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        assert_eq!(store.queue_copy(&id, "INBOX", "Archive").unwrap(), job);
        assert!(store.queue_copy(&id, "INBOX", "INBOX").is_err());
        assert!(store.queue_copy(&id, "INBOX", "Missing").is_err());
        assert!(store.queue_copy(&id, "INBOX", "Archive\r\nCOPY").is_err());
        let op = store.directory_operation(&job).unwrap();
        assert!(store.claim_copy(&op).unwrap());
        assert!(!store.claim_copy(&op).unwrap());
        assert!(store.directory_action(&job, "cancel").is_err());
        store.submit_copy(&op, "hash").unwrap();
        store.fail_copy(&job, "Disconnected", false).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "uncertain");
        assert!(store.directory_action(&job, "retry").is_err());
        assert!(store.directory_action(&job, "cancel").is_err());
    }
    #[test]
    fn ui_names_are_decoded_but_command_paths_and_backup_journal_stay_separate() {
        let (_temp, store, a, id) = fixture();
        let wire = "&UXZO1mWHTvZZOQ-/Archive";
        let mut folder = store.remote_folders(Some(&a.id)).unwrap().remove(0);
        folder.name = wire.into();
        folder.delimiter = Some("/".into());
        store.save_remote_folders(&a.id, &[folder]).unwrap();
        let job = store.queue_copy(&id, "INBOX", wire).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().target, wire);
        let snapshot = store.directory_operations().unwrap();
        assert_eq!(snapshot[0].folder, "收件箱");
        assert_eq!(snapshot[0].target, "其他文件夹/归档");
        let mut sent = store.remote_folders(Some(&a.id)).unwrap().remove(0);
        sent.name = "Sent Messages".into();
        sent.roles.clear();
        sent.detected_roles = None;
        store.save_remote_folders(&a.id, &[sent]).unwrap();
        let sent_job = store.queue_copy(&id, "INBOX", "Sent Messages").unwrap();
        let sent_snapshot = store
            .directory_operations()
            .unwrap()
            .into_iter()
            .find(|op| op.id == sent_job)
            .unwrap();
        assert_eq!(sent_snapshot.target, "已发送");
        assert_eq!(
            store.directory_operation(&sent_job).unwrap().target,
            "Sent Messages"
        );
        let output = tempfile::tempdir().unwrap();
        let path = store.backup(output.path()).unwrap();
        let db = rusqlite::Connection::open_with_flags(
            std::path::Path::new(&path).join("snapshot.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM directory_operations", [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            0
        );
        assert_eq!(store.directory_operation(&job).unwrap().status, "queued");
    }
    #[test]
    fn failed_receipt_persistence_keeps_submission_uncertain_and_never_replays() {
        let (_temp, store, a, id) = fixture();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store.submit_copy(&op, "hash").unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER reject_receipt BEFORE UPDATE ON directory_operations WHEN NEW.status='confirmed' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(store
            .save_copy_receipt(
                &op,
                &CopyReceipt {
                    validity: 9,
                    uid: 34
                }
            )
            .is_err());
        store
            .fail_copy(&job, "receipt persistence failed", false)
            .unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "uncertain");
        assert!(store.due_copies(&a.id).unwrap().is_empty());
        assert!(store.directory_action(&job, "retry").is_err());
    }
    #[test]
    fn restart_recovers_only_unsubmitted_work_and_readonly_receipts() {
        let (temp, store, a, id) = fixture();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        drop(store);
        let store = Store::new(temp.path().into()).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "queued");
        store.claim_copy(&op).unwrap();
        store.submit_copy(&op, "hash").unwrap();
        drop(store);
        let store = Store::new(temp.path().into()).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "uncertain");
        assert!(store.due_copies(&a.id).unwrap().is_empty());
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE directory_operations SET status='submitted' WHERE id=?1",
                [&job],
            )
            .unwrap();
        store
            .save_copy_receipt(
                &op,
                &CopyReceipt {
                    validity: 9,
                    uid: 34,
                },
            )
            .unwrap();
        let confirmed = store.directory_operation(&job).unwrap();
        store.claim_copy(&confirmed).unwrap();
        drop(store);
        let store = Store::new(temp.path().into()).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "confirmed");
        assert_eq!(store.due_copies(&a.id).unwrap().len(), 1);
        assert!(store.directory_action(&job, "retry").is_err());
    }
    #[test]
    fn receipt_links_verified_target_atomically_and_preserves_source_mime_flags() {
        let (_temp, store, _a, id) = fixture();
        let before = store.message_raw(&store.mail(&id).unwrap()).unwrap();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store
            .submit_copy(&op, &crate::archive::digest(&before))
            .unwrap();
        store
            .save_copy_receipt(
                &op,
                &CopyReceipt {
                    validity: 9,
                    uid: 34,
                },
            )
            .unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER reject_copy BEFORE UPDATE ON directory_operations WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(store.complete_copy(&op).is_err());
        assert!(!store.has_source(&op.account_id, "Archive", "9:34").unwrap());
        store
            .db()
            .unwrap()
            .execute_batch("DROP TRIGGER reject_copy;")
            .unwrap();
        store.complete_copy(&op).unwrap();
        assert!(store.has_source(&op.account_id, "Archive", "9:34").unwrap());
        assert!(store.has_source(&op.account_id, "INBOX", "7:12").unwrap());
        assert_eq!(
            store.message_raw(&store.mail(&id).unwrap()).unwrap(),
            before
        );
        assert_eq!(store.directory_operation(&job).unwrap().status, "completed");
        assert_eq!(store.queue_copy(&id, "INBOX", "Archive").unwrap(), job);
        assert!(store.due_copies(&op.account_id).unwrap().is_empty());
    }
    #[test]
    fn isolation_identity_change_and_lost_provenance_block_unsubmitted_copy() {
        let (_temp, store, mut a, id) = fixture();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store
            .isolate_folder(&a, "Archive", "bad", &Default::default())
            .unwrap();
        assert!(store.validate_copy(&op).is_err());
        assert!(store.queue_copy(&id, "INBOX", "Archive").is_err());
        store.restore_folder_trust(&a, "Archive").unwrap();
        a.incoming_host = "changed.invalid".into();
        store.save_account(&a).unwrap();
        assert!(store.validate_copy(&op).is_err());
    }
}
