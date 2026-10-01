use crate::{archive, models::*, rules};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    fs,
    path::{Path, PathBuf},
};
#[derive(Clone)]
pub struct Store {
    pub root: PathBuf,
}
impl Store {
    pub fn new(root: PathBuf) -> Result<Self> {
        fs::create_dir_all(&root).map_err(err)?;
        let s = Self { root };
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
        db.execute_batch("CREATE TABLE IF NOT EXISTS contacts(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL COLLATE NOCASE UNIQUE); CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,data TEXT NOT NULL);")
            .map_err(err)?;
        for (column, definition) in [
            ("error", "TEXT NOT NULL DEFAULT ''"),
            ("updated_at", "TEXT NOT NULL DEFAULT ''"),
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
        s.refresh_archive_metadata()?;
        Ok(s)
    }
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
        next.last_sync = if source_changed { None } else { old.last_sync };
        next.error = None;
        let mut db = self.db()?;
        let tx = db.transaction().map_err(err)?;
        tx.execute(
            "UPDATE accounts SET data=?2 WHERE id=?1",
            params![a.id, serde_json::to_string(&next).map_err(err)?],
        )
        .map_err(err)?;
        if source_changed {
            tx.execute("DELETE FROM sources WHERE account_id=?1", [&a.id])
                .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn remove_account(&self, id: &str) -> Result<()> {
        self.db()?
            .execute("DELETE FROM accounts WHERE id=?1", [id])
            .map_err(err)?;
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
        let tx = db.transaction().map_err(err)?;
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
        let (mut mail, _, _) = archive::parse(raw, a, folder)?;
        let hash = archive::store_raw(&self.root, raw)?; // durable, complete MIME before DB success or rule execution
        let mut db = self.db()?;
        let tx = db.transaction().map_err(err)?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT id FROM messages WHERE account_id=?1 AND hash=?2",
                params![a.id, hash],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let is_new = existing.is_none();
        if let Some(id) = existing {
            mail.id = id;
        } else {
            mail.is_read = read;
            tx.execute(
                "INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,1)",
                params![
                    mail.id,
                    a.id,
                    hash,
                    serde_json::to_string(&mail).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.execute("INSERT INTO sources(account_id,folder,remote_id,mail_id) VALUES(?1,?2,?3,?4) ON CONFLICT(account_id,folder,remote_id) DO UPDATE SET mail_id=excluded.mail_id,active=1",params![a.id,folder,remote,mail.id]).map_err(err)?;
        tx.commit().map_err(err)?;
        if is_new {
            self.apply_rules(&mail.id)?;
        }
        Ok(is_new)
    }
    pub fn apply_rules(&self, id: &str) -> Result<u32> {
        let mut m = self.mail(id)?;
        archive::read_raw(&self.root, &m.hash)?;
        let mut count = 0;
        for r in self.rules()? {
            if rules::matches(&r, &m) {
                match r.action.as_str() {
                    "folder" => m.local_folder = r.destination.clone(),
                    "read" => m.is_read = true,
                    "unread" => m.is_read = false,
                    "star" => m.starred = true,
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
        let tx = db.transaction().map_err(err)?;
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
        let where_sql="(?1='' OR account_id=?1) AND (?2='' OR instr(lower(CASE ?8 WHEN 'subject' THEN json_extract(data,'$.subject') WHEN 'sender' THEN json_extract(data,'$.sender') WHEN 'recipients' THEN json_extract(data,'$.recipients') WHEN 'body' THEN json_extract(data,'$.body') ELSE json_extract(data,'$.subject') || ' ' || json_extract(data,'$.sender') || ' ' || json_extract(data,'$.recipients') || ' ' || json_extract(data,'$.body') END), lower(?2))>0) AND (?3='' OR json_extract(data,'$.localFolder')=?3) AND CASE ?4 WHEN 'trash' THEN json_extract(data,'$.trashed')=1 ELSE json_extract(data,'$.trashed')=0 END AND CASE ?4 WHEN 'all' THEN EXISTS(SELECT 1 FROM sources s JOIN accounts a ON a.id=s.account_id WHERE s.mail_id=messages.id AND s.folder='INBOX' COLLATE NOCASE AND s.active=1) WHEN 'unread' THEN json_extract(data,'$.isRead')=0 WHEN 'starred' THEN json_extract(data,'$.starred')=1 WHEN 'sent' THEN json_extract(data,'$.sourceFolder')='Sent' ELSE 1 END AND (?5=0 OR json_extract(data,'$.isRead')=0) AND (?6=0 OR json_extract(data,'$.starred')=1) AND (?7=0 OR json_extract(data,'$.hasAttachments')=1)";
        let mut st=db.prepare(&format!("SELECT data FROM messages WHERE {where_sql} ORDER BY json_extract(data,'$.date') DESC LIMIT ?9")).map_err(err)?;
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
                    q.limit.clamp(1, 5000)
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(err)?;
        let messages = rows
            .map(|r| serde_json::from_str(&r.map_err(err)?).map_err(err))
            .collect::<Result<Vec<Mail>>>()?;
        let matched = db
            .query_row(
                &format!("SELECT COUNT(*) FROM messages WHERE {where_sql}"),
                params![
                    q.account_id,
                    q.search,
                    q.folder,
                    q.view,
                    q.unread_only,
                    q.starred_only,
                    q.attachments_only,
                    q.search_field
                ],
                |r| r.get(0),
            )
            .map_err(err)?;
        let stats=db.query_row("SELECT COUNT(*),COALESCE(SUM(json_extract(data,'$.isRead')=0 AND json_extract(data,'$.trashed')=0),0),COALESCE(SUM(json_extract(data,'$.size')),0) FROM messages",[],|r|Ok(Stats{total:r.get(0)?,saved:r.get(0)?,unread:r.get(1)?,bytes:r.get(2)?})).map_err(err)?;
        let mut fs=db.prepare("SELECT DISTINCT json_extract(data,'$.localFolder') FROM messages WHERE json_extract(data,'$.localFolder')!='全部存档' ORDER BY 1").map_err(err)?;
        let folders = fs
            .query_map([], |r| r.get(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(err)?;
        let mut ls = db
            .prepare("SELECT time || '  ' || message FROM logs ORDER BY id DESC LIMIT 30")
            .map_err(err)?;
        let logs = ls
            .query_map([], |r| r.get(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(err)?;
        Ok(Snapshot {
            accounts: self.accounts()?,
            rules: self.rules()?,
            messages,
            folders,
            stats,
            logs,
            data_dir: self.root.to_string_lossy().into(),
            matched,
        })
    }
    pub fn detail(&self, id: &str) -> Result<Detail> {
        let mail = self.mail(id)?;
        let (_, html, attachments) = self.reparse(&mail)?;
        let (reply_to, to, cc) =
            archive::reply_addresses(&archive::read_raw(&self.root, &mail.hash)?)?;
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
        let fake = Account {
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
            last_sync: None,
            error: None,
        };
        archive::parse(&raw, &fake, &mail.source_folder)
    }
    fn refresh_archive_metadata(&self) -> Result<()> {
        let mut db = self.db()?;
        let tx = db.transaction().map_err(err)?;
        let rows = tx
            .prepare("SELECT data FROM messages WHERE parser_version < 1")
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
            mail.sender = parsed.sender;
            mail.recipients = parsed.recipients;
            mail.subject = parsed.subject;
            mail.body = parsed.body;
            mail.preview = parsed.preview;
            tx.execute(
                "UPDATE messages SET data=?2,parser_version=1 WHERE id=?1",
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
        self.db()?
            .execute(
                "INSERT INTO drafts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                params![d.id, serde_json::to_string(d).map_err(err)?],
            )
            .map_err(err)?;
        Ok(())
    }
    pub fn backup(&self, destination: &Path) -> Result<String> {
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
            .prepare("SELECT DISTINCT hash FROM messages")
            .map_err(err)?;
        for h in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
            let hash = h.map_err(err)?;
            archive::atomic_write(
                &folder.join("archive").join(format!("{hash}.eml")),
                &archive::read_raw(&self.root, &hash)?,
            )?;
        }
        drop(stmt);
        snap.execute_batch("DELETE FROM accounts; DELETE FROM drafts; DELETE FROM outbox; DELETE FROM logs; VACUUM;").map_err(err)?;
        archive::atomic_write(
            &folder.join("manifest.json"),
            br#"{"format":"mail-desktop-archive","version":1}"#,
        )?;
        Ok(folder.to_string_lossy().into())
    }
    pub fn restore(&self, folder: &Path) -> Result<usize> {
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
            let raw = archive::read_raw(folder, &m.hash)?;
            archive::store_raw(&self.root, &raw)?;
            messages.push(m);
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
        let tx = db.transaction().map_err(err)?;
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
