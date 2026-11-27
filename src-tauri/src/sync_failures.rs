//! Persistent per-message IMAP fetch failures so a single broken or oversized
//! message does not trap folder sync in an opaque UID-only error loop.
use crate::{models::*, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFailureEnvelope {
    pub subject: String,
    pub sender: String,
    pub date: String,
    pub size: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFailure {
    pub account_id: String,
    pub account_email: String,
    pub folder: String,
    pub display_name: String,
    pub remote_id: String,
    pub uid: u32,
    pub subject: String,
    pub sender: String,
    pub date: String,
    pub size: Option<u64>,
    pub stage: String,
    pub reason: String,
    pub status: String,
    pub failed_at: String,
}

pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_failures(
            account_id TEXT NOT NULL,
            folder TEXT NOT NULL,
            remote_id TEXT NOT NULL,
            uid INTEGER NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            sender TEXT NOT NULL DEFAULT '',
            date TEXT NOT NULL DEFAULT '',
            size INTEGER,
            stage TEXT NOT NULL DEFAULT '',
            reason TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'failed',
            failed_at TEXT NOT NULL,
            PRIMARY KEY(account_id, folder, remote_id)
        );
        CREATE INDEX IF NOT EXISTS sync_failures_account_status
            ON sync_failures(account_id, status, failed_at);",
    )
    .map_err(err)
}

