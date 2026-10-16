//! One Keychain item for all app credentials. Never log a document or a native error.
//! All Keychain calls (including legacy reads) are serialized by the session mutex.
use crate::models::Result;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Mutex, OnceLock},
};

const SERVICE: &str = "dev.maildesk.desktop";
const VAULT: &str = "anser-credentials-v1";
const MAX_BYTES: usize = 2 * 1024 * 1024;
const LOCKED: &str = "无法解锁雁信凭据库；已停止重复授权，请解锁系统钥匙串后退出并重新打开雁信";
const LEGACY: &str = "旧版凭据未获当前应用授权；原记录已保留，请重新连接该账号或重新填写对应密钥，不会逐项弹出钥匙串授权";
const WRITE_FAILED: &str = "凭据库保存失败；请解锁系统钥匙串后退出并重新打开雁信，原有凭据未被替换";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    version: u32,
    // None is a durable tombstone: deletion must never fall back to legacy data.
    entries: BTreeMap<String, Option<String>>,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            entries: BTreeMap::new(),
        }
    }
}
trait Backend {
    fn read(&self, id: &str, interactive: bool) -> Result<Option<String>>;
    fn write(&self, id: &str, raw: &str, interactive: bool) -> Result<()>;
}
struct Native(&'static str);
const NATIVE: Native = Native(SERVICE);

// This setting is process-wide. No other application module may call Keychain
// directly. Restore the previous state, including during error unwinding.
#[cfg(target_os = "macos")]
struct Interaction(u8);
#[cfg(target_os = "macos")]
#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainGetUserInteractionAllowed(state: *mut u8) -> i32;
    fn SecKeychainSetUserInteractionAllowed(state: u8) -> i32;
}
#[cfg(target_os = "macos")]
impl Interaction {
    fn new(allowed: bool) -> Result<Self> {
        let mut previous = 0;
        unsafe {
            if SecKeychainGetUserInteractionAllowed(&mut previous) != 0 {
                return Err(LOCKED.into());
            }
            // Never enable interaction when the host process already disabled it.
            if SecKeychainSetUserInteractionAllowed(u8::from(allowed && previous != 0)) != 0 {
                return Err(LOCKED.into());
            }
        }
        Ok(Self(previous))
    }
}
#[cfg(target_os = "macos")]
impl Drop for Interaction {
    fn drop(&mut self) {
        unsafe {
            SecKeychainSetUserInteractionAllowed(self.0);
        }
    }
}
impl Backend for Native {
    fn read(&self, id: &str, interactive: bool) -> Result<Option<String>> {
        #[cfg(target_os = "macos")]
        let _interaction = Interaction::new(interactive)?;
        #[cfg(not(target_os = "macos"))]
        let _ = interactive;
        let entry = keyring::Entry::new(self.0, id).map_err(|_| LOCKED)?;
        match entry.get_password() {
            Ok(raw) => Ok(Some(raw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(LOCKED.into()),
        }
    }
    fn write(&self, id: &str, raw: &str, interactive: bool) -> Result<()> {
        #[cfg(target_os = "macos")]
        let _interaction = Interaction::new(interactive)?;
        #[cfg(not(target_os = "macos"))]
        let _ = interactive;
        keyring::Entry::new(self.0, id)
            .map_err(|_| WRITE_FAILED)?
            .set_password(raw)
            .map_err(|_| WRITE_FAILED.into())
    }
}

#[derive(Default)]
struct Session {
    // A denied/corrupt initial load is cached too: background workers cannot retry
    // authorization once per account or once per scheduled poll.
    document: Option<Result<Document>>,
    legacy_errors: HashMap<String, String>,
}
#[derive(Clone)]
pub struct Previous(Option<Option<String>>);
impl Session {
    fn document(&mut self, backend: &impl Backend) -> Result<&Document> {
        if self.document.is_none() {
            let loaded = (|| {
                match backend.read(VAULT, true)? {
                    Some(raw) => {
                        if raw.len() > MAX_BYTES {
                            return Err("凭据库超过容量限制".into());
                        }
                        let doc: Document = serde_json::from_str(&raw)
                            .map_err(|_| "凭据库格式损坏，原记录已保留，请勿重新创建或覆盖")?;
                        if doc.version != 1 {
                            return Err("凭据库版本不受支持，请更新雁信".into());
                        }
                        Ok(doc)
                    }
                    None => {
                        let doc = Document::default();
                        // A missing vault must not consume a second interactive operation.
                        // Creation fails clearly if the login Keychain is still locked.
                        backend.write(
                            VAULT,
                            &serde_json::to_string(&doc).map_err(|_| WRITE_FAILED)?,
                            false,
                        )?;
                        Ok(doc)
                    }
                }
            })();
            self.document = Some(loaded);
        }
        self.document
            .as_ref()
            .unwrap()
            .as_ref()
            .map_err(Clone::clone)
    }
    fn commit(&mut self, backend: &impl Backend, doc: Document) -> Result<()> {
        let raw = serde_json::to_string(&doc).map_err(|_| WRITE_FAILED)?;
        if raw.len() > MAX_BYTES {
            return Err("凭据库超过容量限制，未保存本次修改".into());
        }
        backend.write(VAULT, &raw, false)?;
        self.document = Some(Ok(doc));
        Ok(())
    }
    fn get(&mut self, backend: &impl Backend, id: &str) -> Result<String> {
        if let Some(value) = self.document(backend)?.entries.get(id) {
            return value
                .clone()
                .ok_or_else(|| "未保存该项凭据，请重新连接账号或填写密钥".into());
        }
        if let Some(error) = self.legacy_errors.get(id) {
            return Err(error.clone());
        }
        let value = match backend.read(id, false) {
            Ok(value) => value,
            Err(_) => {
                self.legacy_errors.insert(id.into(), LEGACY.into());
                return Err(LEGACY.into());
            }
        };
        // Publish migrated data only after durable write; keep the original item
        // intact for recovery. Future reads prefer the shared vault exclusively.
        let mut doc = self.document(backend)?.clone();
        doc.entries.insert(id.into(), value.clone());
        self.commit(backend, doc)?;
        value.ok_or_else(|| "未保存该项凭据，请重新连接账号或填写密钥".into())
    }
    fn replace(
        &mut self,
        backend: &impl Backend,
        id: &str,
        value: Option<&str>,
    ) -> Result<Previous> {
        let mut doc = self.document(backend)?.clone();
        let previous = Previous(doc.entries.insert(id.into(), value.map(str::to_owned)));
        self.commit(backend, doc)?;
        self.legacy_errors.remove(id);
        Ok(previous)
    }
    fn restore(&mut self, backend: &impl Backend, id: &str, previous: Previous) -> Result<()> {
        let mut doc = self.document(backend)?.clone();
        match previous.0 {
            Some(value) => {
                doc.entries.insert(id.into(), value);
            }
            None => {
                doc.entries.remove(id);
            }
        }
        self.commit(backend, doc)
    }
}
fn session() -> &'static Mutex<Session> {
    static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(Session::default()))
}
/// Optional recovery bridge for users who still have the previous stable signing
/// identity. Production access itself migrates lazily, always without legacy UI.
#[allow(dead_code)]
pub fn migrate(ids: &[String]) -> Result<(usize, usize)> {
    let mut session = session().lock().map_err(|_| LOCKED)?;
    session.document(&NATIVE)?;
    let mut available = 0;
    let mut unavailable = 0;
    for id in ids {
        entry(id)?;
        if session.get(&NATIVE, id).is_ok() {
            available += 1;
        } else {
            unavailable += 1;
        }
    }
    Ok((available, unavailable))
}

