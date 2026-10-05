use crate::{archive, models::*, store::Store};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

pub struct ScheduledMail {
    pub draft: Compose,
    pub raw: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        network,
        tests::{account, draft},
    };
    fn setup() -> (tempfile::TempDir, Store, DateTime<Utc>) {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::new(dir.path().into()).unwrap();
        s.save_account(&account()).unwrap();
        (
            dir,
            s,
            DateTime::parse_from_rfc3339("2026-10-01T02:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        )
    }
    #[test]
    fn scheduled_send_survives_restart_and_source_attachment_removal() {
        let (dir, s, now) = setup();
        let mut d = draft();
        let path = dir.path().join("report.txt");
        std::fs::write(&path, b"frozen attachment").unwrap();
        d.attachments.push(path.to_string_lossy().into());
        d.format = "markdown".into();
        d.source = "**Alex**".into();
        let raw = network::build_message(&account(), &d).unwrap().formatted();
        s.save_draft(&d).unwrap();
        s.schedule_mail(&d, &raw, "2026-10-01T10:01:00+08:00", now)
            .unwrap();
        assert!(s.drafts().unwrap().is_empty());
        assert!(s.save_draft(&d).is_err());
        assert!(s
            .schedule_mail(&d, &raw, "2026-10-01T02:01:00Z", now)
            .is_err());
        std::fs::remove_file(path).unwrap();
        let s = Store::new(dir.path().into()).unwrap();
        assert_eq!(s.outbox().unwrap()[0].status, "scheduled");
        assert!(s.claim_scheduled(now).unwrap().is_none());
        let due = now + chrono::Duration::minutes(1);
        let send = s.claim_scheduled(due).unwrap().unwrap();
        assert_eq!(send.draft.source, "**Alex**");
        assert!(s.claim_scheduled(due).unwrap().is_none());
        network::deliver_scheduled(&s, send, |envelope, raw| {
            assert_eq!(envelope.to().len(), 3);
            let p = mailparse::parse_mail(raw).unwrap();
            use mailparse::MailHeaderMap;
            assert!(p.headers.get_first_value("Bcc").is_none());
            assert_eq!(p.headers.get_first_value("Date").unwrap(), due.to_rfc2822());
            let (_, html, attachments) = archive::parse(raw, &account(), "Sent").unwrap();
            assert!(html.contains("<strong>Alex</strong>"));
            assert_eq!(
                archive::attachment(raw, attachments[0].index).unwrap(),
                b"frozen attachment"
            );
            Ok(())
        })
        .unwrap();
        let record = &s.outbox().unwrap()[0];
        assert_eq!(record.status, "sent");
        assert!(record.archived);
        assert!(s.cancel_schedule(&d.id).is_err());
        assert!(s
            .reschedule_mail(&d.id, "2026-10-02T02:00:00Z", due)
            .is_err());
    }
    #[test]
    fn overdue_pause_corruption_and_explicit_reschedule_never_auto_send() {
        let (_dir, s, now) = setup();
        let d = draft();
        let raw = network::build_message(&account(), &d).unwrap().formatted();
        assert!(s.schedule_mail(&d, &raw, "yesterday", now).is_err());
        assert!(s.schedule_mail(&d, &raw, &now.to_rfc3339(), now).is_err());
        s.schedule_mail(
            &d,
            &raw,
            &(now + chrono::Duration::minutes(1)).to_rfc3339(),
            now,
        )
        .unwrap();
        let late = now + chrono::Duration::minutes(7);
        assert!(s.claim_scheduled(late).unwrap().is_none());
        assert_eq!(s.outbox().unwrap()[0].status, "overdue");
        s.reschedule_mail(
            &d.id,
            &(late + chrono::Duration::minutes(1)).to_rfc3339(),
            late,
        )
        .unwrap();
        let mut a = account();
        a.enabled = false;
        s.save_account(&a).unwrap();
        assert!(s
            .claim_scheduled(late + chrono::Duration::minutes(1))
            .unwrap()
            .is_none());
        assert_eq!(s.outbox().unwrap()[0].status, "paused");
        a.enabled = true;
        s.save_account(&a).unwrap();
        assert!(s
            .claim_scheduled(late + chrono::Duration::minutes(2))
            .unwrap()
            .is_none());
        s.reschedule_mail(
            &d.id,
            &(late + chrono::Duration::minutes(3)).to_rfc3339(),
            late,
        )
        .unwrap();
        s.db()
            .unwrap()
            .execute("UPDATE outbox SET raw=?1", [b"corrupt".as_slice()])
            .unwrap();
        assert!(s
            .claim_scheduled(late + chrono::Duration::minutes(3))
            .unwrap()
            .is_none());
        assert_eq!(s.outbox().unwrap()[0].status, "failed");
        assert!(s.outbox().unwrap()[0].error.contains("校验失败"));
    }
    #[test]
    fn cancelling_restores_frozen_attachments_even_after_account_removal() {
        let (dir, s, now) = setup();
        let mut d = draft();
        d.quote = Some(QuotedMail {
            kind: "forward".into(),
            included: true,
            sender: "lin@example.com".into(),
            recipients: String::new(),
            date: now.to_rfc3339(),
            subject: "Report".into(),
            body: "Original report".into(),
            html: "<table><tr><td>Original report</td></tr></table>".into(),
        });
        d.delivery_body = Some("Hello Alex\nOriginal report".into());
        d.delivery_html = Some(format!("{}{}", d.html, d.quote.as_ref().unwrap().html));
        let path = dir.path().join("report.txt");
        std::fs::write(&path, b"original bytes").unwrap();
        d.attachments.push(path.to_string_lossy().into());
        let raw = network::build_message(&account(), &d).unwrap().formatted();
        s.schedule_mail(&d, &raw, "2026-10-01T02:01:00Z", now)
            .unwrap();
        std::fs::remove_file(path).unwrap();
        s.remove_account(&account().id).unwrap();
        let s = Store::new(dir.path().into()).unwrap();
        let restored = s.cancel_schedule(&d.id).unwrap();
        assert_ne!(restored.id, d.id);
        assert_eq!(restored.html, d.html);
        assert_eq!(restored.body, d.body);
        assert!(restored.quote.as_ref().unwrap().included);
        assert_eq!(
            restored.quote.as_ref().unwrap().html,
            d.quote.as_ref().unwrap().html
        );
        assert_eq!(restored.delivery_html, d.delivery_html);
        assert_eq!(
            std::fs::read(&restored.attachments[0]).unwrap(),
            b"original bytes"
        );
        assert_eq!(s.outbox().unwrap()[0].status, "cancelled");
        assert!(s
            .claim_scheduled(now + chrono::Duration::minutes(1))
            .unwrap()
            .is_none());
        assert_eq!(s.drafts().unwrap().len(), 1);
    }
    #[test]
    fn interrupted_or_unconfirmed_scheduled_sends_require_manual_duplicate_confirmation() {
        let (dir, s, now) = setup();
        let d = draft();
        let raw = network::build_message(&account(), &d).unwrap().formatted();
        s.schedule_mail(&d, &raw, "2026-10-01T02:01:00Z", now)
            .unwrap();
        let send = s
            .claim_scheduled(now + chrono::Duration::minutes(1))
            .unwrap()
            .unwrap();
        network::deliver_scheduled(&s, send, |_, _| {
            Err(("uncertain", "connection lost after DATA".into()))
        })
        .unwrap_err();
        assert_eq!(s.outbox().unwrap()[0].status, "uncertain");
        assert!(s
            .claim_scheduled(now + chrono::Duration::minutes(2))
            .unwrap()
            .is_none());
        assert!(s.outbox_draft(&d.id, false).is_err());
        assert!(s.outbox_draft(&d.id, true).is_ok());
        s.db()
            .unwrap()
            .execute("UPDATE outbox SET status='sending'", [])
            .unwrap();
        let restarted = Store::new(dir.path().into()).unwrap();
        assert_eq!(restarted.outbox().unwrap()[0].status, "uncertain");
        assert!(restarted
            .claim_scheduled(now + chrono::Duration::minutes(2))
            .unwrap()
            .is_none());
    }
}
fn timestamp(value: &str, now: DateTime<Utc>) -> Result<String> {
    let date = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "定时发送时间无效")?
        .with_timezone(&Utc);
    if date <= now {
        return Err("请选择未来的发送时间".into());
    }
    Ok(date.to_rfc3339_opts(SecondsFormat::Secs, true))
}
fn with_send_date(raw: &[u8], now: DateTime<Utc>) -> Result<Vec<u8>> {
    let end = raw
        .windows(4)
        .position(|v| v == b"\r\n\r\n")
        .ok_or("待发邮件头无效")?;
    let mut result = Vec::new();
    for line in raw[..end].split(|b| *b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        if line.len() >= 5 && line[..5].eq_ignore_ascii_case(b"Date:") {
            result.extend_from_slice(format!("Date: {}", now.to_rfc2822()).as_bytes());
        } else {
            result.extend_from_slice(line);
        }
        result.extend_from_slice(b"\r\n");
    }
    result.extend_from_slice(b"\r\n");
    result.extend_from_slice(&raw[end + 4..]);
    Ok(result)
}
impl Store {
    pub fn schedule_mail(
        &self,
        draft: &Compose,
        raw: &[u8],
        at: &str,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let at = timestamp(at, now)?;
        let account = self.account(&draft.account_id)?;
        if !account.enabled {
            return Err("此账号已暂停，请先启用".into());
        }
        mailparse::parse_mail(raw).map_err(err)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1)",
                [&draft.id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if exists {
            return Err("这封邮件已有发送记录，请先检查发送记录".into());
        }
        tx.execute("INSERT INTO outbox(id,status,data,raw,error,updated_at,scheduled_at,raw_hash) VALUES(?1,'scheduled',?2,?3,'',?4,?5,?6)", params![draft.id,serde_json::to_string(draft).map_err(err)?,raw,now.to_rfc3339(),at,archive::digest(raw)]).map_err(err)?;
        tx.execute("DELETE FROM drafts WHERE id=?1", [&draft.id])
            .map_err(err)?;
        tx.commit().map_err(err)
    }
    // Claim before any network call. A restart cannot silently repeat this send.
    pub fn claim_scheduled(&self, now: DateTime<Utc>) -> Result<Option<ScheduledMail>> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let record: Option<(String,String,Vec<u8>,String,String)> = tx.query_row("SELECT id,data,raw,raw_hash,scheduled_at FROM outbox WHERE status='scheduled' AND scheduled_at<=?1 ORDER BY scheduled_at LIMIT 1", [now.to_rfc3339_opts(SecondsFormat::Secs,true)], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).optional().map_err(err)?;
        let Some((id, data, raw, hash, at)) = record else {
            return Ok(None);
        };
        let draft: Compose = serde_json::from_str(&data).map_err(err)?;
        let due = DateTime::parse_from_rfc3339(&at).map_err(err)?;
        let issue = if now.signed_duration_since(due).num_seconds() > 300 {
            Some((
                "overdue",
                "已错过发送时间，请重新安排时间或取消计划".to_string(),
            ))
        } else if archive::digest(&raw) != hash {
            Some(("failed", "待发原始邮件校验失败，未发送".to_string()))
        } else {
            match self.account(&draft.account_id) {
                Ok(a) if a.enabled => None,
                _ => Some((
                    "paused",
                    "发件账号已暂停或移除，请检查账号后重新安排时间".to_string(),
                )),
            }
        };
        let (status, error) = issue.unwrap_or(("sending", String::new()));
        let raw = if status == "sending" {
            with_send_date(&raw, now)?
        } else {
            raw
        };
        if status == "sending" {
            tx.execute(
                "UPDATE outbox SET raw=?2,raw_hash=?3 WHERE id=?1",
                params![id, raw, archive::digest(&raw)],
            )
            .map_err(err)?;
        }
        tx.execute(
            "UPDATE outbox SET status=?2,error=?3,updated_at=?4 WHERE id=?1 AND status='scheduled'",
            params![id, status, error, now.to_rfc3339()],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok((status == "sending").then_some(ScheduledMail { draft, raw }))
    }
    pub fn reschedule_mail(&self, id: &str, at: &str, now: DateTime<Utc>) -> Result<()> {
        let at = timestamp(at, now)?;
        let db = self.db()?;
        let data: String = db
            .query_row("SELECT data FROM outbox WHERE id=?1", [id], |r| r.get(0))
            .map_err(err)?;
        let draft: Compose = serde_json::from_str(&data).map_err(err)?;
        if !self.account(&draft.account_id)?.enabled {
            return Err("此账号已暂停，请先启用".into());
        }
        let count = db.execute("UPDATE outbox SET status='scheduled',scheduled_at=?2,error='',updated_at=?3 WHERE id=?1 AND status IN ('scheduled','overdue','paused')",params![id,at,now.to_rfc3339()]).map_err(err)?;
        if count != 1 {
            return Err("邮件已进入发送阶段或此计划不可修改".into());
        }
        Ok(())
    }
    pub fn recover_outbox_draft(&self, data: &str, raw: &[u8]) -> Result<Compose> {
        let mut draft: Compose = serde_json::from_str(data).map_err(err)?;
        draft.id = uuid::Uuid::new_v4().to_string();
        let parsed = mailparse::parse_mail(raw).map_err(err)?;
        let mut parts = Vec::new();
        archive::leaves(&parsed, &mut parts);
        let directory = self.root.join("draft-assets").join(&draft.id);
        draft.attachments.clear();
        for (i, part) in parts.into_iter().enumerate() {
            let disposition = part.get_content_disposition();
            let filename = disposition
                .params
                .get("filename")
                .or_else(|| part.ctype.params.get("name"));
            if filename.is_none()
                && disposition.disposition != mailparse::DispositionType::Attachment
            {
                continue;
            }
            let name =
                std::path::Path::new(filename.map(String::as_str).unwrap_or("attachment.bin"))
                    .file_name()
                    .filter(|n| !n.is_empty())
                    .unwrap_or(std::ffi::OsStr::new("attachment.bin"));
            let path = directory.join(format!("{i}-{}", name.to_string_lossy()));
            archive::atomic_write(&path, &part.get_body_raw().map_err(err)?)?;
            draft.attachments.push(path.to_string_lossy().to_string());
        }
        Ok(draft)
    }
    pub fn cancel_schedule(&self, id: &str) -> Result<Compose> {
        let mut db = self.db()?;
        let (status, data, raw): (String, String, Vec<u8>) = db
            .query_row(
                "SELECT status,data,raw FROM outbox WHERE id=?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(err)?;
        if !["scheduled", "overdue", "paused"].contains(&status.as_str()) {
            return Err("邮件已进入发送阶段或此计划不可取消".into());
        }
        let draft = self.recover_outbox_draft(&data, &raw)?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        if tx.execute("UPDATE outbox SET status='cancelled',updated_at=?2 WHERE id=?1 AND status IN ('scheduled','overdue','paused')", params![id,Utc::now().to_rfc3339()]).map_err(err)? != 1 { return Err("此计划已发生变化，请刷新".into()); }
        tx.execute(
            "INSERT INTO drafts(id,data) VALUES(?1,?2)",
            params![draft.id, serde_json::to_string(&draft).map_err(err)?],
        )
        .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(draft)
    }
    pub fn finish_send(&self, id: &str, status: &str, error: &str) -> Result<()> {
        self.db()?.execute("UPDATE outbox SET status=?2,error=?3,updated_at=?4 WHERE id=?1 AND status='sending'",params![id,status,error,Utc::now().to_rfc3339()]).map_err(err)?;
        Ok(())
    }
}
