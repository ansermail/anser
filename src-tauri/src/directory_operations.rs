//! Non-idempotent directory actions have their own durable journal.
//! Submitted COPY/MOVE is never automatically replayed after an interruption.
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
    #[serde(default = "copy_kind")]
    pub kind: String,
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
    #[serde(default)]
    pub receipt_origin: Option<String>,
    /// None means native COPY/MOVE; old journal entries remain read-only after receipt.
    #[serde(default)]
    pub strategy: Option<String>,
}
fn copy_kind() -> String {
    "copy".into()
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    let legacy: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='directory_operations') AND NOT EXISTS(SELECT 1 FROM pragma_table_info('directory_operations') WHERE name='kind')", [], |r| r.get(0)).map_err(err)?;
    if legacy {
        // Preserve receipts/statuses from COPY v1; add action to the uniqueness
        // key so COPY and MOVE to the same target are separate operations.
        db.execute_batch("BEGIN IMMEDIATE;
            ALTER TABLE directory_operations RENAME TO directory_operations_v1;
            DROP INDEX IF EXISTS directory_due;
            CREATE TABLE directory_operations(
                id TEXT PRIMARY KEY,account_id TEXT NOT NULL,folder TEXT NOT NULL,remote_id TEXT NOT NULL,
                target TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'copy',data TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',
                content_hash TEXT NOT NULL DEFAULT '',receipt TEXT,next_attempt INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,UNIQUE(account_id,folder,remote_id,target,kind));
            INSERT INTO directory_operations SELECT id,account_id,folder,remote_id,target,'copy',data,status,error,content_hash,receipt,next_attempt,updated_at FROM directory_operations_v1;
            DROP TABLE directory_operations_v1;
            COMMIT;").map_err(|e| { let _=db.execute_batch("ROLLBACK;"); err(e) })?;
    }
    db.execute_batch("CREATE TABLE IF NOT EXISTS directory_operations(
        id TEXT PRIMARY KEY,account_id TEXT NOT NULL,folder TEXT NOT NULL,remote_id TEXT NOT NULL,
        target TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'copy',data TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',receipt TEXT,next_attempt INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,UNIQUE(account_id,folder,remote_id,target,kind));
        CREATE INDEX IF NOT EXISTS directory_due ON directory_operations(account_id,status,next_attempt);
        UPDATE directory_operations SET status='queued' WHERE status='preparing';
        UPDATE directory_operations SET status='uncertain',error='文件夹操作已提交但确认未保存；请核对原目录和目标目录，不会自动重发' WHERE status='submitted';
        UPDATE directory_operations SET status='confirmed' WHERE status='verifying';
        UPDATE directory_operations SET status='cleanup_pending' WHERE status='cleanup_running';
        UPDATE directory_operations SET status='cleanup_uncertain',error='原目录移除已提交但结果未确认；先只读核对，不会自动再次移除' WHERE status='cleanup_submitted';").map_err(err)
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
fn check_other_move(db: &rusqlite::Connection, op: &DirectoryOperation) -> Result<()> {
    let moving:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM directory_operations WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND id!=?4 AND kind='move' AND status NOT IN ('completed','cancelled','blocked'))",params![op.account_id,op.folder,op.remote_id,op.id],|r|r.get(0)).map_err(err)?;
    if moving {
        return Err("该服务器来源已有其他移动任务，请先查看现有结果".into());
    }
    Ok(())
}
fn check(db: &rusqlite::Connection, op: &DirectoryOperation) -> Result<Account> {
    if !matches!(op.kind.as_str(), "copy" | "move") {
        return Err("文件夹操作类型无效".into());
    }
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
    if !matches!(
        op.status.as_str(),
        "confirmed"
            | "verifying"
            | "cleanup_pending"
            | "cleanup_running"
            | "cleanup_submitted"
            | "cleanup_uncertain"
            | "cleanup_blocked"
    ) {
        let active: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM trusted_sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND mail_id=?4 AND active=1)", params![a.id,op.folder,op.remote_id,op.mail_id], |r| r.get(0)).map_err(err)?;
        if !active {
            return Err("原服务器来源已失效，请重新收取后操作".into());
        }
        if op.kind == "move" {
            if operations::remote_identity(&op.remote_id)
                .is_none_or(|(v, _, _)| v.is_none_or(|v| v == 0))
            {
                return Err("移动需要可靠的来源 UIDVALIDITY，请重新收取该目录后操作".into());
            }
            let pending: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM server_operations WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND status IN ('queued','running','blocked'))",params![a.id,op.folder,op.remote_id],|r|r.get(0)).map_err(err)?;
            if pending {
                return Err("来源邮件的已读或星标尚未同步，请处理完成后再移动".into());
            }
        }
    }
    Ok(a)
}
impl Store {
    pub fn queue_copy(&self, mail_id: &str, source: &str, target: &str) -> Result<String> {
        self.queue_directory(mail_id, source, target, "copy")
    }
    pub fn queue_move(&self, mail_id: &str, source: &str, target: &str) -> Result<String> {
        self.queue_directory(mail_id, source, target, "move")
    }
    fn queue_directory(
        &self,
        mail_id: &str,
        source: &str,
        target: &str,
        kind: &str,
    ) -> Result<String> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: String = tx
            .query_row("SELECT data FROM messages WHERE id=?1", [mail_id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let mail: Mail = serde_json::from_str(&data).map_err(err)?;
        let id = Self::queue_directory_in(&tx, &mail, source, target, kind)?;
        tx.commit().map_err(err)?;
        Ok(id)
    }
    pub(crate) fn queue_directory_in(
        tx: &rusqlite::Connection,
        mail: &Mail,
        source: &str,
        target: &str,
        kind: &str,
    ) -> Result<String> {
        let mail_id = &mail.id;
        if source.eq_ignore_ascii_case(target) {
            return Err("请选择不同的服务器目标目录".into());
        }
        if target.bytes().any(|b| b < 32 || b == 127) {
            return Err("目标目录名称无效".into());
        }
        let a_data: String = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&mail.account_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let a: Account = serde_json::from_str(&a_data).map_err(err)?;
        let remote_id: String = tx.query_row("SELECT remote_id FROM trusted_sources WHERE account_id=?1 AND mail_id=?2 AND folder=?3 AND active=1 ORDER BY remote_id LIMIT 1", params![a.id,mail_id,source], |r| r.get(0)).map_err(|_| "该邮件在所选目录没有可用的服务器来源")?;
        operations::remote_identity(&remote_id).ok_or("仅本地邮件不能复制到服务器")?;
        let op = DirectoryOperation {
            kind: kind.into(),
            id: uuid::Uuid::new_v4().to_string(),
            account_id: a.id.clone(),
            account_email: a.email.clone(),
            mail_id: mail_id.into(),
            subject: mail.subject.clone(),
            folder: source.into(),
            remote_id,
            target: target.into(),
            identity: operations::identity(&a),
            status: "queued".into(),
            error: String::new(),
            content_hash: String::new(),
            receipt: None,
            receipt_origin: None,
            strategy: None,
        };
        check(&tx, &op)?;
        let existing: Option<(String,String)> = tx.query_row("SELECT id,status FROM directory_operations WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND target=?4 AND kind=?5",params![a.id,source,op.remote_id,target,kind],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
        if let Some((id, status)) = existing {
            if status == "cancelled" {
                tx.execute("DELETE FROM directory_operations WHERE id=?1", [id])
                    .map_err(err)?;
            } else {
                return Ok(id);
            }
        }
        let moving:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM directory_operations WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND kind='move' AND status NOT IN ('completed','cancelled','blocked'))",params![a.id,source,op.remote_id],|r|r.get(0)).map_err(err)?;
        if moving {
            return Err("该服务器来源已有移动任务，请先查看现有结果".into());
        }
        tx.execute("INSERT INTO directory_operations(id,account_id,folder,remote_id,target,kind,data,status,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'queued',?8)",params![op.id,a.id,source,op.remote_id,target,kind,serde_json::to_string(&op).map_err(err)?,chrono::Utc::now().timestamp()]).map_err(err)?;
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
        let mut st=db.prepare(&format!("SELECT {COLUMNS} FROM directory_operations ORDER BY CASE status WHEN 'uncertain' THEN 0 WHEN 'cleanup_uncertain' THEN 0 WHEN 'blocked' THEN 1 WHEN 'cleanup_blocked' THEN 1 WHEN 'completed' THEN 3 ELSE 2 END,updated_at DESC LIMIT 50")).map_err(err)?;
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
                check_other_move(&tx, &op)?;
                "queued"
            }
            ("verify", "confirmed") => "confirmed",
            ("verify", "cleanup_uncertain" | "cleanup_blocked") => "confirmed",
            ("continue_move", "confirmed" | "cleanup_uncertain" | "cleanup_blocked")
                if op.kind == "move"
                    && op.strategy.as_deref() == Some("copy-delete")
                    && op.receipt.is_some()
                    && !op.content_hash.is_empty() =>
            {
                check(&tx, &op)?;
                check_other_move(&tx, &op)?;
                "cleanup_pending"
            }
            ("verify", "uncertain") if op.kind == "move" && !op.content_hash.is_empty() => {
                // Recovery observes a single trusted target, not a guessed
                // COPYUID. The worker still verifies full MIME and source UID
                // absence; this transition never resends MOVE.
                let mut rows=tx.prepare("SELECT remote_id FROM trusted_sources WHERE account_id=?1 AND folder=?2 AND mail_id=?3 AND active=1").map_err(err)?;
                let candidates = rows
                    .query_map(params![op.account_id, op.target, op.mail_id], |r| {
                        r.get::<_, String>(0)
                    })
                    .map_err(err)?
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(err)?;
                if candidates.len() != 1 {
                    return Err(
                        "请先刷新目标目录；必须找到唯一的可信目标副本才能只读核查移动结果".into(),
                    );
                }
                let (validity, uid, _) = operations::remote_identity(&candidates[0])
                    .ok_or("目标来源没有可靠的服务器编号")?;
                let receipt = CopyReceipt {
                    validity: validity
                        .filter(|v| *v > 0)
                        .ok_or("目标来源没有可靠的 UIDVALIDITY")?,
                    uid,
                };
                let mut observed = op.clone();
                observed.status = "confirmed".into();
                check(&tx, &observed)?;
                tx.execute("UPDATE directory_operations SET receipt=?2,data=json_set(data,'$.receiptOrigin','observed') WHERE id=?1",params![id,serde_json::to_string(&receipt).map_err(err)?]).map_err(err)?;
                "confirmed"
            }
            _ => return Err("此任务不能重发；结果未确认时请先核对目标目录".into()),
        };
        tx.execute("UPDATE directory_operations SET status=?2,error='',next_attempt=0,updated_at=?3 WHERE id=?1",params![id,status,chrono::Utc::now().timestamp()]).map_err(err)?;
        tx.commit().map_err(err)
    }
    pub(crate) fn claim_copy(&self, op: &DirectoryOperation) -> Result<bool> {
        let next = match op.status.as_str() {
            "confirmed" => "verifying",
            "cleanup_pending" => "cleanup_running",
            "queued" => "preparing",
            _ => return Ok(false),
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
    #[cfg(test)]
    pub(crate) fn submit_copy(&self, op: &DirectoryOperation, hash: &str) -> Result<()> {
        self.submit_directory(op, hash, false)
    }
    pub(crate) fn submit_directory(
        &self,
        op: &DirectoryOperation,
        hash: &str,
        compatibility: bool,
    ) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        check(&tx, op)?;
        check_other_move(&tx, op)?;
        if compatibility && op.kind != "move" {
            return Err("兼容移动类型无效".into());
        }
        if tx.execute("UPDATE directory_operations SET status='submitted',content_hash=?2,data=json_set(data,'$.strategy',?3) WHERE id=?1 AND status='preparing'",params![op.id,hash,if compatibility { Some("copy-delete") } else { None }]).map_err(err)?!=1 {return Err("文件夹任务状态已变化，停止提交".into());}
        tx.commit().map_err(err)
    }
    pub(crate) fn save_copy_receipt(
        &self,
        op: &DirectoryOperation,
        receipt: &CopyReceipt,
    ) -> Result<()> {
        if self.db()?.execute("UPDATE directory_operations SET status=CASE WHEN json_extract(data,'$.strategy')='copy-delete' THEN 'cleanup_pending' ELSE 'confirmed' END,receipt=?2 WHERE id=?1 AND status='submitted'",params![op.id,serde_json::to_string(receipt).map_err(err)?]).map_err(err)?!=1 {return Err("文件夹操作回执无法保存，请核对两个目录，不要重复提交".into());}
        Ok(())
    }
    pub(crate) fn submit_move_cleanup(&self, op: &DirectoryOperation) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let current = tx
            .query_row(
                &format!("SELECT {COLUMNS} FROM directory_operations WHERE id=?1"),
                [&op.id],
                decode,
            )
            .map_err(err)?;
        if current.kind != "move"
            || current.strategy.as_deref() != Some("copy-delete")
            || current.receipt.is_none()
            || current.content_hash.is_empty()
        {
            return Err("缺少已保存的目标回执，不能移除原目录邮件".into());
        }
        let receipt = current.receipt.as_ref().unwrap();
        if current.content_hash != op.content_hash
            || op
                .receipt
                .as_ref()
                .is_none_or(|r| r.uid != receipt.uid || r.validity != receipt.validity)
        {
            return Err("核验依据已变化，不能移除原目录邮件".into());
        }
        let target_remote = format!("{}:{}", receipt.validity, receipt.uid);
        let linked: Option<String> = tx
            .query_row(
                "SELECT mail_id FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![current.account_id, current.target, target_remote],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if linked.is_some_and(|mail| mail != current.mail_id) {
            return Err("目标编号已关联其他邮件，不能移除原目录邮件".into());
        }
        let mut source_check = current.clone();
        source_check.status = "queued".into();
        check(&tx, &source_check)?;
        check_other_move(&tx, &current)?;
        if tx.execute("UPDATE directory_operations SET status='cleanup_submitted' WHERE id=?1 AND status='cleanup_running'", [&op.id]).map_err(err)? != 1 {
            return Err("移动阶段已变化，未移除原目录邮件".into());
        }
        tx.commit().map_err(err)
    }
    pub(crate) fn complete_copy(&self, op: &DirectoryOperation) -> Result<()> {
        let receipt = op.receipt.as_ref().ok_or("文件夹操作确认缺失")?;
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
        if !matches!(
            status.as_str(),
            "confirmed" | "verifying" | "cleanup_running" | "cleanup_submitted"
        ) {
            return Err("文件夹任务状态已变化".into());
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
        if op.kind == "move" {
            tx.execute("UPDATE sources SET active=0 WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND mail_id=?4",params![op.account_id,op.folder,op.remote_id,op.mail_id]).map_err(err)?;
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
        self.db()?.execute("UPDATE directory_operations SET status=CASE WHEN status='cleanup_submitted' THEN 'cleanup_uncertain' WHEN status='cleanup_running' THEN 'cleanup_blocked' WHEN status IN ('confirmed','verifying') THEN 'confirmed' WHEN status='submitted' AND (?3=0 OR kind='move') THEN 'uncertain' ELSE 'blocked' END,error=?2,next_attempt=?4,updated_at=?5 WHERE id=?1 AND status IN ('preparing','submitted','confirmed','verifying','cleanup_running','cleanup_submitted')",params![id,reason,definite_rejection,chrono::Utc::now().timestamp()+60,chrono::Utc::now().timestamp()]).map_err(err)?;
        Ok(())
    }
    pub(crate) fn due_copies(&self, account: &str) -> Result<Vec<DirectoryOperation>> {
        let db = self.db()?;
        let mut st=db.prepare(&format!("SELECT {COLUMNS} FROM directory_operations WHERE account_id=?1 AND status IN ('queued','confirmed','cleanup_pending') AND next_attempt<=?2 ORDER BY updated_at LIMIT 20")).map_err(err)?;
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
                                _ => "文件夹操作已中断，请查看任务记录".into(),
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
    fn ready_compatibility(store: &Store, id: &str) -> DirectoryOperation {
        let job = store.queue_move(id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store.submit_directory(&op, "full-hash", true).unwrap();
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
        assert_eq!(op.status, "cleanup_pending");
        op
    }
    #[test]
    fn compatibility_restart_only_resumes_before_source_mutation_and_keeps_receipt() {
        for submitted in [false, true] {
            let (temp, store, a, id) = fixture();
            let op = ready_compatibility(&store, &id);
            store.claim_copy(&op).unwrap();
            if submitted {
                store.submit_move_cleanup(&op).unwrap();
            }
            drop(store);
            let store = Store::new(temp.path().into()).unwrap();
            let restored = store.directory_operation(&op.id).unwrap();
            assert_eq!(restored.strategy.as_deref(), Some("copy-delete"));
            assert_eq!(restored.receipt.unwrap().uid, 34);
            assert_eq!(restored.content_hash, "full-hash");
            assert_eq!(
                restored.status,
                if submitted {
                    "cleanup_uncertain"
                } else {
                    "cleanup_pending"
                }
            );
            assert_eq!(
                store.due_copies(&a.id).unwrap().len(),
                if submitted { 0 } else { 1 }
            );
            assert!(store.directory_action(&op.id, "retry").is_err());
            if submitted {
                store.directory_action(&op.id, "verify").unwrap();
                assert_eq!(
                    store.directory_operation(&op.id).unwrap().status,
                    "confirmed"
                );
                store.directory_action(&op.id, "continue_move").unwrap();
                assert_eq!(
                    store.directory_operation(&op.id).unwrap().status,
                    "cleanup_pending"
                );
            }
        }
    }
    #[test]
    fn cleanup_submission_rechecks_identity_isolation_source_flags_and_target_collision() {
        for variant in 0..5 {
            let (_temp, store, mut a, id) = fixture();
            let op = ready_compatibility(&store, &id);
            store.claim_copy(&op).unwrap();
            match variant {
                0 => {
                    a.incoming_host = "changed.invalid".into();
                    store.save_account(&a).unwrap();
                }
                1 => {
                    store
                        .isolate_folder(&a, "Archive", "bad", &Default::default())
                        .unwrap();
                }
                2 => {
                    store
                        .db()
                        .unwrap()
                        .execute("UPDATE sources SET active=0 WHERE folder='INBOX'", [])
                        .unwrap();
                }
                3 => {
                    store.db().unwrap().execute("INSERT INTO server_operations(id,account_id,folder,remote_id,action,data,revision,status,updated_at) VALUES('pending',?1,'INBOX','7:12','read','{}',1,'queued',0)",[&a.id]).unwrap();
                }
                _ => {
                    store
                        .db()
                        .unwrap()
                        .execute(
                            "INSERT INTO sources VALUES(?1,'Archive','9:34','other-mail',1)",
                            [&a.id],
                        )
                        .unwrap();
                }
            }
            assert!(store.submit_move_cleanup(&op).is_err(), "variant {variant}");
            assert_eq!(
                store.directory_operation(&op.id).unwrap().status,
                "cleanup_running"
            );
        }
    }
    #[test]
    fn compatibility_freezes_flag_intents_and_retains_online_metadata_during_partial_move() {
        let (_temp, store, a, id) = fixture();
        let op = ready_compatibility(&store, &id);
        for status in [
            "cleanup_pending",
            "cleanup_running",
            "cleanup_submitted",
            "cleanup_uncertain",
            "cleanup_blocked",
        ] {
            store
                .db()
                .unwrap()
                .execute(
                    "UPDATE directory_operations SET status=?1 WHERE id=?2",
                    params![status, op.id],
                )
                .unwrap();
            assert!(store.change_mail(&id, "star", "true").is_err());
            assert!(!store.mail(&id).unwrap().starred);
            assert!(store.queue_move(&id, "INBOX", "Archive").is_ok()); // same task, not another COPY
            assert!(store.queue_copy(&id, "INBOX", "Archive").is_err());
        }
        store.db().unwrap().execute("UPDATE messages SET data=json_set(data,'$.savedLocally',json('false')) WHERE id=?1",[&id]).unwrap();
        store.reconcile_folder(&a.id, "INBOX", &[]).unwrap();
        assert!(store.mail(&id).is_ok());
    }
    #[test]
    fn continuation_requires_compatibility_and_cannot_replay_copy_or_native_move() {
        let (_temp, store, _a, id) = fixture();
        let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store.submit_copy(&op, "hash").unwrap();
        store
            .save_copy_receipt(
                &op,
                &CopyReceipt {
                    validity: 9,
                    uid: 34,
                },
            )
            .unwrap();
        assert!(store.directory_action(&job, "continue_move").is_err());
        assert!(store.directory_action(&job, "retry").is_err());
        let mut stale = store.directory_operation(&job).unwrap();
        stale.status = "cleanup_uncertain".into();
        assert!(!store.claim_copy(&stale).unwrap());
    }
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
    #[test]
    fn move_waits_for_flags_and_blocks_new_flag_intents_without_losing_local_state() {
        let (_temp, store, a, id) = fixture();
        store.change_mail(&id, "star", "true").unwrap();
        assert!(store
            .queue_move(&id, "INBOX", "Archive")
            .unwrap_err()
            .contains("尚未同步"));
        let flag = store.due_operations(&a.id).unwrap().remove(0);
        store.claim_operation(&flag).unwrap();
        store.finish_operation(&flag, Ok(())).unwrap();
        let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
        assert_eq!(store.queue_move(&id, "INBOX", "Archive").unwrap(), job);
        assert!(store
            .change_mail(&id, "star", "false")
            .unwrap_err()
            .contains("移动尚未确认"));
        assert!(store.mail(&id).unwrap().starred);
        assert!(store.due_operations(&a.id).unwrap().is_empty());
        store.directory_action(&job, "cancel").unwrap();
        store.change_mail(&id, "star", "false").unwrap();
        assert!(!store.mail(&id).unwrap().starred);
    }
    #[test]
    fn move_completion_is_atomic_preserves_archives_and_only_retires_the_exact_source() {
        let (_temp, store, a, id) = fixture();
        let raw = store.message_raw(&store.mail(&id).unwrap()).unwrap();
        store.db().unwrap().execute("INSERT INTO sources(account_id,folder,remote_id,mail_id,active) VALUES(?1,'INBOX','7:99',?2,1)",params![a.id,id]).unwrap();
        let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store.submit_copy(&op, "hash").unwrap();
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
        store.db().unwrap().execute_batch("CREATE TRIGGER fail_retire BEFORE UPDATE ON sources WHEN NEW.active=0 BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(store.complete_copy(&confirmed).is_err());
        assert!(!store.has_source(&a.id, "Archive", "9:34").unwrap());
        assert_eq!(store.directory_operation(&job).unwrap().status, "confirmed");
        store
            .db()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_retire;")
            .unwrap();
        store.complete_copy(&confirmed).unwrap();
        let source_active = |uid: &str| -> bool {
            store.db().unwrap().query_row("SELECT active FROM sources WHERE account_id=?1 AND folder='INBOX' AND remote_id=?2",params![a.id,uid],|r|r.get(0)).unwrap()
        };
        assert!(!source_active("7:12"));
        assert!(source_active("7:99"));
        assert!(store.has_source(&a.id, "Archive", "9:34").unwrap());
        assert_eq!(store.message_raw(&store.mail(&id).unwrap()).unwrap(), raw);
        assert!(store.mail(&id).unwrap().saved_locally);
        assert_eq!(store.directory_operation(&job).unwrap().status, "completed");
        store.change_mail(&id, "star", "true").unwrap();
        let flags = store.due_operations(&a.id).unwrap();
        assert!(flags.iter().all(|f| f.remote_id != "7:12"));
        assert!(flags
            .iter()
            .any(|f| f.folder == "Archive" && f.remote_id == "9:34"));
    }
    #[test]
    fn submitted_move_no_is_uncertain_and_online_record_survives_source_scan() {
        let (temp, store, a, id) = fixture();
        let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store.submit_copy(&op, "hash").unwrap();
        store
            .fail_copy(&job, "NO can partially succeed", true)
            .unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "uncertain");
        assert!(store.directory_action(&job, "retry").is_err());
        store.db().unwrap().execute("UPDATE messages SET data=json_set(data,'$.savedLocally',json('false')) WHERE id=?1",[&id]).unwrap();
        store.reconcile_folder(&a.id, "INBOX", &[]).unwrap();
        assert!(store.mail(&id).is_ok());
        drop(store);
        let store = Store::new(temp.path().into()).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "uncertain");
        assert!(store.due_copies(&a.id).unwrap().is_empty());
    }
    #[test]
    fn legacy_copy_migration_preserves_receipts_and_action_uniqueness() {
        let (_temp, store, _a, id) = fixture();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let db = store.db().unwrap();
        db.execute_batch("ALTER TABLE directory_operations RENAME TO new_operations;
            DROP INDEX directory_due;
            CREATE TABLE directory_operations(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,folder TEXT NOT NULL,remote_id TEXT NOT NULL,target TEXT NOT NULL,data TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',content_hash TEXT NOT NULL DEFAULT '',receipt TEXT,next_attempt INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,UNIQUE(account_id,folder,remote_id,target));
            INSERT INTO directory_operations SELECT id,account_id,folder,remote_id,target,json_remove(data,'$.kind'),'completed','', 'hash', '{\"validity\":9,\"uid\":34}',0,updated_at FROM new_operations;
            DROP TABLE new_operations;").unwrap();
        initialize(&db).unwrap();
        initialize(&db).unwrap();
        let copy = store.directory_operation(&job).unwrap();
        assert_eq!(copy.kind, "copy");
        assert_eq!(copy.status, "completed");
        assert_eq!(copy.receipt.unwrap().uid, 34);
        let moved = store.queue_move(&id, "INBOX", "Archive").unwrap();
        assert_ne!(moved, job);
        assert_eq!(store.directory_operation(&moved).unwrap().kind, "move");
    }
    #[test]
    fn uncertain_move_can_only_observe_a_unique_trusted_target_and_never_resubmit() {
        let (_temp, store, a, id) = fixture();
        let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store.submit_copy(&op, "full-hash").unwrap();
        store.fail_copy(&job, "mapping lost", false).unwrap();
        assert!(store
            .directory_action(&job, "verify")
            .unwrap_err()
            .contains("唯一"));
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO sources VALUES(?1,'Archive','9:34',?2,1)",
                params![a.id, id],
            )
            .unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO sources VALUES(?1,'Archive','9:35',?2,1)",
                params![a.id, id],
            )
            .unwrap();
        assert!(store.directory_action(&job, "verify").is_err());
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE sources SET active=0 WHERE folder='Archive' AND remote_id='9:35'",
                [],
            )
            .unwrap();
        store
            .isolate_folder(&a, "Archive", "bad", &Default::default())
            .unwrap();
        assert!(store.directory_action(&job, "verify").is_err());
        store.restore_folder_trust(&a, "Archive").unwrap();
        store
            .db()
            .unwrap()
            .execute("UPDATE sources SET active=0 WHERE folder='INBOX'", [])
            .unwrap();
        store.directory_action(&job, "verify").unwrap();
        let observed = store.directory_operation(&job).unwrap();
        assert_eq!(observed.status, "confirmed");
        assert_eq!(observed.receipt_origin.as_deref(), Some("observed"));
        assert_eq!(observed.receipt.unwrap().uid, 34);
        assert_eq!(store.due_copies(&a.id).unwrap()[0].status, "confirmed");
        assert!(store.directory_action(&job, "retry").is_err());
    }
}
