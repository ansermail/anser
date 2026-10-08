use crate::{archive, models::*, store::Store};
use rusqlite::params;
use std::collections::BTreeMap;

#[derive(Default)]
pub struct SyncSchedule {
    last_sync: Option<i64>,
    last_tick: Option<i64>,
    wake_pending: bool,
}
impl SyncSchedule {
    pub fn due(&mut self, now: i64, interval: i64) -> bool {
        if self
            .last_tick
            .is_some_and(|last| now - last > 45 || now < last)
        {
            self.wake_pending = true;
        }
        self.last_tick = Some(now);
        self.wake_pending || self.last_sync.is_none_or(|last| now - last >= interval)
    }
    pub fn completed(&mut self, now: i64) {
        self.last_sync = Some(now);
        self.last_tick = Some(now);
        self.wake_pending = false;
    }
}

impl Store {
    pub fn preferences(&self) -> Result<Preferences> {
        use rusqlite::OptionalExtension;
        let data: Option<String> = self
            .db()?
            .query_row("SELECT data FROM preferences WHERE key='sync'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(err)?;
        data.map(|data| serde_json::from_str(&data).map_err(err))
            .unwrap_or(Ok(Preferences::default()))
    }
    pub fn save_preferences(&self, p: &Preferences) -> Result<()> {
        if ![1, 5, 10, 15, 30, 60].contains(&p.sync_interval_minutes) {
            return Err("请选择有效的后台检查间隔".into());
        }
        self.db()?.execute("INSERT INTO preferences(key,data) VALUES('sync',?1) ON CONFLICT(key) DO UPDATE SET data=excluded.data",[serde_json::to_string(p).map_err(err)?]).map_err(err)?;
        Ok(())
    }
    pub fn archive_health(&self) -> Result<ArchiveHealth> {
        let db = self.db()?;
        let mut q = db
            .prepare("SELECT data FROM messages WHERE COALESCE(json_extract(data,'$.savedLocally'),1)=1 ORDER BY rowid")
            .map_err(err)?;
        let mut checked = 0;
        let mut healthy = 0;
        let mut problems = Vec::new();
        for row in q.query_map([], |r| r.get::<_, String>(0)).map_err(err)? {
            let mail: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            checked += 1;
            match archive::read_raw(&self.root, &mail.hash).and_then(|raw| {
                let parsed = mailparse::parse_mail(&raw).map_err(err)?;
                let mut parts = Vec::new();
                archive::leaves(&parsed, &mut parts);
                for part in parts {
                    archive::decoded_bytes(part)?;
                }
                Ok(())
            }) {
                Ok(()) => healthy += 1,
                Err(error) => problems.push(ArchiveProblem {
                    mail_id: mail.id,
                    subject: mail.subject,
                    error,
                }),
            }
        }
        Ok(ArchiveHealth {
            checked,
            healthy,
            problems,
            checked_at: chrono::Utc::now().to_rfc3339(),
        })
    }
    pub fn contacts(&self) -> Result<Vec<Contact>> {
        let db = self.db()?;
        let mut query = db
            .prepare("SELECT id,name,email FROM contacts ORDER BY name COLLATE NOCASE,email")
            .map_err(err)?;
        let rows = query
            .query_map([], |r| {
                Ok(Contact {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    email: r.get(2)?,
                })
            })
            .map_err(err)?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)
    }
    pub fn save_contact(&self, contact: &Contact) -> Result<()> {
        let email = contact.email.trim();
        if email.parse::<lettre::Address>().is_err() || contact.name.contains(['\r', '\n']) {
            return Err("请填写有效的联系人邮箱和姓名".into());
        }
        if contact.id.trim().is_empty() {
            return Err("联系人标识不能为空".into());
        }
        self.db()?.execute("INSERT INTO contacts(id,name,email) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email",
            params![contact.id,contact.name.trim(),email]).map_err(|e| match e {
                rusqlite::Error::SqliteFailure(ref code, _) if code.code == rusqlite::ErrorCode::ConstraintViolation => "该邮箱已存在于通讯录中".to_string(),
                other => err(other),
            })?;
        Ok(())
    }
    pub fn contact_suggestions(&self) -> Result<Vec<Address>> {
        let mut addresses = BTreeMap::<String, (Address, u32)>::new();
        let db = self.db()?;
        let mut query = db
            .prepare("SELECT data FROM message_listing ORDER BY rowid DESC LIMIT 1000")
            .map_err(err)?;
        for row in query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(err)?
        {
            let mail: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
            for value in [&mail.sender, &mail.recipients] {
                for address in archive::addresses(value).unwrap_or_default() {
                    if address.email.parse::<lettre::Address>().is_err() {
                        continue;
                    }
                    let key = address.email.to_lowercase();
                    let entry = addresses.entry(key).or_insert((address, 0));
                    entry.1 += 1;
                }
            }
        }
        for c in self.contacts()? {
            addresses.insert(
                c.email.to_lowercase(),
                (
                    Address {
                        name: c.name,
                        email: c.email,
                    },
                    u32::MAX,
                ),
            );
        }
        let mut items: Vec<_> = addresses.into_values().collect();
        items.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.email.cmp(&b.0.email)));
        Ok(items.into_iter().take(200).map(|(a, _)| a).collect())
    }
    pub fn outbox(&self) -> Result<Vec<OutboxRecord>> {
        let db = self.db()?;
        let mut query = db.prepare("SELECT id,status,data,error,updated_at,raw,scheduled_at FROM outbox ORDER BY CASE WHEN status IN ('scheduled','overdue','paused') THEN 0 ELSE 1 END,scheduled_at, rowid DESC LIMIT 100").map_err(err)?;
        let rows = query
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Vec<u8>>(5)?,
                    r.get::<_, String>(6)?,
                ))
            })
            .map_err(err)?;
        let mut out = Vec::new();
        for row in rows {
            let (id, status, data, error, updated_at, raw, scheduled_at) = row.map_err(err)?;
            let draft: Compose = serde_json::from_str(&data).map_err(err)?;
            let hash = archive::digest(&raw);
            let exists: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM messages WHERE account_id=?1 AND hash=?2)",
                    params![draft.account_id, hash],
                    |r| r.get(0),
                )
                .map_err(err)?;
            let archived = exists && archive::read_raw(&self.root, &hash).is_ok();
            let server_copy = self.sent_upload(&id)?;
            let server_copy_available = self
                .account(&draft.account_id)
                .is_ok_and(|a| a.enabled && a.protocol == "imap");
            out.push(OutboxRecord {
                id,
                status,
                draft,
                error,
                updated_at,
                archived,
                scheduled_at,
                server_copy,
                server_copy_available,
            });
        }
        Ok(out)
    }
    pub fn outbox_draft(&self, id: &str, confirm_duplicate: bool) -> Result<Compose> {
        let db = self.db()?;
        let (status, data, raw): (String, String, Vec<u8>) = db
            .query_row(
                "SELECT status,data,raw FROM outbox WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        if status != "failed" && status != "uncertain" {
            return Err("这条发送记录不能重新发送".into());
        }
        if status == "uncertain" && !confirm_duplicate {
            return Err("请先检查服务端已发送文件夹，并确认仍要准备重发".into());
        }
        self.account(
            &serde_json::from_str::<Compose>(&data)
                .map_err(err)?
                .account_id,
        )?;
        let draft = self.recover_outbox_draft(&data, &raw)?;
        self.save_draft(&draft)?;
        // Preparing a draft never sends it; retain the original protected record.
        Ok(draft)
    }
    pub fn archive_outbox(&self, id: &str) -> Result<()> {
        let (status, data, raw): (String, String, Vec<u8>) = self
            .db()?
            .query_row(
                "SELECT status,data,raw FROM outbox WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        if status != "sent" {
            return Err("仅 SMTP 已确认的邮件可恢复为已发送存档".into());
        }
        let draft: Compose = serde_json::from_str(&data).map_err(err)?;
        let mut account = self.account(&draft.account_id)?;
        // This is an explicit local recovery, independent of received-mail retention.
        account.save_locally = true;
        self.ingest(&account, "Sent", id, &raw, true)?;
        if let Some(upload) = self.sent_upload(id)?.filter(|u| {
            u.status == "completed"
                && !u.server_message_id.is_empty()
                && u.identity == crate::operations::identity(&account)
        }) {
            self.db()?.execute("UPDATE messages SET data=json_set(data,'$.serverMessageId',?3) WHERE id=(SELECT mail_id FROM sources WHERE account_id=?1 AND folder='Sent' AND remote_id=?2)",params![account.id,id,upload.server_message_id]).map_err(err)?;
        }
        self.db()?
            .execute("DELETE FROM drafts WHERE id=?1", [id])
            .map_err(err)?;
        Ok(())
    }
}
