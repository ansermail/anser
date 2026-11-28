//! Pure-Rust OpenPGP (rPGP) support for Anser.
//!
//! Security invariants:
//! - Private key material and optional passphrases are stored ONLY in the
//!   AES-256-GCM encrypted `credentials.vault` (never SQLite, backups, or logs).
//! - Encrypted emails are decrypted strictly in memory on demand. Decrypted
//!   plaintext and attachments are NEVER written to SQLite, FTS, or archives.
//! - Original MIME bytes remain immutable.

use crate::{
    archive,
    models::{err, Account, AttachmentInfo, Mail, Result},
    store::Store,
};
use chrono::{DateTime, Duration, TimeZone, Utc};
use mailparse::{MailHeaderMap, ParsedMail};
use pgp::{
    composed::{
        ArmorOptions, CleartextSignedMessage, Deserializable, DetachedSignature, EncryptionCaps,
        KeyType, Message, MessageBuilder, SecretKeyParamsBuilder, SignedPublicKey,
        SignedPublicSubKey, SignedSecretKey, SubkeyParamsBuilder,
    },
    crypto::{ecc_curve::ECCCurve, hash::HashAlgorithm, sym::SymmetricKeyAlgorithm},
    packet::{KeyFlags, Signature},
    types::{CompressionAlgorithm, KeyDetails as _, KeyVersion, Password, Timestamp, VerifyingKey},
};
use rand::thread_rng;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use smallvec::smallvec;
use std::{
    collections::{HashMap, HashSet},
    io::Cursor,
    sync::{Mutex, OnceLock},
};

const MAX_KEY_IMPORT_BYTES: usize = 512 * 1024;
const MAX_PGP_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;

static SESSION_PASSPHRASES: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn session_passphrases() -> &'static Mutex<HashMap<String, String>> {
    SESSION_PASSPHRASES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn lock_session() {
    if let Ok(mut map) = session_passphrases().lock() {
        map.clear();
    }
}

fn get_session_passphrase(fingerprint: &str) -> Option<String> {
    session_passphrases()
        .lock()
        .ok()
        .and_then(|map| map.get(fingerprint).cloned())
}

fn set_session_passphrase(fingerprint: &str, passphrase: String) {
    if let Ok(mut map) = session_passphrases().lock() {
        map.insert(fingerprint.to_string(), passphrase);
    }
}

