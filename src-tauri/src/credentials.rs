//! One encrypted local vault for all app credentials. Never log a document, key
//! material or a native error. All vault access is serialized by the session mutex.
use crate::models::Result;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File, OpenOptions},
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const SERVICE: &str = "dev.maildesk.desktop";
// macOS binds a Keychain item's ACL and partition list to the creating binary's
// CDHash, so "Always Allow" cannot survive an update of a self-signed app and
// editing an existing item's ACL needs the login password. The vault therefore
// lives in an AES-256-GCM file and only its key is kept in a Keychain item created
// and read by /usr/bin/security, whose identity stays stable across app builds.
const KEY_ITEM: &str = "anser-credentials-key-v2";
const PREVIOUS_VAULT: &str = "anser-credentials-v1";
// Session id for the encrypted file. It is not a Keychain account name.
const VAULT: &str = "anser-credentials-vault";
const VAULT_FILE: &str = "credentials.vault";
const VAULT_MAGIC: &[u8] = b"ANSERVLT";
const VAULT_AAD: &[u8] = b"anser-credentials-vault-v1";
const VAULT_VERSION: u8 = 1;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const LOCKED: &str = "无法解锁雁信凭据库；已停止重复授权，请解锁系统钥匙串后退出并重新打开雁信";
const KEYCHAIN_UNAVAILABLE: &str =
    "无法访问系统登录钥匙串；未读取或改动雁信凭据库，请解锁后退出并重新打开雁信";
const LEGACY: &str = "旧版凭据未获当前应用授权；原记录已保留，请重新连接该账号或重新填写对应密钥，不会逐项弹出钥匙串授权";
const CREATE_FAILED: &str =
    "无法创建本地凭据库；请确认登录钥匙串已解锁且数据目录可写后重新打开雁信，原有凭据未被改动";
