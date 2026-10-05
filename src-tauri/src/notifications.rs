use crate::{archive, models::*, store::Store};
use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::Emitter;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendReceipt {
    pub id: String,
    pub status: String,
    pub subject: String,
    pub message: String,
}
pub fn checkpoint(store: &Store) -> i64 {
    store
        .db()
        .and_then(|db| {
            db.query_row("SELECT COALESCE(MAX(rowid),0) FROM messages", [], |r| {
                r.get(0)
            })
            .map_err(err)
        })
        .unwrap_or(i64::MAX)
}
pub fn incoming(
    store: &Store,
    account: &Account,
    after: i64,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<Vec<Mail>> {
    // An initial import and old folder downloads must not flood Notification Center.
    if account.last_sync.is_none() {
        return Ok(Vec::new());
    }
    let db = store.db()?;
    let mut q = db.prepare("SELECT m.data FROM messages m WHERE m.rowid>?1 AND m.account_id=?2 AND EXISTS(SELECT 1 FROM sources s WHERE s.mail_id=m.id AND s.folder='INBOX' COLLATE NOCASE AND s.active=1)").map_err(err)?;
    let mut mails = Vec::new();
    for row in q
        .query_map(rusqlite::params![after, account.id], |r| {
            r.get::<_, String>(0)
        })
        .map_err(err)?
    {
        let mail: Mail = serde_json::from_str(&row.map_err(err)?).map_err(err)?;
        let recent = chrono::DateTime::parse_from_rfc3339(&mail.date)
            .ok()
            .is_some_and(|date| date >= now - chrono::Duration::hours(24));
        let own = archive::addresses(&mail.sender)
            .unwrap_or_default()
            .iter()
            .any(|a| a.email.eq_ignore_ascii_case(&account.email));
        if recent && !mail.is_read && !mail.trashed && !own {
            mails.push(mail);
        }
    }
    Ok(mails)
}
pub fn show(app: &tauri::AppHandle, title: &str, body: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        // Unlike the plugin's detached desktop task, propagate preparation errors
        // to the test button and activity log. The .app identity is set at startup.
        notify_rust::Notification::new()
            .summary(title)
            .body(body)
            .show()
            .map(|_| ())
            .map_err(err)
    }
    #[cfg(not(target_os = "macos"))]
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(err)
}
pub fn received(store: &Store, app: &tauri::AppHandle, account: &Account, after: i64) {
    if !store
        .preferences()
        .unwrap_or_default()
        .new_mail_notifications
    {
        return;
    }
    if let Ok(mails) = incoming(store, account, after, chrono::Utc::now())
        .and_then(|mails| claim_received(store, mails))
    {
        if mails.is_empty() {
            return;
        }
        let body = if mails.len() == 1 {
            format!("{}\n{}", mails[0].sender, mails[0].subject)
        } else {
            format!("{} 收到 {} 封新邮件", account.email, mails.len())
        };
        if let Err(error) = show(app, "雁信 · 新邮件", &body) {
            let _ = store.log(&format!("系统通知失败：{error}"));
        }
    }
}

// Full sweeps and inbox jobs can overlap their rowid checkpoints. Claim each
// message once per process before notifying, even if both jobs observe it.
fn claim_received(store: &Store, mails: Vec<Mail>) -> Result<Vec<Mail>> {
    static CLAIMED: OnceLock<Mutex<HashSet<(std::path::PathBuf, String)>>> = OnceLock::new();
    let mut claimed = CLAIMED.get_or_init(Default::default).lock().map_err(err)?;
    Ok(mails
        .into_iter()
        .filter(|mail| claimed.insert((store.root.clone(), mail.id.clone())))
        .collect())
}

#[cfg(test)]
mod receiving_tests {
    use super::*;
    #[test]
    fn overlapping_jobs_claim_new_mail_once() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "1:1", &crate::tests::raw(), false)
            .unwrap();
        let mails = store.snapshot(&crate::tests::query()).unwrap().messages;
        let count = std::thread::scope(|scope| {
            let jobs = (0..2)
                .map(|_| scope.spawn(|| claim_received(&store, mails.clone()).unwrap().len()))
                .collect::<Vec<_>>();
            jobs.into_iter()
                .map(|job| job.join().unwrap())
                .sum::<usize>()
        });
        assert_eq!(count, 1);
    }
}
pub fn receipt(store: &Store, draft: &Compose, result: &Result<String>) -> SendReceipt {
    use rusqlite::OptionalExtension;
    let status = store
        .db()
        .and_then(|db| {
            db.query_row("SELECT status FROM outbox WHERE id=?1", [&draft.id], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map_err(err)
        })
        .ok()
        .flatten();
    let status = match status.as_deref() {
        Some("sent") => "sent",
        Some("uncertain" | "sending") => "uncertain",
        Some("failed") => "failed",
        _ if result.is_ok() => "sent",
        _ => "failed",
    };
    let message = match status {
        "sent" => format!(
            "发送服务器已接受这封邮件。{}",
            result.as_ref().cloned().unwrap_or_else(|e| e.clone())
        ),
        "uncertain" => format!(
            "未取得服务器确认，可能已经发送；请先核对发送记录，避免重复发送。{}",
            result.as_ref().err().cloned().unwrap_or_default()
        ),
        _ => result
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "发送失败，草稿已保留".into()),
    };
    SendReceipt {
        id: draft.id.clone(),
        status: status.into(),
        subject: draft.subject.clone(),
        message,
    }
}
pub fn sent(
    store: &Store,
    app: &tauri::AppHandle,
    draft: &Compose,
    result: &Result<String>,
    scheduled: bool,
) {
    let receipt = receipt(store, draft, result);
    let label = match receipt.status.as_str() {
        "sent" => "发送成功",
        "uncertain" => "发送结果未确认",
        _ => "发送失败",
    };
    let _ = store.log(&format!(
        "{label} · {}：{}",
        receipt.subject, receipt.message
    ));
    if scheduled {
        let _ = app.emit("send-result", &receipt);
    }
    if store
        .preferences()
        .unwrap_or_default()
        .send_result_notifications
    {
        if let Err(error) = show(
            app,
            &format!("雁信 · {label}"),
            &format!("{}\n{}", receipt.subject, receipt.message),
        ) {
            let _ = store.log(&format!("系统通知失败：{error}"));
        }
    }
}
