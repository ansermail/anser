//! SMTP acceptance and IMAP archival are independent durable results.
//! Once APPEND may have been written, recovery is read-only and never replays it.
use crate::{archive, models::*, operations, store::Store};
use mailparse::MailHeaderMap;
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SentUpload {
    pub id: String,
    pub account_id: String,
    #[serde(skip)]
    pub identity: String,
    #[serde(skip)]
    pub content_hash: String,
    pub message_id: String,
    pub target: String,
    #[serde(default)]
    pub target_label: String,
    pub validity: u32,
    pub uid: Option<u32>,
    pub status: String,
    pub error: String,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub server_message_id: String,
    #[serde(skip)]
    pub(crate) verification_attempts: u32,
}
const COLUMNS: &str =
    "id,account_id,identity,content_hash,message_id,target,validity,uid,status,error,origin,server_message_id,verification_attempts";
const SMTP_REPORTED: &str = "smtpReported";
const MAX_REPORTED_CHECKS: u32 = 5;
fn decode(r: &rusqlite::Row<'_>) -> rusqlite::Result<SentUpload> {
    let target: String = r.get(5)?;
    Ok(SentUpload {
        id: r.get(0)?,
        account_id: r.get(1)?,
        identity: r.get(2)?,
        content_hash: r.get(3)?,
        message_id: r.get(4)?,
        target_label: crate::remote::display_name(&target),
        target,
        validity: r.get(6)?,
        uid: r.get(7)?,
        status: r.get(8)?,
        error: r.get(9)?,
        origin: r.get(10)?,
        server_message_id: r.get(11)?,
        verification_attempts: r.get(12)?,
    })
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS sent_uploads(
        id TEXT PRIMARY KEY,account_id TEXT NOT NULL,identity TEXT NOT NULL,content_hash TEXT NOT NULL,
        message_id TEXT NOT NULL,target TEXT NOT NULL DEFAULT '',validity INTEGER NOT NULL DEFAULT 0,uid INTEGER,
        status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',next_attempt INTEGER NOT NULL DEFAULT 0);").map_err(err)?;
    let has_origin: bool = db
        .prepare("PRAGMA table_info(sent_uploads)")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(err)?
        .any(|v| v.as_deref() == Ok("origin"));
    if !has_origin {
        db.execute(
            "ALTER TABLE sent_uploads ADD COLUMN origin TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(err)?;
    }
    let has_mid: bool = db
        .prepare("PRAGMA table_info(sent_uploads)")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(err)?
        .any(|v| v.as_deref() == Ok("server_message_id"));
    if !has_mid {
        db.execute(
            "ALTER TABLE sent_uploads ADD COLUMN server_message_id TEXT NOT NULL DEFAULT ''",
            [],
        )
        .map_err(err)?;
    }
    let has_attempts = db
        .prepare("PRAGMA table_info(sent_uploads)")
        .map_err(err)?
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(err)?
        .any(|v| v.as_deref() == Ok("verification_attempts"));
    if !has_attempts {
        db.execute(
            "ALTER TABLE sent_uploads ADD COLUMN verification_attempts INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(err)?;
    }
    db.execute_batch("UPDATE sent_uploads SET status='queued',target='',validity=0 WHERE status='preparing';
        UPDATE sent_uploads SET status='uncertain',error='上传已提交但确认未保存；只能核对，不会自动重复上传' WHERE status='submitted';
        UPDATE sent_uploads SET status=CASE WHEN uid IS NOT NULL THEN 'confirmed' WHEN origin='smtpReported' AND verification_attempts<5 THEN 'checking' ELSE 'uncertain' END WHERE status='verifying';
        UPDATE sent_uploads SET status='uncertain' WHERE status='checking' AND (origin!='smtpReported' OR verification_attempts>=5);
        UPDATE sent_uploads SET status='checking',origin='smtpReported',verification_attempts=0,next_attempt=0,error='服务器报告 SMTP 已保存，等待只读核对；不会再次上传'
        WHERE status='blocked' AND target!='' AND validity>0 AND uid IS NULL
        AND error='服务器明确拒绝上传，原件尚未传输：Mail has saved by smtp!'
        AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=sent_uploads.account_id AND json_extract(a.data,'$.provider')='qq');").map_err(err)?;
    Ok(())
}
fn insert(db: &rusqlite::Connection, a: &Account, id: &str, raw: &[u8]) -> Result<()> {
    if a.protocol != "imap" {
        return Ok(());
    }
    let (headers, _) = mailparse::parse_headers(raw).map_err(err)?;
    let mid = headers
        .get_first_value("Message-ID")
        .ok_or("发送原件缺少 Message-ID")?;
    if archive::message_ids(&mid) != vec![mid.clone()]
        || mid.len() > 998
        || !mid.is_ascii()
        || mid.contains(['\r', '\n', '\0'])
    {
        return Err("发送原件 Message-ID 无效，未安排上传".into());
    }
    db.execute("INSERT OR IGNORE INTO sent_uploads(id,account_id,identity,content_hash,message_id,status,next_attempt) VALUES(?1,?2,?3,?4,?5,'queued',?6)",params![id,a.id,operations::identity(a),archive::digest(raw),mid,chrono::Utc::now().timestamp()+5]).map_err(err)?;
    Ok(())
}
impl Store {
    /// Persist success and its archival intent in the same transaction.
    pub(crate) fn confirm_smtp(&self, a: &Account, id: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let raw: Vec<u8> = tx
            .query_row(
                "SELECT raw FROM outbox WHERE id=?1 AND status='sending'",
                [id],
                |r| r.get(0),
            )
            .map_err(err)?;
        tx.execute(
            "UPDATE outbox SET status='sent',error='',updated_at=?2 WHERE id=?1",
            params![id, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(err)?;
        // A malformed legacy MIME must not turn SMTP acceptance into a failed send.
        // New send builders always produce the validated stable Message-ID.
        if let Err(e) = insert(&tx, a, id, &raw) {
            tx.execute(
                "UPDATE outbox SET error=?2 WHERE id=?1",
                params![id, format!("SMTP 已确认，上传未安排：{e}")],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn queue_sent_upload(&self, id: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let (data, raw): (String, Vec<u8>) = tx
            .query_row(
                "SELECT data,raw FROM outbox WHERE id=?1 AND status='sent'",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| "仅 SMTP 已确认的记录可保存到服务器")?;
        let c: Compose = serde_json::from_str(&data).map_err(err)?;
        let a = self.account(&c.account_id)?;
        if !a.enabled || a.protocol != "imap" {
            return Err("需要启用的 IMAP 账号；POP3 仅保留本地副本".into());
        }
        insert(&tx, &a, id, &raw)?;
        tx.commit().map_err(err)
    }
    pub fn sent_upload(&self, id: &str) -> Result<Option<SentUpload>> {
        self.db()?
            .query_row(
                &format!("SELECT {COLUMNS} FROM sent_uploads WHERE id=?1"),
                [id],
                decode,
            )
            .optional()
            .map_err(err)
    }
    pub(crate) fn upload_content(&self, u: &SentUpload) -> Result<(Account, Vec<u8>)> {
        let a = self.account(&u.account_id)?;
        if !a.enabled || a.protocol != "imap" || operations::identity(&a) != u.identity {
            return Err("账号已暂停、移除或连接配置已变化，未执行上传".into());
        }
        let raw:Vec<u8>=self.db()?.query_row("SELECT raw FROM outbox WHERE id=?1 AND status='sent' AND json_extract(data,'$.accountId')=?2",params![u.id,a.id],|r|r.get(0)).map_err(err)?;
        if archive::digest(&raw) != u.content_hash {
            return Err("发送原件校验失败，不会上传或重发邮件".into());
        }
        let (headers, _) = mailparse::parse_headers(&raw).map_err(err)?;
        if headers.get_first_value("Message-ID").as_deref() != Some(&u.message_id) {
            return Err("上传任务与发送原件的 Message-ID 不一致".into());
        }
        Ok((a, raw))
    }
    pub(crate) fn upload_target(&self, u: &SentUpload) -> Result<String> {
        let folders = self.remote_folders(Some(&u.account_id))?;
        let candidates: Vec<_> = folders
            .iter()
            .filter(|f| f.selectable && f.roles.contains(&FolderRole::Sent))
            .collect();
        let target = if u.target.is_empty() {
            if candidates.len() != 1 {
                return Err("请在账号文件夹设置中指定唯一的已发送目录，再重试上传".into());
            }
            candidates[0].name.clone()
        } else {
            if matches!(u.status.as_str(), "queued" | "preparing" | "blocked")
                && (candidates.len() != 1 || candidates[0].name != u.target)
            {
                return Err("已发送目录映射已变化，尚未上传；请刷新后重试".into());
            }
            if !folders.iter().any(|f| f.name == u.target && f.selectable) {
                return Err("原上传目标已不存在或不可选，只能保留本地副本".into());
            }
            u.target.clone()
        };
        let isolated: bool = self
            .db()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM folder_health WHERE account_id=?1 AND folder=?2)",
                params![u.account_id, target],
                |r| r.get(0),
            )
            .map_err(err)?;
        if isolated {
            return Err("已发送目标已隔离，请先核查该目录".into());
        }
        Ok(target)
    }
    pub(crate) fn bind_upload(&self, u: &SentUpload, target: &str, validity: u32) -> Result<()> {
        if validity == 0 {
            return Err("已发送目录缺少可靠 UIDVALIDITY，尚未提交".into());
        }
        if self
            .db()?
            .execute(
                "UPDATE sent_uploads SET target=?2,validity=?3 WHERE id=?1 AND status='preparing'",
                params![u.id, target, validity],
            )
            .map_err(err)?
            != 1
        {
            return Err("上传任务已变化".into());
        }
        Ok(())
    }
    pub(crate) fn submit_upload(&self, u: &SentUpload) -> Result<()> {
        let (a, _) = self.upload_content(u)?;
        let target = self.upload_target(u)?;
        if target != u.target || u.validity == 0 {
            return Err("上传目标未绑定".into());
        }
        let changed=self.db()?.execute("UPDATE sent_uploads SET status='submitted' WHERE id=?1 AND status='preparing' AND EXISTS(SELECT 1 FROM accounts WHERE id=?2 AND data=?3) AND NOT EXISTS(SELECT 1 FROM folder_health WHERE account_id=?2 AND folder=?4)",params![u.id,a.id,serde_json::to_string(&a).map_err(err)?,u.target]).map_err(err)?;
        if changed != 1 {
            return Err("上传任务或账号已变化，尚未提交".into());
        }
        Ok(())
    }
    pub(crate) fn receipt_upload(&self, u: &SentUpload, uid: u32) -> Result<()> {
        if uid == 0 || u.validity == 0 {
            return Err("上传回执无效".into());
        }
        let changed=self.db()?.execute("UPDATE sent_uploads SET uid=?2,origin=CASE WHEN origin='smtpReported' THEN 'existing' WHEN origin!='' THEN origin WHEN status='preparing' THEN 'existing' WHEN status='submitted' THEN 'appended' ELSE 'observed' END,status='confirmed',error='' WHERE id=?1 AND status IN ('preparing','submitted','verifying') AND validity=?3",params![u.id,uid,u.validity]).map_err(err)?;
        if changed != 1 {
            return Err("上传任务已变化，回执未保存".into());
        }
        Ok(())
    }
    pub(crate) fn complete_upload(&self, u: &SentUpload) -> Result<()> {
        let (a, _) = self.upload_content(u)?;
        let uid = u.uid.ok_or("上传回执尚未保存")?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let current: String = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [&a.id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let current: Account = serde_json::from_str(&current).map_err(err)?;
        if !current.enabled || operations::identity(&current) != u.identity {
            return Err("账号已变化，本地副本保留，上传结果待核对".into());
        }
        // A user can clear local archives after SMTP succeeds. Server archival
        // must never recreate that explicitly removed local copy automatically.
        let mail_id:Option<String>=tx.query_row("SELECT mail_id FROM sources WHERE account_id=?1 AND folder='Sent' AND remote_id=?2",params![a.id,u.id],|r|r.get(0)).optional().map_err(err)?;
        if let Some(mail_id) = mail_id {
            if !u.server_message_id.is_empty() {
                tx.execute(
                    "UPDATE messages SET data=json_set(data,'$.serverMessageId',?2) WHERE id=?1",
                    params![mail_id, u.server_message_id],
                )
                .map_err(err)?;
            }
            tx.execute("INSERT INTO sources(account_id,folder,remote_id,mail_id,active) VALUES(?1,?2,?3,?4,1) ON CONFLICT(account_id,folder,remote_id) DO UPDATE SET mail_id=excluded.mail_id,active=1",params![a.id,u.target,format!("{}:{uid}",u.validity),mail_id]).map_err(err)?;
        }
        if tx.execute("UPDATE sent_uploads SET status='completed',error='' WHERE id=?1 AND status='confirmed' AND uid=?2",params![u.id,uid]).map_err(err)?!=1 { return Err("上传任务已变化".into()); }
        tx.commit().map_err(err)
    }
    pub(crate) fn set_upload_server_id(&self, id: &str, mid: &str) -> Result<()> {
        if archive::message_ids(mid) != vec![mid.to_string()] {
            return Err("服务器副本 Message-ID 无效".into());
        }
        self.db()?.execute("UPDATE sent_uploads SET server_message_id=?2 WHERE id=?1 AND status IN ('preparing','submitted','confirmed','verifying')",params![id,mid]).map_err(err)?;
        Ok(())
    }
    pub(crate) fn fail_upload(&self, id: &str, error: &str) -> Result<()> {
        let u = self.sent_upload(id)?.ok_or("上传任务不存在")?;
        if u.status == "verifying"
            && u.origin == SMTP_REPORTED
            && u.verification_attempts < MAX_REPORTED_CHECKS
            && self.upload_content(&u).is_ok()
        {
            let delay = match u.verification_attempts {
                0 | 1 => 10,
                2 => 30,
                3 => 60,
                _ => 120,
            };
            self.db()?.execute("UPDATE sent_uploads SET status='checking',error=?2,next_attempt=?3 WHERE id=?1 AND status='verifying' AND origin='smtpReported' AND verification_attempts=?4",params![id,error,chrono::Utc::now().timestamp()+delay,u.verification_attempts]).map_err(err)?;
            return Ok(());
        }
        self.db()?.execute("UPDATE sent_uploads SET status=CASE WHEN status='preparing' THEN 'blocked' ELSE 'uncertain' END,error=?2 WHERE id=?1 AND status IN ('preparing','submitted','verifying','confirmed')",params![id,error]).map_err(err)?;
        Ok(())
    }
    pub(crate) fn smtp_reported_upload(&self, id: &str) -> Result<()> {
        let changed = self.db()?.execute("UPDATE sent_uploads SET status='checking',origin='smtpReported',verification_attempts=0,next_attempt=?2,error='服务器报告 SMTP 已保存，等待只读核对；不会再次上传' WHERE id=?1 AND status='submitted' AND uid IS NULL",params![id,chrono::Utc::now().timestamp()+5]).map_err(err)?;
        if changed != 1 {
            return Err("上传任务已变化，服务器报告待核对".into());
        }
        Ok(())
    }
    pub(crate) fn reject_upload_before_literal(&self, id: &str, error: &str) -> Result<()> {
        self.db()?.execute("UPDATE sent_uploads SET status='blocked',error=?2 WHERE id=?1 AND status='submitted' AND uid IS NULL",params![id,error]).map_err(err)?;
        Ok(())
    }
    pub fn sent_upload_action(&self, id: &str, action: &str) -> Result<()> {
        let u = self.sent_upload(id)?.ok_or("没有上传任务")?;
        self.upload_content(&u)?;
        let (from, to) = match action {
            "retry" if u.status == "blocked" && u.uid.is_none() && u.origin != SMTP_REPORTED => {
                ("blocked", "queued")
            }
            "verify" if u.status == "blocked" && !u.target.is_empty() && u.validity > 0 => {
                ("blocked", "checking")
            }
            "verify" if matches!(u.status.as_str(), "uncertain" | "confirmed") => {
                (u.status.as_str(), "checking")
            }
            _ => return Err("该状态不能重复上传；结果不明时只能核对".into()),
        };
        let db = self.db()?;
        if to == "queued" {
            db.execute("UPDATE sent_uploads SET status='queued',target='',validity=0,error='',next_attempt=0 WHERE id=?1 AND status=?2",params![id,from]).map_err(err)?;
        } else {
            db.execute("UPDATE sent_uploads SET status='checking',error='',next_attempt=0,verification_attempts=0 WHERE id=?1 AND status=?2",params![id,from]).map_err(err)?;
        }
        Ok(())
    }
    pub(crate) fn due_uploads(&self) -> Result<Vec<SentUpload>> {
        let db = self.db()?;
        let mut q=db.prepare(&format!("SELECT {COLUMNS} FROM sent_uploads WHERE status IN ('queued','confirmed','checking') AND next_attempt<=?1 ORDER BY rowid LIMIT 10")).map_err(err)?;
        let rows = q
            .query_map([chrono::Utc::now().timestamp()], decode)
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }
    pub(crate) fn claim_upload(&self, u: &SentUpload) -> Result<bool> {
        Ok(self
            .db()?
            .execute(
                "UPDATE sent_uploads SET status=?3,verification_attempts=verification_attempts+CASE WHEN origin='smtpReported' AND ?2!='queued' THEN 1 ELSE 0 END WHERE id=?1 AND status=?2",
                params![
                    u.id,
                    u.status,
                    if u.status == "queued" {
                        "preparing"
                    } else {
                        "verifying"
                    }
                ],
            )
            .map_err(err)?
            == 1)
    }
}
pub fn start(store: Store, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        if let Ok(jobs) = store.due_uploads() {
            for job in jobs {
                if !store.claim_upload(&job).unwrap_or(false) {
                    continue;
                }
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    crate::network::upload_sent(&store, &job)
                }));
                if !matches!(result, Ok(Ok(()))) {
                    let error = match result {
                        Ok(Err(e)) => e,
                        _ => "上传操作中断，请查看发送记录".into(),
                    };
                    let _ = store.fail_upload(&job.id, &error);
                }
                let _ = app.emit("mail-updated", ());
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    });
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{
        network,
        tests::{account, draft},
    };
    pub(crate) fn fixture() -> (tempfile::TempDir, Store, Account, String, Vec<u8>) {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        store
            .save_remote_folders(
                &a.id,
                &[RemoteFolder {
                    account_id: a.id.clone(),
                    name: "Sent Messages".into(),
                    display_name: "已发送".into(),
                    delimiter: Some("/".into()),
                    selectable: true,
                    roles: vec![FolderRole::Sent],
                    detected_roles: None,
                    sync_error: None,
                }],
            )
            .unwrap();
        let c = draft();
        network::send_with(&store, &c, |_| Ok(()), |_, _| Ok(())).unwrap();
        let raw = store
            .upload_content(&store.sent_upload(&c.id).unwrap().unwrap())
            .unwrap()
            .1;
        store
            .db()
            .unwrap()
            .execute("UPDATE sent_uploads SET next_attempt=0", [])
            .unwrap();
        (temp, store, a, c.id, raw)
    }
    #[test]
    fn acceptance_is_atomic_and_failed_or_pop3_sends_do_not_upload() {
        let (_temp, store, _, id, _) = fixture();
        let job = store.sent_upload(&id).unwrap().unwrap();
        assert_eq!(store.outbox().unwrap()[0].status, "sent");
        assert_eq!(job.status, "queued");
        store.queue_sent_upload(&id).unwrap();
        assert_eq!(store.due_uploads().unwrap().len(), 1);
        assert!(store.claim_upload(&job).unwrap());
        assert!(!store.claim_upload(&job).unwrap());
        let mut c = draft();
        c.id = "failed".into();
        assert!(network::send_with(
            &store,
            &c,
            |_| Ok(()),
            |_, _| Err(("failed", "reject".into()))
        )
        .is_err());
        assert!(store.sent_upload(&c.id).unwrap().is_none());
        assert!(store.queue_sent_upload(&c.id).is_err());
        let mut a = account();
        a.protocol = "pop3".into();
        a.incoming_port = 995;
        store.save_account(&a).unwrap();
        c.id = "pop3".into();
        network::send_with(&store, &c, |_| Ok(()), |_, _| Ok(())).unwrap();
        assert!(store.sent_upload(&c.id).unwrap().is_none());
    }
    #[test]
    fn smtp_reported_copy_retries_are_readonly_bounded_and_survive_restart() {
        let (temp, mut store, _, id, raw) = fixture();
        let u = store.sent_upload(&id).unwrap().unwrap();
        store.claim_upload(&u).unwrap();
        store.bind_upload(&u, "Sent Messages", 7).unwrap();
        store
            .submit_upload(&store.sent_upload(&id).unwrap().unwrap())
            .unwrap();
        store.smtp_reported_upload(&id).unwrap();
        // Failure reporting by the worker must not turn the scheduled read-only
        // observation into a write-capable retry.
        store.fail_upload(&id, "reported").unwrap();
        for attempt in 1..=MAX_REPORTED_CHECKS {
            store = Store::new(temp.path().into()).unwrap();
            let before = store.sent_upload(&id).unwrap().unwrap();
            assert_eq!(before.status, "checking");
            assert!(store.sent_upload_action(&id, "retry").is_err());
            store
                .db()
                .unwrap()
                .execute("UPDATE sent_uploads SET next_attempt=0 WHERE id=?1", [&id])
                .unwrap();
            let u = store.due_uploads().unwrap().remove(0);
            assert!(store.claim_upload(&u).unwrap());
            assert!(!store.claim_upload(&u).unwrap());
            let live = store.sent_upload(&id).unwrap().unwrap();
            assert_eq!(live.verification_attempts, attempt);
            store.fail_upload(&id, "not visible yet").unwrap();
            let state = store.sent_upload(&id).unwrap().unwrap();
            assert_eq!(
                state.status,
                if attempt < MAX_REPORTED_CHECKS {
                    "checking"
                } else {
                    "uncertain"
                }
            );
            assert_eq!(state.target, "Sent Messages");
            assert_eq!(state.validity, 7);
            assert_eq!(store.upload_content(&state).unwrap().1, raw);
            assert_eq!(store.outbox().unwrap()[0].status, "sent");
        }
        store = Store::new(temp.path().into()).unwrap();
        assert!(store.due_uploads().unwrap().is_empty());
        assert!(store.sent_upload_action(&id, "retry").is_err());
        store.sent_upload_action(&id, "verify").unwrap();
        assert_eq!(
            store
                .sent_upload(&id)
                .unwrap()
                .unwrap()
                .verification_attempts,
            0
        );
        let u = store.sent_upload(&id).unwrap().unwrap();
        store.claim_upload(&u).unwrap();
        let mut account = store.account(&u.account_id).unwrap();
        account.enabled = false;
        store.save_account(&account).unwrap();
        store.fail_upload(&id, "paused account").unwrap();
        assert_eq!(store.sent_upload(&id).unwrap().unwrap().status, "uncertain");
    }
    #[test]
    fn legacy_reported_copy_migration_and_blocked_verification_never_requeue_writes() {
        for (provider, reason, migrated) in [
            ("qq", "Mail has saved by smtp!", true),
            ("custom", "Mail has saved by smtp!", false),
            ("qq", "APPEND not permitted", false),
            ("qq", "Mail has saved by smtp! different", false),
        ] {
            let (temp, store, mut account, id, _) = fixture();
            account.provider = provider.into();
            store.save_account(&account).unwrap();
            let u = store.sent_upload(&id).unwrap().unwrap();
            store.claim_upload(&u).unwrap();
            store.bind_upload(&u, "Sent Messages", 7).unwrap();
            store
                .submit_upload(&store.sent_upload(&id).unwrap().unwrap())
                .unwrap();
            store
                .reject_upload_before_literal(
                    &id,
                    &format!("服务器明确拒绝上传，原件尚未传输：{reason}"),
                )
                .unwrap();
            let store = Store::new(temp.path().into()).unwrap();
            let u = store.sent_upload(&id).unwrap().unwrap();
            assert_eq!(u.status, if migrated { "checking" } else { "blocked" });
            if migrated {
                assert_eq!(u.origin, SMTP_REPORTED);
            } else {
                store.sent_upload_action(&id, "verify").unwrap();
                let u = store.sent_upload(&id).unwrap().unwrap();
                assert_eq!(u.status, "checking");
                assert_eq!(u.target, "Sent Messages");
                assert_eq!(u.validity, 7);
                assert!(store.sent_upload_action(&id, "retry").is_err());
            }
        }
        let (_temp, store, _, id, _) = fixture();
        let u = store.sent_upload(&id).unwrap().unwrap();
        store.claim_upload(&u).unwrap();
        store.fail_upload(&id, "no bound namespace").unwrap();
        assert!(store.sent_upload_action(&id, "verify").is_err());
    }
    #[test]
    fn interruption_after_submission_never_requeues_append_and_receipts_survive() {
        let (temp, store, _, id, _) = fixture();
        let u = store.sent_upload(&id).unwrap().unwrap();
        store.claim_upload(&u).unwrap();
        store.bind_upload(&u, "Sent Messages", 7).unwrap();
        store
            .submit_upload(&store.sent_upload(&id).unwrap().unwrap())
            .unwrap();
        let reopened = Store::new(temp.path().into()).unwrap();
        assert_eq!(
            reopened.sent_upload(&id).unwrap().unwrap().status,
            "uncertain"
        );
        assert!(reopened.due_uploads().unwrap().is_empty());
        assert!(reopened.sent_upload_action(&id, "retry").is_err());
        reopened.sent_upload_action(&id, "verify").unwrap();
        let u = reopened.sent_upload(&id).unwrap().unwrap();
        assert!(reopened.claim_upload(&u).unwrap());
        reopened.receipt_upload(&u, 9).unwrap();
        let third = Store::new(temp.path().into()).unwrap();
        let u = third.sent_upload(&id).unwrap().unwrap();
        assert_eq!(u.uid, Some(9));
        assert_eq!(u.status, "confirmed");
        assert!(third.sent_upload_action(&id, "retry").is_err());
    }
    #[test]
    fn preflight_protects_configuration_mappings_and_original_mime() {
        let (_temp, s, mut a, id, _) = fixture();
        let u = s.sent_upload(&id).unwrap().unwrap();
        s.claim_upload(&u).unwrap();
        s.bind_upload(&u, "Sent Messages", 7).unwrap();
        let u = s.sent_upload(&id).unwrap().unwrap();
        s.save_folder_mappings(
            &a.id,
            &[FolderMapping {
                role: FolderRole::Sent,
                folder: None,
            }],
        )
        .unwrap();
        assert!(s.submit_upload(&u).is_err());
        s.fail_upload(&id, "mapping").unwrap();
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "blocked");
        s.sent_upload_action(&id, "retry").unwrap();
        assert!(s.sent_upload(&id).unwrap().unwrap().target.is_empty());
        a.incoming_host = "changed.example.com".into();
        s.save_account(&a).unwrap();
        assert!(s.upload_content(&u).is_err());
        a = account();
        s.save_account(&a).unwrap();
        s.db()
            .unwrap()
            .execute(
                "UPDATE outbox SET raw=?2 WHERE id=?1",
                params![id, b"changed".as_slice()],
            )
            .unwrap();
        assert!(s.upload_content(&u).is_err());
    }
    #[test]
    fn recovery_retains_local_original_and_backups_exclude_live_upload_tasks() {
        let (temp, s, a, id, raw) = fixture();
        let u = s.sent_upload(&id).unwrap().unwrap();
        s.claim_upload(&u).unwrap();
        s.bind_upload(&u, "Sent Messages", 7).unwrap();
        let u = s.sent_upload(&id).unwrap().unwrap();
        s.receipt_upload(&u, 9).unwrap();
        s.complete_upload(&s.sent_upload(&id).unwrap().unwrap())
            .unwrap();
        assert!(s.has_source(&a.id, "Sent Messages", "7:9").unwrap());
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "completed");
        assert_eq!(s.outbox().unwrap()[0].status, "sent");
        assert!(s.outbox().unwrap()[0].archived);
        let mids = s.snapshot(&crate::tests::query()).unwrap().messages;
        assert_eq!(mids.len(), 1);
        assert_eq!(s.message_raw(&s.mail(&mids[0].id).unwrap()).unwrap(), raw);
        let destination = temp.path().join("backup");
        let backup_path = s.backup(&destination).unwrap();
        let backup =
            rusqlite::Connection::open(std::path::Path::new(&backup_path).join("snapshot.sqlite3"))
                .unwrap();
        assert_eq!(
            backup
                .query_row("SELECT COUNT(*) FROM sent_uploads", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn finishing_server_archival_does_not_revive_a_removed_local_archive() {
        let (_temp, s, mut a, id, raw) = fixture();
        let u = s.sent_upload(&id).unwrap().unwrap();
        s.claim_upload(&u).unwrap();
        s.bind_upload(&u, "Sent Messages", 7).unwrap();
        let u = s.sent_upload(&id).unwrap().unwrap();
        s.receipt_upload(&u, 9).unwrap();
        s.set_upload_server_id(&id, "<server@example.com>").unwrap();
        s.db()
            .unwrap()
            .execute_batch("DELETE FROM sources; DELETE FROM messages;")
            .unwrap();
        std::fs::remove_file(
            s.root
                .join("archive")
                .join(format!("{}.eml", archive::digest(&raw))),
        )
        .unwrap();
        s.complete_upload(&s.sent_upload(&id).unwrap().unwrap())
            .unwrap();
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "completed");
        assert!(s
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .is_empty());
        assert_eq!(s.outbox().unwrap()[0].status, "sent");
        assert!(!s.outbox().unwrap()[0].archived);
        a.save_locally = false;
        s.save_account(&a).unwrap();
        s.archive_outbox(&id).unwrap();
        assert!(s.outbox().unwrap()[0].archived);
        let restored = s.snapshot(&crate::tests::query()).unwrap().messages[0].clone();
        assert_eq!(restored.server_message_id, "<server@example.com>");
        assert_eq!(s.message_raw(&s.mail(&restored.id).unwrap()).unwrap(), raw);
    }
}
