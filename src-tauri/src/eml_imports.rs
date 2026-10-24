//! Explicit local imports. Never creates remote provenance or runs mail rules.
use crate::{archive, eml_input, models::*, store::Store};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{path::Path, time::Instant};
use tauri::Emitter;

const MAX_FILES: usize = 1000;
const MAX_BATCH: u64 = 1024 * 1024 * 1024;
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub ordinal: i64,
    pub filename: String,
    pub status: String,
    pub error: String,
    pub warnings: usize,
    pub mail_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportJob {
    pub id: String,
    pub account_id: String,
    pub folder: String,
    pub status: String,
    pub total: usize,
    pub bytes: u64,
    pub processed: usize,
    pub added: usize,
    pub upgraded: usize,
    pub duplicate: usize,
    pub failed: usize,
    pub warnings: usize,
    pub error: String,
    pub items: Vec<ImportItem>,
}
pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS message_imports(mail_id TEXT PRIMARY KEY,hash TEXT NOT NULL,imported_at TEXT NOT NULL);
        CREATE TRIGGER IF NOT EXISTS import_message_delete AFTER DELETE ON messages BEGIN DELETE FROM message_imports WHERE mail_id=OLD.id; END;
        CREATE TABLE IF NOT EXISTS eml_import_jobs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,folder TEXT NOT NULL,status TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,bytes INTEGER NOT NULL,created_at TEXT NOT NULL,error TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS eml_import_items(job_id TEXT NOT NULL,ordinal INTEGER NOT NULL,filename TEXT NOT NULL,path TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',warnings INTEGER NOT NULL DEFAULT 0,mail_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(job_id,ordinal));
        CREATE INDEX IF NOT EXISTS import_pending ON eml_import_jobs(status,created_at);
        UPDATE eml_import_jobs SET status='interrupted',revision=revision+1,error='interrupted' WHERE status IN ('prepared','queued','running');
        UPDATE eml_import_items SET path='',fingerprint='' WHERE job_id IN (SELECT id FROM eml_import_jobs WHERE status!='running');").map_err(err)?;
    for column in ["byte_offset", "byte_length"] {
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM pragma_table_info('eml_import_items') WHERE name=?1)",
                [column],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            db.execute(
                &format!(
                    "ALTER TABLE eml_import_items ADD COLUMN {column} INTEGER NOT NULL DEFAULT 0"
                ),
                [],
            )
            .map_err(err)?;
        }
    }
    Ok(())
}
fn folder(value: &str) -> Result<&str> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 120 || value.chars().any(char::is_control) {
        Err("invalidFolder".into())
    } else {
        Ok(value)
    }
}
fn account_in(db: &Connection, id: &str) -> Result<Account> {
    let data: String = db
        .query_row("SELECT data FROM accounts WHERE id=?1", [id], |r| r.get(0))
        .map_err(|_| "accountRemoved".to_string())?;
    serde_json::from_str(&data).map_err(err)
}
fn space(store: &Store, bytes: u64) -> Result<()> {
    let actual = crate::archive_location::physical_root(&store.root)
        .map_err(|_| "archiveUnavailable".to_string())?;
    let needed = crate::retention_budget::with_reserve(bytes).ok_or("noSpace")?;
    if fs2::available_space(actual).map_err(|_| "archiveUnavailable".to_string())? < needed {
        return Err("noSpace".into());
    }
    Ok(())
}
fn finish_in(db: &Connection, id: &str, status: &str, error: &str) -> Result<()> {
    let previous: String = db
        .query_row(
            "SELECT status FROM eml_import_jobs WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    db.execute(
        "UPDATE eml_import_jobs SET status=?2,revision=revision+1,error=?3 WHERE id=?1",
        params![id, status, error],
    )
    .map_err(err)?;
    db.execute(
        "UPDATE eml_import_items SET path='',fingerprint='' WHERE job_id=?1",
        [id],
    )
    .map_err(err)?;
    if previous != "prepared" {
        let (added,upgraded,duplicate,failed):(i64,i64,i64,i64)=db.query_row("SELECT COALESCE(SUM(status='added'),0),COALESCE(SUM(status='upgraded'),0),COALESCE(SUM(status='duplicate'),0),COALESCE(SUM(status='failed'),0) FROM eml_import_items WHERE job_id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).map_err(err)?;
        let state = match status {
            "completed" => "完成",
            "cancelled" => "已取消",
            _ => "已中断",
        };
        db.execute("INSERT INTO logs(time,message) VALUES(?1,?2)",params![chrono::Local::now().format("%m-%d %H:%M").to_string(),format!("邮件本地导入{state}：新增 {added}，补全 {upgraded}，重复 {duplicate}，失败 {failed}")]).map_err(err)?;
        db.execute(
            "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)",
            [],
        )
        .map_err(err)?;
    }
    Ok(())
}
impl Store {
    pub fn prepare_eml_import(
        &self,
        paths: &[String],
        account_id: &str,
        target: &str,
    ) -> Result<ImportJob> {
        if paths.is_empty() || paths.len() > MAX_FILES {
            return Err("batchLimit".into());
        }
        let target = folder(target)?;
        account_in(&self.db()?, account_id)?;
        let mut entries = Vec::new();
        let mut bytes = 0u64;
        for path in paths {
            let p = Path::new(path);
            let name = p
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .chars()
                .take(255)
                .collect::<String>();
            let checked = eml_input::metadata(p);
            if let Ok(m) = std::fs::symlink_metadata(p) {
                if m.is_file() {
                    bytes = bytes.checked_add(m.len()).ok_or("batchLimit")?;
                }
            }
            if bytes > MAX_BATCH {
                return Err("batchLimit".into());
            }
            match checked {
                Ok(m) => {
                    let stamp = eml_input::fingerprint(&m);
                    match crate::mail_formats::ranges(p, &stamp) {
                        Ok(ranges) => {
                            let multiple = ranges.len() > 1;
                            for (index, (offset, length)) in ranges.into_iter().enumerate() {
                                let file_name = if multiple {
                                    format!("{name} · #{}", index + 1)
                                } else {
                                    name.clone()
                                };
                                let (status, error) = if length > eml_input::MAX_BYTES {
                                    ("failed", "tooLarge".to_string())
                                } else {
                                    ("pending", String::new())
                                };
                                entries.push((
                                    file_name,
                                    path.clone(),
                                    stamp.clone(),
                                    status,
                                    error,
                                    offset,
                                    length,
                                ));
                            }
                        }
                        Err(e) if e == "batchLimit" => return Err(e),
                        Err(e) => {
                            entries.push((name, path.clone(), String::new(), "failed", e, 0, 0))
                        }
                    }
                }
                Err(e) => entries.push((name, path.clone(), String::new(), "failed", e, 0, 0)),
            }
            if entries.len() > MAX_FILES {
                return Err("batchLimit".into());
            }
        }

        // An estimate from metadata only. Deduplication can reduce actual use.
        let _archive = self.archive_gate.read().map_err(err)?;
        space(self, bytes)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        account_in(&tx, account_id)?;
        let active: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE status IN ('queued','running'))",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if active {
            return Err("importBusy".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO eml_import_jobs(id,account_id,folder,status,bytes,created_at) VALUES(?1,?2,?3,'prepared',?4,?5)",params![id,account_id,target,bytes,chrono::Utc::now().to_rfc3339()]).map_err(err)?;
        for (i, (name, path, stamp, status, error, offset, length)) in entries.iter().enumerate() {
            tx.execute("INSERT INTO eml_import_items(job_id,ordinal,filename,path,fingerprint,status,error,byte_offset,byte_length) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id,i,name,if *status=="pending" {path.as_str()} else {""},stamp,status,error,offset,length]).map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.eml_import_job(&id, true)
    }
    pub fn eml_import_jobs(&self) -> Result<Vec<ImportJob>> {
        let db = self.db()?;
        let mut q=db.prepare("SELECT id FROM eml_import_jobs WHERE status!='prepared' ORDER BY created_at DESC LIMIT 30").map_err(err)?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        ids.iter()
            .map(|id| self.eml_import_job(id, false))
            .collect()
    }
    pub fn eml_import_job(&self, id: &str, details: bool) -> Result<ImportJob> {
        let db = self.db()?;
        let mut job = db
            .query_row(
                "SELECT id,account_id,folder,status,bytes,error FROM eml_import_jobs WHERE id=?1",
                [id],
                |r| {
                    Ok(ImportJob {
                        id: r.get(0)?,
                        account_id: r.get(1)?,
                        folder: r.get(2)?,
                        status: r.get(3)?,
                        bytes: r.get(4)?,
                        error: r.get(5)?,
                        total: 0,
                        processed: 0,
                        added: 0,
                        upgraded: 0,
                        duplicate: 0,
                        failed: 0,
                        warnings: 0,
                        items: vec![],
                    })
                },
            )
            .map_err(err)?;
        let mut q=db.prepare("SELECT ordinal,filename,status,error,warnings,mail_id FROM eml_import_items WHERE job_id=?1 ORDER BY ordinal").map_err(err)?;
        for item in q
            .query_map([id], |r| {
                Ok(ImportItem {
                    ordinal: r.get(0)?,
                    filename: r.get(1)?,
                    status: r.get(2)?,
                    error: r.get(3)?,
                    warnings: r.get(4)?,
                    mail_id: r.get(5)?,
                })
            })
            .map_err(err)?
        {
            let item = item.map_err(err)?;
            job.total += 1;
            match item.status.as_str() {
                "added" => job.added += 1,
                "upgraded" => job.upgraded += 1,
                "duplicate" => job.duplicate += 1,
                "failed" => job.failed += 1,
                _ => {}
            }
            if item.status != "pending" {
                job.processed += 1;
            }
            job.warnings += usize::from(item.warnings > 0);
            if details {
                job.items.push(item);
            }
        }
        Ok(job)
    }
    pub fn eml_import_action(&self, id: &str, action: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let (status, account): (String, String) = tx
            .query_row(
                "SELECT status,account_id FROM eml_import_jobs WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        match action {
            "start" if status == "prepared" => {
                account_in(&tx, &account)?;
                let active:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE status IN ('queued','running'))",[],|r|r.get(0)).map_err(err)?;
                if active {
                    return Err("importBusy".into());
                }
                tx.execute(
                    "UPDATE eml_import_jobs SET status='queued' WHERE id=?1",
                    [id],
                )
                .map_err(err)?;
            }
            "cancel" if ["prepared", "queued", "running"].contains(&status.as_str()) => {
                finish_in(&tx, id, "cancelled", "")?
            }
            "clear" if !["queued", "running"].contains(&status.as_str()) => {
                tx.execute("DELETE FROM eml_import_items WHERE job_id=?1", [id])
                    .map_err(err)?;
                tx.execute("DELETE FROM eml_import_jobs WHERE id=?1", [id])
                    .map_err(err)?;
            }
            _ => return Err("staleImport".into()),
        }
        tx.commit().map_err(err)
    }
    pub(crate) fn process_eml_import(&self, id: &str) -> Result<bool> {
        let db = self.db()?;
        db.execute(
            "UPDATE eml_import_jobs SET status='running' WHERE id=?1 AND status='queued'",
            [id],
        )
        .map_err(err)?;
        let claim:Option<(String,String,i64)>=db.query_row("SELECT account_id,folder,revision FROM eml_import_jobs WHERE id=?1 AND status='running'",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
        let Some((account_id, target, revision)) = claim else {
            return Ok(false);
        };
        let next:Option<(i64,String,String,u64,u64)>=db.query_row("SELECT ordinal,path,fingerprint,byte_offset,byte_length FROM eml_import_items WHERE job_id=?1 AND status='pending' ORDER BY ordinal LIMIT 1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(err)?;
        let Some((ordinal, path, stamp, offset, length)) = next else {
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let live:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE id=?1 AND status='running' AND revision=?2)",params![id,revision],|r|r.get(0)).map_err(err)?;
            if live {
                finish_in(&tx, id, "completed", "")?;
            }
            tx.commit().map_err(err)?;
            return Ok(true);
        };
        let result = (|| -> Result<()> {
            let started = Instant::now();
            let raw =
                eml_input::read_message(Path::new(&path), Some(&stamp), offset, Some(length))?;
            let mut account = account_in(&self.db()?, &account_id)?;
            account.save_locally = true;
            let mut mail = archive::parse(&raw, &account, "")
                .map_err(|_| "invalidMessage".to_string())?
                .0;
            if started.elapsed() > eml_input::TIME_LIMIT {
                return Err("budgetExceeded".into());
            }
            let _archive = self.archive_gate.read().map_err(err)?;
            space(self, raw.len() as u64)?;
            let staged = archive::stage_raw(&self.root, &raw)
                .map_err(|_| "archiveWriteFailed".to_string())?;
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let live:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE id=?1 AND revision=?2 AND status='running')",params![id,revision],|r|r.get(0)).map_err(err)?;
            if !live {
                return Err("staleImport".into());
            }
            let latest_account = account_in(&tx, &account_id)?;
            mail.account_email = latest_account.email;
            folder(&target)?;
            let existing: Option<String> = tx
                .query_row(
                    "SELECT data FROM messages WHERE account_id=?1 AND hash=?2",
                    params![account_id, mail.hash],
                    |r| r.get(0),
                )
                .optional()
                .map_err(err)?;
            let mut outcome = "added";
            let mut item_error = "";
            if let Some(data) = existing {
                let old: Mail = serde_json::from_str(&data).map_err(err)?;
                mail.id = old.id.clone();
                if old.saved_locally || old.trashed {
                    outcome = "duplicate";
                    if old.trashed {
                        item_error = "inTrash";
                    }
                } else {
                    outcome = "upgraded";
                    mail.is_read = old.is_read;
                    mail.starred = old.starred;
                    mail.local_read_override = old.local_read_override;
                    mail.local_star_override = old.local_star_override;
                    mail.local_folder = old.local_folder;
                    mail.trashed = old.trashed;
                    mail.date = old.date;
                    mail.server_date = old.server_date;
                    mail.source_folder = old.source_folder;
                    mail.server_message_id = old.server_message_id;
                }
            } else {
                mail.is_read = true;
                mail.local_folder = target.clone();
            }
            if outcome != "duplicate" {
                staged
                    .publish()
                    .map_err(|_| "archiveWriteFailed".to_string())?;
                tx.execute("INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET data=excluded.data,parser_version=excluded.parser_version",params![mail.id,mail.account_id,mail.hash,serde_json::to_string(&mail).map_err(err)?,archive::PARSER_VERSION]).map_err(err)?;
                tx.execute("INSERT OR IGNORE INTO message_imports(mail_id,hash,imported_at) VALUES(?1,?2,?3)",params![mail.id,mail.hash,chrono::Utc::now().to_rfc3339()]).map_err(err)?;
            }
            tx.execute("UPDATE eml_import_items SET status=?3,error=?4,warnings=?5,mail_id=?6,path='',fingerprint='' WHERE job_id=?1 AND ordinal=?2",params![id,ordinal,outcome,item_error,mail.parse_warnings.len(),mail.id]).map_err(err)?;
            tx.commit().map_err(err)
        })();
        if let Err(error) = result {
            let code = match error.as_str() {
                "staleImport" => return Ok(false),
                "invalidFile"
                | "unreadable"
                | "tooLarge"
                | "fileChanged"
                | "invalidMessage"
                | "budgetExceeded"
                | "unsupportedMessage"
                | "unsupportedMboxVariant"
                | "accountRemoved"
                | "archiveUnavailable"
                | "noSpace"
                | "archiveWriteFailed" => error.as_str(),
                _ => "databaseFailed",
            };
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let live:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM eml_import_jobs WHERE id=?1 AND status='running' AND revision=?2)",params![id,revision],|r|r.get(0)).map_err(err)?;
            if live {
                if [
                    "accountRemoved",
                    "archiveUnavailable",
                    "noSpace",
                    "archiveWriteFailed",
                    "databaseFailed",
                ]
                .contains(&code)
                {
                    finish_in(&tx, id, "interrupted", code)?;
                } else {
                    tx.execute("UPDATE eml_import_items SET status='failed',error=?3,path='',fingerprint='' WHERE job_id=?1 AND ordinal=?2",params![id,ordinal,code]).map_err(err)?;
                }
            }
            tx.commit().map_err(err)?;
        }
        Ok(true)
    }
}
pub fn start(store: Store, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let id=store.db().and_then(|db|db.query_row("SELECT id FROM eml_import_jobs WHERE status IN ('queued','running') ORDER BY created_at LIMIT 1",[],|r|r.get::<_,String>(0)).optional().map_err(err));
        if let Ok(Some(id)) = id {
            // One bounded file per iteration; publish changes at most twice a second.
            let tick = Instant::now();
            loop {
                if !store.process_eml_import(&id).unwrap_or(false)
                    || tick.elapsed().as_millis() >= 500
                {
                    break;
                }
            }
            let _ = app.emit("mail-updated", ());
        }
        std::thread::sleep(std::time::Duration::from_millis(500));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::{account, query, raw};
    use std::fs;
    fn fixture() -> (tempfile::TempDir, Store, Account, String) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().join("store")).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let path = dir.path().join("邮件.EML");
        fs::write(&path, raw()).unwrap();
        (dir, store, a, path.to_string_lossy().into())
    }
    fn run(store: &Store, paths: &[String], a: &Account, target: &str) -> ImportJob {
        let job = store.prepare_eml_import(paths, &a.id, target).unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        for _ in 0..1002 {
            if !store.process_eml_import(&job.id).unwrap() {
                break;
            }
        }
        store.eml_import_job(&job.id, true).unwrap()
    }
    #[test]
    fn eml_import_preserves_original_search_scope_and_does_not_create_remote_jobs_or_rules() {
        let (_dir, store, a, path) = fixture();
        let mut rules = store.rules().unwrap();
        let rule = Rule {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Do not run".into(),
            enabled: true,
            account_id: String::new(),
            mode: "all".into(),
            source_folder: String::new(),
            stop: false,
            conditions: vec![Condition {
                field: "subject".into(),
                operator: "contains".into(),
                value: "invoice".into(),
            }],
            action: "star".into(),
            destination: String::new(),
            actions: vec![],
        };
        rules.push(rule);
        store.save_rules(&rules).unwrap();
        let job = run(&store, &[path.clone()], &a, "导入");
        assert_eq!((job.added, job.failed, job.processed), (1, 0, 1));
        assert_eq!(job.status, "completed");
        let mail = store.mail(&job.items[0].mail_id).unwrap();
        assert!(mail.is_read && mail.saved_locally && !mail.starred);
        assert!(mail.source_folder.is_empty());
        assert_eq!(mail.local_folder, "导入");
        assert_eq!(archive::read_raw(&store.root, &mail.hash).unwrap(), raw());
        assert_eq!(fs::read(&path).unwrap(), raw());
        let detail = store.detail(&mail.id).unwrap();
        assert_eq!(detail.mail.date, mail.date);
        assert_eq!(
            archive::attachment(&archive::read_raw(&store.root, &mail.hash).unwrap(), 1).unwrap(),
            b"invoice content"
        );
        assert!(crate::rules::matches(&store.rules().unwrap()[0], &mail));
        assert!(store.source(&mail.id).is_err());
        let db = store.db().unwrap();
        for table in [
            "sources",
            "server_operations",
            "directory_operations",
            "rule_runs",
            "sent_uploads",
            "outbox",
        ] {
            let count: i64 = db
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
        let mut q = query();
        q.folder = "导入".into();
        q.account_id = a.id.clone();
        assert_eq!(store.snapshot(&q).unwrap().messages.len(), 1);
        q.remote_folder = "INBOX".into();
        assert!(store.snapshot(&q).unwrap().messages.is_empty());
        let value = serde_json::to_string(&job).unwrap();
        assert!(!value.contains(&path));
    }
    #[test]
    fn eml_import_exact_dedup_keeps_flags_folder_and_trash_and_cross_account_shares_bytes() {
        let (_dir, store, a, path) = fixture();
        let first = run(&store, &[path.clone()], &a, "A");
        let id = &first.items[0].mail_id;
        store.change_mail(id, "star", "true").unwrap();
        store.change_mail(id, "read", "false").unwrap();
        let duplicate = run(&store, &[path.clone(), path.clone()], &a, "B");
        assert_eq!(duplicate.duplicate, 2);
        let mail = store.mail(id).unwrap();
        assert!(mail.starred && !mail.is_read);
        assert_eq!(mail.local_folder, "A");
        store.change_mail(id, "trash", "true").unwrap();
        let job = run(&store, &[path.clone()], &a, "B");
        assert_eq!(job.items[0].error, "inTrash");
        assert!(store.mail(id).unwrap().trashed);
        let mut other = a.clone();
        other.id = "other".into();
        store.save_account(&other).unwrap();
        let job = run(&store, &[path], &other, "B");
        assert_eq!(job.added, 1);
        assert_ne!(job.items[0].mail_id, *id);
        assert_eq!(store.mail(&job.items[0].mail_id).unwrap().hash, mail.hash);
    }
    #[test]
    fn eml_import_online_upgrade_preserves_identity_date_and_user_intent() {
        let (_dir, store, mut a, path) = fixture();
        a.save_locally = false;
        store.edit_account(&a).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        let mut q = query();
        q.view = "all".into();
        let old = store.snapshot(&q).unwrap().messages[0].clone();
        store.change_mail(&old.id, "folder", "Keep").unwrap();
        store.change_mail(&old.id, "star", "true").unwrap();
        let job = run(&store, &[path], &a, "New");
        assert_eq!(job.upgraded, 1);
        let saved = store.mail(&old.id).unwrap();
        assert!(saved.saved_locally && saved.starred && !saved.is_read);
        assert_eq!(saved.date, old.date);
        assert_eq!(saved.local_folder, "Keep");
        assert_eq!(saved.source_folder, "INBOX");
        assert!(store.detail(&old.id).is_ok());
    }
    #[test]
    fn eml_import_cancel_and_account_removal_prevent_later_commits_and_relaunch_never_resumes_paths(
    ) {
        let (_dir, store, a, path) = fixture();
        let job = store
            .prepare_eml_import(&[path.clone(), path.clone()], &a.id, "A")
            .unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        assert!(store.process_eml_import(&job.id).unwrap());
        store.eml_import_action(&job.id, "cancel").unwrap();
        assert!(!store.process_eml_import(&job.id).unwrap());
        let cancelled = store.eml_import_job(&job.id, true).unwrap();
        assert_eq!((cancelled.processed, cancelled.added), (1, 1));
        let next = store
            .prepare_eml_import(&[path.clone()], &a.id, "B")
            .unwrap();
        store.eml_import_action(&next.id, "start").unwrap();
        let restarted = Store::new(store.root.clone()).unwrap();
        assert_eq!(
            restarted.eml_import_job(&next.id, true).unwrap().status,
            "interrupted"
        );
        assert!(!restarted.process_eml_import(&next.id).unwrap());
        let next = restarted.prepare_eml_import(&[path], &a.id, "B").unwrap();
        restarted.eml_import_action(&next.id, "start").unwrap();
        restarted.remove_account(&a.id).unwrap();
        assert!(!restarted.process_eml_import(&next.id).unwrap());
        assert_eq!(restarted.snapshot(&query()).unwrap().messages.len(), 1);
        let paths: i64 = restarted
            .db()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM eml_import_items WHERE path!=''",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(paths, 0);
    }
    #[test]
    fn eml_import_bad_changed_symlink_and_large_files_do_not_block_good_files() {
        let (dir, store, a, path) = fixture();
        let bad = dir.path().join("bad.eml");
        fs::write(&bad, b"not an email").unwrap();
        let huge = dir.path().join("huge.eml");
        fs::File::create(&huge)
            .unwrap()
            .set_len(eml_input::MAX_BYTES + 1)
            .unwrap();
        let job = run(
            &store,
            &[
                bad.to_string_lossy().into(),
                huge.to_string_lossy().into(),
                path.clone(),
            ],
            &a,
            "A",
        );
        assert_eq!((job.added, job.failed), (1, 2));
        let next = store
            .prepare_eml_import(&[path.clone()], &a.id, "A")
            .unwrap();
        fs::write(&path, b"Subject: changed\r\n\r\nnew").unwrap();
        store.eml_import_action(&next.id, "start").unwrap();
        store.process_eml_import(&next.id).unwrap();
        assert_eq!(
            store.eml_import_job(&next.id, true).unwrap().items[0].error,
            "fileChanged"
        );
        store.eml_import_action(&next.id, "cancel").unwrap();
        #[cfg(unix)]
        {
            let link = dir.path().join("link.eml");
            std::os::unix::fs::symlink(&path, &link).unwrap();
            assert_eq!(eml_input::read(&link, None).unwrap_err(), "invalidFile");
        }
    }
    #[test]
    fn eml_import_sql_failure_cannot_publish_success_and_does_not_remove_shared_raw() {
        let (_dir, store, a, path) = fixture();
        let mut other = a.clone();
        other.id = "shared".into();
        store.save_account(&other).unwrap();
        store.ingest(&other, "INBOX", "8:1", &raw(), true).unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'forced'); END;").unwrap();
        let job = run(&store, &[path.clone()], &a, "A");
        assert_eq!((job.added, job.processed), (0, 0));
        assert_eq!(job.status, "interrupted");
        let mut q = query();
        q.account_id = a.id.clone();
        assert!(store.snapshot(&q).unwrap().messages.is_empty());
        assert_eq!(
            archive::read_raw(&store.root, &archive::digest(&raw())).unwrap(),
            raw()
        );
        store
            .db()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_import")
            .unwrap();
        let job = run(&store, &[path], &a, "A");
        assert_eq!(job.added, 1);
        assert_eq!(
            archive::read_raw(&store.root, &archive::digest(&raw())).unwrap(),
            raw()
        );
    }
    #[test]
    fn eml_import_backup_restore_preserves_provenance_without_accounts_jobs_or_source_paths() {
        let (dir, store, a, path) = fixture();
        let job = run(&store, &[path], &a, "A");
        let backup = store.backup(dir.path()).unwrap();
        let snap = Connection::open(Path::new(&backup).join("snapshot.sqlite3")).unwrap();
        for table in ["eml_import_jobs", "eml_import_items", "accounts"] {
            let count: i64 = snap
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0);
        }
        let restored = Store::new(dir.path().join("restore")).unwrap();
        assert_eq!(restored.restore(Path::new(&backup)).unwrap(), 1);
        assert!(restored.detail(&job.items[0].mail_id).is_ok());
        assert!(restored.eml_import_jobs().unwrap().is_empty());
        let n: i64 = restored
            .db()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM message_imports", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let preview = restored.archive_deletion_preview("").unwrap();
        assert_eq!(preview.offline_only, 1);
        restored
            .delete_local_archives("", false, preview.count, &preview.review_token)
            .unwrap();
        let n: i64 = restored
            .db()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM message_imports", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }
    #[test]
    fn eml_import_thousand_small_files_remain_bounded_and_idempotent() {
        let (dir, store, a, _path) = fixture();
        let paths=(0..1000).map(|i| {
            let path=dir.path().join(format!("{i}.eml"));
            fs::write(&path,format!("From: sample@example.com\r\nTo: reader@example.com\r\nMessage-ID: <{i}@example.com>\r\nSubject: Imported {i}\r\n\r\nSmall message {i}")).unwrap();
            path.to_string_lossy().into_owned()
        }).collect::<Vec<_>>();
        let job = run(&store, &paths, &a, "A");
        assert_eq!(
            (job.total, job.processed, job.added, job.duplicate),
            (1000, 1000, 1000, 0)
        );
        let again = run(&store, &paths, &a, "B");
        assert_eq!((again.added, again.duplicate), (0, 1000));
        assert!(store
            .prepare_eml_import(&vec![paths[0].clone(); 1001], &a.id, "A")
            .is_err());
    }

    #[test]
    fn eml_import_cancel_while_prepared_bytes_wait_for_archive_gate_drops_late_result() {
        let (_dir, store, a, path) = fixture();
        let job = store.prepare_eml_import(&[path], &a.id, "A").unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        let gate = store.archive_gate.write().unwrap();
        let worker = store.clone();
        let id = job.id.clone();
        let thread = std::thread::spawn(move || worker.process_eml_import(&id).unwrap());
        let started = Instant::now();
        while store.eml_import_job(&job.id, false).unwrap().status != "running" {
            assert!(started.elapsed().as_secs() < 5);
            std::thread::yield_now();
        }
        store.eml_import_action(&job.id, "cancel").unwrap();
        drop(gate);
        thread.join().unwrap();
        assert!(store.snapshot(&query()).unwrap().messages.is_empty());
        assert_eq!(store.eml_import_job(&job.id, true).unwrap().added, 0);
    }
    #[test]
    fn eml_import_external_disconnect_stops_without_local_fallback() {
        let (dir, store, a, path) = fixture();
        let disk = dir.path().join("disk");
        fs::create_dir(&disk).unwrap();
        store.move_archive_location(disk.to_str().unwrap()).unwrap();
        let job = store.prepare_eml_import(&[path], &a.id, "A").unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        fs::rename(disk.join("Anser-Archive"), disk.join("Disconnected")).unwrap();
        store.process_eml_import(&job.id).unwrap();
        let failed = store.eml_import_job(&job.id, true).unwrap();
        assert_eq!(failed.error, "archiveUnavailable");
        assert_eq!(failed.added, 0);
        assert!(!store
            .root
            .join("archive")
            .join(format!("{}.eml", archive::digest(&raw())))
            .exists());
    }
    #[test]
    fn eml_import_local_user_flags_survive_real_source_link_and_archive_migration() {
        let (dir, store, a, path) = fixture();
        let job = run(&store, &[path], &a, "A");
        let id = &job.items[0].mail_id;
        store.change_mail(id, "read", "false").unwrap();
        store.change_mail(id, "star", "true").unwrap();
        assert!(store.server_operations().unwrap().items.is_empty());
        store.ingest(&a, "INBOX", "7:1", &raw(), true).unwrap();
        store
            .merge_remote_flags(&a, "INBOX", &[("7:1".into(), true, false)])
            .unwrap();
        let mail = store.mail(id).unwrap();
        assert!(!mail.is_read && mail.starred);
        assert_eq!(store.detail(id).unwrap().mail.source_folder, "INBOX");
        let disk = dir.path().join("disk");
        fs::create_dir(&disk).unwrap();
        store.move_archive_location(disk.to_str().unwrap()).unwrap();
        assert!(store.detail(id).is_ok());
    }
    #[test]
    fn eml_import_batch_bytes_are_bounded_before_creating_a_job() {
        let (dir, store, a, _path) = fixture();
        let paths = (0..17)
            .map(|i| {
                let path = dir.path().join(format!("large{i}.eml"));
                fs::File::create(&path)
                    .unwrap()
                    .set_len(eml_input::MAX_BYTES)
                    .unwrap();
                path.to_string_lossy().into_owned()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            store.prepare_eml_import(&paths, &a.id, "A").unwrap_err(),
            "batchLimit"
        );
        assert!(store.eml_import_jobs().unwrap().is_empty());
    }
    #[test]
    fn eml_import_archive_cleanup_cancels_pending_work_and_removes_only_local_records() {
        let (_dir, store, a, path) = fixture();
        let first = run(&store, &[path.clone()], &a, "A");
        let pending = store.prepare_eml_import(&[path], &a.id, "B").unwrap();
        store.eml_import_action(&pending.id, "start").unwrap();
        let preview = store.archive_deletion_preview(&a.id).unwrap();
        assert_eq!(preview.offline_only, 1);
        store
            .delete_local_archives(&a.id, false, preview.count, &preview.review_token)
            .unwrap();
        assert!(!store.process_eml_import(&pending.id).unwrap());
        assert!(store.mail(&first.items[0].mail_id).is_err());
        assert_eq!(
            store.eml_import_job(&pending.id, false).unwrap().error,
            "archiveCleared"
        );
    }
    #[test]
    fn deleting_an_import_folder_removes_import_records_search_entries_and_original() {
        let (_dir, store, a, path) = fixture();
        let first = run(&store, &[path], &a, "Delete imported");
        let mail_id = first.items[0].mail_id.clone();
        let hash = store.mail(&mail_id).unwrap().hash;
        assert_eq!(store.delete_local_folder("Delete imported").unwrap(), 1);
        assert!(store.mail(&mail_id).is_err());
        assert!(archive::read_raw(&store.root, &hash).is_err());
        let db = store.db().unwrap();
        for (table, column) in [
            ("message_imports", "mail_id"),
            ("search_documents", "mail_id"),
            ("sources", "mail_id"),
            ("notification_targets", "mail_id"),
        ] {
            let count: i64 = db
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE {column}=?1"),
                    [&mail_id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
        assert!(store
            .snapshot(&query())
            .unwrap()
            .folders
            .iter()
            .all(|folder| folder != "Delete imported"));
    }
    #[test]
    fn eml_import_different_originals_with_same_message_id_and_unknown_dates_remain_distinct() {
        let (dir, store, a, _path) = fixture();
        let mut paths = vec![];
        for i in 0..2 {
            let path = dir.path().join(format!("variant{i}.eml"));
            fs::write(&path,format!("From: sender@example.com\r\nSubject: 邮件变体\r\nMessage-ID: <same@example.com>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>中文内容 {i}</p>")).unwrap();
            paths.push(path.to_string_lossy().into_owned());
        }
        let job = run(&store, &paths, &a, "A");
        assert_eq!(job.added, 2);
        let a = store.detail(&job.items[0].mail_id).unwrap();
        let b = store.detail(&job.items[1].mail_id).unwrap();
        assert_ne!(a.mail.id, b.mail.id);
        assert_ne!(a.original_hash, b.original_hash);
        assert_eq!(a.mail.message_id, b.mail.message_id);
        assert!(a.mail.date.is_empty() && b.mail.date.is_empty());
        assert!(a.mail.body.contains("中文内容"));
        assert!(a.html.contains("<p>中文内容 0</p>"));
    }
    #[test]
    fn mail_import_mixed_formats_keep_original_blobs_and_restore_without_sources() {
        let (dir, store, a, eml) = fixture();
        let emlx = dir.path().join("apple.emlx");
        let mut apple = format!("{}\n", raw().len()).into_bytes();
        apple.extend_from_slice(&raw());
        apple.extend_from_slice(b"\n<plist>local flags</plist>");
        fs::write(&emlx, &apple).unwrap();
        let msg = dir.path().join("outlook.msg");
        let outlook = crate::msg_format::tests::sample();
        fs::write(&msg, &outlook).unwrap();
        let mbox = dir.path().join("folder.mbox");
        let first=b"From qa@example.test Fri Oct 23 08:00:00 2026\nSubject: Mbox one\nMessage-ID: <mbox-one@example.test>\n\n>From quoted body\n";
        let second=b"From qa@example.test Fri Oct 23 08:00:01 2026\nSubject: Mbox two\nMessage-ID: <mbox-two@example.test>\n\nSecond\n";
        let mailbox = [first.as_slice(), second.as_slice()].concat();
        fs::write(&mbox, &mailbox).unwrap();
        let paths = vec![
            eml,
            emlx.to_string_lossy().into_owned(),
            msg.to_string_lossy().into_owned(),
            mbox.to_string_lossy().into_owned(),
        ];
        let job = run(&store, &paths, &a, "Mail files");
        assert_eq!((job.total, job.added, job.failed), (5, 5, 0));
        for (item, expected) in
            job.items
                .iter()
                .zip([raw(), apple, outlook, first.to_vec(), second.to_vec()])
        {
            let mail = store.mail(&item.mail_id).unwrap();
            assert_eq!(
                archive::read_raw(&store.root, &mail.hash).unwrap(),
                expected
            );
            assert!(store.source(&mail.id).is_err());
            let detail = store.detail(&mail.id).unwrap();
            assert!(!detail.mail.subject.is_empty());
            if mail.subject == "Mbox one" {
                assert_eq!(detail.mail.body, "From quoted body");
            }
            if mail.subject == "MSG 中文标题" {
                assert!(detail.html.contains("中文 HTML"));
                assert_eq!(detail.attachments[0].name, "测试附件.bin");
                assert_eq!(
                    archive::attachment(&expected, detail.attachments[0].index).unwrap(),
                    b"\0\xff\x10QA\r\n"
                );
            }
        }
        let duplicate = run(&store, &paths, &a, "Other");
        assert_eq!((duplicate.duplicate, duplicate.added), (5, 0));
        let backup = dir.path().join("backup-formats");
        let backup = store.backup(&backup).unwrap();
        let destination = tempfile::tempdir().unwrap();
        let restored = Store::new(destination.path().to_path_buf()).unwrap();
        restored.restore(Path::new(&backup)).unwrap();
        for item in job.items {
            assert_eq!(
                restored.detail(&item.mail_id).unwrap().original_hash,
                store.detail(&item.mail_id).unwrap().original_hash
            );
        }
    }
    #[test]
    fn mailbox_index_and_reads_reject_late_change_unsupported_variant_and_oversized_count() {
        let (dir, store, a, _) = fixture();
        let path = dir.path().join("mailbox.mbox");
        let record = b"From qa@example.test Fri Oct 23 08:00:00 2026\nSubject: Mbox\n\nBody\n";
        fs::write(&path, [record.as_slice(), record.as_slice()].concat()).unwrap();
        let paths = vec![path.to_string_lossy().into_owned()];
        let job = store.prepare_eml_import(&paths, &a.id, "Mbox").unwrap();
        assert_eq!(job.total, 2);
        store.eml_import_action(&job.id, "start").unwrap();
        store.process_eml_import(&job.id).unwrap();
        store.eml_import_action(&job.id, "cancel").unwrap();
        assert!(!store.process_eml_import(&job.id).unwrap());
        assert_eq!(store.eml_import_job(&job.id, true).unwrap().added, 1);
        let job = store.prepare_eml_import(&paths, &a.id, "Changed").unwrap();
        fs::write(&path, b"replaced").unwrap();
        store.eml_import_action(&job.id, "start").unwrap();
        while store.process_eml_import(&job.id).unwrap() {}
        let changed = store.eml_import_job(&job.id, true).unwrap();
        assert_eq!((changed.added, changed.failed), (0, 2));
        fs::write(&path,b"From qa@example.test Fri Oct 23 08:00:00 2026\nContent-Length: 8\nSubject: variant\n\nBody\n").unwrap();
        let bad = run(&store, &paths, &a, "Variant");
        assert_eq!(bad.items[0].error, "unsupportedMboxVariant");
        fs::write(&path, record.repeat(1001)).unwrap();
        assert_eq!(
            store
                .prepare_eml_import(&paths, &a.id, "Too many")
                .unwrap_err(),
            "batchLimit"
        );
    }
}
