//! Durable, idempotent flag intents. Never enqueue destructive operations here.
use crate::{models::*, store::Store};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Operation {
    pub id: String,
    pub account_id: String,
    pub account_email: String,
    pub mail_id: String,
    pub subject: String,
    pub folder: String,
    pub remote_id: String,
    pub action: String,
    pub value: bool,
    pub identity: String,
    pub revision: i64,
    pub status: String,
    pub attempts: i64,
    pub error: String,
    pub updated_at: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationSnapshot {
    pub pending: usize,
    pub blocked: usize,
    pub completed: usize,
    pub isolated: usize,
    pub items: Vec<Operation>,
}
pub enum Failure {
    Retry(String),
    Blocked(String),
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
pub fn identity(a: &Account) -> String {
    serde_json::json!([
        a.email,
        a.protocol,
        a.incoming_host,
        a.incoming_port,
        a.incoming_tls,
        a.username,
        a.auth,
        a.oauth_client_id
    ])
    .to_string()
}
pub fn remote_identity(remote: &str) -> Option<(Option<u32>, u32, Option<&str>)> {
    let parts: Vec<_> = remote.split(':').collect();
    if parts.len() == 2 {
        let validity: u32 = parts[0].parse().ok()?;
        let uid: u32 = parts[1].parse().ok()?;
        return (validity > 0 && uid > 0).then_some((Some(validity), uid, None));
    }
    if parts.len() == 3
        && parts[0] == "content"
        && parts[2].len() == 64
        && parts[2].bytes().all(|c| c.is_ascii_hexdigit())
    {
        let uid: u32 = parts[1].parse().ok()?;
        return (uid > 0).then_some((None, uid, Some(parts[2])));
    }
    None
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS server_operations(
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, folder TEXT NOT NULL, remote_id TEXT NOT NULL, action TEXT NOT NULL,
        data TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL,
        UNIQUE(account_id,folder,remote_id,action));
        CREATE INDEX IF NOT EXISTS operations_due ON server_operations(account_id,status,next_attempt);
        UPDATE server_operations SET status='queued',next_attempt=0 WHERE status='running';") .map_err(err)
}
pub fn enqueue(tx: &Transaction<'_>, mail: &Mail, action: &str, value: bool) -> Result<()> {
    if !matches!(action, "read" | "star") {
        return Ok(());
    }
    let data: Option<String> = tx
        .query_row(
            "SELECT data FROM accounts WHERE id=?1",
            [&mail.account_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let Some(data) = data else {
        return Ok(());
    };
    let a: Account = serde_json::from_str(&data).map_err(err)?;
    if a.protocol != "imap" {
        return Ok(());
    }
    // Preserve the intent transaction rather than enqueueing a UID that may
    // disappear during MOVE. The local flag update rolls back with this error.
    let moving:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM directory_operations WHERE account_id=?1 AND json_extract(data,'$.mailId')=?2 AND kind='move' AND status IN ('queued','preparing','submitted','confirmed','verifying','uncertain','cleanup_pending','cleanup_running','cleanup_submitted','cleanup_uncertain','cleanup_blocked'))",params![a.id,mail.id],|r|r.get(0)).map_err(err)?;
    if moving {
        return Err("该邮件的服务器移动尚未确认，请在文件夹操作完成后修改已读或星标".into());
    }
    let sources = tx
        .prepare(
            "SELECT folder,remote_id FROM trusted_sources WHERE account_id=?1 AND mail_id=?2 AND active=1",
        )
        .map_err(err)?
        .query_map(params![a.id, mail.id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    for (folder, remote_id) in sources {
        // Locally sent outbox UUIDs and POP3 UIDLs are not IMAP identifiers.
        if remote_identity(&remote_id).is_none() {
            continue;
        }
        let op = Operation {
            id: uuid::Uuid::new_v4().to_string(),
            account_id: a.id.clone(),
            account_email: a.email.clone(),
            mail_id: mail.id.clone(),
            subject: mail.subject.clone(),
            folder: folder.clone(),
            remote_id: remote_id.clone(),
            action: action.into(),
            value,
            identity: identity(&a),
            revision: 1,
            status: "queued".into(),
            attempts: 0,
            error: String::new(),
            updated_at: now(),
        };
        tx.execute("INSERT INTO server_operations(id,account_id,folder,remote_id,action,data,revision,status,updated_at)
            VALUES(?1,?2,?3,?4,?5,?6,1,'queued',?7)
            ON CONFLICT(account_id,folder,remote_id,action) DO UPDATE SET data=excluded.data,revision=server_operations.revision+1,
                status='queued',attempts=0,next_attempt=0,error='',updated_at=excluded.updated_at",
            params![op.id, a.id, folder, remote_id, action, serde_json::to_string(&op).map_err(err)?, now()]).map_err(err)?;
    }
    Ok(())
}
fn decode(r: &rusqlite::Row<'_>) -> rusqlite::Result<Operation> {
    let data: String = r.get(0)?;
    let mut op: Operation = serde_json::from_str(&data).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    op.id = r.get(1)?;
    op.revision = r.get(2)?;
    op.status = r.get(3)?;
    op.attempts = r.get(4)?;
    op.error = r.get(5)?;
    op.updated_at = r.get(6)?;
    Ok(op)
}
const COLUMNS: &str = "data,id,revision,status,attempts,error,updated_at";
impl Store {
    pub fn server_operations(&self) -> Result<OperationSnapshot> {
        let db = self.db()?;
        let (pending, blocked, completed, isolated) = db.query_row("SELECT COALESCE(SUM(status IN ('queued','running')),0),COALESCE(SUM(status='blocked'),0),COALESCE(SUM(status='completed'),0),COALESCE(SUM(status='isolated'),0) FROM server_operations", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
        let mut stmt = db.prepare(&format!("SELECT {COLUMNS} FROM server_operations ORDER BY CASE status WHEN 'blocked' THEN 0 WHEN 'running' THEN 1 WHEN 'queued' THEN 2 WHEN 'isolated' THEN 3 ELSE 4 END,updated_at DESC LIMIT 50")).map_err(err)?;
        let mut items = stmt
            .query_map([], decode)
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let accounts = self.accounts()?;
        for op in &mut items {
            op.folder = crate::remote::display_name(&op.folder);
            if op.status == "queued" && accounts.iter().any(|a| a.id == op.account_id && !a.enabled)
            {
                op.status = "paused".into();
            }
        }
        Ok(OperationSnapshot {
            pending,
            blocked,
            completed,
            isolated,
            items,
        })
    }
    pub(crate) fn due_operations(&self, account: &str) -> Result<Vec<Operation>> {
        let db = self.db()?;
        let mut stmt = db.prepare(&format!("SELECT {COLUMNS} FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY folder ORDER BY updated_at,id) AS ordinal FROM server_operations WHERE account_id=?1 AND status='queued' AND next_attempt<=?2) WHERE ordinal=1 ORDER BY updated_at,id LIMIT 50")).map_err(err)?;
        let items = stmt
            .query_map(params![account, now()], decode)
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        Ok(items)
    }
    pub(crate) fn claim_operation(&self, op: &Operation) -> Result<bool> {
        Ok(self.db()?.execute("UPDATE server_operations SET status='running',attempts=attempts+1,updated_at=?3 WHERE id=?1 AND revision=?2 AND status='queued'", params![op.id,op.revision,now()]).map_err(err)? == 1)
    }
    pub(crate) fn finish_operation(
        &self,
        op: &Operation,
        outcome: std::result::Result<(), Failure>,
    ) -> Result<()> {
        let (status, error, retry) = match outcome {
            Ok(()) => ("completed", String::new(), 0),
            Err(Failure::Blocked(e)) => ("blocked", e, 0),
            Err(Failure::Retry(e)) => (
                "queued",
                e,
                now() + (5_i64 * 2_i64.pow((op.attempts as u32).min(6))).min(300),
            ),
        };
        // A newer click/undo must survive completion of an older in-flight request.
        self.db()?.execute("UPDATE server_operations SET status=?3,error=?4,next_attempt=?5,updated_at=?6 WHERE id=?1 AND revision=?2 AND status='running'", params![op.id,op.revision,status,error,retry,now()]).map_err(err)?;
        Ok(())
    }
    pub fn retry_server_operation(&self, id: &str) -> Result<()> {
        let op = self
            .db()?
            .query_row(
                &format!("SELECT {COLUMNS} FROM server_operations WHERE id=?1"),
                [id],
                decode,
            )
            .map_err(err)?;
        self.validate_operation(&op).map_err(|e| match e {
            Failure::Retry(e) | Failure::Blocked(e) => e,
        })?;
        if self.db()?.execute("UPDATE server_operations SET status='queued',next_attempt=0,error='',updated_at=?2 WHERE id=?1 AND status IN ('queued','blocked')", params![id,now()]).map_err(err)? == 0 { return Err("任务已完成或正在同步，请刷新后查看".into()); }
        Ok(())
    }
    pub(crate) fn validate_operation(
        &self,
        op: &Operation,
    ) -> std::result::Result<Account, Failure> {
        let blocked = |e: &str| Failure::Blocked(e.into());
        let a = self
            .account(&op.account_id)
            .map_err(|_| blocked("账号已移除，本地存档保留"))?;
        if !a.enabled {
            return Err(Failure::Retry("账号已暂停，恢复收取后继续同步".into()));
        }
        if a.protocol != "imap" || identity(&a) != op.identity {
            return Err(blocked("账号连接配置已变化，请重新收取后再操作"));
        }
        if let Some(reason) = self
            .folder_isolated_reason(&op.account_id, &op.folder)
            .map_err(Failure::Retry)?
        {
            return Err(blocked(&format!(
                "目录来源已隔离，请先在设置中重新核查：{reason}"
            )));
        }
        let active: bool = self.db().map_err(Failure::Retry)?.query_row("SELECT EXISTS(SELECT 1 FROM sources JOIN messages ON messages.id=sources.mail_id WHERE sources.account_id=?1 AND sources.folder=?2 AND remote_id=?3 AND mail_id=?4 AND active=1 AND messages.account_id=?1)", params![op.account_id,op.folder,op.remote_id,op.mail_id], |r| r.get(0)).map_err(|e| Failure::Retry(err(e)))?;
        if !active {
            return Err(blocked("原邮件已不在该服务器文件夹，本地存档保留"));
        }
        let mail = self
            .mail(&op.mail_id)
            .map_err(|_| blocked("本地邮件记录已移除"))?;
        let desired = if op.action == "read" {
            mail.is_read
        } else {
            mail.starred
        };
        if desired != op.value {
            return Err(blocked("本地状态已更新，请按当前状态重新操作"));
        }
        Ok(a)
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
                let Ok(jobs) = store.due_operations(&a.id) else {
                    continue;
                };
                if jobs.is_empty() {
                    continue;
                }
                busy.insert(a.id.clone());
                drop(busy);
                let store = store.clone();
                let app = app.clone();
                let active = active.clone();
                std::thread::spawn(move || {
                    for op in jobs {
                        let Ok(gate) = crate::sync_control::folder_gate(
                            &store.root,
                            &op.account_id,
                            &op.folder,
                        ) else {
                            continue;
                        };
                        let Ok(_guard) = gate.try_lock() else {
                            continue;
                        };
                        if !store.claim_operation(&op).unwrap_or(false) {
                            continue;
                        }
                        let result = store.validate_operation(&op).and_then(|account| {
                            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                                crate::network::apply_server_flag(&account, &op)
                            }))
                            .unwrap_or_else(|_| {
                                Err(Failure::Retry("服务器状态同步中断，将自动重试".into()))
                            })
                        });
                        if let Err(e) = store.finish_operation(&op, result) {
                            let _ = store.log(&format!("服务器状态同步记录失败：{e}"));
                        }
                        let _ = app.emit("server-operations-updated", ());
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
mod tests {
    use super::*;
    use crate::tests::{account, query, raw};
    fn seed() -> (tempfile::TempDir, Store, Account, String) {
        let temp = tempfile::tempdir().unwrap();
        let s = Store::new(temp.path().into()).unwrap();
        let a = account();
        s.save_account(&a).unwrap();
        s.ingest(&a, "INBOX", "7:12", &raw(), false).unwrap();
        let id = s.snapshot(&query()).unwrap().messages[0].id.clone();
        (temp, s, a, id)
    }
    #[test]
    fn flags_are_atomic_durable_and_restart_recovers_only_idempotent_running_work() {
        let (temp, s, a, id) = seed();
        s.change_mail(&id, "read", "true").unwrap();
        let job = s.due_operations(&a.id).unwrap().remove(0);
        assert!(s.mail(&id).unwrap().is_read);
        assert!(s.claim_operation(&job).unwrap());
        assert!(!s.claim_operation(&job).unwrap());
        drop(s);
        let s = Store::new(temp.path().into()).unwrap();
        let recovered = s.due_operations(&a.id).unwrap().remove(0);
        assert_eq!(recovered.id, job.id);
        assert_eq!(recovered.attempts, 1);
        s.db().unwrap().execute_batch("CREATE TRIGGER fail_flags BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(s.change_mail(&id, "star", "true").is_err());
        assert!(!s.mail(&id).unwrap().starred);
        assert_eq!(s.server_operations().unwrap().pending, 1);
    }
    #[test]
    fn a_new_click_and_undo_survive_an_old_completion() {
        let (_temp, s, a, id) = seed();
        s.change_mail(&id, "star", "true").unwrap();
        let job = s.due_operations(&a.id).unwrap().remove(0);
        assert!(s.claim_operation(&job).unwrap());
        s.change_mail(&id, "star", "false").unwrap();
        s.finish_operation(&job, Ok(())).unwrap();
        let next = s.due_operations(&a.id).unwrap().remove(0);
        assert_eq!(next.id, job.id);
        assert!(next.revision > job.revision);
        assert!(!next.value);
        assert!(!s.mail(&id).unwrap().starred);
        assert!(!s.claim_operation(&job).unwrap());
        assert!(s.claim_operation(&next).unwrap());
        s.finish_operation(&next, Ok(())).unwrap();
        assert_eq!(s.server_operations().unwrap().completed, 1);
    }
    #[test]
    fn failures_back_off_manual_retry_is_guarded_and_archives_survive() {
        let (_temp, s, a, id) = seed();
        s.change_mail(&id, "read", "true").unwrap();
        let op = s.due_operations(&a.id).unwrap().remove(0);
        s.claim_operation(&op).unwrap();
        assert!(s.retry_server_operation(&op.id).is_err());
        s.finish_operation(&op, Err(Failure::Retry("offline".into())))
            .unwrap();
        assert!(s.due_operations(&a.id).unwrap().is_empty());
        assert_eq!(s.server_operations().unwrap().items[0].error, "offline");
        s.retry_server_operation(&op.id).unwrap();
        let retry = s.due_operations(&a.id).unwrap().remove(0);
        s.claim_operation(&retry).unwrap();
        s.finish_operation(&retry, Err(Failure::Blocked("identity conflict".into())))
            .unwrap();
        assert_eq!(s.server_operations().unwrap().blocked, 1);
        assert!(s.due_operations(&a.id).unwrap().is_empty());
        assert_eq!(
            crate::archive::read_raw(&s.root, &s.mail(&id).unwrap().hash).unwrap(),
            raw()
        );
    }
    #[test]
    fn syncs_each_active_copy_but_never_pop3_local_sent_or_other_accounts() {
        let (_temp, s, a, id) = seed();
        s.ingest(&a, "Other", "7:13", &raw(), false).unwrap();
        s.ingest(&a, "Sent", "local-outbox-uuid", &raw(), false)
            .unwrap();
        s.ingest(&a, "Removed", "7:14", &raw(), false).unwrap();
        s.reconcile_folder(&a.id, "Removed", &[]).unwrap();
        let mut b = a.clone();
        b.id = "other".into();
        s.save_account(&b).unwrap();
        s.ingest(&b, "INBOX", "7:12", &raw(), false).unwrap();
        s.change_mail(&id, "star", "true").unwrap();
        assert_eq!(s.due_operations(&a.id).unwrap().len(), 2);
        assert!(s.due_operations(&b.id).unwrap().is_empty());
        b.protocol = "pop3".into();
        s.save_account(&b).unwrap();
        let other = s
            .snapshot(&query())
            .unwrap()
            .messages
            .into_iter()
            .find(|m| m.account_id == b.id)
            .unwrap();
        s.change_mail(&other.id, "read", "true").unwrap();
        assert!(s.mail(&other.id).unwrap().is_read);
        assert!(s.due_operations(&b.id).unwrap().is_empty());
        s.change_mail(&id, "trash", "true").unwrap();
        assert_eq!(s.server_operations().unwrap().pending, 2);
    }
    #[test]
    fn changed_accounts_missing_sources_and_removed_accounts_never_replay() {
        let (_temp, s, a, id) = seed();
        s.change_mail(&id, "read", "true").unwrap();
        let op = s.due_operations(&a.id).unwrap().remove(0);
        assert!(s.validate_operation(&op).is_ok());
        s.reconcile_folder(&a.id, "INBOX", &[]).unwrap();
        assert!(matches!(
            s.validate_operation(&op),
            Err(Failure::Blocked(_))
        ));
        s.ingest(&a, "INBOX", "7:12", &raw(), false).unwrap();
        let mut edited = a.clone();
        edited.username = "new@example.com".into();
        s.edit_account(&edited).unwrap();
        assert!(matches!(
            s.validate_operation(&op),
            Err(Failure::Blocked(_))
        ));
        assert_eq!(s.server_operations().unwrap().blocked, 1);
        s.remove_account(&a.id).unwrap();
        assert!(matches!(
            s.validate_operation(&op),
            Err(Failure::Blocked(_))
        ));
        assert!(s.mail(&id).is_ok());
    }
    #[test]
    fn paused_accounts_keep_work_and_backups_do_not_replay_server_intents() {
        let (temp, s, mut a, id) = seed();
        s.change_mail(&id, "read", "true").unwrap();
        a.enabled = false;
        s.save_account(&a).unwrap();
        assert_eq!(s.server_operations().unwrap().items[0].status, "paused");
        let backup = s.backup(temp.path()).unwrap();
        let db = rusqlite::Connection::open(std::path::Path::new(&backup).join("snapshot.sqlite3"))
            .unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM server_operations", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        let restored = tempfile::tempdir().unwrap();
        let restored = Store::new(restored.path().into()).unwrap();
        restored.restore(std::path::Path::new(&backup)).unwrap();
        assert_eq!(restored.server_operations().unwrap().pending, 0);
        assert_eq!(restored.snapshot(&query()).unwrap().stats.saved, 1);
    }
    #[test]
    fn a_busy_folder_cannot_hide_another_folder_and_local_rules_do_not_replay_old_intents() {
        let (_temp, s, a, id) = seed();
        for uid in 20..80 {
            s.ingest(&a, "INBOX", &format!("7:{uid}"), &raw(), false)
                .unwrap();
        }
        s.ingest(&a, "Other", "7:90", &raw(), false).unwrap();
        s.change_mail(&id, "star", "true").unwrap();
        let jobs = s.due_operations(&a.id).unwrap();
        assert_eq!(jobs.len(), 2);
        assert!(jobs.iter().any(|op| op.folder == "Other"));
        let mut changed = s.mail(&id).unwrap();
        changed.starred = false;
        s.update_mail(&changed).unwrap();
        assert!(matches!(
            s.validate_operation(&jobs[0]),
            Err(Failure::Blocked(_))
        ));
    }
    #[test]
    fn accepts_only_unambiguous_imap_identifiers() {
        for remote in [
            "0:1",
            "1:0",
            "1:1:extra",
            "INBOX:1",
            "123",
            "content:4:invalid",
            "1:*",
            "1:1,2",
        ] {
            assert!(remote_identity(remote).is_none(), "{remote}");
        }
        assert_eq!(remote_identity("7:12"), Some((Some(7), 12, None)));
        let key = format!("content:12:{}", crate::archive::digest(&raw()));
        assert!(remote_identity(&key).is_some());
    }
}