pub struct Entry(String);
pub fn entry(id: &str) -> Result<Entry> {
    if id.is_empty() || id == VAULT || id.len() > 512 {
        return Err("凭据标识无效".into());
    }
    Ok(Entry(id.into()))
}
impl Entry {
    pub fn get_password(&self) -> Result<String> {
        session().lock().map_err(|_| LOCKED)?.get(&NATIVE, &self.0)
    }
    pub fn set_password(&self, value: &str) -> Result<()> {
        self.replace(Some(value)).map(|_| ())
    }
    pub fn delete_credential(&self) -> Result<()> {
        self.replace(None).map(|_| ())
    }
    pub fn replace(&self, value: Option<&str>) -> Result<Previous> {
        session()
            .lock()
            .map_err(|_| LOCKED)?
            .replace(&NATIVE, &self.0, value)
    }
    pub fn restore(&self, previous: Previous) -> Result<()> {
        session()
            .lock()
            .map_err(|_| LOCKED)?
            .restore(&NATIVE, &self.0, previous)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    #[derive(Default)]
    struct Fake {
        data: Mutex<BTreeMap<String, String>>,
        calls: Mutex<Vec<(String, bool, bool)>>,
        deny: AtomicBool,
        fail_write: AtomicBool,
        deny_legacy: AtomicBool,
    }
    impl Backend for Fake {
        fn read(&self, id: &str, interactive: bool) -> Result<Option<String>> {
            self.calls
                .lock()
                .unwrap()
                .push((id.into(), interactive, false));
            if self.deny.load(Ordering::SeqCst)
                || (id != VAULT && self.deny_legacy.load(Ordering::SeqCst))
            {
                return Err("native error must not escape".into());
            }
            Ok(self.data.lock().unwrap().get(id).cloned())
        }
        fn write(&self, id: &str, raw: &str, interactive: bool) -> Result<()> {
            self.calls
                .lock()
                .unwrap()
                .push((id.into(), interactive, true));
            if self.fail_write.load(Ordering::SeqCst) {
                return Err(WRITE_FAILED.into());
            }
            self.data.lock().unwrap().insert(id.into(), raw.into());
            Ok(())
        }
    }
    fn seeded() -> Fake {
        let fake = Fake::default();
        fake.data.lock().unwrap().insert(
            VAULT.into(),
            serde_json::to_string(&Document::default()).unwrap(),
        );
        fake
    }
    #[test]
    fn many_kinds_share_one_interactive_read_per_session() {
        let backend = seeded();
        let mut session = Session::default();
        for id in [
            "account-a",
            "account-b",
            "network-proxy",
            "translation-api-key",
        ] {
            session.replace(&backend, id, Some("fake secret")).unwrap();
            assert_eq!(session.get(&backend, id).unwrap(), "fake secret");
        }
        let calls = backend.calls.lock().unwrap();
        assert_eq!(calls.iter().filter(|c| c.1).count(), 1);
        assert!(calls.iter().all(|c| c.0 == VAULT));
    }
    #[test]
    fn new_vault_has_only_one_interactive_operation_too() {
        let backend = Fake::default();
        let mut session = Session::default();
        session
            .replace(&backend, "account", Some("fictional"))
            .unwrap();
        assert_eq!(
            backend.calls.lock().unwrap().iter().filter(|c| c.1).count(),
            1
        );
    }
    #[test]
    fn cancelled_initial_read_is_not_retried_by_accounts_or_writes() {
        let backend = seeded();
        backend.deny.store(true, Ordering::SeqCst);
        let mut session = Session::default();
        for _ in 0..10 {
            assert!(session.get(&backend, "a").is_err());
            assert!(session.get(&backend, "b").is_err());
            assert!(session.replace(&backend, "key", Some("new")).is_err());
        }
        assert_eq!(backend.calls.lock().unwrap().len(), 1);
    }
    #[test]
    fn legacy_migration_is_silent_durable_and_keeps_original() {
        let backend = seeded();
        backend
            .data
            .lock()
            .unwrap()
            .insert("a".into(), "old".into());
        let mut session = Session::default();
        assert_eq!(session.get(&backend, "a").unwrap(), "old");
        session.replace(&backend, "a", Some("refreshed")).unwrap();
        let mut restarted = Session::default();
        assert_eq!(restarted.get(&backend, "a").unwrap(), "refreshed");
        assert_eq!(backend.data.lock().unwrap().get("a").unwrap(), "old");
        let calls = backend.calls.lock().unwrap();
        assert_eq!(calls.iter().filter(|c| c.0 == "a").count(), 1);
        assert!(calls.iter().filter(|c| c.0 == "a").all(|c| !c.1));
    }
    #[test]
    fn failed_legacy_access_does_not_prompt_and_can_be_replaced() {
        let backend = seeded();
        backend.deny_legacy.store(true, Ordering::SeqCst);
        let mut session = Session::default();
        for _ in 0..5 {
            assert_eq!(session.get(&backend, "a").unwrap_err(), LEGACY);
        }
        session.replace(&backend, "a", Some("replacement")).unwrap();
        assert_eq!(session.get(&backend, "a").unwrap(), "replacement");
        assert_eq!(
            backend
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|c| c.0 == "a")
                .count(),
            1
        );
    }
    #[test]
    fn deleted_and_missing_entries_never_resurrect_from_legacy() {
        let backend = seeded();
        backend
            .data
            .lock()
            .unwrap()
            .insert("a".into(), "legacy".into());
        let mut session = Session::default();
        session.replace(&backend, "a", None).unwrap();
        assert!(session.get(&backend, "missing").is_err());
        backend
            .data
            .lock()
            .unwrap()
            .insert("missing".into(), "late legacy".into());
        let mut restarted = Session::default();
        assert!(restarted.get(&backend, "a").is_err());
        assert!(restarted.get(&backend, "missing").is_err());
    }
    #[test]
    fn failed_write_does_not_publish_memory_and_migration_can_retry() {
        let backend = seeded();
        let mut session = Session::default();
        session.replace(&backend, "a", Some("old")).unwrap();
        backend.fail_write.store(true, Ordering::SeqCst);
        assert!(session.replace(&backend, "a", Some("new")).is_err());
        assert_eq!(session.get(&backend, "a").unwrap(), "old");
        backend
            .data
            .lock()
            .unwrap()
            .insert("legacy".into(), "migrated".into());
        assert!(session.get(&backend, "legacy").is_err());
        backend.fail_write.store(false, Ordering::SeqCst);
        assert_eq!(session.get(&backend, "legacy").unwrap(), "migrated");
    }
    #[test]
    fn config_rollback_restores_absence_tombstone_and_previous_value() {
        let backend = seeded();
        backend
            .data
            .lock()
            .unwrap()
            .insert("key".into(), "legacy".into());
        let mut session = Session::default();
        let before = session.replace(&backend, "key", Some("new")).unwrap();
        session.restore(&backend, "key", before).unwrap();
        assert_eq!(session.get(&backend, "key").unwrap(), "legacy");
        session.replace(&backend, "key", None).unwrap();
        let before = session.replace(&backend, "key", Some("next")).unwrap();
        session.restore(&backend, "key", before).unwrap();
        assert!(session.get(&backend, "key").is_err());
    }
    #[test]
    fn corrupt_unknown_and_oversized_documents_fail_closed_without_overwrite() {
        for raw in [
            "{bad".to_string(),
            r#"{"version":2,"entries":{}}"#.to_string(),
            " ".repeat(MAX_BYTES + 1),
        ] {
            let backend = seeded();
            backend
                .data
                .lock()
                .unwrap()
                .insert(VAULT.into(), raw.clone());
            let mut session = Session::default();
            assert!(session.replace(&backend, "a", Some("new")).is_err());
            assert!(session.get(&backend, "a").is_err());
            assert_eq!(backend.data.lock().unwrap().get(VAULT).unwrap(), &raw);
            assert_eq!(backend.calls.lock().unwrap().len(), 1);
        }
    }
    #[test]
    fn concurrent_account_refresh_and_settings_writes_keep_all_values() {
        let backend = Arc::new(seeded());
        let session = Arc::new(Mutex::new(Session::default()));
        let jobs: Vec<_> = (0..20)
            .map(|n| {
                let backend = backend.clone();
                let session = session.clone();
                std::thread::spawn(move || {
                    session
                        .lock()
                        .unwrap()
                        .replace(backend.as_ref(), &format!("id-{n}"), Some("fake"))
                        .unwrap();
                })
            })
            .collect();
        for job in jobs {
            job.join().unwrap();
        }
        let mut restarted = Session::default();
        for n in 0..20 {
            assert_eq!(
                restarted.get(backend.as_ref(), &format!("id-{n}")).unwrap(),
                "fake"
            );
        }
        assert_eq!(
            backend.calls.lock().unwrap().iter().filter(|c| c.1).count(),
            2
        );
    }
    #[test]
    fn oversized_mutation_keeps_existing_credentials() {
        let backend = seeded();
        let mut session = Session::default();
        session.replace(&backend, "a", Some("saved")).unwrap();
        assert!(session
            .replace(&backend, "huge", Some(&"x".repeat(MAX_BYTES)))
            .is_err());
        assert_eq!(session.get(&backend, "a").unwrap(), "saved");
    }
    /// Run manually with a fixed-signed test executable and a random fixture
    /// service. Never touches production credentials, accounts or application DB.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires fixed code signing and native macOS Keychain"]
    fn native_cross_build_fixture() {
        let service = std::env::var("ANSER_KEYCHAIN_PROBE_SERVICE")
            .expect("explicit isolated fixture service required");
        assert!(service.starts_with("dev.maildesk.desktop.probe-"));
        let backend = Native(Box::leak(service.into_boxed_str()));
        let mut session = Session::default();
        let phase = std::env::var("ANSER_KEYCHAIN_PROBE_PHASE").unwrap();
        if phase == "seed" {
            for id in [
                "account-a",
                "account-b",
                "network-proxy",
                "translation-api-key",
            ] {
                session
                    .replace(&backend, id, Some("fictional probe secret"))
                    .unwrap();
            }
        } else {
            for id in [
                "account-a",
                "account-b",
                "network-proxy",
                "translation-api-key",
            ] {
                assert_eq!(session.get(&backend, id).unwrap(), "fictional probe secret");
            }
            session
                .replace(&backend, "account-a", Some("fictional refreshed"))
                .unwrap();
            assert_eq!(
                session.get(&backend, "account-a").unwrap(),
                "fictional refreshed"
            );
        }
        if phase == "cleanup" {
            let _interaction = Interaction::new(false).unwrap();
            keyring::Entry::new(backend.0, VAULT)
                .unwrap()
                .delete_credential()
                .unwrap();
        }
    }
}