fn clear_session_passphrase(fingerprint: &str) {
    if let Ok(mut map) = session_passphrases().lock() {
        map.remove(fingerprint);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSecret {
    armored_secret: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    passphrase: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PgpKeyInfo {
    pub fingerprint: String,
    pub key_id: String,
    pub email: String,
    pub emails: Vec<String>,
    pub user_ids: Vec<String>,
    pub account_id: String,
    pub is_secret: bool,
    pub has_saved_passphrase: bool,
    pub is_passphrase_protected: bool,
    pub algorithm: String,
    pub created_at: String,
    pub expires_at: String,
    pub expired: bool,
    pub revoked: bool,
    pub source: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PgpImportResult {
    pub imported: Vec<PgpKeyInfo>,
    pub passphrase_required_fingerprints: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PgpRecipientStatus {
    pub email: String,
    pub has_key: bool,
    pub fingerprint: String,
    pub user_id: String,
    pub expired: bool,
    pub revoked: bool,
    pub algorithm: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PgpComposeCheck {
    pub sender_has_secret_key: bool,
    pub sender_fingerprint: String,
    pub sender_passphrase_needed: bool,
    pub recipients: Vec<PgpRecipientStatus>,
    pub all_recipients_ready: bool,
    pub missing_emails: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PgpMessageInfo {
    pub encrypted: bool,
    /// "none" | "decrypted" | "missingKey" | "passphraseRequired" | "failed"
    pub encryption_state: String,
    /// "none" | "pgpMime" | "inlinePgp"
    pub format: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub decryption_key_fingerprint: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub recipient_key_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub encryption_error: String,
    pub signed: bool,
    /// "none" | "valid" | "invalid" | "missingKey" | "expiredKey" | "revokedKey" | "error"
    pub signature_state: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signer_fingerprint: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signer_key_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signer_user_id: String,
    pub sender_matches_signer: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub signature_error: String,
    pub has_attached_public_key: bool,
}

impl PgpMessageInfo {
    pub fn is_active(&self) -> bool {
        self.encrypted || self.signed || self.has_attached_public_key
    }
}

pub fn init_schema(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS pgp_keys (
            fingerprint TEXT PRIMARY KEY,
            key_id TEXT NOT NULL,
            email TEXT NOT NULL COLLATE NOCASE,
            emails_json TEXT NOT NULL,
            user_ids_json TEXT NOT NULL,
            account_id TEXT NOT NULL DEFAULT '',
            is_secret INTEGER NOT NULL DEFAULT 0,
            is_passphrase_protected INTEGER NOT NULL DEFAULT 0,
            has_saved_passphrase INTEGER NOT NULL DEFAULT 0,
            algorithm TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL DEFAULT '',
            revoked INTEGER NOT NULL DEFAULT 0,
            armored_public TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'manual',
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pgp_keys_email ON pgp_keys(email);
        CREATE INDEX IF NOT EXISTS idx_pgp_keys_account ON pgp_keys(account_id);",
    )
    .map_err(err)
}

#[cfg(test)]
static TEST_SECRETS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

#[cfg(test)]
fn test_secrets() -> &'static Mutex<HashMap<String, String>> {
    TEST_SECRETS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(not(test))]
fn secret_entry(fingerprint: &str) -> Result<crate::credentials::Entry> {
    crate::credentials::entry(&format!("pgp-secret-{}", fingerprint.to_uppercase()))
        .map_err(|_| "无法访问 OpenPGP 私钥凭据库".into())
}

fn read_secret_payload(fingerprint: &str) -> Result<Option<String>> {
    let key = fingerprint.to_uppercase();
    #[cfg(test)]
    {
        return Ok(test_secrets().lock().map_err(err)?.get(&key).cloned());
    }
    #[cfg(not(test))]
    {
        let entry = secret_entry(&key)?;
        match entry.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.contains("未保存") || error.contains("不存在") => Ok(None),
            Err(error) => Err(error),
        }
    }
}

fn load_secret(fingerprint: &str) -> Result<Option<(SignedSecretKey, Option<String>)>> {
    let Some(raw) = read_secret_payload(fingerprint)? else {
        return Ok(None);
    };
    let stored: StoredSecret =
        serde_json::from_str(&raw).map_err(|_| "已保存的 OpenPGP 私钥数据损坏")?;
    let (key, _) = SignedSecretKey::from_string(&stored.armored_secret)
        .map_err(|_| "无法解析已保存的 OpenPGP 私钥")?;
    Ok(Some((key, stored.passphrase)))
}

fn load_secret_armored(fingerprint: &str) -> Result<String> {
    let raw = read_secret_payload(fingerprint)?.ok_or("未找到已保存的 OpenPGP 私钥")?;
    let stored: StoredSecret =
        serde_json::from_str(&raw).map_err(|_| "已保存的 OpenPGP 私钥数据损坏")?;
    Ok(stored.armored_secret)
}

fn save_secret(
    fingerprint: &str,
    armored_secret: String,
    passphrase: Option<String>,
) -> Result<()> {
    let key = fingerprint.to_uppercase();
    let payload = serde_json::to_string(&StoredSecret {
        armored_secret,
        passphrase,
    })
    .map_err(err)?;
    #[cfg(test)]
    {
        test_secrets().lock().map_err(err)?.insert(key, payload);
        return Ok(());
    }
    #[cfg(not(test))]
    {
        let entry = secret_entry(&key)?;
        entry.replace_interactive(Some(&payload))?;
        Ok(())
    }
}

fn delete_secret(fingerprint: &str) -> Result<()> {
    let key = fingerprint.to_uppercase();
    clear_session_passphrase(&key);
    #[cfg(test)]
    {
        test_secrets().lock().map_err(err)?.remove(&key);
        return Ok(());
    }
    #[cfg(not(test))]
    {
        let entry = secret_entry(&key)?;
        let _ = entry.replace_interactive(None);
        Ok(())
    }
}

fn fingerprint_hex(fp: &pgp::types::Fingerprint) -> String {
    hex_upper(fp.as_bytes())
}

fn key_id_hex(id: &pgp::types::KeyId) -> String {
    hex_upper(id.as_ref())
}

fn hex_upper(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut out, b| {
            let _ = write!(out, "{b:02X}");
            out
        })
}

fn normalize_email(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn extract_email_from_uid(uid: &str) -> Option<String> {
    if let Some(start) = uid.rfind('<') {
        if let Some(end) = uid[start + 1..].find('>') {
            let candidate = uid[start + 1..start + 1 + end].trim();
            if candidate.contains('@') && !candidate.contains(char::is_whitespace) {
                return Some(normalize_email(candidate));
            }
        }
    }
    let trimmed = uid.trim();
    if trimmed.contains('@') && !trimmed.contains(char::is_whitespace) {
        return Some(normalize_email(trimmed));
    }
    None
}

fn timestamp_to_rfc3339(ts: Timestamp) -> String {
    let secs = ts.as_secs() as i64;
    Utc.timestamp_opt(secs, 0)
        .single()
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default()
}

fn describe_algorithm(key: &SignedPublicKey) -> String {
    use pgp::crypto::public_key::PublicKeyAlgorithm;
    let primary = match key.primary_key.algorithm() {
        PublicKeyAlgorithm::EdDSALegacy | PublicKeyAlgorithm::Ed25519 => "Ed25519".to_string(),
        PublicKeyAlgorithm::Ed448 => "Ed448".to_string(),
        PublicKeyAlgorithm::RSA | PublicKeyAlgorithm::RSASign | PublicKeyAlgorithm::RSAEncrypt => {
            "RSA".to_string()
        }
        PublicKeyAlgorithm::ECDSA => "ECDSA".to_string(),
        PublicKeyAlgorithm::DSA => "DSA".to_string(),
        other => format!("{other:?}"),
    };
    let sub = key
        .public_subkeys
        .iter()
        .find_map(|sub| match sub.key.algorithm() {
            PublicKeyAlgorithm::ECDH | PublicKeyAlgorithm::X25519 => Some("Curve25519"),
            PublicKeyAlgorithm::X448 => Some("X448"),
            PublicKeyAlgorithm::RSA | PublicKeyAlgorithm::RSAEncrypt => Some("RSA"),
            _ => None,
        });
    match sub {
        Some(enc) if !primary.starts_with(enc) => format!("{primary} / {enc}"),
        _ => primary,
    }
}

fn extract_expiration_and_revocation(key: &SignedPublicKey) -> (String, bool, bool) {
    let revoked = !key.details.revocation_signatures.is_empty();
    let created_secs = key.primary_key.created_at().as_secs() as i64;
    let mut expiration_secs: Option<i64> = None;
    for sig in key
        .details
        .direct_signatures
        .iter()
        .chain(key.details.users.iter().flat_map(|u| u.signatures.iter()))
    {
        if let Some(dur) = sig.key_expiration_time() {
            let secs = dur.as_secs() as i64;
            if secs > 0 {
                expiration_secs = Some(created_secs.saturating_add(secs));
            }
        }
    }
    match expiration_secs {
        Some(exp) => {
            let dt = Utc.timestamp_opt(exp, 0).single();
            let expired = dt.is_some_and(|d| d <= Utc::now());
            (
                dt.map(|d| d.to_rfc3339()).unwrap_or_default(),
                expired,
                revoked,
            )
        }
        None => (String::new(), false, revoked),
    }
}

fn extract_user_ids(key: &SignedPublicKey) -> (Vec<String>, Vec<String>) {
    let mut user_ids = Vec::new();
    let mut emails = Vec::new();
    for user in &key.details.users {
        let uid = String::from_utf8_lossy(user.id.id()).trim().to_string();
        if !uid.is_empty() {
            if let Some(email) = extract_email_from_uid(&uid) {
                if !emails.contains(&email) {
                    emails.push(email);
                }
            }
            if !user_ids.contains(&uid) {
                user_ids.push(uid);
            }
        }
    }
    (user_ids, emails)
}

fn is_secret_key_locked(key: &SignedSecretKey) -> bool {
    key.primary_key.secret_params().is_encrypted()
        || key
            .secret_subkeys
            .iter()
            .any(|s| s.key.secret_params().is_encrypted())
}

fn verify_secret_passphrase(key: &SignedSecretKey, passphrase: &str) -> bool {
    let pw: Password = passphrase.into();
    if key.primary_key.secret_params().is_encrypted()
        && key.primary_key.unlock(&pw, |_, _| Ok(())).is_err()
    {
        return false;
    }
    for sub in &key.secret_subkeys {
        if sub.key.secret_params().is_encrypted() && sub.key.unlock(&pw, |_, _| Ok(())).is_err() {
            return false;
        }
    }
    true
}

fn is_expired_str(expires_at: &str) -> bool {
    if expires_at.trim().is_empty() {
        return false;
    }
    DateTime::parse_from_rfc3339(expires_at)
        .map(|dt| dt.with_timezone(&Utc) <= Utc::now())
        .unwrap_or(false)
}

fn upsert_public_record(
    store: &Store,
    pub_key: &SignedPublicKey,
    account_id: Option<&str>,
    is_secret: Option<bool>,
    is_passphrase_protected: Option<bool>,
    has_saved_passphrase: Option<bool>,
    source: &str,
) -> Result<PgpKeyInfo> {
    let fp = fingerprint_hex(&pub_key.primary_key.fingerprint());
    let key_id = key_id_hex(&pub_key.primary_key.legacy_key_id());
    let (user_ids, emails) = extract_user_ids(pub_key);
    let email = emails.first().cloned().unwrap_or_default();
    let algorithm = describe_algorithm(pub_key);
    let created_at = timestamp_to_rfc3339(pub_key.primary_key.created_at());
    let (expires_at, expired, revoked) = extract_expiration_and_revocation(pub_key);
    let armored_public = pub_key
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| format!("序列化 OpenPGP 公钥失败：{e}"))?;
    let now = Utc::now().to_rfc3339();

    let mut db = store.db()?;
    let tx = db.transaction().map_err(err)?;
    let existing: Option<(String, i64, i64, i64, String)> = tx
        .query_row(
            "SELECT account_id, is_secret, is_passphrase_protected, has_saved_passphrase, source FROM pgp_keys WHERE fingerprint=?1",
            [&fp],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .map_err(err)?;

    let final_account_id = account_id
        .map(str::to_string)
        .or_else(|| existing.as_ref().map(|e| e.0.clone()))
        .unwrap_or_default();
    let final_is_secret = is_secret.unwrap_or_else(|| existing.as_ref().is_some_and(|e| e.1 != 0));
    let final_protected =
        is_passphrase_protected.unwrap_or_else(|| existing.as_ref().is_some_and(|e| e.2 != 0));
    let final_saved_pw =
        has_saved_passphrase.unwrap_or_else(|| existing.as_ref().is_some_and(|e| e.3 != 0));
    let final_source = if existing.as_ref().is_some_and(|e| e.4 == "generated") {
        "generated"
    } else {
        source
    };

    if final_is_secret && !final_account_id.is_empty() {
        tx.execute(
            "UPDATE pgp_keys SET account_id='' WHERE account_id=?1 AND fingerprint!=?2",
            params![final_account_id, fp],
        )
        .map_err(err)?;
    }

    tx.execute(
        "INSERT INTO pgp_keys(
            fingerprint, key_id, email, emails_json, user_ids_json, account_id,
            is_secret, is_passphrase_protected, has_saved_passphrase, algorithm,
            created_at, expires_at, revoked, armored_public, source, updated_at
        ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
        ON CONFLICT(fingerprint) DO UPDATE SET
            key_id=excluded.key_id,
            email=excluded.email,
            emails_json=excluded.emails_json,
            user_ids_json=excluded.user_ids_json,
            account_id=excluded.account_id,
            is_secret=excluded.is_secret,
            is_passphrase_protected=excluded.is_passphrase_protected,
            has_saved_passphrase=excluded.has_saved_passphrase,
            algorithm=excluded.algorithm,
            created_at=excluded.created_at,
            expires_at=excluded.expires_at,
            revoked=excluded.revoked,
            armored_public=excluded.armored_public,
            source=excluded.source,
            updated_at=excluded.updated_at",
        params![
            fp,
            key_id,
            email,
            serde_json::to_string(&emails).map_err(err)?,
            serde_json::to_string(&user_ids).map_err(err)?,
            final_account_id,
            i64::from(final_is_secret),
            i64::from(final_protected),
            i64::from(final_saved_pw),
            algorithm,
            created_at,
            expires_at,
            i64::from(revoked),
            armored_public,
            final_source,
            now
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;

    Ok(PgpKeyInfo {
        fingerprint: fp,
        key_id,
        email,
        emails,
        user_ids,
        account_id: final_account_id,
        is_secret: final_is_secret,
        has_saved_passphrase: final_saved_pw,
        is_passphrase_protected: final_protected,
        algorithm,
        created_at,
        expires_at,
        expired,
        revoked,
        source: final_source.to_string(),
        updated_at: now,
    })
}

pub fn generate_key(
    store: &Store,
    account_id: &str,
    name: &str,
    email: &str,
    algorithm: &str,
    passphrase: Option<&str>,
    expires_days: Option<u32>,
) -> Result<PgpKeyInfo> {
    let email_trimmed = email.trim();
    if email_trimmed.is_empty() || !email_trimmed.contains('@') {
        return Err("生成 OpenPGP 密钥需要有效的邮箱地址".into());
    }
    let user_id = if name.trim().is_empty() {
        format!("<{email_trimmed}>")
    } else {
        format!("{} <{email_trimmed}>", name.trim())
    };
    let pw = passphrase
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let (primary_type, sub_type) = match algorithm {
        "rsa4096" => (KeyType::Rsa(4096), KeyType::Rsa(4096)),
        "rsa2048" => (KeyType::Rsa(2048), KeyType::Rsa(2048)),
        _ => (
            KeyType::Ed25519Legacy,
            KeyType::ECDH(ECCCurve::Curve25519Legacy),
        ),
    };
    let mut sub_builder = SubkeyParamsBuilder::default();
    sub_builder
        .version(KeyVersion::V4)
        .key_type(sub_type)
        .can_encrypt(EncryptionCaps::All);
    if let Some(ref p) = pw {
        sub_builder.passphrase(Some(p.clone()));
    }
    let subkey = sub_builder
        .build()
        .map_err(|e| format!("构造 OpenPGP 加密子密钥参数失败：{e}"))?;

    let mut params = SecretKeyParamsBuilder::default();
    params
        .version(KeyVersion::V4)
        .key_type(primary_type)
        .can_certify(true)
        .can_sign(true)
        .primary_user_id(user_id)
        .preferred_symmetric_algorithms(smallvec![
            SymmetricKeyAlgorithm::AES256,
            SymmetricKeyAlgorithm::AES128,
        ])
        .preferred_hash_algorithms(smallvec![HashAlgorithm::Sha256, HashAlgorithm::Sha512,])
        .preferred_compression_algorithms(smallvec![
            CompressionAlgorithm::ZLIB,
            CompressionAlgorithm::ZIP,
        ])
        .subkeys(vec![subkey]);
    if let Some(ref p) = pw {
        params.passphrase(Some(p.clone()));
    }
    let built = params
        .build()
        .map_err(|e| format!("构造 OpenPGP 主密钥参数失败：{e}"))?;
    let mut rng = thread_rng();
    let secret = built
        .generate(&mut rng)
        .map_err(|e| format!("生成 OpenPGP 密钥对失败：{e}"))?;
    let public = secret.to_public_key();
    let fp = fingerprint_hex(&public.primary_key.fingerprint());
    let armored_secret = secret
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| format!("序列化 OpenPGP 私钥失败：{e}"))?;

    save_secret(&fp, armored_secret, pw.clone())?;
    let mut info = upsert_public_record(
        store,
        &public,
        Some(account_id),
        Some(true),
        Some(pw.is_some()),
        Some(pw.is_some()),
        "generated",
    )?;

    // Record user-requested soft expiration metadata if specified (rPGP v4 builder
    // defaults to non-expiring self-sigs; storing advisory expiration keeps UI clear).
    if let Some(days) = expires_days.filter(|&d| d > 0 && d <= 3650) {
        let exp = (Utc::now() + Duration::days(i64::from(days))).to_rfc3339();
        let db = store.db()?;
        db.execute(
            "UPDATE pgp_keys SET expires_at=?1 WHERE fingerprint=?2",
            params![exp, fp],
        )
        .map_err(err)?;
        info.expires_at = exp;
    }

    let _ = store.log(&format!(
        "已生成 OpenPGP 密钥（{}，指纹后 16 位 {}）",
        info.algorithm, info.key_id
    ));
    Ok(info)
}

pub fn import_keys(
    store: &Store,
    raw: &[u8],
    account_id_hint: Option<&str>,
    passphrase: Option<&str>,
    remember_passphrase: bool,
    source: &str,
) -> Result<PgpImportResult> {
    if raw.is_empty() || raw.len() > MAX_KEY_IMPORT_BYTES {
        return Err("密钥文件为空或超过 512 KB 上限".into());
    }
    let mut imported = Vec::new();
    let mut passphrase_required = Vec::new();
    let accounts = store.accounts().unwrap_or_default();

    let match_account = |emails: &[String]| -> Option<String> {
        if let Some(hint) = account_id_hint.filter(|s| !s.is_empty()) {
            return Some(hint.to_string());
        }
        for account in &accounts {
            let addr = normalize_email(&account.email);
            if emails.iter().any(|e| e == &addr) {
                return Some(account.id.clone());
            }
        }
        None
    };

    let text = std::str::from_utf8(raw).ok();
    let looks_armored = text.is_some_and(|s| s.contains("-----BEGIN PGP "));

    if looks_armored {
        let text = text.unwrap();
        // Parse armored blocks sequentially so a file with mixed public/secret keys works cleanly.
        let mut rest = text;
        while let Some(pos) = rest.find("-----BEGIN PGP ") {
            let block_start = &rest[pos..];
            let end_marker = "-----END PGP ";
            let Some(end_rel) = block_start.find(end_marker) else {
                break;
            };
            let after_end = &block_start[end_rel..];
            let block_len = after_end
                .find('\n')
                .map(|nl| end_rel + nl + 1)
                .unwrap_or(block_start.len());
            let block = &block_start[..block_len];
            rest = &block_start[block_len..];

            if block.starts_with("-----BEGIN PGP PRIVATE KEY BLOCK-----") {
                let (secret, _) = SignedSecretKey::from_string(block)
                    .map_err(|e| format!("无法解析 OpenPGP 私钥：{e}"))?;
                let info = store_imported_secret(
                    store,
                    &secret,
                    &match_account,
                    passphrase,
                    remember_passphrase,
                    source,
                    &mut passphrase_required,
                )?;
                if let Some(info) = info {
                    imported.push(info);
                }
            } else if block.starts_with("-----BEGIN PGP PUBLIC KEY BLOCK-----") {
                let (keys, _) = SignedPublicKey::from_armor_many(Cursor::new(block.as_bytes()))
                    .map_err(|e| format!("无法解析 OpenPGP 公钥：{e}"))?;
                for key_res in keys {
                    let pub_key = key_res.map_err(|e| format!("OpenPGP 公钥格式无效：{e}"))?;
                    let info =
                        upsert_public_record(store, &pub_key, None, None, None, None, source)?;
                    imported.push(info);
                }
            }
        }
    } else {
        // Binary OpenPGP keyring (.gpg / .pgp)
        if let Ok(secret) = SignedSecretKey::from_bytes(Cursor::new(raw)) {
            if let Some(info) = store_imported_secret(
                store,
                &secret,
                &match_account,
                passphrase,
                remember_passphrase,
                source,
                &mut passphrase_required,
            )? {
                imported.push(info);
            }
        } else if let Ok(keys) = SignedPublicKey::from_bytes_many(Cursor::new(raw)) {
            for key_res in keys {
                let pub_key = key_res.map_err(|e| format!("二进制 OpenPGP 公钥无效：{e}"))?;
                let info = upsert_public_record(store, &pub_key, None, None, None, None, source)?;
                imported.push(info);
            }
        }
    }

    if imported.is_empty() && passphrase_required.is_empty() {
        return Err("未在输入中找到有效的 OpenPGP 公钥或私钥".into());
    }
    if !imported.is_empty() {
        let _ = store.log(&format!("已导入 {} 个 OpenPGP 密钥", imported.len()));
    }
    Ok(PgpImportResult {
        imported,
        passphrase_required_fingerprints: passphrase_required,
    })
}

fn store_imported_secret(
    store: &Store,
    secret: &SignedSecretKey,
    match_account: &impl Fn(&[String]) -> Option<String>,
    passphrase: Option<&str>,
    remember_passphrase: bool,
    source: &str,
    passphrase_required: &mut Vec<String>,
) -> Result<Option<PgpKeyInfo>> {
    let public = secret.to_public_key();
    let fp = fingerprint_hex(&public.primary_key.fingerprint());
    let locked = is_secret_key_locked(secret);
    let mut saved_pw: Option<String> = None;
    if locked {
        if let Some(pw) = passphrase.filter(|s| !s.is_empty()) {
            if !verify_secret_passphrase(secret, pw) {
                return Err("私钥密码短语不正确，导入已取消".into());
            }
            if remember_passphrase {
                saved_pw = Some(pw.to_string());
            } else {
                set_session_passphrase(&fp, pw.to_string());
            }
        } else {
            passphrase_required.push(fp.clone());
            // Still import the locked secret key so the user can unlock on demand,
            // or if caller checks `passphrase_required_fingerprints` they can prompt.
        }
    }
    let armored_secret = secret
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| format!("序列化 OpenPGP 私钥失败：{e}"))?;
    save_secret(&fp, armored_secret, saved_pw.clone())?;
    let (_, emails) = extract_user_ids(&public);
    let account_id = match_account(&emails);
    let info = upsert_public_record(
        store,
        &public,
        account_id.as_deref(),
        Some(true),
        Some(locked),
        Some(saved_pw.is_some()),
        source,
    )?;
    Ok(Some(info))
}

pub fn list_keys(store: &Store) -> Result<Vec<PgpKeyInfo>> {
    let db = store.db()?;
    let mut stmt = db
        .prepare(
            "SELECT fingerprint, key_id, email, emails_json, user_ids_json, account_id,
                    is_secret, is_passphrase_protected, has_saved_passphrase, algorithm,
                    created_at, expires_at, revoked, source, updated_at
             FROM pgp_keys
             ORDER BY is_secret DESC, email ASC, updated_at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let emails_json: String = r.get(3)?;
            let user_ids_json: String = r.get(4)?;
            let expires_at: String = r.get(11)?;
            Ok(PgpKeyInfo {
                fingerprint: r.get(0)?,
                key_id: r.get(1)?,
                email: r.get(2)?,
                emails: serde_json::from_str(&emails_json).unwrap_or_default(),
                user_ids: serde_json::from_str(&user_ids_json).unwrap_or_default(),
                account_id: r.get(5)?,
                is_secret: r.get::<_, i64>(6)? != 0,
                is_passphrase_protected: r.get::<_, i64>(7)? != 0,
                has_saved_passphrase: r.get::<_, i64>(8)? != 0,
                algorithm: r.get(9)?,
                created_at: r.get(10)?,
                expired: is_expired_str(&expires_at),
                expires_at,
                revoked: r.get::<_, i64>(12)? != 0,
                source: r.get(13)?,
                updated_at: r.get(14)?,
            })
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(err)?);
    }
    Ok(out)
}

pub fn bind_account_key(store: &Store, account_id: &str, fingerprint: &str) -> Result<()> {
    let mut db = store.db()?;
    let tx = db.transaction().map_err(err)?;
    tx.execute(
        "UPDATE pgp_keys SET account_id='' WHERE account_id=?1",
        [account_id],
    )
    .map_err(err)?;
    if !fingerprint.trim().is_empty() {
        let updated = tx
            .execute(
                "UPDATE pgp_keys SET account_id=?1 WHERE fingerprint=?2 AND is_secret=1",
                params![account_id, fingerprint.trim().to_uppercase()],
            )
            .map_err(err)?;
        if updated == 0 {
            return Err("未找到对应的自有 OpenPGP 私钥".into());
        }
    }
    tx.commit().map_err(err)
}

pub fn export_public_key(store: &Store, fingerprint: &str) -> Result<String> {
    let db = store.db()?;
    db.query_row(
        "SELECT armored_public FROM pgp_keys WHERE fingerprint=?1",
        [fingerprint.trim().to_uppercase()],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "未找到对应的 OpenPGP 公钥".into())
}

pub fn export_secret_key(store: &Store, fingerprint: &str) -> Result<String> {
    let fp = fingerprint.trim().to_uppercase();
    let db = store.db()?;
    let is_secret: Option<i64> = db
        .query_row(
            "SELECT is_secret FROM pgp_keys WHERE fingerprint=?1",
            [&fp],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    if is_secret != Some(1) {
        return Err("该条目仅包含公钥，不含私钥".into());
    }
    load_secret_armored(&fp)
}

pub fn delete_key(store: &Store, fingerprint: &str) -> Result<()> {
    let fp = fingerprint.trim().to_uppercase();
    let db = store.db()?;
    let is_secret: Option<i64> = db
        .query_row(
            "SELECT is_secret FROM pgp_keys WHERE fingerprint=?1",
            [&fp],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    db.execute("DELETE FROM pgp_keys WHERE fingerprint=?1", [&fp])
        .map_err(err)?;
    if is_secret == Some(1) {
        delete_secret(&fp)?;
    }
    let _ = store.log("已移除 1 个 OpenPGP 密钥");
    Ok(())
}

pub fn unlock_key(
    store: &Store,
    fingerprint: &str,
    passphrase: &str,
    remember: bool,
) -> Result<()> {
    let fp = fingerprint.trim().to_uppercase();
    let Some((secret, _)) = load_secret(&fp)? else {
        return Err("未找到对应的 OpenPGP 私钥".into());
    };
    if !verify_secret_passphrase(&secret, passphrase) {
        return Err("OpenPGP 私钥密码短语不正确".into());
    }
    set_session_passphrase(&fp, passphrase.to_string());
    if remember {
        let armored = load_secret_armored(&fp)?;
        save_secret(&fp, armored, Some(passphrase.to_string()))?;
        let db = store.db()?;
        db.execute(
            "UPDATE pgp_keys SET has_saved_passphrase=1 WHERE fingerprint=?1",
            [&fp],
        )
        .map_err(err)?;
    }
    Ok(())
}

fn load_all_public_keys(store: &Store) -> Result<Vec<(PgpKeyInfo, SignedPublicKey)>> {
    let db = store.db()?;
    let mut stmt = db
        .prepare(
            "SELECT fingerprint, key_id, email, emails_json, user_ids_json, account_id,
                    is_secret, is_passphrase_protected, has_saved_passphrase, algorithm,
                    created_at, expires_at, revoked, armored_public, source, updated_at
             FROM pgp_keys
             ORDER BY is_secret DESC, updated_at DESC",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            let emails_json: String = r.get(3)?;
            let user_ids_json: String = r.get(4)?;
            let expires_at: String = r.get(11)?;
            let armored: String = r.get(13)?;
            Ok((
                PgpKeyInfo {
                    fingerprint: r.get(0)?,
                    key_id: r.get(1)?,
                    email: r.get(2)?,
                    emails: serde_json::from_str(&emails_json).unwrap_or_default(),
                    user_ids: serde_json::from_str(&user_ids_json).unwrap_or_default(),
                    account_id: r.get(5)?,
                    is_secret: r.get::<_, i64>(6)? != 0,
                    is_passphrase_protected: r.get::<_, i64>(7)? != 0,
                    has_saved_passphrase: r.get::<_, i64>(8)? != 0,
                    algorithm: r.get(9)?,
                    created_at: r.get(10)?,
                    expired: is_expired_str(&expires_at),
                    expires_at,
                    revoked: r.get::<_, i64>(12)? != 0,
                    source: r.get(14)?,
                    updated_at: r.get(15)?,
                },
                armored,
            ))
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (info, armored) = row.map_err(err)?;
        if let Ok((pub_key, _)) = SignedPublicKey::from_string(&armored) {
            out.push((info, pub_key));
        }
    }
    Ok(out)
}

fn find_account_secret_key(
    store: &Store,
    account: &Account,
) -> Result<Option<(PgpKeyInfo, SignedSecretKey, Option<String>)>> {
    let keys = list_keys(store)?;
    let normalized = normalize_email(&account.email);
    let candidate = keys
        .iter()
        .find(|k| k.is_secret && !k.revoked && !k.expired && k.account_id == account.id)
        .or_else(|| {
            keys.iter().find(|k| {
                k.is_secret && !k.revoked && !k.expired && k.emails.iter().any(|e| e == &normalized)
            })
        });
    let Some(info) = candidate else {
        return Ok(None);
    };
    let Some((secret, saved_pw)) = load_secret(&info.fingerprint)? else {
        return Ok(None);
    };
    let effective_pw = get_session_passphrase(&info.fingerprint).or(saved_pw);
    Ok(Some((info.clone(), secret, effective_pw)))
}

fn find_public_key_for_email(
    all: &[(PgpKeyInfo, SignedPublicKey)],
    email: &str,
) -> Option<(PgpKeyInfo, SignedPublicKey)> {
    let target = normalize_email(email);
    all.iter()
        .find(|(info, _)| {
            !info.revoked && !info.expired && info.emails.iter().any(|e| e == &target)
        })
        .or_else(|| {
            all.iter()
                .find(|(info, _)| info.emails.iter().any(|e| e == &target))
        })
        .cloned()
}

pub fn check_compose_readiness(
    store: &Store,
    account_id: &str,
    recipient_emails: &[String],
) -> Result<PgpComposeCheck> {
    let account = store.account(account_id)?;
    let sender = find_account_secret_key(store, &account)?;
    let (sender_has_secret_key, sender_fingerprint, sender_passphrase_needed) = match sender {
        Some((info, secret, pw)) => {
            let locked = is_secret_key_locked(&secret);
            let unlocked = !locked
                || pw
                    .as_deref()
                    .is_some_and(|p| verify_secret_passphrase(&secret, p));
            (true, info.fingerprint, !unlocked)
        }
        None => (false, String::new(), false),
    };

    let all_keys = load_all_public_keys(store)?;
    let mut seen = HashSet::new();
    let mut recipients = Vec::new();
    let mut missing_emails = Vec::new();

    for raw_email in recipient_emails {
        let email = normalize_email(raw_email);
        if email.is_empty() || !seen.insert(email.clone()) {
            continue;
        }
        if let Some((info, _)) = find_public_key_for_email(&all_keys, &email) {
            let usable = !info.expired && !info.revoked;
            if !usable {
                missing_emails.push(email.clone());
            }
            recipients.push(PgpRecipientStatus {
                email,
                has_key: usable,
                fingerprint: info.fingerprint,
                user_id: info.user_ids.first().cloned().unwrap_or_default(),
                expired: info.expired,
                revoked: info.revoked,
                algorithm: info.algorithm,
            });
        } else {
            missing_emails.push(email.clone());
            recipients.push(PgpRecipientStatus {
                email,
                has_key: false,
                fingerprint: String::new(),
                user_id: String::new(),
                expired: false,
                revoked: false,
                algorithm: String::new(),
            });
        }
    }

    let all_recipients_ready = !recipients.is_empty() && missing_emails.is_empty();
    Ok(PgpComposeCheck {
        sender_has_secret_key,
        sender_fingerprint,
        sender_passphrase_needed,
        recipients,
        all_recipients_ready,
        missing_emails,
    })
}

fn select_encryption_subkey(pub_key: &SignedPublicKey) -> Option<&SignedPublicSubKey> {
    pub_key
        .public_subkeys
        .iter()
        .find(|sub| {
            let flags = sub
                .signatures
                .iter()
                .find_map(|s| s.key_flags().into())
                .unwrap_or_else(KeyFlags::default);
            flags.encrypt_comms() || flags.encrypt_storage()
        })
        .or_else(|| pub_key.public_subkeys.first())
}

fn normalize_crlf(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() + 64);
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'\r' {
            if i + 1 < input.len() && input[i + 1] == b'\n' {
                out.extend_from_slice(b"\r\n");
                i += 2;
            } else {
                out.extend_from_slice(b"\r\n");
                i += 1;
            }
        } else if input[i] == b'\n' {
            out.extend_from_slice(b"\r\n");
            i += 1;
        } else {
            out.push(input[i]);
            i += 1;
        }
    }
    out
}

/// Split an RFC 5322 message into `(outer_headers, inner_entity)` where
/// `inner_entity` starts with `Content-Type:` / `Content-Transfer-Encoding:` /
/// `Content-Disposition:` headers plus `\r\n\r\n` and the body.
fn split_envelope_and_entity(formatted_message: &[u8]) -> Result<(Vec<u8>, Vec<u8>)> {
    let normalized = normalize_crlf(formatted_message);
    let sep = normalized
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("邮件报文缺少头部分隔符")?;
    let header_block = &normalized[..sep];
    let body = &normalized[sep + 4..];

    let mut outer_headers = Vec::new();
    let mut entity_headers = Vec::new();
    // Unfold logical headers (lines starting with space/tab belong to previous header).
    let mut lines: Vec<&[u8]> = Vec::new();
    for line in header_block.split(|&b| b == b'\n') {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        lines.push(line);
    }
    let mut idx = 0;
    while idx < lines.len() {
        let mut group = Vec::new();
        group.extend_from_slice(lines[idx]);
        idx += 1;
        while idx < lines.len() && matches!(lines[idx].first(), Some(b' ' | b'\t')) {
            group.extend_from_slice(b"\r\n");
            group.extend_from_slice(lines[idx]);
            idx += 1;
        }
        let name = group
            .split(|&b| b == b':')
            .next()
            .and_then(|n| std::str::from_utf8(n).ok())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if matches!(
            name.as_str(),
            "content-type"
                | "content-transfer-encoding"
                | "content-disposition"
                | "content-description"
                | "content-id"
        ) {
            entity_headers.extend_from_slice(&group);
            entity_headers.extend_from_slice(b"\r\n");
        } else if name != "mime-version" {
            outer_headers.extend_from_slice(&group);
            outer_headers.extend_from_slice(b"\r\n");
        }
    }
    outer_headers.extend_from_slice(b"MIME-Version: 1.0\r\n");

    let mut inner_entity = entity_headers;
    inner_entity.extend_from_slice(b"\r\n");
    inner_entity.extend_from_slice(body);
    Ok((outer_headers, inner_entity))
}

/// Produce a standard RFC 3156 PGP/MIME message from a `lettre`-formatted
/// message. Returns the final raw RFC 5322 bytes ready for `send_raw`.
pub fn protect_outgoing_mime(
    store: &Store,
    account: &Account,
    formatted_message: &[u8],
    recipient_emails: &[String],
    sign: bool,
    encrypt: bool,
) -> Result<Vec<u8>> {
    if !sign && !encrypt {
        return Ok(formatted_message.to_vec());
    }
    let (mut outer_headers, inner_entity) = split_envelope_and_entity(formatted_message)?;

    let sender_secret = if sign || encrypt {
        find_account_secret_key(store, account)?
    } else {
        None
    };

    let (signing_key, signing_pw) = if sign {
        let Some((info, secret, pw)) = sender_secret.as_ref() else {
            return Err(
                "当前发件账号未配置 OpenPGP 私钥，请先在「设置 → 阅读与写信」生成或导入密钥".into(),
            );
        };
        let password = if is_secret_key_locked(secret) {
            let Some(p) = pw.as_deref() else {
                return Err(format!(
                    "发件私钥（{}）需要密码短语解锁，请先在 OpenPGP 设置或写信安全选项中解锁",
                    info.key_id
                ));
            };
            if !verify_secret_passphrase(secret, p) {
                return Err("发件私钥密码短语验证失败，请重新解锁".into());
            }
            Password::from(p)
        } else {
            Password::empty()
        };
        (Some(secret.clone()), password)
    } else {
        (None, Password::empty())
    };

    let boundary = format!("anser-pgp-{}", uuid::Uuid::new_v4().simple());

    if encrypt {
        let all_keys = load_all_public_keys(store)?;
        let mut target_keys: Vec<SignedPublicKey> = Vec::new();
        let mut seen_fp = HashSet::new();
        let mut missing = Vec::new();

        for raw_email in recipient_emails {
            let email = normalize_email(raw_email);
            if email.is_empty() {
                continue;
            }
            if let Some((info, pub_key)) = find_public_key_for_email(&all_keys, &email) {
                if info.expired || info.revoked {
                    missing.push(format!("{email}（密钥已过期或吊销）"));
                } else if seen_fp.insert(info.fingerprint) {
                    target_keys.push(pub_key);
                }
            } else {
                missing.push(email);
            }
        }
        if !missing.is_empty() {
            return Err(format!(
                "以下收件人缺少可用的 OpenPGP 公钥，无法加密发送：{}",
                missing.join("、")
            ));
        }

        // Always also encrypt to the sender's own key so the Sent copy remains readable.
        if let Some((info, secret, _)) = sender_secret.as_ref() {
            if seen_fp.insert(info.fingerprint.clone()) {
                target_keys.push(secret.to_public_key());
            }
        } else if let Some((info, pub_key)) = find_public_key_for_email(&all_keys, &account.email) {
            if !info.expired && !info.revoked && seen_fp.insert(info.fingerprint) {
                target_keys.push(pub_key);
            }
        }

        if target_keys.is_empty() {
            return Err("没有可用于加密的目标公钥".into());
        }

        let mut rng = thread_rng();
        let mut builder = MessageBuilder::from_bytes("", inner_entity)
            .seipd_v1(&mut rng, SymmetricKeyAlgorithm::AES256);
        builder.compression(CompressionAlgorithm::ZLIB);
        if let Some(ref signer) = signing_key {
            builder.sign(&signer.primary_key, signing_pw, HashAlgorithm::Sha256);
        }
        for pub_key in &target_keys {
            if let Some(sub) = select_encryption_subkey(pub_key) {
                builder
                    .encrypt_to_key(&mut rng, sub)
                    .map_err(|e| format!("OpenPGP 加密失败：{e}"))?;
            } else {
                builder
                    .encrypt_to_key(&mut rng, &pub_key.primary_key)
                    .map_err(|e| format!("OpenPGP 加密失败：{e}"))?;
            }
        }
        let armored = builder
            .to_armored_string(&mut rng, ArmorOptions::default())
            .map_err(|e| format!("生成 OpenPGP 加密报文失败：{e}"))?;
        let armored_crlf = normalize_crlf(armored.as_bytes());

        outer_headers.extend_from_slice(
            format!(
                "Content-Type: multipart/encrypted; protocol=\"application/pgp-encrypted\"; boundary=\"{boundary}\"\r\n\r\n"
            )
            .as_bytes(),
        );
        outer_headers.extend_from_slice(
            format!(
                "This is an OpenPGP/MIME encrypted message (RFC 4880 and 3156)\r\n\
                 --{boundary}\r\n\
                 Content-Type: application/pgp-encrypted\r\n\
                 Content-Description: PGP/MIME version identification\r\n\r\n\
                 Version: 1\r\n\r\n\
                 --{boundary}\r\n\
                 Content-Type: application/octet-stream; name=\"encrypted.asc\"\r\n\
                 Content-Description: OpenPGP encrypted message\r\n\
                 Content-Disposition: inline; filename=\"encrypted.asc\"\r\n\r\n"
            )
            .as_bytes(),
        );
        outer_headers.extend_from_slice(&armored_crlf);
        if !armored_crlf.ends_with(b"\r\n") {
            outer_headers.extend_from_slice(b"\r\n");
        }
        outer_headers.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        return Ok(outer_headers);
    }

    // Sign only (RFC 3156 §5 multipart/signed)
    let signer = signing_key.ok_or("缺少签名私钥")?;
    let mut rng = thread_rng();
    let detached = DetachedSignature::sign_binary_data(
        &mut rng,
        &signer.primary_key,
        &signing_pw,
        HashAlgorithm::Sha256,
        Cursor::new(&inner_entity),
    )
    .map_err(|e| format!("生成 OpenPGP 数字签名失败：{e}"))?;
    let sig_armored = detached
        .to_armored_string(ArmorOptions::default())
        .map_err(|e| format!("序列化 OpenPGP 签名失败：{e}"))?;
    let sig_crlf = normalize_crlf(sig_armored.as_bytes());

    outer_headers.extend_from_slice(
        format!(
            "Content-Type: multipart/signed; micalg=\"pgp-sha256\"; protocol=\"application/pgp-signature\"; boundary=\"{boundary}\"\r\n\r\n"
        )
        .as_bytes(),
    );
    outer_headers.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    outer_headers.extend_from_slice(&inner_entity);
    outer_headers.extend_from_slice(
        format!(
            "\r\n--{boundary}\r\n\
             Content-Type: application/pgp-signature; name=\"signature.asc\"\r\n\
             Content-Description: OpenPGP digital signature\r\n\
             Content-Disposition: attachment; filename=\"signature.asc\"\r\n\r\n"
        )
        .as_bytes(),
    );
    outer_headers.extend_from_slice(&sig_crlf);
    if !sig_crlf.ends_with(b"\r\n") {
        outer_headers.extend_from_slice(b"\r\n");
    }
    outer_headers.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok(outer_headers)
}

pub fn sender_public_key_attachment(
    store: &Store,
    account: &Account,
) -> Result<Option<(String, Vec<u8>)>> {
    let Some((info, _, _)) = find_account_secret_key(store, account)? else {
        return Ok(None);
    };
    let armored = export_public_key(store, &info.fingerprint)?;
    Ok(Some((
        format!("0x{}.asc", info.key_id),
        armored.into_bytes(),
    )))
}

/// Extract exact raw multipart subparts between `--{boundary}` markers without
/// modifying headers or body encoding (critical for RFC 3156 `multipart/signed`).
fn extract_multipart_raw_parts(raw_body: &[u8], boundary: &str) -> Vec<Vec<u8>> {
    let delim = format!("--{boundary}");
    let delim_bytes = delim.as_bytes();
    let mut positions = Vec::new();
    let mut i = 0;
    while i + delim_bytes.len() <= raw_body.len() {
        let at_line_start = i == 0 || raw_body[i - 1] == b'\n';
        if at_line_start && &raw_body[i..i + delim_bytes.len()] == delim_bytes {
            positions.push(i);
            i += delim_bytes.len();
            continue;
        }
        i += 1;
    }
    let mut parts = Vec::new();
    for pair in positions.windows(2) {
        let mut start = pair[0] + delim_bytes.len();
        if raw_body.get(start..start + 2) == Some(b"--") {
            break;
        }
        if raw_body.get(start) == Some(&b'\r') {
            start += 1;
        }
        if raw_body.get(start) == Some(&b'\n') {
            start += 1;
        }
        let mut end = pair[1];
        if end > start && raw_body[end - 1] == b'\n' {
            end -= 1;
        }
        if end > start && raw_body[end - 1] == b'\r' {
            end -= 1;
        }
        if end >= start {
            parts.push(raw_body[start..end].to_vec());
        }
    }
    parts
}

fn signature_matches_key(sig: &Signature, pub_key: &SignedPublicKey) -> bool {
    let primary_fp = pub_key.primary_key.fingerprint();
    let primary_id = pub_key.primary_key.legacy_key_id();
    for fp in sig.issuer_fingerprint() {
        if *fp == primary_fp
            || pub_key
                .public_subkeys
                .iter()
                .any(|sub| sub.key.fingerprint() == *fp)
        {
            return true;
        }
    }
    for id in sig.issuer_key_id() {
        if *id == primary_id
            || pub_key
                .public_subkeys
                .iter()
                .any(|sub| sub.key.legacy_key_id() == *id)
        {
            return true;
        }
    }
    false
}

fn verify_detached_against_keyring(
    detached: &DetachedSignature,
    raw_content: &[u8],
    all_keys: &[(PgpKeyInfo, SignedPublicKey)],
    from_email: &str,
    info: &mut PgpMessageInfo,
) {
    info.signed = true;
    let sig = &detached.signature;
    let sig_key_id = sig
        .issuer_key_id()
        .first()
        .map(|id| key_id_hex(id))
        .unwrap_or_default();
    let sig_fp = sig
        .issuer_fingerprint()
        .first()
        .map(|fp| fingerprint_hex(fp))
        .unwrap_or_default();
    info.signer_key_id = sig_key_id;
    info.signer_fingerprint = sig_fp;

    let crlf_content = normalize_crlf(raw_content);
    let mut matched_key: Option<&(PgpKeyInfo, SignedPublicKey)> = None;

    for candidate in all_keys {
        let (_, pub_key) = candidate;
        let id_hint = signature_matches_key(sig, pub_key);
        let verify_with = |data: &[u8]| -> bool {
            if detached.verify(&pub_key.primary_key, data).is_ok() {
                return true;
            }
            pub_key
                .public_subkeys
                .iter()
                .any(|sub| detached.verify(&sub.key, data).is_ok())
        };
        if verify_with(raw_content) || verify_with(&crlf_content) {
            let (key_info, _) = candidate;
            info.signer_fingerprint = key_info.fingerprint.clone();
            info.signer_key_id = key_info.key_id.clone();
            info.signer_user_id = key_info.user_ids.first().cloned().unwrap_or_default();
            let from_norm = normalize_email(from_email);
            info.sender_matches_signer =
                !from_norm.is_empty() && key_info.emails.iter().any(|e| e == &from_norm);
            info.signature_state = if key_info.revoked {
                "revokedKey".into()
            } else if key_info.expired {
                "expiredKey".into()
            } else {
                "valid".into()
            };
            return;
        }
        if id_hint && matched_key.is_none() {
            matched_key = Some(candidate);
        }
    }

    if let Some((key_info, _)) = matched_key {
        info.signer_fingerprint = key_info.fingerprint.clone();
        info.signer_key_id = key_info.key_id.clone();
        info.signer_user_id = key_info.user_ids.first().cloned().unwrap_or_default();
        info.signature_state = "invalid".into();
        info.signature_error = "签名验证失败，邮件内容可能被修改".into();
    } else {
        info.signature_state = "missingKey".into();
    }
}

fn secret_key_matches_key_ids(secret: &SignedSecretKey, recipient_ids: &[String]) -> bool {
    if recipient_ids.is_empty() || recipient_ids.iter().any(|id| id == "0000000000000000") {
        return true;
    }
    let primary_id = key_id_hex(&secret.primary_key.legacy_key_id());
    if recipient_ids.iter().any(|id| id == &primary_id) {
        return true;
    }
    secret.secret_subkeys.iter().any(|sub| {
        let sub_id = key_id_hex(&sub.key.legacy_key_id());
        recipient_ids.iter().any(|id| id == &sub_id)
    })
}

fn decrypt_openpgp_payload(
    store: &Store,
    payload: &[u8],
    all_keys: &[(PgpKeyInfo, SignedPublicKey)],
    from_email: &str,
    info: &mut PgpMessageInfo,
) -> Option<Vec<u8>> {
    if payload.len() > MAX_PGP_PAYLOAD_BYTES {
        info.encryption_state = "failed".into();
        info.encryption_error = "加密邮件体超过 64 MB 解密上限".into();
        return None;
    }
    let parse_message = || -> Result<Message<'_>> {
        if let Ok(text) = std::str::from_utf8(payload) {
            if text.contains("-----BEGIN PGP MESSAGE-----") {
                return Message::from_string(text)
                    .map(|(m, _)| m)
                    .map_err(|e| format!("无法解析 OpenPGP 加密报文：{e}"));
            }
        }
        Message::from_bytes(payload).map_err(|e| format!("无法解析 OpenPGP 加密报文：{e}"))
    };

    let msg = match parse_message() {
        Ok(m) => m,
        Err(e) => {
            info.encryption_state = "failed".into();
            info.encryption_error = e;
            return None;
        }
    };

    let recipient_ids: Vec<String> = match &msg {
        Message::Encrypted { esk, .. } => esk
            .iter()
            .filter_map(|item| match item {
                pgp::composed::Esk::PublicKeyEncryptedSessionKey(pkesk) => {
                    pkesk.id().ok().map(key_id_hex)
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    info.recipient_key_ids = recipient_ids.clone();

    let secret_infos: Vec<&PgpKeyInfo> = all_keys
        .iter()
        .filter(|(k, _)| k.is_secret)
        .map(|(k, _)| k)
        .collect();

    let mut matched_locked: Option<String> = None;
    let mut attempted_any = false;

    for key_info in secret_infos {
        let Ok(Some((secret, saved_pw))) = load_secret(&key_info.fingerprint) else {
            continue;
        };
        if !secret_key_matches_key_ids(&secret, &recipient_ids) {
            continue;
        }
        attempted_any = true;
        let effective_pw = get_session_passphrase(&key_info.fingerprint).or(saved_pw);
        let password = if is_secret_key_locked(&secret) {
            match effective_pw {
                Some(ref p) if verify_secret_passphrase(&secret, p) => Password::from(p.as_str()),
                _ => {
                    if matched_locked.is_none() {
                        matched_locked = Some(key_info.fingerprint.clone());
                    }
                    continue;
                }
            }
        } else {
            Password::empty()
        };

        let Ok(fresh_msg) = parse_message() else {
            continue;
        };
        let decrypted = match fresh_msg.decrypt(&password, &secret) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let mut inner = match decrypted.decompress() {
            Ok(m) => m,
            Err(_) => continue,
        };

        // Check embedded signatures if present before reading literal bytes.
        let verifying_refs: Vec<&dyn VerifyingKey> = all_keys
            .iter()
            .flat_map(|(_, pk)| {
                let mut v: Vec<&dyn VerifyingKey> = vec![&pk.primary_key];
                for sub in &pk.public_subkeys {
                    v.push(&sub.key);
                }
                v
            })
            .collect();

        let was_signed = inner.is_signed() || inner.is_one_pass_signed();
        let data = match inner.as_data_vec() {
            Ok(bytes) => bytes,
            Err(e) => {
                info.encryption_state = "failed".into();
                info.encryption_error = format!("读取解密正文失败：{e}");
                return None;
            }
        };

        if was_signed {
            info.signed = true;
            if let Ok(results) = inner.verify_nested(&verifying_refs) {
                if let Some(valid_sig) = results.iter().find_map(|r| match r {
                    pgp::composed::VerificationResult::Valid(sig) => Some(sig),
                    _ => None,
                }) {
                    if let Some((signer_info, _)) = all_keys
                        .iter()
                        .find(|(_, pk)| signature_matches_key(valid_sig, pk))
                    {
                        info.signer_fingerprint = signer_info.fingerprint.clone();
                        info.signer_key_id = signer_info.key_id.clone();
                        info.signer_user_id =
                            signer_info.user_ids.first().cloned().unwrap_or_default();
                        let from_norm = normalize_email(from_email);
                        info.sender_matches_signer = !from_norm.is_empty()
                            && signer_info.emails.iter().any(|e| e == &from_norm);
                        info.signature_state = if signer_info.revoked {
                            "revokedKey".into()
                        } else if signer_info.expired {
                            "expiredKey".into()
                        } else {
                            "valid".into()
                        };
                    } else {
                        info.signature_state = "valid".into();
                    }
                } else {
                    info.signature_state = "missingKey".into();
                }
            } else {
                info.signature_state = "missingKey".into();
            }
        }

        info.encryption_state = "decrypted".into();
        info.decryption_key_fingerprint = key_info.fingerprint.clone();
        let _ = store;
        return Some(data);
    }

    if let Some(locked_fp) = matched_locked {
        info.encryption_state = "passphraseRequired".into();
        info.decryption_key_fingerprint = locked_fp;
    } else if !attempted_any {
        info.encryption_state = "missingKey".into();
    } else {
        info.encryption_state = "failed".into();
        info.encryption_error = "已尝试本地私钥但未能解密此邮件".into();
    }
    None
}

fn has_public_key_attachment(attachments: &[AttachmentInfo]) -> bool {
    attachments.iter().any(|a| {
        a.mime.eq_ignore_ascii_case("application/pgp-keys")
            || a.name.to_ascii_lowercase().ends_with(".asc")
    })
}

fn first_from_email(parsed: &ParsedMail) -> String {
    let raw_from = parsed.headers.get_first_value("From").unwrap_or_default();
    archive::addresses(&raw_from)
        .ok()
        .and_then(|list| list.into_iter().next())
        .map(|a| a.email)
        .unwrap_or_default()
}

fn is_pgp_mime_encrypted(parsed: &ParsedMail) -> bool {
    parsed
        .ctype
        .mimetype
        .eq_ignore_ascii_case("multipart/encrypted")
        && parsed
            .ctype
            .params
            .get("protocol")
            .is_some_and(|p| p.eq_ignore_ascii_case("application/pgp-encrypted"))
}

fn is_pgp_mime_signed(parsed: &ParsedMail) -> bool {
    parsed
        .ctype
        .mimetype
        .eq_ignore_ascii_case("multipart/signed")
        && parsed
            .ctype
            .params
            .get("protocol")
            .is_some_and(|p| p.eq_ignore_ascii_case("application/pgp-signature"))
}

fn extract_inline_block<'a>(text: &'a str, begin: &str, end: &str) -> Option<&'a str> {
    let start = text.find(begin)?;
    let rest = &text[start..];
    let end_pos = rest.find(end)?;
    Some(&rest[..end_pos + end.len()])
}

/// Returns effective MIME bytes for attachment extraction if the message is
/// PGP/MIME encrypted (decrypted purely in memory) or `None` if the outer raw
/// bytes should be used directly.
pub fn decrypted_mime_for_attachments(store: &Store, raw: &[u8]) -> Result<Option<Vec<u8>>> {
    let projection = crate::mail_formats::mime(raw)?;
    let parsed = mailparse::parse_mail(&projection).map_err(err)?;
    if !is_pgp_mime_encrypted(&parsed) {
        return Ok(None);
    }
    let payload_part = parsed
        .subparts
        .get(1)
        .ok_or("PGP/MIME 加密邮件结构不完整")?;
    let payload_bytes = archive::decoded_bytes(payload_part)?;
    let all_keys = load_all_public_keys(store)?;
    let from_email = first_from_email(&parsed);
    let mut info = PgpMessageInfo {
        encrypted: true,
        format: "pgpMime".into(),
        ..Default::default()
    };
    let Some(inner) =
        decrypt_openpgp_payload(store, &payload_bytes, &all_keys, &from_email, &mut info)
    else {
        return Err(if info.encryption_state == "passphraseRequired" {
            "请先解锁 OpenPGP 私钥后再读取加密附件".into()
        } else {
            "当前无法解密该邮件的附件".into()
        });
    };
    Ok(Some(inner))
}

/// Process a raw message purely in memory for reading (`Detail`).
/// Never mutates the original archive or writes plaintext to SQLite.
pub fn parse_for_reading(
    store: &Store,
    raw: &[u8],
    account: &Account,
    folder: &str,
) -> Result<(Mail, String, Vec<AttachmentInfo>, Option<PgpMessageInfo>)> {
    let projection = crate::mail_formats::mime(raw)?;
    let parsed_outer = mailparse::parse_mail(&projection).map_err(err)?;
    let from_email = first_from_email(&parsed_outer);
    let mut info = PgpMessageInfo {
        encryption_state: "none".into(),
        signature_state: "none".into(),
        format: "none".into(),
        ..Default::default()
    };

    // 1. PGP/MIME encrypted (RFC 3156 §4)
    if is_pgp_mime_encrypted(&parsed_outer) {
        info.encrypted = true;
        info.format = "pgpMime".into();
        let all_keys = load_all_public_keys(store)?;
        if let Some(payload_part) = parsed_outer.subparts.get(1) {
            if let Ok(payload_bytes) = archive::decoded_bytes(payload_part) {
                if let Some(inner_mime) = decrypt_openpgp_payload(
                    store,
                    &payload_bytes,
                    &all_keys,
                    &from_email,
                    &mut info,
                ) {
                    // Check if the decrypted inner entity is itself multipart/signed.
                    if let Ok(inner_parsed) = mailparse::parse_mail(&inner_mime) {
                        if is_pgp_mime_signed(&inner_parsed) && !info.signed {
                            verify_pgp_mime_signed_entity(
                                &inner_mime,
                                &inner_parsed,
                                &all_keys,
                                &from_email,
                                &mut info,
                            );
                        }
                    }
                    let (mut outer_mail, _, _) = archive::parse(raw, account, folder)?;
                    let (inner_mail, inner_html, mut inner_attachments) =
                        archive::parse(&inner_mime, account, folder)?;
                    inner_attachments.retain(|a| {
                        !a.mime.eq_ignore_ascii_case("application/pgp-signature")
                            && !a.mime.eq_ignore_ascii_case("application/pgp-encrypted")
                    });
                    outer_mail.body = inner_mail.body;
                    outer_mail.has_attachments = !inner_attachments.is_empty();
                    info.has_attached_public_key = has_public_key_attachment(&inner_attachments);
                    return Ok((outer_mail, inner_html, inner_attachments, Some(info)));
                }
            } else {
                info.encryption_state = "failed".into();
                info.encryption_error = "无法读取加密邮件负载".into();
            }
        } else {
            info.encryption_state = "failed".into();
            info.encryption_error = "PGP/MIME 加密结构不完整".into();
        }
        let (mut mail, _, _) = archive::parse(raw, account, folder)?;
        mail.body = String::new();
        mail.has_attachments = false;
        return Ok((mail, String::new(), Vec::new(), Some(info)));
    }

    // 2. PGP/MIME signed (RFC 3156 §5)
    if is_pgp_mime_signed(&parsed_outer) {
        info.format = "pgpMime".into();
        let all_keys = load_all_public_keys(store)?;
        verify_pgp_mime_signed_entity(
            &projection,
            &parsed_outer,
            &all_keys,
            &from_email,
            &mut info,
        );
        let (mut mail, html, mut attachments) = archive::parse(raw, account, folder)?;
        attachments.retain(|a| !a.mime.eq_ignore_ascii_case("application/pgp-signature"));
        mail.has_attachments = !attachments.is_empty();
        info.has_attached_public_key = has_public_key_attachment(&attachments);
        return Ok((mail, html, attachments, Some(info)));
    }

    // 3. Regular mail or Inline PGP
    let (mut mail, html, attachments) = archive::parse(raw, account, folder)?;
    info.has_attached_public_key = has_public_key_attachment(&attachments);

    if html.trim().is_empty() && mail.body.contains("-----BEGIN PGP MESSAGE-----") {
        if let Some(block) = extract_inline_block(
            &mail.body,
            "-----BEGIN PGP MESSAGE-----",
            "-----END PGP MESSAGE-----",
        ) {
            info.encrypted = true;
            info.format = "inlinePgp".into();
            let all_keys = load_all_public_keys(store)?;
            if let Some(plain_bytes) =
                decrypt_openpgp_payload(store, block.as_bytes(), &all_keys, &from_email, &mut info)
            {
                mail.body = String::from_utf8_lossy(&plain_bytes).into_owned();
            }
            return Ok((mail, html, attachments, Some(info)));
        }
    }

    if html.trim().is_empty() && mail.body.contains("-----BEGIN PGP SIGNED MESSAGE-----") {
        if let Some(block) = extract_inline_block(
            &mail.body,
            "-----BEGIN PGP SIGNED MESSAGE-----",
            "-----END PGP SIGNATURE-----",
        ) {
            info.signed = true;
            info.format = "inlinePgp".into();
            let all_keys = load_all_public_keys(store)?;
            match CleartextSignedMessage::from_string(block) {
                Ok((csf, _)) => {
                    if let Some(sig) = csf.signatures().first() {
                        info.signer_key_id = sig
                            .issuer_key_id()
                            .first()
                            .map(|id| key_id_hex(id))
                            .unwrap_or_default();
                        info.signer_fingerprint = sig
                            .issuer_fingerprint()
                            .first()
                            .map(|fp| fingerprint_hex(fp))
                            .unwrap_or_default();
                    }
                    let mut verified = false;
                    let mut matched_invalid: Option<&PgpKeyInfo> = None;
                    for (key_info, pub_key) in &all_keys {
                        let ok = csf.verify(&pub_key.primary_key).is_ok()
                            || pub_key
                                .public_subkeys
                                .iter()
                                .any(|sub| csf.verify(&sub.key).is_ok());
                        if ok {
                            info.signer_fingerprint = key_info.fingerprint.clone();
                            info.signer_key_id = key_info.key_id.clone();
                            info.signer_user_id =
                                key_info.user_ids.first().cloned().unwrap_or_default();
                            let from_norm = normalize_email(&from_email);
                            info.sender_matches_signer = !from_norm.is_empty()
                                && key_info.emails.iter().any(|e| e == &from_norm);
                            info.signature_state = if key_info.revoked {
                                "revokedKey".into()
                            } else if key_info.expired {
                                "expiredKey".into()
                            } else {
                                "valid".into()
                            };
                            verified = true;
                            break;
                        }
                        if csf
                            .signatures()
                            .first()
                            .is_some_and(|sig| signature_matches_key(sig, pub_key))
                        {
                            matched_invalid = Some(key_info);
                        }
                    }
                    if !verified {
                        if let Some(key_info) = matched_invalid {
                            info.signer_fingerprint = key_info.fingerprint.clone();
                            info.signer_key_id = key_info.key_id.clone();
                            info.signer_user_id =
                                key_info.user_ids.first().cloned().unwrap_or_default();
                            info.signature_state = "invalid".into();
                            info.signature_error = "签名验证失败，邮件内容可能被修改".into();
                        } else {
                            info.signature_state = "missingKey".into();
                        }
                    }
                    mail.body = csf.text().to_string();
                }
                Err(e) => {
                    info.signature_state = "error".into();
                    info.signature_error = format!("无法解析 Inline PGP 签名：{e}");
                }
            }
            return Ok((mail, html, attachments, Some(info)));
        }
    }

    let pgp = info.is_active().then_some(info);
    Ok((mail, html, attachments, pgp))
}

fn verify_pgp_mime_signed_entity(
    raw_entity: &[u8],
    parsed: &ParsedMail,
    all_keys: &[(PgpKeyInfo, SignedPublicKey)],
    from_email: &str,
    info: &mut PgpMessageInfo,
) {
    info.signed = true;
    let Some(boundary) = parsed.ctype.params.get("boundary") else {
        info.signature_state = "error".into();
        info.signature_error = "签名邮件缺少 MIME boundary".into();
        return;
    };
    let body_slice = raw_entity
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|p| &raw_entity[p + 4..])
        .or_else(|| {
            raw_entity
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|p| &raw_entity[p + 2..])
        })
        .unwrap_or(raw_entity);
    let raw_parts = extract_multipart_raw_parts(body_slice, boundary);
    let Some(signed_bytes) = raw_parts.first() else {
        info.signature_state = "error".into();
        info.signature_error = "签名邮件缺少正文分片".into();
        return;
    };
    let Some(sig_part) = parsed.subparts.get(1) else {
        info.signature_state = "error".into();
        info.signature_error = "签名邮件缺少签名分片".into();
        return;
    };
    let Ok(sig_bytes) = archive::decoded_bytes(sig_part) else {
        info.signature_state = "error".into();
        info.signature_error = "无法解码数字签名附件".into();
        return;
    };
    let detached = if let Ok(text) = std::str::from_utf8(&sig_bytes) {
        if text.contains("-----BEGIN PGP SIGNATURE-----") {
            DetachedSignature::from_string(text).map(|(d, _)| d)
        } else {
            DetachedSignature::from_bytes(Cursor::new(&sig_bytes))
        }
    } else {
        DetachedSignature::from_bytes(Cursor::new(&sig_bytes))
    };
    match detached {
        Ok(sig) => verify_detached_against_keyring(&sig, signed_bytes, all_keys, from_email, info),
        Err(e) => {
            info.signature_state = "error".into();
            info.signature_error = format!("数字签名格式无效：{e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_account(id: &str, email: &str) -> Account {
        Account {
            id: id.into(),
            name: "Test".into(),
            email: email.into(),
            provider: "custom".into(),
            protocol: "imap".into(),
            incoming_host: "mail.example".into(),
            incoming_port: 993,
            incoming_tls: "tls".into(),
            smtp_host: "mail.example".into(),
            smtp_port: 465,
            smtp_tls: "tls".into(),
            username: email.into(),
            smtp_username: String::new(),
            auth: "password".into(),
            oauth_client_id: String::new(),
            enabled: true,
            save_locally: true,
            server_retention_days: None,
            last_sync: None,
            error: None,
        }
    }

    #[test]
    fn key_generation_pgp_mime_sign_encrypt_and_inline_pgp_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let alice = test_account("acc-alice", "alice@example.com");
        let bob = test_account("acc-bob", "bob@example.com");
        store.save_account(&alice).unwrap();
        store.save_account(&bob).unwrap();

        let alice_key = generate_key(
            &store,
            &alice.id,
            "Alice",
            &alice.email,
            "ed25519",
            Some("alice-pass"),
            Some(365),
        )
        .unwrap();
        assert!(alice_key.is_secret);
        assert!(alice_key.is_passphrase_protected);
        assert!(alice_key.has_saved_passphrase);
        assert!(!alice_key.expires_at.is_empty());

        let bob_key =
            generate_key(&store, &bob.id, "Bob", &bob.email, "ed25519", None, None).unwrap();
        assert!(bob_key.is_secret);
        assert!(!bob_key.is_passphrase_protected);

        // Public key export does NOT contain private key header.
        let alice_pub = export_public_key(&store, &alice_key.fingerprint).unwrap();
        assert!(alice_pub.contains("-----BEGIN PGP PUBLIC KEY BLOCK-----"));
        assert!(!alice_pub.contains("PRIVATE KEY"));

        // Compose readiness check reports ready for Bob and missing for Carol.
        let check = check_compose_readiness(
            &store,
            &alice.id,
            &["bob@example.com".into(), "carol@example.com".into()],
        )
        .unwrap();
        assert!(check.sender_has_secret_key);
        assert!(!check.sender_passphrase_needed);
        assert!(!check.all_recipients_ready);
        assert_eq!(check.missing_emails, vec!["carol@example.com".to_string()]);

        let sample_rfc5322 = b"From: Alice <alice@example.com>\r\n\
To: Bob <bob@example.com>\r\n\
Subject: PGP Test\r\n\
Date: Sat, 28 Nov 2026 10:00:00 +0800\r\n\
Message-ID: <test-1@example.com>\r\n\
MIME-Version: 1.0\r\n\
Content-Type: text/plain; charset=utf-8\r\n\r\n\
Hello Bob, top secret line!\r\n";

        // 1. RFC 3156 Sign-only round-trip
        let signed_raw = protect_outgoing_mime(
            &store,
            &alice,
            sample_rfc5322,
            &["bob@example.com".into()],
            true,
            false,
        )
        .unwrap();
        let (mail, _html, attachments, pgp) =
            parse_for_reading(&store, &signed_raw, &bob, "INBOX").unwrap();
        let pgp = pgp.expect("signed pgp info");
        assert!(pgp.signed);
        assert!(!pgp.encrypted);
        assert_eq!(pgp.format, "pgpMime");
        assert_eq!(pgp.signature_state, "valid");
        assert!(pgp.sender_matches_signer);
        assert_eq!(pgp.signer_fingerprint, alice_key.fingerprint);
        assert!(mail.body.contains("Hello Bob, top secret line!"));
        assert!(attachments.is_empty());

        // Tampering invalidates the detached signature.
        let tampered = String::from_utf8_lossy(&signed_raw)
            .replacen("top secret line", "tampered line!!", 1)
            .into_bytes();
        let (_, _, _, tampered_pgp) = parse_for_reading(&store, &tampered, &bob, "INBOX").unwrap();
        assert_eq!(tampered_pgp.unwrap().signature_state, "invalid");

        // 2. RFC 3156 Sign + Encrypt round-trip
        let enc_raw = protect_outgoing_mime(
            &store,
            &alice,
            sample_rfc5322,
            &["bob@example.com".into()],
            true,
            true,
        )
        .unwrap();
        assert!(!String::from_utf8_lossy(&enc_raw).contains("top secret line"));
        let (dec_mail, _, _, dec_pgp) = parse_for_reading(&store, &enc_raw, &bob, "INBOX").unwrap();
        let dec_pgp = dec_pgp.expect("encrypted pgp info");
        assert!(dec_pgp.encrypted);
        assert_eq!(dec_pgp.encryption_state, "decrypted");
        assert!(dec_pgp.signed);
        assert_eq!(dec_pgp.signature_state, "valid");
        assert!(dec_pgp.sender_matches_signer);
        assert!(dec_mail.body.contains("Hello Bob, top secret line!"));

        // 3. Inline PGP clearsigned verification
        let (alice_secret, _) = load_secret(&alice_key.fingerprint).unwrap().unwrap();
        let mut rng = thread_rng();
        let csf = CleartextSignedMessage::sign(
            &mut rng,
            "Inline signed body.",
            &alice_secret.primary_key,
            &Password::from("alice-pass"),
        )
        .unwrap();
        let inline_raw = format!(
            "From: Alice <alice@example.com>\r\n\
To: Bob <bob@example.com>\r\n\
Subject: Inline\r\n\
Content-Type: text/plain; charset=utf-8\r\n\r\n{}",
            csf.to_armored_string(ArmorOptions::default()).unwrap()
        );
        let (inline_mail, _, _, inline_pgp) =
            parse_for_reading(&store, inline_raw.as_bytes(), &bob, "INBOX").unwrap();
        let inline_pgp = inline_pgp.expect("inline pgp");
        assert_eq!(inline_pgp.format, "inlinePgp");
        assert_eq!(inline_pgp.signature_state, "valid");
        assert_eq!(inline_mail.body.trim(), "Inline signed body.");

        // 4. Delete key cleans up both SQLite and vault.
        delete_key(&store, &alice_key.fingerprint).unwrap();
        assert!(load_secret(&alice_key.fingerprint).unwrap().is_none());
        assert_eq!(list_keys(&store).unwrap().len(), 1);
    }

    #[test]
    fn passphrase_unlock_and_encrypted_attachments_stay_in_memory_only() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let alice = test_account("acc-alice-2", "alice2@example.com");
        let bob = test_account("acc-bob-2", "bob2@example.com");
        store.save_account(&alice).unwrap();
        store.save_account(&bob).unwrap();

        let _alice_key = generate_key(
            &store,
            &alice.id,
            "Alice",
            &alice.email,
            "ed25519",
            None,
            None,
        )
        .unwrap();
        let bob_key = generate_key(
            &store,
            &bob.id,
            "Bob",
            &bob.email,
            "ed25519",
            Some("bob-secret-pw"),
            None,
        )
        .unwrap();

        // Re-import Bob's secret key without saving its passphrase so reading requires unlock.
        let bob_armored_secret = export_secret_key(&store, &bob_key.fingerprint).unwrap();
        delete_key(&store, &bob_key.fingerprint).unwrap();
        let imported = import_keys(
            &store,
            bob_armored_secret.as_bytes(),
            Some(&bob.id),
            None,
            false,
            "imported",
        )
        .unwrap();
        assert_eq!(
            imported.passphrase_required_fingerprints,
            vec![bob_key.fingerprint.clone()]
        );

        let multipart_with_att = b"From: Alice <alice2@example.com>\r\n\
To: Bob <bob2@example.com>\r\n\
Subject: Secret Doc\r\n\
MIME-Version: 1.0\r\n\
Content-Type: multipart/mixed; boundary=\"inner-b\"\r\n\r\n\
--inner-b\r\n\
Content-Type: text/plain; charset=utf-8\r\n\r\n\
Body inside encrypted mail\r\n\
--inner-b\r\n\
Content-Type: text/plain; name=\"note.txt\"\r\n\
Content-Disposition: attachment; filename=\"note.txt\"\r\n\r\n\
Confidential attachment bytes\r\n\
--inner-b--\r\n";

        // Encrypt to Bob; missing Carol should be rejected cleanly.
        let missing_err = protect_outgoing_mime(
            &store,
            &alice,
            multipart_with_att,
            &["carol@example.com".into()],
            false,
            true,
        )
        .unwrap_err();
        assert!(missing_err.contains("carol@example.com"));

        let encrypted = protect_outgoing_mime(
            &store,
            &alice,
            multipart_with_att,
            &["bob2@example.com".into()],
            false,
            true,
        )
        .unwrap();
        assert!(!String::from_utf8_lossy(&encrypted).contains("Confidential attachment bytes"));

        // Delete Alice's key so only Bob's locked key can decrypt.
        let alice_fp = list_keys(&store)
            .unwrap()
            .into_iter()
            .find(|k| k.email == "alice2@example.com")
            .unwrap()
            .fingerprint;
        delete_key(&store, &alice_fp).unwrap();
        lock_session();

        // Reading before unlock requests passphrase and exposes zero plaintext.
        let (locked_mail, _, locked_atts, locked_pgp) =
            parse_for_reading(&store, &encrypted, &bob, "INBOX").unwrap();
        let locked_pgp = locked_pgp.unwrap();
        assert_eq!(locked_pgp.encryption_state, "passphraseRequired");
        assert_eq!(locked_pgp.decryption_key_fingerprint, bob_key.fingerprint);
        assert!(locked_mail.body.is_empty());
        assert!(locked_atts.is_empty());

        // Wrong passphrase fails; correct passphrase unlocks in memory only.
        assert!(unlock_key(&store, &bob_key.fingerprint, "wrong", false).is_err());
        unlock_key(&store, &bob_key.fingerprint, "bob-secret-pw", false).unwrap();

        let (mail, _, atts, pgp) = parse_for_reading(&store, &encrypted, &bob, "INBOX").unwrap();
        assert_eq!(pgp.unwrap().encryption_state, "decrypted");
        assert!(mail.body.contains("Body inside encrypted mail"));
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].name, "note.txt");

        // Attachment extraction works purely in memory on the encrypted MIME.
        let inner = decrypted_mime_for_attachments(&store, &encrypted)
            .unwrap()
            .expect("decrypted inner mime");
        let bytes = archive::attachment(&inner, atts[0].index).unwrap();
        assert_eq!(
            String::from_utf8_lossy(&bytes).trim(),
            "Confidential attachment bytes"
        );

        // Locking session immediately requires passphrase again.
        lock_session();
        let (_, _, _, relocked) = parse_for_reading(&store, &encrypted, &bob, "INBOX").unwrap();
        assert_eq!(relocked.unwrap().encryption_state, "passphraseRequired");
    }
}
