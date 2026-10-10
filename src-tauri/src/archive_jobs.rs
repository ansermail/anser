//! Explicit archival is a durable, read-only network task. A cancelled or stale
//! attempt cannot publish content, and backups never carry executable jobs.
use crate::{archive, models::*, operations, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveJob {
    pub id: String,
    pub mail_id: String,
    pub account_id: String,
    pub account_email: String,
    pub subject: String,
    pub folder: String,
    pub remote_id: String,
    pub identity: String,
    pub expected_hash: String,
    pub status: String,
    pub error: String,
    pub revision: i64,
    pub updated_at: String,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveQueueResult {
    pub queued: u32,
    pub already_saved: u32,
    pub blocked: u32,
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS archive_jobs(id TEXT PRIMARY KEY,mail_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,error TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS archive_jobs_pending ON archive_jobs(status,updated_at);
    UPDATE archive_jobs SET status='queued',revision=revision+1,error='应用退出后继续补存' WHERE status='running';").map_err(err)
}
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<ArchiveJob> {
    let data: String = row.get(0)?;
    let mut job: ArchiveJob = serde_json::from_str(&data).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    job.status = row.get(1)?;
    job.revision = row.get(2)?;
    job.error = row.get(3)?;
    job.updated_at = row.get(4)?;
    Ok(job)
}
const COLUMNS: &str = "data,status,revision,error,updated_at";
pub(crate) fn proof(db: &rusqlite::Connection, job: &ArchiveJob) -> Result<(Account, Mail)> {
    let data: String = db
        .query_row(
            "SELECT data FROM accounts WHERE id=?1",
            [&job.account_id],
            |r| r.get(0),
        )
        .map_err(|_| "账号已移除".to_string())?;
    let a: Account = serde_json::from_str(&data).map_err(err)?;
    if !a.enabled || operations::identity(&a) != job.identity {
        return Err("账号已暂停或连接配置已变化，请重新检查后入队".into());
    }
    let data: String = db
        .query_row(
            "SELECT data FROM messages WHERE id=?1 AND account_id=?2",
            params![job.mail_id, job.account_id],
            |r| r.get(0),
        )
        .map_err(|_| "本地邮件记录已移除，不会重新保存".to_string())?;
    let m: Mail = serde_json::from_str(&data).map_err(err)?;
    if m.hash != job.expected_hash && !m.saved_locally {
        return Err("邮件元数据已变化，请重新入队".into());
    }
    let valid:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM trusted_sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3 AND mail_id=?4 AND active=1)",params![job.account_id,job.folder,job.remote_id,job.mail_id],|r|r.get(0)).map_err(err)?;
    if !valid {
        return Err("服务器来源已失效或被隔离，请收取真实文件夹后重试".into());
    }
    let count:u32=db.query_row("SELECT COUNT(*) FROM trusted_sources WHERE account_id=?1 AND folder=?2 AND mail_id=?3 AND active=1",params![job.account_id,job.folder,job.mail_id],|r|r.get(0)).map_err(err)?;
    if count != 1 {
        return Err("来源文件夹包含多个邮件编号，需核对后再保存，不会猜测原件".into());
    }
    Ok((a, m))
}
pub(crate) struct PreparedArchive {
    pub mail: Mail,
    pub header_hash: String,
    staged: archive::StagedRaw,
}
impl Store {
    pub fn archive_jobs(&self) -> Result<Vec<ArchiveJob>> {
        let db = self.db()?;
        let mut q = db
            .prepare(&format!(
                "SELECT {COLUMNS} FROM archive_jobs ORDER BY updated_at DESC LIMIT 100"
            ))
            .map_err(err)?;
        let rows = q.query_map([], decode).map_err(err)?;
        rows.map(|r| {
            let mut job = r.map_err(err)?;
            job.folder = crate::remote::display_name(&job.folder);
            Ok(job)
        })
        .collect()
    }
    pub(crate) fn archive_job(&self, id: &str) -> Result<ArchiveJob> {
        self.db()?
            .query_row(
                &format!("SELECT {COLUMNS} FROM archive_jobs WHERE id=?1"),
                [id],
                decode,
            )
            .map_err(err)
    }
    pub fn queue_archives(
        &self,
        ids: &[String],
        conversations: bool,
    ) -> Result<ArchiveQueueResult> {
        if ids.is_empty() || ids.len() > 5000 {
            return Err("请选择 1–5000 封邮件".into());
        }
        let mut chosen = std::collections::BTreeSet::new();
        for id in ids {
            if conversations {
                for m in self.conversation(id)? {
                    chosen.insert(m.id);
                }
            } else {
                chosen.insert(id.clone());
            }
        }
        if chosen.len() > 5000 {
            return Err("一次最多补存 5000 封邮件".into());
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut result = ArchiveQueueResult::default();
        for id in chosen {
            match Self::queue_archive_in(&tx, &id)? {
                "saved" => result.already_saved += 1,
                "blocked" => result.blocked += 1,
                _ => result.queued += 1,
            }
        }
        tx.commit().map_err(err)?;
        Ok(result)
    }
    fn queue_archive(&self, id: &str) -> Result<&'static str> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let result = Self::queue_archive_in(&tx, id)?;
        tx.commit().map_err(err)?;
        Ok(result)
    }
    pub(crate) fn queue_archive_in(tx: &rusqlite::Connection, id: &str) -> Result<&'static str> {
        let data: String = tx
            .query_row("SELECT data FROM messages WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        let m: Mail = serde_json::from_str(&data).map_err(err)?;
        if m.saved_locally {
            return Ok("saved");
        }
        let old = tx
            .query_row(
                &format!("SELECT {COLUMNS} FROM archive_jobs WHERE mail_id=?1"),
                [id],
                decode,
            )
            .optional()
            .map_err(err)?;
        if let Some(old) = &old {
            if matches!(old.status.as_str(), "queued" | "running" | "paused") {
                return Ok(if old.status == "paused" {
                    "blocked"
                } else {
                    "queued"
                });
            }
        }
        let account: Option<String> = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&m.account_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let account = account
            .map(|data| serde_json::from_str::<Account>(&data).map_err(err))
            .transpose()?;
        // Choose only a current trusted source; never infer a mailbox from a UID.
        let source:Option<(String,String)>=tx.query_row("SELECT folder,remote_id FROM trusted_sources WHERE mail_id=?1 AND account_id=?2 AND active=1 ORDER BY folder='INBOX' COLLATE NOCASE DESC,folder,remote_id LIMIT 1",params![m.id,m.account_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
        let (folder, remote_id) = source.unwrap_or_default();
        let mut job = ArchiveJob {
            id: old
                .as_ref()
                .map(|j| j.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            mail_id: m.id,
            account_id: m.account_id,
            account_email: m.account_email,
            subject: m.subject,
            folder,
            remote_id,
            identity: account
                .as_ref()
                .map(operations::identity)
                .unwrap_or_default(),
            expected_hash: m.hash,
            status: "queued".into(),
            error: String::new(),
            revision: old.map(|j| j.revision + 1).unwrap_or(1),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        if let Err(e) = proof(&tx, &job) {
            job.status = "blocked".into();
            job.error = e;
        }
        tx.execute("INSERT INTO archive_jobs VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(mail_id) DO UPDATE SET data=excluded.data,status=excluded.status,revision=excluded.revision,error=excluded.error,updated_at=excluded.updated_at",params![job.id,job.mail_id,serde_json::to_string(&job).map_err(err)?,job.status,job.revision,job.error,job.updated_at]).map_err(err)?;
        Ok(if job.status == "blocked" {
            "blocked"
        } else {
            "queued"
        })
    }
    pub fn archive_job_action(&self, id: &str, action: &str) -> Result<()> {
        if id.is_empty() {
            let (next, states) = match action {
                "pause" => ("paused", "'queued','running'"),
                "resume" => ("queued", "'paused'"),
                "cancel" => ("cancelled", "'queued','running','paused','blocked'"),
                _ => return Err("不支持的补存操作".into()),
            };
            self.db()?.execute(&format!("UPDATE archive_jobs SET status=?1,revision=revision+1,updated_at=?2 WHERE status IN ({states})"),params![next,chrono::Utc::now().to_rfc3339()]).map_err(err)?;
            return Ok(());
        }
        let job = self.archive_job(id)?;
        if action == "retry" && matches!(job.status.as_str(), "blocked" | "cancelled" | "completed")
        {
            self.queue_archive(&job.mail_id)?;
            return Ok(());
        }
        let next = match (action, job.status.as_str()) {
            ("pause", "queued" | "running") => "paused",
            ("resume", "paused") => "queued",
            ("cancel", "queued" | "running" | "paused" | "blocked") => "cancelled",
            _ => return Err("补存任务状态已变化，请刷新".into()),
        };
        self.db()?.execute("UPDATE archive_jobs SET status=?2,revision=revision+1,updated_at=?3 WHERE id=?1 AND revision=?4 AND status=?5",params![id,next,chrono::Utc::now().to_rfc3339(),job.revision,job.status]).map_err(err)?;
        Ok(())
    }
    pub(crate) fn claim_archive(&self, job: &ArchiveJob) -> Result<bool> {
        Ok(self.db()?.execute("UPDATE archive_jobs SET status='running',error='',updated_at=?3 WHERE id=?1 AND revision=?2 AND status='queued'",params![job.id,job.revision,chrono::Utc::now().to_rfc3339()]).map_err(err)?==1)
    }
    pub(crate) fn archive_job_content(&self, job: &ArchiveJob) -> Result<(Account, Mail)> {
        proof(&self.db()?, job)
    }
    pub(crate) fn complete_archive(&self, job: &ArchiveJob, raw: &[u8]) -> Result<()> {
        let _archive = self.archive_gate.read().map_err(err)?;
        let existing = if raw.is_empty() {
            let (_, mail) = proof(&self.db()?, job)?;
            if !mail.saved_locally {
                return Err("未收到完整原件，不能标记保存成功".into());
            }
            Some(archive::read_raw(&self.root, &mail.hash)?)
        } else {
            None
        };
        let prepared = self.prepare_archive(&job, existing.as_deref().unwrap_or(raw))?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        self.complete_archive_in(&tx, job, &prepared)?;
        tx.commit().map_err(err)
    }
    pub(crate) fn archive_job_for_mail_in(
        db: &rusqlite::Connection,
        id: &str,
    ) -> Result<ArchiveJob> {
        db.query_row(
            &format!("SELECT {COLUMNS} FROM archive_jobs WHERE mail_id=?1"),
            [id],
            decode,
        )
        .map_err(err)
    }
    // Parse and fsync outside the SQLite writer. Callers retain archive_gate
    // until publication, so migration cannot switch the physical archive.
    pub(crate) fn prepare_archive(&self, job: &ArchiveJob, raw: &[u8]) -> Result<PreparedArchive> {
        if !job.id.is_empty() {
            let current = self.archive_job(&job.id)?;
            if current.status != "running" || current.revision != job.revision {
                return Err("补存已暂停、取消或重新入队，未发布原件".into());
            }
        }
        let (mut account, old) = proof(&self.db()?, job)?;
        account.save_locally = true;
        let mut mail = archive::parse(raw, &account, &job.folder)?.0;
        let end = raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|p| p + 4)
            .unwrap_or(raw.len());
        let header_hash = archive::digest(&raw[..end]);
        if mail.hash != job.expected_hash && header_hash != job.expected_hash {
            return Err("邮件原始头或内容已变化，未保存错误邮件".into());
        }
        if !old.message_id.is_empty() && mail.message_id != old.message_id {
            return Err("邮件标识不匹配，未保存".into());
        }
        if old.saved_locally && old.hash != mail.hash {
            return Err("邮件已被另一原件替代，未将旧补存任务标记为成功".into());
        }
        let staged = archive::stage_raw(&self.root, raw)?;
        mail.hash = staged.hash().into();
        Ok(PreparedArchive {
            mail,
            header_hash,
            staged,
        })
    }
    pub(crate) fn complete_archive_in(
        &self,
        tx: &rusqlite::Connection,
        job: &ArchiveJob,
        prepared: &PreparedArchive,
    ) -> Result<()> {
        let current = tx
            .query_row(
                &format!("SELECT {COLUMNS} FROM archive_jobs WHERE id=?1"),
                [&job.id],
                decode,
            )
            .map_err(err)?;
        if current.status != "running" || current.revision != job.revision {
            return Err("补存已暂停、取消或重新入队，未发布原件".into());
        }
        let (_, old) = proof(&tx, job)?;
        let hash = &prepared.mail.hash;
        if hash != &job.expected_hash && prepared.header_hash != job.expected_hash {
            return Err("邮件原始头或内容已变化，未保存错误邮件".into());
        }
        if old.saved_locally && &old.hash != hash {
            return Err("邮件已被另一原件替代，未将旧补存任务标记为成功".into());
        }
        if !old.saved_locally {
            let mut mail = prepared.mail.clone();
            if !old.message_id.is_empty() && mail.message_id != old.message_id {
                return Err("邮件标识不匹配，未保存".into());
            }
            let duplicate:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND hash=?2 AND id!=?3)",params![old.account_id,hash,old.id],|r|r.get(0)).map_err(err)?;
            if duplicate {
                return Err(
                    "已有相同完整存档，但对应不同本地记录；请核对来源后处理，原状态保留".into(),
                );
            }
            prepared.staged.publish()?;
            mail.id = old.id.clone();
            mail.hash = hash.clone();
            mail.saved_locally = true;
            mail.is_read = old.is_read;
            mail.starred = old.starred;
            mail.local_read_override = old.local_read_override;
            mail.local_star_override = old.local_star_override;
            mail.trashed = old.trashed;
            mail.local_folder = old.local_folder;
            mail.server_date = old.server_date;
            mail.source_folder = old.source_folder;
            mail.server_message_id = old.server_message_id;
            if mail.date.is_empty() {
                mail.date = mail.server_date.clone();
            }
            tx.execute(
                "UPDATE messages SET hash=?2,data=?3,parser_version=3 WHERE id=?1",
                params![
                    old.id,
                    mail.hash,
                    serde_json::to_string(&mail).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.execute(
            "UPDATE archive_jobs SET status='completed',error='',updated_at=?2 WHERE id=?1",
            params![job.id, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(err)?;
        Ok(())
    }
    fn fail_archive(&self, job: &ArchiveJob, error: &str) -> Result<()> {
        self.db()?.execute("UPDATE archive_jobs SET status='blocked',error=?3,updated_at=?4 WHERE id=?1 AND revision=?2 AND status='running'",params![job.id,job.revision,error,chrono::Utc::now().to_rfc3339()]).map_err(err)?;
        Ok(())
    }
}
pub fn start(store: Store, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let next = (|| -> Result<Option<ArchiveJob>> {
            store.db()?.query_row(&format!("SELECT {COLUMNS} FROM archive_jobs WHERE status='queued' ORDER BY updated_at LIMIT 1"),[],decode).optional().map_err(err)
        })();
        if let Ok(Some(job)) = next {
            let result = (|| -> Result<()> {
                let gate =
                    crate::sync_control::folder_gate(&store.root, &job.account_id, &job.folder)?;
                let _folder = gate.lock().map_err(err)?;
                if !store.claim_archive(&job)? {
                    return Ok(());
                }
                let (a, mail) = store.archive_job_content(&job)?;
                if mail.saved_locally {
                    return store.complete_archive(&job, &[]);
                }
                let raw = crate::network::read_remote_source(
                    &store,
                    &a,
                    &mail,
                    &job.folder,
                    &job.remote_id,
                )?;
                store.complete_archive(&job, &raw)
            })();
            if let Err(e) = result {
                let _ = store.fail_archive(&job, &e);
            }
            let _ = app.emit("mail-updated", ());
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, raw};
    fn fixture() -> (tempfile::TempDir, Store, Account, String) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let mut a = account();
        a.save_locally = false;
        store.save_account(&a).unwrap();
        let raw = raw();
        let end = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        store
            .ingest(&a, "INBOX", "7:12", &raw[..end], false)
            .unwrap();
        let id = store
            .db()
            .unwrap()
            .query_row("SELECT id FROM messages", [], |r| r.get::<_, String>(0))
            .unwrap();
        (dir, store, a, id)
    }
    fn queued(store: &Store, id: &str) -> ArchiveJob {
        assert_eq!(store.queue_archives(&[id.into()], false).unwrap().queued, 1);
        let view = store.archive_jobs().unwrap().remove(0);
        store.archive_job(&view.id).unwrap()
    }
    #[test]
    fn explicit_archive_preserves_identity_actions_sources_and_online_default() {
        let (_dir, store, a, id) = fixture();
        let job = queued(&store, &id);
        assert_eq!(
            store
                .queue_archives(&[id.clone(), id.clone()], false)
                .unwrap()
                .queued,
            1
        );
        assert_eq!(store.archive_jobs().unwrap().len(), 1);
        let original_date = store.mail(&id).unwrap().date;
        assert!(store.claim_archive(&job).unwrap());
        store.change_mail(&id, "star", "true").unwrap();
        store.change_mail(&id, "folder", "自选归类").unwrap();
        store
            .save_rules(&[Rule {
                id: "remote-test".into(),
                name: "manual save must not run remote rules".into(),
                account_id: a.id.clone(),
                enabled: true,
                mode: "all".into(),
                conditions: vec![Condition {
                    field: "subject".into(),
                    operator: "contains".into(),
                    value: "invoice".into(),
                }],
                action: "serverCopy".into(),
                source_folder: "INBOX".into(),
                destination: "Archive".into(),
                stop: true,
            }])
            .unwrap();
        store.complete_archive(&job, &raw()).unwrap();
        let m = store.mail(&id).unwrap();
        assert!(m.saved_locally && m.starred);
        assert_eq!(m.local_folder, "自选归类");
        assert_eq!(m.date, original_date);
        assert!(store.rule_executions().unwrap().is_empty());
        assert_eq!(store.message_raw(&m).unwrap(), raw());
        let attachment_index = archive::parse(&raw(), &a, "INBOX").unwrap().2[0].index;
        assert_eq!(
            archive::attachment(&raw(), attachment_index).unwrap(),
            b"invoice content"
        );
        assert!(!store.account(&a.id).unwrap().save_locally);
        assert_eq!(store.source(&id).unwrap(), ("INBOX".into(), "7:12".into()));
        assert_eq!(store.archive_job(&job.id).unwrap().status, "completed");
        assert_eq!(store.queue_archives(&[id], false).unwrap().already_saved, 1);
    }
    #[test]
    fn pause_resume_cancel_revision_rejects_every_late_publication() {
        let (_dir, store, _a, id) = fixture();
        let old = queued(&store, &id);
        assert!(store.claim_archive(&old).unwrap());
        store.archive_job_action(&old.id, "pause").unwrap();
        assert!(store.complete_archive(&old, &raw()).is_err());
        assert!(!store.mail(&id).unwrap().saved_locally);
        store.archive_job_action(&old.id, "resume").unwrap();
        let current = store.archive_job(&old.id).unwrap();
        assert!(store.claim_archive(&current).unwrap());
        assert!(store.complete_archive(&old, &raw()).is_err());
        store.archive_job_action(&old.id, "cancel").unwrap();
        assert!(store.complete_archive(&current, &raw()).is_err());
        store
            .fail_archive(&current, "stale network failure")
            .unwrap();
        assert_eq!(store.archive_job(&old.id).unwrap().status, "cancelled");
        store.archive_job_action(&old.id, "retry").unwrap();
        let next = store.archive_job(&old.id).unwrap();
        assert!(store.claim_archive(&next).unwrap());
        store.complete_archive(&next, &raw()).unwrap();
    }
    #[test]
    fn changed_connection_source_or_headers_cannot_save_wrong_content() {
        for variant in 0..3 {
            let (_dir, store, mut a, id) = fixture();
            let job = queued(&store, &id);
            store.claim_archive(&job).unwrap();
            let mut payload = raw();
            match variant {
                0 => {
                    a.incoming_host = "changed.example.com".into();
                    store.save_account(&a).unwrap();
                }
                1 => {
                    store
                        .db()
                        .unwrap()
                        .execute("UPDATE sources SET active=0", [])
                        .unwrap();
                }
                _ => {
                    payload = String::from_utf8(payload)
                        .unwrap()
                        .replace("Project invoice", "wrong mail")
                        .into_bytes();
                }
            }
            let error = store.complete_archive(&job, &payload).unwrap_err();
            store.fail_archive(&job, &error).unwrap();
            assert!(!store.mail(&id).unwrap().saved_locally);
            assert_eq!(store.archive_job(&job.id).unwrap().status, "blocked");
            assert!(!store
                .root
                .join("archive")
                .join(format!("{}.eml", archive::digest(&payload)))
                .exists());
        }
    }
    #[test]
    fn batch_rollback_and_missing_source_feedback_are_persistent() {
        let (_dir, store, _a, id) = fixture();
        assert!(store
            .queue_archives(&[id.clone(), "missing".into()], false)
            .is_err());
        assert!(store.archive_jobs().unwrap().is_empty());
        store
            .db()
            .unwrap()
            .execute("UPDATE sources SET active=0", [])
            .unwrap();
        let result = store.queue_archives(&[id.clone()], false).unwrap();
        assert_eq!(result.blocked, 1);
        let job = store.archive_jobs().unwrap().remove(0);
        assert!(job.error.contains("来源"));
        store
            .db()
            .unwrap()
            .execute("UPDATE sources SET active=1", [])
            .unwrap();
        store.archive_job_action(&job.id, "retry").unwrap();
        assert_eq!(store.archive_job(&job.id).unwrap().status, "queued");
    }
    #[test]
    fn restart_requeues_read_only_work_and_backup_omits_jobs() {
        let (dir, store, _a, id) = fixture();
        let job = queued(&store, &id);
        store.claim_archive(&job).unwrap();
        drop(store);
        let store = Store::new(dir.path().into()).unwrap();
        let recovered = store.archive_job(&job.id).unwrap();
        assert_eq!(recovered.status, "queued");
        assert!(recovered.revision > job.revision);
        store.claim_archive(&recovered).unwrap();
        store.complete_archive(&recovered, &raw()).unwrap();
        let output = tempfile::tempdir().unwrap();
        let path = store.backup(output.path()).unwrap();
        let db = rusqlite::Connection::open(std::path::Path::new(&path).join("snapshot.sqlite3"))
            .unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM archive_jobs", [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            0
        );
        assert_eq!(store.archive_jobs().unwrap().len(), 1);
    }
    #[test]
    fn archive_deletion_cancels_pending_read_and_cannot_be_undone_by_late_fetch() {
        let (_dir, store, a, id) = fixture();
        let job = queued(&store, &id);
        store.claim_archive(&job).unwrap();
        let mut saving = a.clone();
        saving.save_locally = true;
        store.edit_account_preferences(&saving).unwrap();
        let separate = String::from_utf8(raw())
            .unwrap()
            .replace("Project invoice", "Saved separate invoice");
        store
            .ingest(&saving, "INBOX", "7:13", separate.as_bytes(), false)
            .unwrap();
        let preview = store.archive_deletion_preview(&a.id).unwrap();
        store
            .delete_local_archives(&a.id, true, preview.count, &preview.review_token)
            .unwrap();
        assert!(store.complete_archive(&job, &raw()).is_err());
        assert!(!store.mail(&id).unwrap().saved_locally);
        assert_eq!(store.archive_job(&job.id).unwrap().status, "cancelled");
    }
    #[test]
    fn global_pause_and_resume_include_work_outside_visible_page() {
        let (_dir, store, _a, id) = fixture();
        let job = queued(&store, &id);
        store.claim_archive(&job).unwrap();
        store.archive_job_action("", "pause").unwrap();
        assert_eq!(store.archive_job(&job.id).unwrap().status, "paused");
        store.archive_job_action("", "resume").unwrap();
        let resumed = store.archive_job(&job.id).unwrap();
        assert_eq!(resumed.status, "queued");
        assert!(!store.claim_archive(&job).unwrap());
        store.archive_job_action("", "cancel").unwrap();
        assert_eq!(store.archive_job(&job.id).unwrap().status, "cancelled");
    }
    #[test]
    fn database_failure_cannot_publish_saved_flag_or_completed_task() {
        let (_dir, store, _a, id) = fixture();
        let job = queued(&store, &id);
        store.claim_archive(&job).unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER reject_archive BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'disk fixture'); END;").unwrap();
        assert!(store.complete_archive(&job, &raw()).is_err());
        assert!(!store.mail(&id).unwrap().saved_locally);
        assert_eq!(store.archive_job(&job.id).unwrap().status, "running");
        store
            .db()
            .unwrap()
            .execute_batch("DROP TRIGGER reject_archive")
            .unwrap();
        store.complete_archive(&job, &raw()).unwrap();
        assert!(store.mail(&id).unwrap().saved_locally);
    }
    #[test]
    fn conversation_batch_expands_turns_while_single_mode_keeps_selected_mail() {
        for grouped in [false, true] {
            let (_dir, store, a, id) = fixture();
            let full = String::from_utf8(raw()).unwrap().replace(
                "From: Alice",
                "Message-ID: <root@example.com>\r\nFrom: Alice",
            );
            let end = full.find("\r\n\r\n").unwrap() + 4;
            store
                .ingest(&a, "INBOX", "7:12", full[..end].as_bytes(), false)
                .unwrap();
            let reply = full
                .replace("<root@example.com>", "<reply@example.com>")
                .replace(
                    "Subject: Project invoice",
                    "In-Reply-To: <root@example.com>\r\nSubject: Re: Project invoice",
                );
            let end = reply.find("\r\n\r\n").unwrap() + 4;
            store
                .ingest(&a, "INBOX", "7:13", reply[..end].as_bytes(), false)
                .unwrap();
            assert_eq!(
                store.queue_archives(&[id], grouped).unwrap().queued,
                if grouped { 2 } else { 1 }
            );
            assert_eq!(
                store.archive_jobs().unwrap().len(),
                if grouped { 2 } else { 1 }
            );
        }
    }
    #[test]
    fn duplicate_full_identity_is_reported_without_discarding_either_local_state() {
        let (_dir, store, a, id) = fixture();
        let job = queued(&store, &id);
        store.claim_archive(&job).unwrap();
        let mut saving = a.clone();
        saving.save_locally = true;
        store.edit_account_preferences(&saving).unwrap();
        // A pre-existing full duplicate bound to another local record must not
        // silently erase a user's independent classification or journal history.
        let (mut duplicate, _, _) = archive::parse(&raw(), &saving, "Archive").unwrap();
        duplicate.hash = archive::store_raw(&store.root, &raw()).unwrap();
        duplicate.local_folder = "另一归类".into();
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO messages(id,account_id,hash,data) VALUES(?1,?2,?3,?4)",
                params![
                    duplicate.id,
                    a.id,
                    duplicate.hash,
                    serde_json::to_string(&duplicate).unwrap()
                ],
            )
            .unwrap();
        assert!(store
            .complete_archive(&job, &raw())
            .unwrap_err()
            .contains("不同本地记录"));
        assert!(!store.mail(&id).unwrap().saved_locally);
        assert_eq!(store.mail(&duplicate.id).unwrap().local_folder, "另一归类");
    }
    #[test]
    fn ambiguous_same_folder_sources_block_queue_without_guessing_uid() {
        let (_dir, store, a, id) = fixture();
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO sources VALUES(?1,'INBOX','7:13',?2,1)",
                params![a.id, id],
            )
            .unwrap();
        assert_eq!(store.queue_archives(&[id], false).unwrap().blocked, 1);
        assert!(store.archive_jobs().unwrap()[0]
            .error
            .contains("多个邮件编号"));
    }
    #[test]
    fn an_automatic_archive_of_different_content_cannot_complete_an_old_task() {
        let (_dir, store, mut a, id) = fixture();
        let job = queued(&store, &id);
        store.claim_archive(&job).unwrap();
        a.save_locally = true;
        store.edit_account_preferences(&a).unwrap();
        let replacement = String::from_utf8(raw())
            .unwrap()
            .replace("Project invoice", "Different server mail");
        store
            .ingest(&a, "INBOX", "7:12", replacement.as_bytes(), false)
            .unwrap();
        assert!(store.mail(&id).unwrap().saved_locally);
        assert!(store
            .complete_archive(&job, &raw())
            .unwrap_err()
            .contains("另一原件"));
        assert_eq!(
            store.message_raw(&store.mail(&id).unwrap()).unwrap(),
            replacement.as_bytes()
        );
    }
}
