use crate::{models::*, store::Store};
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct NotificationOpen(Mutex<Option<String>>);
impl NotificationOpen {
    pub fn queue(&self, token: &str) -> Result<()> {
        if uuid::Uuid::parse_str(token).is_err() {
            return Err("通知邮件定位信息无效".into());
        }
        // Rapid clicks use the most recent destination, including before the
        // WebView listener is ready. No body or credentials enter the payload.
        *self.0.lock().map_err(err)? = Some(token.into());
        Ok(())
    }
    pub fn take(&self) -> Result<Option<String>> {
        Ok(self.0.lock().map_err(err)?.take())
    }
}
pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS notification_targets(token TEXT PRIMARY KEY, mail_id TEXT NOT NULL, account_id TEXT NOT NULL, created_at INTEGER NOT NULL);").map_err(err)
}
pub fn bind(store: &Store, mail: &Mail) -> Result<String> {
    let mut db = store.db()?;
    let tx = db.transaction().map_err(err)?;
    let token = uuid::Uuid::new_v4().to_string();
    tx.execute(
        "DELETE FROM notification_targets WHERE created_at < unixepoch()-2592000",
        [],
    )
    .map_err(err)?;
    tx.execute(
        "INSERT INTO notification_targets VALUES(?1,?2,?3,unixepoch())",
        params![token, mail.id, mail.account_id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(token)
}
pub fn resolve(store: &Store, token: &str) -> Result<Mail> {
    if uuid::Uuid::parse_str(token).is_err() {
        return Err("通知邮件定位信息无效".into());
    }
    let db = store.db()?;
    let (id, account): (String, String) = db.query_row(
        "SELECT n.mail_id,n.account_id FROM notification_targets n JOIN message_listing m ON m.id=n.mail_id AND m.account_id=n.account_id WHERE n.token=?1 AND n.created_at>=unixepoch()-2592000 AND (json_extract(m.data,'$.savedLocally')=1 OR EXISTS(SELECT 1 FROM trusted_sources s WHERE s.mail_id=m.id AND s.account_id=m.account_id AND s.active=1))",
        [token], |r| Ok((r.get(0)?,r.get(1)?)),
    ).map_err(|_| "这条通知对应的邮件已移除、过期或来源暂不可用".to_string())?;
    let mail = store.mail_metadata(&id)?;
    if mail.account_id != account {
        return Err("通知邮件所属账号已变化".into());
    }
    Ok(mail)
}
pub fn activate(app: &tauri::AppHandle, token: &str) {
    if !token.is_empty() {
        if let Err(error) = app.state::<NotificationOpen>().queue(token) {
            let _ = app.state::<crate::AppState>().store.log(&error);
            return;
        }
    }
    let app = app.clone();
    let handle = app.clone();
    let _ = handle.run_on_main_thread(move || {
        crate::show_main_window(&app);
        let _ = app.emit("notification-mail-available", ());
    });
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use std::{
        ffi::{c_char, CStr, CString},
        sync::OnceLock,
    };
    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    unsafe extern "C" {
        fn anser_notifications_initialize(
            click: extern "C" fn(*const c_char),
            error: extern "C" fn(*const c_char),
        );
        fn anser_notification_show(title: *const c_char, body: *const c_char, token: *const c_char);
    }
    extern "C" fn clicked(token: *const c_char) {
        if token.is_null() {
            return;
        }
        if let Some(app) = APP.get() {
            // The bridge passes a live UTF-8 NSString for the duration of this call.
            activate(app, &unsafe { CStr::from_ptr(token) }.to_string_lossy());
        }
    }
    extern "C" fn failed(error: *const c_char) {
        if error.is_null() {
            return;
        }
        if let Some(app) = APP.get() {
            let _ = app.state::<crate::AppState>().store.log(&format!(
                "系统通知失败：{}",
                unsafe { CStr::from_ptr(error) }.to_string_lossy()
            ));
        }
    }
    pub fn setup(app: &tauri::AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            anser_notifications_initialize(clicked, failed);
        }
    }
    pub fn show(title: &str, body: &str, token: &str) -> Result<()> {
        let title = CString::new(title.replace('\0', " ")).map_err(err)?;
        let body = CString::new(body.replace('\0', " ")).map_err(err)?;
        let token = CString::new(token).map_err(err)?;
        unsafe {
            anser_notification_show(title.as_ptr(), body.as_ptr(), token.as_ptr());
        }
        Ok(())
    }
}
#[cfg(target_os = "macos")]
pub use macos::{setup, show};

// Protocol activations carry only the same opaque, expiring token used by the
// macOS bridge. Never accept a mail id, server UID, file path or arbitrary URL.
#[cfg(any(target_os = "windows", test))]
fn protocol_target(raw: &str) -> Option<Option<String>> {
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "anser"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    match url.host_str()? {
        "open" if url.path().is_empty() || url.path() == "/" => Some(None),
        "notification" => {
            let token = url.path().strip_prefix('/')?;
            let parsed = uuid::Uuid::parse_str(token).ok()?;
            (parsed.to_string() == token).then(|| Some(token.to_string()))
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
pub fn queue_arguments(app: &tauri::AppHandle, args: &[String]) -> bool {
    if let Some(target) = args.iter().filter_map(|arg| protocol_target(arg)).last() {
        activate(app, target.as_deref().unwrap_or(""));
        true
    } else {
        false
    }
}

#[cfg(any(target_os = "windows", test))]
fn toast_xml(title: &str, body: &str, token: &str) -> Result<String> {
    let launch = if token.is_empty() {
        "anser://open".to_string()
    } else {
        if uuid::Uuid::parse_str(token).is_err() {
            return Err("通知邮件定位信息无效".into());
        }
        format!("anser://notification/{token}")
    };
    let escape = |text: &str| {
        text.chars()
            .filter(|c| {
                (*c >= ' ' || matches!(c, '\t' | '\r' | '\n'))
                    && !matches!(c, '\u{fffe}' | '\u{ffff}')
            })
            .take(4000)
            .collect::<String>()
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    };
    Ok(format!("<toast activationType=\"protocol\" launch=\"{launch}\"><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>", escape(title), escape(body)))
}

#[cfg(target_os = "windows")]
pub fn show(title: &str, body: &str, token: &str) -> Result<()> {
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        Win32::{
            Foundation::RPC_E_CHANGED_MODE,
            System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
        },
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };
    struct Apartment(bool);
    impl Drop for Apartment {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    RoUninitialize();
                }
            }
        }
    }
    let initialized = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    let apartment = Apartment(initialized.is_ok());
    if initialized.is_err_and(|error| error.code() != RPC_E_CHANGED_MODE) {
        return Err("无法初始化 Windows 系统通知".into());
    }
    let xml = toast_xml(title, body, token)?;
    let result = (|| -> windows::core::Result<()> {
        let document = XmlDocument::new()?;
        document.LoadXml(&HSTRING::from(xml))?;
        let toast = ToastNotification::CreateToastNotification(&document)?;
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(
            "dev.maildesk.desktop",
        ))?;
        notifier.Show(&toast)
    })();
    drop(apartment);
    result.map_err(|_| "无法显示 Windows 系统通知".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_activation_keeps_only_valid_opaque_tokens() {
        let token = uuid::Uuid::new_v4().to_string();
        assert_eq!(
            protocol_target(&format!("anser://notification/{token}")),
            Some(Some(token.clone()))
        );
        assert_eq!(protocol_target("anser://open"), Some(None));
        for value in [
            "https://example.com",
            "anser://notification/INBOX/42",
            "anser://user@open",
            "anser://open?mail=1",
            "anser://open/#x",
            "anser://open:80",
        ] {
            assert_eq!(protocol_target(value), None, "{value}");
        }
        assert_eq!(
            protocol_target(&format!("anser://notification/{token}/extra")),
            None
        );
    }
    #[test]
    fn windows_toast_treats_mail_headers_as_text_and_rejects_invalid_tokens() {
        let xml = toast_xml("<title>&", "\"body\"\0<actions/>", "").unwrap();
        assert!(xml.contains("&lt;title&gt;&amp;"));
        assert!(xml.contains("&quot;body&quot;&lt;actions/&gt;"));
        assert!(!xml.contains('\0'));
        assert!(xml.contains("launch=\"anser://open\""));
        assert!(toast_xml("", "", "mail-id").is_err());
    }
    #[test]
    fn pending_before_listener_keeps_last_click_and_rejects_bad_payload() {
        let queue = NotificationOpen::default();
        let a = uuid::Uuid::new_v4().to_string();
        let b = uuid::Uuid::new_v4().to_string();
        queue.queue(&a).unwrap();
        queue.queue(&b).unwrap();
        assert!(queue.queue("INBOX/42").is_err());
        assert_eq!(queue.take().unwrap(), Some(b));
        assert_eq!(queue.take().unwrap(), None);
    }
    #[test]
    fn resolve_never_reads_body_or_changes_flags_and_rejects_untrusted_remote_source() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "1:1", &crate::tests::raw(), false)
            .unwrap();
        let mut mail = store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .remove(0);
        let token = bind(&store, &mail).unwrap();
        let before = store.mail(&mail.id).unwrap();
        assert!(resolve(&store, &token).unwrap().body.is_empty());
        assert_eq!(
            serde_json::to_string(&store.mail(&mail.id).unwrap()).unwrap(),
            serde_json::to_string(&before).unwrap()
        );
        mail.saved_locally = false;
        store.update_mail(&mail).unwrap();
        assert!(resolve(&store, &token).is_ok());
        store
            .db()
            .unwrap()
            .execute("UPDATE sources SET active=0 WHERE mail_id=?1", [&mail.id])
            .unwrap();
        assert!(resolve(&store, &token).is_err());
        mail.saved_locally = true;
        store.update_mail(&mail).unwrap();
        assert!(resolve(&store, &token).is_ok());
        store
            .db()
            .unwrap()
            .execute("DELETE FROM messages WHERE id=?1", [&mail.id])
            .unwrap();
        assert!(resolve(&store, &token).is_err());
    }
    #[test]
    fn target_survives_restart_but_does_not_guess_missing_or_changed_mail() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "1:1", &crate::tests::raw(), false)
            .unwrap();
        let mail = store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .remove(0);
        let token = bind(&store, &mail).unwrap();
        drop(store);
        let store = Store::new(dir.path().into()).unwrap();
        assert_eq!(resolve(&store, &token).unwrap().id, mail.id);
        assert!(resolve(&store, &uuid::Uuid::new_v4().to_string()).is_err());
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE notification_targets SET account_id='other' WHERE token=?1",
                [&token],
            )
            .unwrap();
        assert!(resolve(&store, &token).is_err());
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE notification_targets SET account_id=?1,created_at=0 WHERE token=?2",
                params![account.id, token],
            )
            .unwrap();
        assert!(resolve(&store, &token).is_err());
    }
}