pub fn format_size_label(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{} KB", (bytes as f64 / 1024.0).round() as u64)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

pub fn format_uid_failure_message(
    folder: &str,
    uid: u32,
    stage: &str,
    reason: &str,
    envelope: Option<&SyncFailureEnvelope>,
) -> String {
    let display_folder = crate::remote::display_name(folder);
    let mut details = Vec::new();
    if let Some(env) = envelope {
        if !env.sender.trim().is_empty() {
            details.push(format!("发件人：{}", env.sender.trim()));
        }
        if let Some(size) = env.size {
            details.push(format!("大小 {}", format_size_label(size)));
        }
    }
    details.push(format!("UID {uid}"));
    let subject = envelope
        .map(|env| env.subject.trim())
        .filter(|s| !s.is_empty());
    let target = if let Some(subject) = subject {
        format!("邮件「{subject}」（{}）", details.join("，"))
    } else if stage.contains(&format!("UID {uid}")) {
        let extra = details
            .into_iter()
            .filter(|item| item != &format!("UID {uid}"))
            .collect::<Vec<_>>();
        if extra.is_empty() {
            stage.to_string()
        } else {
            format!("{stage}（{}）", extra.join("，"))
        }
    } else {
        format!("{stage}（{}）", details.join("，"))
    };
    format!(
        "文件夹「{display_folder}」{target}失败：{reason}；可在「设置 → 后台任务 → 邮件收取异常」中重试、改为仅在线加载或跳过"
    )
}

impl Store {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn record_sync_failure(
        &self,
        account_id: &str,
        folder: &str,
        remote_id: &str,
        uid: u32,
        stage: &str,
        reason: &str,
        envelope: Option<&SyncFailureEnvelope>,
    ) -> Result<()> {
        let now = chrono::Utc::now().to_rfc3339();
        let subject = envelope.map(|e| e.subject.as_str()).unwrap_or("");
        let sender = envelope.map(|e| e.sender.as_str()).unwrap_or("");
        let date = envelope.map(|e| e.date.as_str()).unwrap_or("");
        let size = envelope.and_then(|e| e.size).map(|s| s as i64);
        let db = self.db()?;
        db.execute(
            "INSERT INTO sync_failures(account_id,folder,remote_id,uid,subject,sender,date,size,stage,reason,status,failed_at)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'failed',?11)
             ON CONFLICT(account_id,folder,remote_id) DO UPDATE SET
               uid=excluded.uid,
               subject=CASE WHEN excluded.subject!='' THEN excluded.subject ELSE sync_failures.subject END,
               sender=CASE WHEN excluded.sender!='' THEN excluded.sender ELSE sync_failures.sender END,
               date=CASE WHEN excluded.date!='' THEN excluded.date ELSE sync_failures.date END,
               size=COALESCE(excluded.size, sync_failures.size),
               stage=excluded.stage,
               reason=excluded.reason,
               status='failed',
               failed_at=excluded.failed_at",
            params![
                account_id,
                folder,
                remote_id,
                uid as i64,
                subject,
                sender,
                date,
                size,
                stage,
                reason,
                now
            ],
        )
        .map_err(err)?;
        Ok(())
    }

    pub(crate) fn clear_sync_failure(
        &self,
        account_id: &str,
        folder: &str,
        remote_id: &str,
    ) -> Result<()> {
        self.db()?
            .execute(
                "DELETE FROM sync_failures WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![account_id, folder, remote_id],
            )
            .map_err(err)?;
        Ok(())
    }

    pub(crate) fn prune_sync_failures(
        &self,
        account_id: &str,
        folder: &str,
        active_uids: &[u32],
    ) -> Result<()> {
        let active: HashSet<i64> = active_uids.iter().map(|&u| u as i64).collect();
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let stale: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT remote_id, uid FROM sync_failures WHERE account_id=?1 AND folder=?2",
                )
                .map_err(err)?;
            let rows = stmt
                .query_map(params![account_id, folder], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
                })
                .map_err(err)?;
            rows.filter_map(|row| match row {
                Ok((remote_id, uid)) if !active.contains(&uid) => Some(Ok(remote_id)),
                Ok(_) => None,
                Err(error) => Some(Err(error)),
            })
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?
        };
        for remote_id in stale {
            tx.execute(
                "DELETE FROM sync_failures WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![account_id, folder, remote_id],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub(crate) fn bypassed_sync_failures(
        &self,
        account_id: &str,
        folder: &str,
    ) -> Result<HashSet<String>> {
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT remote_id FROM sync_failures
                 WHERE account_id=?1 AND folder=?2 AND status IN ('skipped','header_only')",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![account_id, folder], |r| r.get::<_, String>(0))
            .map_err(err)?;
        rows.collect::<rusqlite::Result<HashSet<_>>>().map_err(err)
    }

    pub fn sync_failure(
        &self,
        account_id: &str,
        folder: &str,
        remote_id: &str,
    ) -> Result<SyncFailure> {
        let db = self.db()?;
        db.query_row(
            "SELECT f.account_id, COALESCE(json_extract(a.data,'$.email'),''), f.folder,
                    f.remote_id, f.uid, f.subject, f.sender, f.date, f.size,
                    f.stage, f.reason, f.status, f.failed_at
             FROM sync_failures f
             LEFT JOIN accounts a ON a.id=f.account_id
             WHERE f.account_id=?1 AND f.folder=?2 AND f.remote_id=?3",
            params![account_id, folder, remote_id],
            decode_row,
        )
        .optional()
        .map_err(err)?
        .ok_or_else(|| "未找到对应的邮件收取异常记录".into())
    }

    pub fn sync_failures(&self) -> Result<Vec<SyncFailure>> {
        let db = self.db()?;
        let mut stmt = db
            .prepare(
                "SELECT f.account_id, COALESCE(json_extract(a.data,'$.email'),''), f.folder,
                        f.remote_id, f.uid, f.subject, f.sender, f.date, f.size,
                        f.stage, f.reason, f.status, f.failed_at
                 FROM sync_failures f
                 JOIN accounts a ON a.id=f.account_id
                 ORDER BY CASE f.status WHEN 'failed' THEN 0 WHEN 'header_only' THEN 1 ELSE 2 END,
                          f.failed_at DESC
                 LIMIT 200",
            )
            .map_err(err)?;
        let rows = stmt.query_map([], decode_row).map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
    }

    pub fn set_sync_failure_status(
        &self,
        account_id: &str,
        folder: &str,
        remote_id: &str,
        status: &str,
    ) -> Result<()> {
        if !matches!(status, "failed" | "skipped" | "header_only" | "dismiss") {
            return Err("不支持的异常处理操作".into());
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let changed = if status == "dismiss" {
            tx.execute(
                "DELETE FROM sync_failures WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![account_id, folder, remote_id],
            )
            .map_err(err)?
        } else {
            tx.execute(
                "UPDATE sync_failures SET status=?4, failed_at=?5
                 WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![
                    account_id,
                    folder,
                    remote_id,
                    status,
                    chrono::Utc::now().to_rfc3339()
                ],
            )
            .map_err(err)?
        };
        if changed == 0 {
            return Err("未找到对应的邮件收取异常记录".into());
        }
        if status != "failed" {
            Self::clear_account_error_if_no_failures_in(&tx, account_id)?;
        }
        tx.commit().map_err(err)
    }

    pub(crate) fn clear_account_error_if_no_failures(&self, account_id: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        Self::clear_account_error_if_no_failures_in(&tx, account_id)?;
        tx.commit().map_err(err)
    }

    fn clear_account_error_if_no_failures_in(
        tx: &rusqlite::Connection,
        account_id: &str,
    ) -> Result<()> {
        let remaining: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM sync_failures WHERE account_id=?1 AND status='failed'",
                [account_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if remaining > 0 {
            return Ok(());
        }
        let data: Option<String> = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [account_id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        if let Some(data) = data {
            let mut account: Account = serde_json::from_str(&data).map_err(err)?;
            if account
                .error
                .as_deref()
                .is_some_and(|e| e.contains("UID ") || e.contains("邮件收取异常"))
            {
                account.error = None;
                tx.execute(
                    "UPDATE accounts SET data=?2 WHERE id=?1",
                    params![account.id, serde_json::to_string(&account).map_err(err)?],
                )
                .map_err(err)?;
            }
        }
        Ok(())
    }
}

fn decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SyncFailure> {
    let folder: String = row.get(2)?;
    let size: Option<i64> = row.get(8)?;
    Ok(SyncFailure {
        account_id: row.get(0)?,
        account_email: row.get(1)?,
        display_name: crate::remote::display_name(&folder),
        folder,
        remote_id: row.get(3)?,
        uid: row.get::<_, i64>(4)?.max(0) as u32,
        subject: row.get(5)?,
        sender: row.get(6)?,
        date: row.get(7)?,
        size: size.map(|v| v.max(0) as u64),
        stage: row.get(9)?,
        reason: row.get(10)?,
        status: row.get(11)?,
        failed_at: row.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_account() -> Account {
        Account {
            id: "acc-1".into(),
            name: "Work".into(),
            email: "user@example.com".into(),
            provider: "exmail".into(),
            protocol: "imap".into(),
            incoming_host: "imap.exmail.qq.com".into(),
            incoming_port: 993,
            incoming_tls: "tls".into(),
            smtp_host: "smtp.exmail.qq.com".into(),
            smtp_port: 465,
            smtp_tls: "tls".into(),
            username: "user@example.com".into(),
            smtp_username: String::new(),
            auth: "password".into(),
            oauth_client_id: String::new(),
            enabled: true,
            save_locally: true,
            server_retention_days: None,
            last_sync: None,
            error: Some("文件夹「收件箱」邮件「合同」（UID 42）失败：连接超时".into()),
        }
    }

    #[test]
    fn records_bypasses_clears_and_prunes_sync_failures() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let account = test_account();
        store.save_account(&account).unwrap();

        let env = SyncFailureEnvelope {
            subject: "大附件测试".into(),
            sender: "Alice <alice@example.com>".into(),
            date: "2026-11-27T01:00:00Z".into(),
            size: Some(32 * 1024 * 1024),
        };
        store
            .record_sync_failure(
                &account.id,
                "INBOX",
                "7:42",
                42,
                "下载完整邮件",
                "读取超时",
                Some(&env),
            )
            .unwrap();
        let list = store.sync_failures().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].subject, "大附件测试");
        assert_eq!(list[0].sender, "Alice <alice@example.com>");
        assert_eq!(list[0].size, Some(32 * 1024 * 1024));
        assert_eq!(list[0].status, "failed");
        assert!(store
            .bypassed_sync_failures(&account.id, "INBOX")
            .unwrap()
            .is_empty());

        store
            .set_sync_failure_status(&account.id, "INBOX", "7:42", "skipped")
            .unwrap();
        assert!(store
            .bypassed_sync_failures(&account.id, "INBOX")
            .unwrap()
            .contains("7:42"));
        assert!(store.account(&account.id).unwrap().error.is_none());

        // Pruning drops entries whose UID disappeared from the server.
        store
            .prune_sync_failures(&account.id, "INBOX", &[10, 11])
            .unwrap();
        assert!(store.sync_failures().unwrap().is_empty());
    }

    #[test]
    fn formats_human_readable_uid_failure_message() {
        let env = SyncFailureEnvelope {
            subject: "季度汇报附件".into(),
            sender: "bob@example.com".into(),
            date: String::new(),
            size: Some(15 * 1024 * 1024),
        };
        let message =
            format_uid_failure_message("INBOX", 99, "下载完整邮件", "连接超时", Some(&env));
        assert!(message.contains("季度汇报附件"));
        assert!(message.contains("bob@example.com"));
        assert!(message.contains("15.0 MB"));
        assert!(message.contains("UID 99"));
        assert!(message.contains("邮件收取异常"));
    }

    #[test]
    fn reorders_accounts_persistently_and_preserves_concurrent_additions() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let mut a1 = test_account();
        a1.id = "acc-a".into();
        a1.email = "a@example.com".into();
        let mut a2 = test_account();
        a2.id = "acc-b".into();
        a2.email = "b@example.com".into();
        let mut a3 = test_account();
        a3.id = "acc-c".into();
        a3.email = "c@example.com".into();
        store.save_account(&a1).unwrap();
        store.save_account(&a2).unwrap();
        store.save_account(&a3).unwrap();

        let initial: Vec<String> = store
            .accounts()
            .unwrap()
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(initial, vec!["acc-a", "acc-b", "acc-c"]);

        // Partial list preserves unlisted concurrent accounts at the end.
        store
            .reorder_accounts(&["acc-c".into(), "acc-a".into()])
            .unwrap();
        let reordered: Vec<String> = store
            .accounts()
            .unwrap()
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(reordered, vec!["acc-c", "acc-a", "acc-b"]);

        // Saving an existing account preserves its custom position.
        a1.name = "Work Renamed".into();
        store.save_account(&a1).unwrap();
        let after_save: Vec<String> = store
            .accounts()
            .unwrap()
            .into_iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(after_save, vec!["acc-c", "acc-a", "acc-b"]);

        // Duplicate or unknown IDs are rejected.
        assert!(store
            .reorder_accounts(&["acc-a".into(), "acc-a".into()])
            .is_err());
        assert!(store.reorder_accounts(&["missing".into()]).is_err());
    }
}