const WRITE_FAILED: &str = "凭据库保存失败；原有凭据未被替换。请确认登录钥匙串已解锁且数据目录可写";
const KEY_FAILED: &str = "无法读取本地凭据库密钥；请确认登录钥匙串已解锁。原有凭据未被改动";
const CORRUPT: &str =
    "凭据库文件无法解密或已损坏；原文件已保留，请备份并移走 credentials.vault 后重新填写凭据";

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
fn parse_document(raw: &str) -> Result<Document> {
    if raw.len() > MAX_BYTES {
        return Err("凭据库超过容量限制".into());
    }
    let document: Document = serde_json::from_str(raw)
        .map_err(|_| "凭据库格式损坏，原记录已保留，请勿重新创建或覆盖")?;
    if document.version != 1 {
        return Err("凭据库版本不受支持，请更新雁信".into());
    }
    Ok(document)
}
trait Backend {
    fn read(&self, id: &str, interactive: bool) -> Result<Option<String>>;
    fn write(&self, id: &str, raw: &str, interactive: bool) -> Result<()>;
    /// Create the local vault and its Keychain key so later reads never prompt.
    fn create_vault(&self, raw: &str) -> Result<()>;
}
struct Native(&'static str);
const NATIVE: Native = Native(SERVICE);

static VAULT_PATH: OnceLock<PathBuf> = OnceLock::new();
/// Set once at startup to the directory that owns the local store.
pub fn initialize(root: &Path) {
    let _ = VAULT_PATH.set(root.join(VAULT_FILE));
}
fn vault_path() -> Result<&'static Path> {
    VAULT_PATH
        .get()
        .map(PathBuf::as_path)
        .ok_or_else(|| "本地凭据库尚未初始化".into())
}
fn random<const N: usize>() -> Result<[u8; N]> {
    let mut bytes = [0u8; N];
    getrandom::getrandom(&mut bytes).map_err(|_| "无法生成凭据库随机数")?;
    Ok(bytes)
}
fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        })
}
fn unhex(text: &str) -> Option<[u8; KEY_LEN]> {
    let text = text.trim();
    if text.len() != KEY_LEN * 2 || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut key = [0u8; KEY_LEN];
    for (index, pair) in text.as_bytes().chunks_exact(2).enumerate() {
        key[index] = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
    }
    Some(key)
}
fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| KEY_FAILED)?;
    let nonce: [u8; NONCE_LEN] = random()?;
    let body = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| WRITE_FAILED)?;
    let mut sealed = Vec::with_capacity(VAULT_MAGIC.len() + 1 + NONCE_LEN + body.len());
    sealed.extend_from_slice(VAULT_MAGIC);
    sealed.push(VAULT_VERSION);
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&body);
    Ok(sealed)
}
fn decrypt(key: &[u8; KEY_LEN], sealed: &[u8]) -> Result<Vec<u8>> {
    let header = VAULT_MAGIC.len() + 1 + NONCE_LEN;
    if sealed.len() < header + 16
        || &sealed[..VAULT_MAGIC.len()] != VAULT_MAGIC
        || sealed[VAULT_MAGIC.len()] != VAULT_VERSION
    {
        return Err(CORRUPT.into());
    }
    let nonce = &sealed[VAULT_MAGIC.len() + 1..header];
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CORRUPT)?;
    cipher
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: &sealed[header..],
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| CORRUPT.into())
}
fn write_vault(path: &Path, sealed: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("凭据库路径无效")?;
    fs::create_dir_all(parent).map_err(|_| WRITE_FAILED)?;
    let temp = parent.join(format!(".credentials-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| WRITE_FAILED)?;
        file.write_all(sealed).map_err(|_| WRITE_FAILED)?;
        file.sync_all().map_err(|_| WRITE_FAILED)?;
        fs::rename(&temp, path).map_err(|_| WRITE_FAILED)?;
        File::open(parent)
            .and_then(|folder| folder.sync_all())
            .map_err(|_| WRITE_FAILED)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
fn read_vault(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(sealed) if sealed.len() <= MAX_BYTES + 128 => Ok(Some(sealed)),
        Ok(_) => Err(CORRUPT.into()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(_) => Err(KEY_FAILED.into()),
    }
}
fn read_master_key(service: &str) -> Result<Option<[u8; KEY_LEN]>> {
    match key_item::read(service)? {
        Some(raw) => unhex(&raw).map(Some).ok_or_else(|| KEY_FAILED.into()),
        None => Ok(None),
    }
}
fn ensure_master_key(service: &str) -> Result<[u8; KEY_LEN]> {
    if let Some(key) = read_master_key(service)? {
        return Ok(key);
    }
    let key: [u8; KEY_LEN] = random()?;
    key_item::create(service, &hex(&key))?;
    match read_master_key(service)? {
        Some(check) if check == key => Ok(key),
        _ => Err("无法验证新建的凭据库密钥；已停止写入未验证的凭据库".into()),
    }
}

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
        if id == VAULT {
            let Some(sealed) = read_vault(vault_path()?)? else {
                return Ok(None);
            };
            let key = read_master_key(self.0)?.ok_or(KEY_FAILED)?;
            let plain = decrypt(&key, &sealed)?;
            return String::from_utf8(plain)
                .map(Some)
                .map_err(|_| CORRUPT.into());
        }
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
        if id == VAULT {
            if raw.len() > MAX_BYTES {
                return Err("凭据库超过容量限制，未保存本次修改".into());
            }
            let key = read_master_key(self.0)?.ok_or(KEY_FAILED)?;
            return write_vault(vault_path()?, &encrypt(&key, raw.as_bytes())?);
        }
        #[cfg(target_os = "macos")]
        let _interaction = Interaction::new(interactive)?;
        #[cfg(not(target_os = "macos"))]
        let _ = interactive;
        keyring::Entry::new(self.0, id)
            .map_err(|_| WRITE_FAILED)?
            .set_password(raw)
            .map_err(|_| WRITE_FAILED.into())
    }
    fn create_vault(&self, raw: &str) -> Result<()> {
        if raw.len() > MAX_BYTES {
            return Err("凭据库超过容量限制".into());
        }
        let key = ensure_master_key(self.0)?;
        write_vault(vault_path()?, &encrypt(&key, raw.as_bytes())?)
            .map_err(|_| CREATE_FAILED.into())
    }
}

/// The key item is created and read by `/usr/bin/security` instead of the app:
/// an item owned by this self-signed binary is bound to its CDHash and would ask
/// for the login password again after every rebuild. No secret is passed on the
/// command line; writes go through stdin and reads come from stdout.
#[cfg(target_os = "macos")]
mod key_item {
    use super::{Result, KEYCHAIN_UNAVAILABLE, KEY_FAILED, KEY_ITEM};
    use std::{
        ffi::c_void,
        io::Write,
        process::{Command, Stdio},
        ptr,
    };

    const SECURITY: &str = "/usr/bin/security";
    const UNLOCKED: u32 = 1;
    const NOT_FOUND: i32 = 44;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainCopyDefault(keychain: *mut *const c_void) -> i32;
        fn SecKeychainGetStatus(keychain: *const c_void, status: *mut u32) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: *const c_void);
    }

    fn unlocked() -> Result<()> {
        unsafe {
            let mut keychain = ptr::null();
            if SecKeychainCopyDefault(&mut keychain) != 0 || keychain.is_null() {
                return Err(KEYCHAIN_UNAVAILABLE.into());
            }
            let mut status = 0u32;
            let code = SecKeychainGetStatus(keychain, &mut status);
            CFRelease(keychain);
            if code != 0 || status & UNLOCKED == 0 {
                return Err(KEYCHAIN_UNAVAILABLE.into());
            }
        }
        Ok(())
    }
    pub fn read(service: &str) -> Result<Option<String>> {
        unlocked()?;
        let output = Command::new(SECURITY)
            .args(["find-generic-password", "-w", "-a", KEY_ITEM, "-s", service])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map_err(|_| KEY_FAILED)?;
        if output.status.code() == Some(NOT_FOUND) {
            return Ok(None);
        }
        if !output.status.success() || output.stdout.len() > 256 {
            return Err(KEY_FAILED.into());
        }
        let raw = String::from_utf8(output.stdout).map_err(|_| KEY_FAILED)?;
        Ok(Some(raw.trim_end_matches(['\n', '\r']).to_owned()))
    }
    pub fn create(service: &str, value: &str) -> Result<()> {
        unlocked()?;
        let mut child = Command::new(SECURITY)
            .args([
                "add-generic-password",
                "-U",
                "-a",
                KEY_ITEM,
                "-s",
                service,
                "-w",
            ])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| KEY_FAILED)?;
        if let Some(mut input) = child.stdin.take() {
            input
                .write_all(format!("{value}\n{value}\n").as_bytes())
                .map_err(|_| KEY_FAILED)?;
        }
        if !child.wait().map_err(|_| KEY_FAILED)?.success() {
            return Err(KEY_FAILED.into());
        }
        Ok(())
    }
    /// Manual probe/cleanup entry; the application never removes the key on its own.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn delete(service: &str) -> Result<()> {
        let status = Command::new(SECURITY)
            .args(["delete-generic-password", "-a", KEY_ITEM, "-s", service])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|_| KEY_FAILED)?;
        if status.success() || status.code() == Some(NOT_FOUND) {
            Ok(())
        } else {
            Err(KEY_FAILED.into())
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod key_item {
    use super::{Result, KEY_FAILED, KEY_ITEM};
    pub fn read(service: &str) -> Result<Option<String>> {
        match keyring::Entry::new(service, KEY_ITEM)
            .map_err(|_| KEY_FAILED)?
            .get_password()
        {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(KEY_FAILED.into()),
        }
    }
    pub fn create(service: &str, value: &str) -> Result<()> {
        keyring::Entry::new(service, KEY_ITEM)
            .map_err(|_| KEY_FAILED)?
            .set_password(value)
            .map_err(|_| KEY_FAILED.into())
    }
    /// Manual probe/cleanup entry; the application never removes the key on its own.
    #[allow(dead_code)]
    pub fn delete(service: &str) -> Result<()> {
        match keyring::Entry::new(service, KEY_ITEM)
            .map_err(|_| KEY_FAILED)?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(KEY_FAILED.into()),
        }
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
            self.document = Some(Self::load(backend));
        }
        self.document
            .as_ref()
            .unwrap()
            .as_ref()
            .map_err(Clone::clone)
    }
    /// The local vault must always be readable without authorization. The only
    /// interactive step is the one-time import of the previous Keychain item.
    fn load(backend: &impl Backend) -> Result<Document> {
        match backend.read(VAULT, false)? {
            Some(raw) => parse_document(&raw),
            None => {
                // The previous vault may still need one system authorization and a
                // rebuilt binary may be denied silently. Never block every later
                // credential on that: start empty and leave the old item intact so
                // it can still be inspected or recovered manually.
                let previous = backend
                    .read(PREVIOUS_VAULT, true)
                    .ok()
                    .flatten()
                    .and_then(|raw| parse_document(&raw).ok());
                let document = previous.unwrap_or_default();
                let raw = serde_json::to_string(&document).map_err(|_| WRITE_FAILED)?;
                if raw.len() > MAX_BYTES {
                    return Err("凭据库超过容量限制".into());
                }
                backend.create_vault(&raw)?;
                // Never publish a vault that cannot be read back: a failed
                // verification leaves the previous item in charge.
                match backend.read(VAULT, false)? {
                    Some(raw) => parse_document(&raw),
                    None => Err("凭据库创建后无法读取；已停止使用未验证的凭据库".into()),
                }
            }
        }
    }
    fn commit(&mut self, backend: &impl Backend, doc: Document, interactive: bool) -> Result<()> {
        let raw = serde_json::to_string(&doc).map_err(|_| WRITE_FAILED)?;
        if raw.len() > MAX_BYTES {
            return Err("凭据库超过容量限制，未保存本次修改".into());
        }
        backend.write(VAULT, &raw, interactive)?;
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
        self.commit(backend, doc, false)?;
        value.ok_or_else(|| "未保存该项凭据，请重新连接账号或填写密钥".into())
    }
    fn replace(
        &mut self,
        backend: &impl Backend,
        id: &str,
        value: Option<&str>,
    ) -> Result<Previous> {
        self.replace_with(backend, id, value, false)
    }
    fn replace_with(
        &mut self,
        backend: &impl Backend,
        id: &str,
        value: Option<&str>,
        interactive: bool,
    ) -> Result<Previous> {
        let mut doc = self.document(backend)?.clone();
        let previous = Previous(doc.entries.insert(id.into(), value.map(str::to_owned)));
        self.commit(backend, doc, interactive)?;
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
        self.commit(backend, doc, false)
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
    if id.is_empty() || [VAULT, KEY_ITEM, PREVIOUS_VAULT].contains(&id) || id.len() > 512 {
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
    /// Explicit user action. The local vault never prompts; this only permits the
    /// one-time read of a previous Keychain item that still needs authorization.
    /// Background refresh must not call this.
    pub fn set_password_interactive(&self, value: &str) -> Result<()> {
        self.replace_interactive(Some(value)).map(|_| ())
    }
    pub fn replace_interactive(&self, value: Option<&str>) -> Result<Previous> {
        session()
            .lock()
            .map_err(|_| LOCKED)?
            .replace_with(&NATIVE, &self.0, value, true)
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
        fn create_vault(&self, raw: &str) -> Result<()> {
            self.write(VAULT, raw, false)
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
    fn prompt_free_vault_never_requests_keychain_interaction() {
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
        assert!(calls.iter().all(|c| !c.1 && c.0 == VAULT));
    }

    #[test]
    fn previous_vault_migrates_with_one_interactive_read() {
        let backend = Fake::default();
        let mut previous = Document::default();
        previous
            .entries
            .insert("account-a".into(), Some("fake secret".into()));
        backend.data.lock().unwrap().insert(
            PREVIOUS_VAULT.into(),
            serde_json::to_string(&previous).unwrap(),
        );
        let mut session = Session::default();
        assert_eq!(session.get(&backend, "account-a").unwrap(), "fake secret");
        assert!(backend.data.lock().unwrap().contains_key(VAULT));
        session
            .replace(&backend, "account-b", Some("other secret"))
            .unwrap();
        assert_eq!(session.get(&backend, "account-b").unwrap(), "other secret");
        let calls = backend.calls.lock().unwrap();
        let previous_reads: Vec<_> = calls.iter().filter(|c| c.0 == PREVIOUS_VAULT).collect();
        assert_eq!(previous_reads.len(), 1);
        assert!(previous_reads[0].1);
        assert_eq!(calls.iter().filter(|c| c.1).count(), 1);
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
    fn unreadable_previous_vault_does_not_block_new_credentials() {
        for corrupt in [false, true] {
            let backend = Fake::default();
            if corrupt {
                backend
                    .data
                    .lock()
                    .unwrap()
                    .insert(PREVIOUS_VAULT.into(), "{bad".into());
            } else {
                backend.deny_legacy.store(true, Ordering::SeqCst);
            }
            let mut session = Session::default();
            session
                .replace(&backend, "account", Some("fictional"))
                .unwrap();
            let mut restarted = Session::default();
            assert_eq!(restarted.get(&backend, "account").unwrap(), "fictional");
            let calls = backend.calls.lock().unwrap();
            let previous: Vec<_> = calls.iter().filter(|c| c.0 == PREVIOUS_VAULT).collect();
            assert_eq!(previous.len(), 1);
            assert!(previous[0].1);
            if corrupt {
                assert_eq!(
                    backend.data.lock().unwrap().get(PREVIOUS_VAULT).unwrap(),
                    "{bad"
                );
            }
        }
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
            0
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
    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("anser-credentials-{}-{name}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    #[test]
    fn vault_ciphertext_roundtrips_and_rejects_tampering() {
        let key = [7u8; KEY_LEN];
        let plaintext = b"fictional probe secret";
        let sealed = encrypt(&key, plaintext).unwrap();
        assert!(!sealed
            .windows(plaintext.len())
            .any(|window| window == plaintext));
        assert_eq!(decrypt(&key, &sealed).unwrap(), plaintext);
        let mut tampered = sealed.clone();
        *tampered.last_mut().unwrap() ^= 1;
        assert_eq!(decrypt(&key, &tampered).unwrap_err(), CORRUPT);
        assert_eq!(decrypt(&[8u8; KEY_LEN], &sealed).unwrap_err(), CORRUPT);
        assert_eq!(
            decrypt(&key, &sealed[..sealed.len() - 1]).unwrap_err(),
            CORRUPT
        );
        let mut header = sealed.clone();
        header[VAULT_MAGIC.len()] = VAULT_VERSION + 1;
        assert_eq!(decrypt(&key, &header).unwrap_err(), CORRUPT);
        assert_eq!(decrypt(&key, VAULT_MAGIC).unwrap_err(), CORRUPT);
    }
    #[test]
    fn key_hex_roundtrip_rejects_invalid_text() {
        let key = [0xab; KEY_LEN];
        let text = hex(&key);
        assert_eq!(text.len(), KEY_LEN * 2);
        assert_eq!(unhex(&text), Some(key));
        assert_eq!(unhex(&format!(" {text}\r\n")), Some(key));
        assert_eq!(unhex(&text[..text.len() - 1]), None);
        assert_eq!(unhex(&format!("zz{}", &text[2..])), None);
        assert_eq!(unhex(""), None);
    }
    #[test]
    fn vault_file_is_private_and_replaced_atomically() {
        let dir = scratch("vault-file");
        let path = dir.join(VAULT_FILE);
        assert_eq!(read_vault(&path).unwrap(), None);
        let key = [1u8; KEY_LEN];
        let first = encrypt(&key, b"one").unwrap();
        write_vault(&path, &first).unwrap();
        assert_eq!(read_vault(&path).unwrap(), Some(first));
        let second = encrypt(&key, b"two").unwrap();
        write_vault(&path, &second).unwrap();
        assert_eq!(read_vault(&path).unwrap(), Some(second));
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|item| item.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from(VAULT_FILE)]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let oversized = dir.join("oversized");
        fs::write(&oversized, vec![0u8; MAX_BYTES + 129]).unwrap();
        assert_eq!(read_vault(&oversized).unwrap_err(), CORRUPT);
        fs::remove_dir_all(&dir).unwrap();
    }

    /// Run manually as three separate builds: `seed`, then recompile and `read`,
    /// then `cleanup`. Interaction stays disabled, so a required prompt fails.
    /// Never touches production credentials, accounts or application DB.
    #[cfg(target_os = "macos")]
    fn fixture() -> Native {
        let service = std::env::var("ANSER_KEYCHAIN_PROBE_SERVICE")
            .expect("explicit isolated fixture service required");
        assert!(service.starts_with("dev.maildesk.desktop.probe-"));
        let dir = std::env::var("ANSER_KEYCHAIN_PROBE_DIR")
            .expect("explicit isolated fixture directory required");
        initialize(Path::new(&dir));
        Native(Box::leak(service.into_boxed_str()))
    }
    #[cfg(target_os = "macos")]
    fn cleanup(backend: &Native) {
        key_item::delete(backend.0).unwrap();
        match fs::remove_file(vault_path().unwrap()) {
            Ok(()) => {}
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => panic!("{error}"),
        }
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires native macOS Keychain and an explicit fixture service"]
    fn native_prompt_free_vault_fixture() {
        let backend = fixture();
        let phase = std::env::var("ANSER_KEYCHAIN_PROBE_PHASE").unwrap();
        if phase == "seed" {
            backend.create_vault("fictional probe secret").unwrap();
            assert_eq!(
                backend.read(VAULT, false).unwrap().as_deref(),
                Some("fictional probe secret")
            );
        } else if phase == "read" {
            let read = backend.read(VAULT, false);
            eprintln!("probe read {read:?}");
            assert_eq!(read.unwrap().as_deref(), Some("fictional probe secret"));
            backend.write(VAULT, "fictional refreshed", false).unwrap();
            assert_eq!(
                backend.read(VAULT, false).unwrap().as_deref(),
                Some("fictional refreshed")
            );
        } else if phase == "cleanup" {
            cleanup(&backend);
        } else {
            panic!("unknown probe phase");
        }
    }

    /// Run manually with a rebuilt binary and the same fixture service and
    /// directory. Never touches production credentials, accounts or application DB.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "requires native macOS Keychain and an explicit fixture service"]
    fn native_cross_build_fixture() {
        let backend = fixture();
        let mut session = Session::default();
        let phase = std::env::var("ANSER_KEYCHAIN_PROBE_PHASE").unwrap();
        let ids = [
            "account-a",
            "account-b",
            "network-proxy",
            "translation-api-key",
        ];
        if phase == "seed" {
            for id in ids {
                session
                    .replace(&backend, id, Some("fictional probe secret"))
                    .unwrap();
            }
        } else if phase == "read" {
            for id in ids {
                assert_eq!(session.get(&backend, id).unwrap(), "fictional probe secret");
            }
            session
                .replace(&backend, "account-a", Some("fictional refreshed"))
                .unwrap();
            assert_eq!(
                session.get(&backend, "account-a").unwrap(),
                "fictional refreshed"
            );
        } else if phase == "cleanup" {
            cleanup(&backend);
        } else {
            panic!("unknown probe phase");
        }
    }
}
