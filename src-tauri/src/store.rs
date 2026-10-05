use crate::{archive, models::*, rules};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
};
#[derive(Clone)]
pub struct Store {
    pub root: PathBuf,
    pub(crate) archive_gate: Arc<RwLock<()>>,
    pub(crate) conversation_cache: Arc<Mutex<Option<(i64, Arc<crate::conversation::Index>)>>>,
}
impl Store {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(err)?;
        let s = Self {
            root,
            archive_gate: Arc::new(RwLock::new(())),
            conversation_cache: Arc::new(Mutex::new(None)),
        };
        let db = s.db()?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(account_id,hash)); CREATE TABLE IF NOT EXISTS sources(account_id TEXT,folder TEXT,remote_id TEXT,mail_id TEXT,active INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(account_id,folder,remote_id)); CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,position INTEGER,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY,time TEXT,message TEXT); CREATE TABLE IF NOT EXISTS drafts(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,status TEXT,data TEXT,raw BLOB); CREATE INDEX IF NOT EXISTS messages_account ON messages(account_id);").map_err(err)?;
        let has_active: bool = db
            .prepare("PRAGMA table_info(sources)")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(err)?
            .any(|r| r.as_deref() == Ok("active"));
        if !has_active {
            db.execute(
                "ALTER TABLE sources ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
                [],
            )
            .map_err(err)?;
        }
        let has_parser_version = db
            .prepare("PRAGMA table_info(messages)")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(err)?
            .any(|r| r.as_deref() == Ok("parser_version"));
        if !has_parser_version {
            db.execute(
                "ALTER TABLE messages ADD COLUMN parser_version INTEGER NOT NULL DEFAULT 0",
                [],
            )
            .map_err(err)?;
        }
        db.execute_batch("CREATE TABLE IF NOT EXISTS folder_mappings(account_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS remote_folders(account_id TEXT NOT NULL,name TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(account_id,name)); CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL COLLATE NOCASE UNIQUE); CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,data TEXT NOT NULL);")
            .map_err(err)?;
        for (column, definition) in [
            ("error", "TEXT NOT NULL DEFAULT ''"),
            ("updated_at", "TEXT NOT NULL DEFAULT ''"),
            ("scheduled_at", "TEXT NOT NULL DEFAULT ''"),
            ("raw_hash", "TEXT NOT NULL DEFAULT ''"),
        ] {
            let exists = db
                .prepare("PRAGMA table_info(outbox)")
                .map_err(err)?
                .query_map([], |r| r.get::<_, String>(1))
                .map_err(err)?
                .any(|r| r.as_deref() == Ok(column));
            if !exists {
                db.execute(
                    &format!("ALTER TABLE outbox ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(err)?;
            }
        }
        db.execute("UPDATE outbox SET status='uncertain',error='应用在发送完成前退出，请先检查服务端已发送邮件' WHERE status='sending'", []).map_err(err)?;
        // Maintain a small listing projection atomically with every archive write,
        // including rule application, restore and parser migrations. Bodies remain
        // in messages and the original MIME archive; list refreshes never load them.
        db.execute_batch("BEGIN IMMEDIATE;
            CREATE INDEX IF NOT EXISTS sources_mail_active ON sources(mail_id, active, folder COLLATE NOCASE, account_id);
            CREATE TABLE IF NOT EXISTS message_listing(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, data TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS listing_account ON message_listing(account_id);
            CREATE TABLE IF NOT EXISTS conversation_revision(id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
            INSERT OR IGNORE INTO conversation_revision VALUES(1,0);
            INSERT OR IGNORE INTO message_listing SELECT id,account_id,json_set(data,'$.body','') FROM messages;
            CREATE TRIGGER IF NOT EXISTS listing_insert AFTER INSERT ON messages BEGIN
                INSERT INTO message_listing VALUES(NEW.id,NEW.account_id,json_set(NEW.data,'$.body',''));
                UPDATE conversation_revision SET version=version+1;
            END;
            CREATE TRIGGER IF NOT EXISTS listing_update AFTER UPDATE OF data ON messages BEGIN
                UPDATE message_listing SET account_id=NEW.account_id,data=json_set(NEW.data,'$.body','') WHERE id=NEW.id;
                UPDATE conversation_revision SET version=version+1;
            END;
            CREATE TRIGGER IF NOT EXISTS listing_delete AFTER DELETE ON messages BEGIN
                DELETE FROM message_listing WHERE id=OLD.id;
                UPDATE conversation_revision SET version=version+1;
            END;
            COMMIT;").map_err(err)?;
        crate::operations::initialize(&db)?;
        s.migrate_folder_roles()?;
        s.recover_archive_deletion()?;
        s.refresh_archive_metadata()?;
        Ok(s)
    }
    // Write transactions use IMMEDIATE so the busy timeout applies before any
    // snapshot is read. DEFERRED read-to-write upgrades can fail with BUSY_SNAPSHOT.
    pub fn db(&self) -> Result<Connection> {
        let c = Connection::open(self.root.join("mail.sqlite3")).map_err(err)?;
        c.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(err)?;
        Ok(c)
    }
    pub fn accounts(&self) -> Result<Vec<Account>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM accounts ORDER BY rowid")
            .map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn account(&self, id: &str) -> Result<Account> {
        self.accounts()?
            .into_iter()
            .find(|a| a.id == id)
            .ok_or("账号不存在".into())
    }
    pub fn save_account(&self, a: &Account) -> Result<()> {
        a.validate()?;
        self.db()?.execute("INSERT INTO accounts(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![a.id,serde_json::to_string(a).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    // Local preferences do not require credentials or a server connection test.
    pub fn edit_account_preferences(&self, account: &Account) -> Result<()> {
        account.validate()?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: String = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&account.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let mut current: Account = serde_json::from_str(&data).map_err(err)?;
        if !current.same_connection(account) {
            return Err("连接配置已变化，请重新验证并保存".into());
        }
        current.name = account.name.clone();
        current.save_locally = account.save_locally;
        tx.execute(
            "UPDATE accounts SET data=?2 WHERE id=?1",
            params![current.id, serde_json::to_string(&current).map_err(err)?],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }
    // A completed sync may have begun before local preferences were edited.
    pub fn save_sync_status(&self, account: &Account) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: Option<String> = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(data) = data {
            let mut current: Account = serde_json::from_str(&data).map_err(err)?;
            if current.same_connection(account) {
                current.last_sync = account.last_sync.clone();
                current.error = account.error.clone();
                tx.execute(
                    "UPDATE accounts SET data=?2 WHERE id=?1",
                    params![current.id, serde_json::to_string(&current).map_err(err)?],
                )
                .map_err(err)?;
            }
        }
        tx.commit().map_err(err)
    }
    pub fn edit_account(&self, a: &Account) -> Result<()> {
        let old = self.account(&a.id)?;
        if a.email != old.email {
            return Err("修改邮箱地址请添加新账号，已有存档仍保留原账号来源".into());
        }
        a.validate()?;
        let source_changed = old.protocol != a.protocol
            || old.incoming_host != a.incoming_host
            || old.incoming_port != a.incoming_port
            || old.username != a.username;
        let mut next = a.clone();
        next.enabled = old.enabled;
        next.last_sync = if source_changed {
            None
        } else {
            old.last_sync.clone()
        };
        next.error = None;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute(
            "UPDATE accounts SET data=?2 WHERE id=?1",
            params![a.id, serde_json::to_string(&next).map_err(err)?],
        )
        .map_err(err)?;
        if crate::operations::identity(&old) != crate::operations::identity(a) {
            tx.execute("UPDATE server_operations SET status='blocked',revision=revision+1,error='账号连接配置已变化，请重新收取后再操作' WHERE account_id=?1 AND status!='completed'", [&a.id]).map_err(err)?;
        }
        if source_changed {
            tx.execute("DELETE FROM sources WHERE account_id=?1", [&a.id])
                .map_err(err)?;
            tx.execute("DELETE FROM remote_folders WHERE account_id=?1", [&a.id])
                .map_err(err)?;
            tx.execute("DELETE FROM folder_mappings WHERE account_id=?1", [&a.id])
                .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn remove_account(&self, id: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute(
            "DELETE FROM messages WHERE account_id=?1 AND json_extract(data,'$.savedLocally')=0",
            [id],
        )
        .map_err(err)?;
        tx.execute("DELETE FROM folder_mappings WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("DELETE FROM remote_folders WHERE account_id=?1", [id])
            .map_err(err)?;
        tx.execute("UPDATE server_operations SET status='blocked',revision=revision+1,error='账号已移除，本地存档保留' WHERE account_id=?1 AND status!='completed'", [id]).map_err(err)?;
        tx.execute("DELETE FROM accounts WHERE id=?1", [id])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        self.log("已移除账号，所有本地存档均已保留")
    }
    pub fn rules(&self) -> Result<Vec<Rule>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM rules ORDER BY position")
            .map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn save_rules(&self, rs: &[Rule]) -> Result<()> {
        for r in rs {
            rules::validate(r)?;
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute("DELETE FROM rules", []).map_err(err)?;
        for (i, r) in rs.iter().enumerate() {
            tx.execute(
                "INSERT INTO rules VALUES(?1,?2,?3)",
                params![r.id, i, serde_json::to_string(r).map_err(err)?],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn mail(&self, id: &str) -> Result<Mail> {
        let raw: String = self
            .db()?
            .query_row("SELECT data FROM messages WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        serde_json::from_str(&raw).map_err(err)
    }
    pub fn update_mail(&self, m: &Mail) -> Result<()> {
        self.db()?
            .execute(
                "UPDATE messages SET data=?2 WHERE id=?1",
                params![m.id, serde_json::to_string(m).map_err(err)?],
            )
            .map_err(err)?;
        Ok(())
    }
    pub fn has_source(&self, account: &str, folder: &str, remote: &str) -> Result<bool> {
        self.db()?.query_row("SELECT EXISTS(SELECT 1 FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3)",params![account,folder,remote],|r|r.get(0)).map_err(err)
    }
    pub fn ingest(
        &self,
        a: &Account,
        folder: &str,
        remote: &str,
        raw: &[u8],
        read: bool,
    ) -> Result<bool> {
        self.ingest_with_flags(a, folder, remote, raw, read, false)
    }
    pub(crate) fn ingest_with_flags(
        &self,
        a: &Account,
        folder: &str,
        remote: &str,
        raw: &[u8],
        read: bool,
        starred: bool,
    ) -> Result<bool> {
        let _archive = self.archive_gate.read().map_err(err)?;
        // A cleanup can disable retention while a FETCH is in flight. Do not
        // republish an old request as a local archive after it finishes.
        let mut a = a.clone();
        if folder != "Sent"
            && self
                .account(&a.id)
                .is_ok_and(|current| !current.save_locally)
        {
            a.save_locally = false;
        }
        let a = &a;
        let (mut mail, _, _) = archive::parse(raw, a, folder)?;
        if !mail.parse_warnings.is_empty() {
            self.log(&format!(
                "文件夹「{folder}」邮件 {remote} 部分内容编码异常；{}：{}",
                if a.save_locally {
                    "完整原件将保留"
                } else {
                    "服务器原件未修改"
                },
                mail.parse_warnings.join("；")
            ))?;
        }
        let save = a.save_locally;
        let hash = if save {
            archive::store_raw(&self.root, raw)?
        } else {
            archive::digest(raw)
        }; // durable, complete MIME before DB success or rule execution
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM messages WHERE account_id=?1 AND hash=?2",
                params![a.id, hash],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let is_new = existing.is_none();
        let mut upgraded = false;
        if let Some(id) = existing {
            mail.id = id;
            let data: String = tx
                .query_row("SELECT data FROM messages WHERE id=?1", [&mail.id], |r| {
                    r.get(0)
                })
                .map_err(err)?;
            let old: Mail = serde_json::from_str(&data).map_err(err)?;
            if save && !old.saved_locally {
                mail.is_read = old.is_read;
                mail.starred = old.starred;
                mail.local_read_override = old.local_read_override;
                mail.local_star_override = old.local_star_override;
                mail.trashed = old.trashed;
                mail.local_folder = old.local_folder;
                mail.server_date = old.server_date;
                if mail.date.is_empty() {
                    mail.date = mail.server_date.clone();
                }
                tx.execute(
                    "UPDATE messages SET data=?2,parser_version=3 WHERE id=?1",
                    params![mail.id, serde_json::to_string(&mail).map_err(err)?],
                )
                .map_err(err)?;
                upgraded = true;
            }
        } else {
            // Preserve identity and local actions when an online-only message
            // later gains a complete archive after the account setting changes.
            let previous: Option<String> = tx.query_row("SELECT m.data FROM sources s JOIN messages m ON m.id=s.mail_id WHERE s.account_id=?1 AND s.folder=?2 AND s.remote_id=?3", params![a.id,folder,remote], |r| r.get(0)).optional().map_err(err)?;
            if let Some(data) = previous {
                let old: Mail = serde_json::from_str(&data).map_err(err)?;
                if !old.saved_locally {
                    mail.id = old.id;
                    mail.is_read = old.is_read;
                    mail.starred = old.starred;
                    mail.local_read_override = old.local_read_override;
                    mail.local_star_override = old.local_star_override;
                    mail.trashed = old.trashed;
                    mail.local_folder = old.local_folder;
                    mail.server_date = old.server_date;
                }
            } else {
                mail.is_read = read;
                mail.starred = starred;
            }
            mail.saved_locally = save;
            if !save {
                mail.body.clear();
            }
            if mail.date.is_empty() {
                mail.date = mail.server_date.clone();
            }
            tx.execute("INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,3) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash,data=excluded.data,parser_version=3", params![mail.id,a.id,hash,serde_json::to_string(&mail).map_err(err)?]).map_err(err)?;
        }
        tx.execute("INSERT INTO sources(account_id,folder,remote_id,mail_id) VALUES(?1,?2,?3,?4) ON CONFLICT(account_id,folder,remote_id) DO UPDATE SET mail_id=excluded.mail_id,active=1",params![a.id,folder,remote,mail.id]).map_err(err)?;
        tx.commit().map_err(err)?;
        if is_new || upgraded {
            self.apply_rules(&mail.id)?;
        }
        Ok(is_new)
    }
    pub fn apply_rules(&self, id: &str) -> Result<u32> {
        let mut m = self.mail(id)?;
        if m.saved_locally {
            archive::read_raw(&self.root, &m.hash)?;
        }
        let mut count = 0;
        for r in self.rules()? {
            if rules::matches(&r, &m) {
                match r.action.as_str() {
                    "folder" => m.local_folder = r.destination.clone(),
                    "read" => {
                        m.is_read = true;
                        m.local_read_override = Some(true);
                    }
                    "unread" => {
                        m.is_read = false;
                        m.local_read_override = Some(false);
                    }
                    "star" => {
                        m.starred = true;
                        m.local_star_override = Some(true);
                    }
                    "trash" => m.trashed = true,
                    _ => return Err("未知动作".into()),
                };
                self.update_mail(&m)?;
                self.log(&format!("规则「{}」已执行 · {}", r.name, m.subject))?;
                count += 1;
                if r.stop {
                    break;
                }
            }
        }
        Ok(count)
    }
    pub fn reconcile_folder(
        &self,
        account: &str,
        folder: &str,
        remote_ids: &[String],
    ) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        tx.execute(
            "UPDATE sources SET active=0 WHERE account_id=?1 AND folder=?2",
            params![account, folder],
        )
        .map_err(err)?;
        for id in remote_ids {
            tx.execute(
                "UPDATE sources SET active=1 WHERE account_id=?1 AND folder=?2 AND remote_id=?3",
                params![account, folder, id],
            )
            .map_err(err)?;
        }
        tx.execute("DELETE FROM messages WHERE account_id=?1 AND json_extract(data,'$.savedLocally')=0 AND NOT EXISTS(SELECT 1 FROM sources WHERE mail_id=messages.id AND active=1)", [account]).map_err(err)?;
        tx.commit().map_err(err)
    }
    pub fn preview_rule(&self, rule: &Rule) -> Result<Vec<String>> {
        rules::validate(rule)?;
        let mut rule = rule.clone();
        rule.enabled = true;
        let db = self.db()?;
        let mut q = db.prepare("SELECT data FROM messages").map_err(err)?;
        let mut matches = Vec::new();
        for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
            let m: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            if rules::matches(&rule, &m) {
                matches.push(m.subject);
            }
        }
        Ok(matches)
    }
    pub fn run_rules(&self) -> Result<u32> {
        let db = self.db()?;
        let mut q = db.prepare("SELECT id FROM messages").map_err(err)?;
        let ids = q
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut n = 0;
        for id in ids {
            n += self.apply_rules(&id)?;
        }
        Ok(n)
    }
    pub fn log(&self, msg: &str) -> Result<()> {
        let db = self.db()?;
        db.execute(
            "INSERT INTO logs(time,message) VALUES(?1,?2)",
            params![chrono::Local::now().format("%m-%d %H:%M").to_string(), msg],
        )
        .map_err(err)?;
        db.execute(
            "DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 500)",
            [],
        )
        .map_err(err)?;
        Ok(())
    }
    pub fn snapshot(&self, q: &Query) -> Result<Snapshot> {
        let db = self.db()?;
        let where_sql="(?1='' OR account_id=?1) AND (?2='' OR instr(lower(CASE ?8 WHEN 'subject' THEN json_extract(data,'$.subject') WHEN 'sender' THEN json_extract(data,'$.sender') WHEN 'recipients' THEN json_extract(data,'$.recipients') WHEN 'body' THEN (SELECT json_extract(original.data,'$.body') FROM messages original WHERE original.id=listing.id) ELSE json_extract(data,'$.subject') || ' ' || json_extract(data,'$.sender') || ' ' || json_extract(data,'$.recipients') || ' ' || (SELECT json_extract(original.data,'$.body') FROM messages original WHERE original.id=listing.id) END), lower(?2))>0) AND (?3='' OR json_extract(data,'$.localFolder')=?3) AND CASE ?4 WHEN 'trash' THEN json_extract(data,'$.trashed')=1 ELSE json_extract(data,'$.trashed')=0 END AND CASE ?4 WHEN 'all' THEN EXISTS(SELECT 1 FROM sources s JOIN accounts a ON a.id=s.account_id WHERE s.mail_id=listing.id AND s.folder='INBOX' COLLATE NOCASE AND s.active=1) WHEN 'unread' THEN json_extract(data,'$.isRead')=0 WHEN 'starred' THEN json_extract(data,'$.starred')=1 WHEN 'sent' THEN (EXISTS(SELECT 1 FROM sources s JOIN remote_folders f ON f.account_id=s.account_id AND f.name=s.folder WHERE s.mail_id=listing.id AND s.active=1 AND EXISTS(SELECT 1 FROM json_each(f.data,'$.roles') WHERE value='sent')) OR (json_extract(data,'$.sourceFolder')='Sent' AND (NOT EXISTS(SELECT 1 FROM remote_folders f WHERE f.account_id=listing.account_id AND f.name='Sent') OR EXISTS(SELECT 1 FROM sources s JOIN outbox o ON o.id=s.remote_id WHERE s.mail_id=listing.id AND s.folder='Sent' AND o.status='sent')))) ELSE 1 END AND (?5=0 OR json_extract(data,'$.isRead')=0) AND (?6=0 OR json_extract(data,'$.starred')=1) AND (?7=0 OR json_extract(data,'$.hasAttachments')=1) AND (?9='' OR EXISTS(SELECT 1 FROM sources s WHERE s.mail_id=listing.id AND s.account_id=listing.account_id AND s.folder=?9 AND s.active=1)) AND (?4!='local' OR COALESCE(json_extract(data,'$.savedLocally'),1)=1)";
        let mut st=db.prepare(&format!("SELECT data FROM message_listing listing WHERE {where_sql} ORDER BY json_extract(data,'$.date') DESC")).map_err(err)?;
        let rows = st
            .query_map(
                params![
                    q.account_id,
                    q.search,
                    q.folder,
                    q.view,
                    q.unread_only,
                    q.starred_only,
                    q.attachments_only,
                    q.search_field,
                    q.remote_folder
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(err)?;
        let messages = rows
            .map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect::<Result<Vec<Mail>>>()?;
        let index = self.conversation_index(&q.account_id)?;
        let mut messages = crate::conversation::summaries(messages, &index);
        let matched = messages.len() as u64;
        messages.truncate(q.limit.clamp(1, 5000) as usize);
        let stats=db.query_row("SELECT COUNT(*),COALESCE(SUM(json_extract(data,'$.isRead')=0 AND json_extract(data,'$.trashed')=0),0),COALESCE(SUM(CASE WHEN COALESCE(json_extract(data,'$.savedLocally'),1)=1 THEN json_extract(data,'$.size') ELSE 0 END),0),COALESCE(SUM(COALESCE(json_extract(data,'$.savedLocally'),1)),0) FROM message_listing",[],|r|Ok(Stats{total:r.get(0)?,saved:r.get(3)?,unread:r.get(1)?,bytes:r.get(2)?})).map_err(err)?;
        let mut fs=db.prepare("SELECT DISTINCT json_extract(data,'$.localFolder') FROM message_listing WHERE json_extract(data,'$.localFolder')!='全部存档' ORDER BY 1").map_err(err)?;
        let folders = fs
            .query_map([], |r| r.get(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(err)?;
        let mut ls = db
            .prepare("SELECT time || '  ' || message FROM logs ORDER BY id DESC LIMIT 30")
            .map_err(err)?;
        let logs = ls
            .query_map([], |r| {
                r.get::<_, String>(0)
                    .map(|message| crate::remote::display_activity(&message))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(err)?;
        Ok(Snapshot {
            accounts: self
                .accounts()?
                .into_iter()
                .map(|mut account| {
                    account.error = account
                        .error
                        .as_deref()
                        .map(crate::remote::display_activity);
                    account
                })
                .collect(),
            rules: self.rules()?,
            messages,
            folders,
            stats,
            logs,
            data_dir: self.root.to_string_lossy().into(),
            matched,
            remote_folders: self.remote_folders(None)?,
        })
    }
    pub fn detail(&self, id: &str) -> Result<Detail> {
        let mut mail = self.mail(id)?;
        let index = self.conversation_index(&mail.account_id)?;
        mail.conversation_id = index
            .roots
            .get(id)
            .cloned()
            .unwrap_or_else(|| id.to_string());
        mail.conversation_count = *index
            .counts
            .get(&(mail.conversation_id.clone(), mail.trashed))
            .unwrap_or(&1);
        let raw = self.message_raw(&mail)?;
        let (parsed, html, attachments) =
            archive::parse(&raw, &self.account_for_mail(&mail), &mail.source_folder)?;
        mail.body = parsed.body;
        mail.has_attachments = parsed.has_attachments;
        let (reply_to, to, cc) = archive::reply_addresses(&raw)?;
        Ok(Detail {
            mail,
            html,
            attachments,
            reply_to,
            to,
            cc,
        })
    }
    fn reparse(&self, mail: &Mail) -> Result<(Mail, String, Vec<AttachmentInfo>)> {
        let raw = archive::read_raw(&self.root, &mail.hash)?;
        let fake = self.account_for_mail(mail);
        archive::parse(&raw, &fake, &mail.source_folder)
    }
    pub(crate) fn account_for_mail(&self, mail: &Mail) -> Account {
        Account {
            id: mail.account_id.clone(),
            email: mail.account_email.clone(),
            name: String::new(),
            provider: String::new(),
            protocol: "imap".into(),
            incoming_host: String::new(),
            incoming_port: 993,
            incoming_tls: "tls".into(),
            smtp_host: String::new(),
            smtp_port: 465,
            smtp_tls: "tls".into(),
            username: String::new(),
            smtp_username: String::new(),
            auth: "password".into(),
            oauth_client_id: String::new(),
            enabled: false,
            save_locally: true,
            last_sync: None,
            error: None,
        }
    }
    fn refresh_archive_metadata(&self) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let rows = tx
            .prepare("SELECT data FROM messages WHERE parser_version < 3")
            .map_err(err)?
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        let mut failed = 0;
        for data in rows {
            let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
            let Ok((parsed, _, _)) = self.reparse(&mail) else {
                // Missing/corrupt archives remain unchanged and retry next startup.
                failed += 1;
                continue;
            };
            mail.date = if parsed.date.is_empty() {
                mail.server_date.clone()
            } else {
                parsed.date
            };
            mail.sender = parsed.sender;
            mail.recipients = parsed.recipients;
            mail.subject = parsed.subject;
            mail.body = parsed.body;
            mail.preview = parsed.preview;
            mail.message_id = parsed.message_id;
            mail.in_reply_to = parsed.in_reply_to;
            mail.references = parsed.references;
            tx.execute(
                "UPDATE messages SET data=?2,parser_version=3 WHERE id=?1",
                params![mail.id, serde_json::to_string(&mail).map_err(err)?],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        if failed > 0 {
            self.log(&format!(
                "{failed} 封存档因文件缺失、校验或解析失败，未更新显示信息；原记录已保留"
            ))?;
        }
        Ok(())
    }
    pub fn drafts(&self) -> Result<Vec<Compose>> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM drafts ORDER BY rowid DESC")
            .map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        rows.map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect()
    }
    pub fn save_draft(&self, d: &Compose) -> Result<()> {
        let db = self.db()?;
        let locked: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1 AND status IN ('scheduled','overdue','paused','sending','sent'))", [&d.id], |r| r.get(0)).map_err(err)?;
        if locked {
            return Err("邮件已进入发送记录，请在那里修改计划或取消后编辑".into());
        }
        db.execute(
            "INSERT INTO drafts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            params![d.id, serde_json::to_string(d).map_err(err)?],
        )
        .map_err(err)?;
        Ok(())
    }
    pub fn backup(&self, destination: &Path) -> Result<String> {
        let _archive = self.archive_gate.read().map_err(err)?;
        let folder = destination.join(format!(
            "Mail-backup-{}-{}",
            chrono::Local::now().format("%Y%m%d-%H%M%S"),
            &uuid::Uuid::new_v4().to_string()[..8]
        ));
        fs::create_dir_all(folder.join("archive")).map_err(err)?;
        let db = self.db()?;
        db.execute(
            "VACUUM INTO ?1",
            [folder.join("snapshot.sqlite3").to_string_lossy().as_ref()],
        )
        .map_err(err)?;
        let snap = Connection::open(folder.join("snapshot.sqlite3")).map_err(err)?;
        let mut stmt = snap
            .prepare("SELECT DISTINCT hash FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1")
            .map_err(err)?;
        for h in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
            let hash = h.map_err(err)?;
            archive::atomic_write(
                &folder.join("archive").join(format!("{hash}.eml")),
                &archive::read_raw(&self.root, &hash)?,
            )?;
        }
        drop(stmt);
        snap.execute_batch("DELETE FROM accounts; DELETE FROM drafts; DELETE FROM outbox; DELETE FROM logs; DELETE FROM server_operations; VACUUM;").map_err(err)?;
        archive::atomic_write(
            &folder.join("manifest.json"),
            br#"{"format":"mail-desktop-archive","version":1}"#,
        )?;
        Ok(folder.to_string_lossy().into())
    }
    pub fn restore(&self, folder: &Path) -> Result<usize> {
        let _archive = self.archive_gate.read().map_err(err)?;
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(folder.join("manifest.json")).map_err(err)?)
                .map_err(err)?;
        if manifest["format"] != "mail-desktop-archive" || manifest["version"] != 1 {
            return Err("不支持的备份格式".into());
        }
        let source = Connection::open_with_flags(
            folder.join("snapshot.sqlite3"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(err)?;
        let mut q = source.prepare("SELECT data FROM messages").map_err(err)?;
        let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
        let mut messages = Vec::new();
        for row in rows {
            let m: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            if !m.saved_locally {
                continue;
            }
            let raw = archive::read_raw(folder, &m.hash)?;
            archive::store_raw(&self.root, &raw)?;
            if m.saved_locally {
                messages.push(m);
            }
        }
        let has_table = |name: &str| -> Result<bool> {
            source
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                    [name],
                    |r| r.get(0),
                )
                .map_err(err)
        };
        let mut restored_rules = Vec::<Rule>::new();
        if has_table("rules")? {
            let mut q = source
                .prepare("SELECT data FROM rules ORDER BY position")
                .map_err(err)?;
            for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
                let rule: Rule = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
                rules::validate(&rule)?;
                restored_rules.push(rule);
            }
        }
        let mut restored_contacts = Vec::<Contact>::new();
        if has_table("contacts")? {
            let mut q = source
                .prepare("SELECT id,name,email FROM contacts ORDER BY rowid")
                .map_err(err)?;
            for row in q
                .query_map([], |r| {
                    Ok(Contact {
                        id: r.get(0)?,
                        name: r.get(1)?,
                        email: r.get(2)?,
                    })
                })
                .map_err(err)?
            {
                let contact = row.map_err(err)?;
                if contact.id.is_empty()
                    || contact.email.parse::<lettre::Address>().is_err()
                    || contact.name.contains(['\r', '\n'])
                {
                    return Err("备份中的联系人信息无效".into());
                }
                restored_contacts.push(contact);
            }
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut count = 0;
        for m in messages {
            count += tx
                .execute(
                    "INSERT OR IGNORE INTO messages(id,account_id,hash,data) VALUES(?1,?2,?3,?4)",
                    params![
                        m.id,
                        m.account_id,
                        m.hash,
                        serde_json::to_string(&m).map_err(err)?
                    ],
                )
                .map_err(err)?;
        }
        let mut position: i64 = tx
            .query_row("SELECT COALESCE(MAX(position),-1)+1 FROM rules", [], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let mut rule_count = 0;
        for rule in restored_rules {
            let n = tx
                .execute(
                    "INSERT OR IGNORE INTO rules(id,position,data) VALUES(?1,?2,?3)",
                    params![
                        rule.id,
                        position,
                        serde_json::to_string(&rule).map_err(err)?
                    ],
                )
                .map_err(err)?;
            position += n as i64;
            rule_count += n;
        }
        let mut contact_count = 0;
        for contact in restored_contacts {
            contact_count += tx
                .execute(
                    "INSERT OR IGNORE INTO contacts(id,name,email) VALUES(?1,?2,?3)",
                    params![contact.id, contact.name, contact.email],
                )
                .map_err(err)?;
        }
        tx.commit().map_err(err)?;
        self.refresh_archive_metadata()?;
        self.log(&format!(
            "备份恢复：新增 {count} 封邮件、{rule_count} 条规则、{contact_count} 位联系人"
        ))?;
        Ok(count)
    }
}
