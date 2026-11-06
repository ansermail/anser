//! Expiring, disposable copies of remote MIME used only to make reopening an
//! online message fast. This is deliberately not part of the durable archive:
//! it never changes `savedLocally`, and it is excluded from archive backup and
//! integrity checks.
use crate::{archive, models::*, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const CACHE_DIR: &str = "read-cache";
const MIN_LIMIT_MB: u64 = 64;
const MAX_LIMIT_MB: u64 = 10 * 1024;
const MAX_RETENTION_DAYS: u32 = 3650;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingCacheStatus {
    pub entries: u64,
    pub bytes: u64,
    pub limit_bytes: u64,
    pub retention_days: u32,
}

struct CachedRecord {
    account_id: String,
    header_hash: String,
    message_id: String,
    cache_file: String,
    content_hash: String,
    size: u64,
    last_used_at: i64,
}

pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS reading_cache(
            mail_id TEXT PRIMARY KEY,
            account_id TEXT NOT NULL,
            header_hash TEXT NOT NULL,
            message_id TEXT NOT NULL DEFAULT '',
            cache_file TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            size INTEGER NOT NULL,
            cached_at INTEGER NOT NULL,
            last_used_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS reading_cache_last_used ON reading_cache(last_used_at);
        CREATE TRIGGER IF NOT EXISTS reading_cache_message_delete
        AFTER DELETE ON messages BEGIN
            DELETE FROM reading_cache WHERE mail_id=OLD.id;
        END;",
    )
    .map_err(err)
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn cache_dir(store: &Store) -> PathBuf {
    store.root.join(CACHE_DIR)
}

fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(err)?;
    }
    Ok(())
}

fn file_name(mail: &Mail) -> String {
    format!(
        "{}.eml",
        archive::digest(format!("{}:{}", mail.id, mail.hash).as_bytes())
    )
}

fn valid_file_name(name: &str) -> bool {
    name.len() == 68 && name.ends_with(".eml") && name[..64].bytes().all(|b| b.is_ascii_hexdigit())
}

fn file_path(store: &Store, name: &str) -> Option<PathBuf> {
    valid_file_name(name).then(|| cache_dir(store).join(name))
}

fn remove_file(store: &Store, name: &str) {
    if let Some(path) = file_path(store, name) {
        let _ = fs::remove_file(path);
    }
}

fn remove_record(conn: &rusqlite::Connection, store: &Store, mail_id: &str) {
    let file: Option<String> = conn
        .query_row(
            "SELECT cache_file FROM reading_cache WHERE mail_id=?1",
            [mail_id],
            |row| row.get(0),
        )
        .optional()
        .ok()
        .flatten();
    if let Some(file) = file {
        remove_file(store, &file);
    }
    let _ = conn.execute("DELETE FROM reading_cache WHERE mail_id=?1", [mail_id]);
}

fn record(conn: &rusqlite::Connection, mail_id: &str) -> Result<Option<CachedRecord>> {
    conn.query_row(
        "SELECT account_id,header_hash,message_id,cache_file,content_hash,size,last_used_at
         FROM reading_cache WHERE mail_id=?1",
        [mail_id],
        |row| {
            Ok(CachedRecord {
                account_id: row.get(0)?,
                header_hash: row.get(1)?,
                message_id: row.get(2)?,
                cache_file: row.get(3)?,
                content_hash: row.get(4)?,
                size: row.get::<_, i64>(5)?.max(0) as u64,
                last_used_at: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(err)
}

fn prune_orphans(store: &Store, conn: &rusqlite::Connection) -> Result<()> {
    let dir = cache_dir(store);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(err(error)),
    };
    let mut known = HashSet::new();
    {
        let mut query = conn
            .prepare("SELECT cache_file FROM reading_cache")
            .map_err(err)?;
        for name in query
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(err)?
        {
            known.insert(name.map_err(err)?);
        }
    }
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if valid_file_name(&name) && !known.contains(&name) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

fn records_by_age(conn: &rusqlite::Connection) -> Result<Vec<(String, String, u64, i64)>> {
    let mut query = conn
        .prepare(
            "SELECT mail_id,cache_file,size,last_used_at
             FROM reading_cache ORDER BY last_used_at ASC",
        )
        .map_err(err)?;
    let rows = query
        .query_map([], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get::<_, i64>(2)?.max(0) as u64,
                row.get(3)?,
            ))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err);
    rows
}

pub fn status(store: &Store) -> Result<ReadingCacheStatus> {
    let preferences = store.preferences()?;
    let (entries, bytes): (u64, u64) = store
        .db()?
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(size),0) FROM reading_cache",
            [],
            |row| Ok((row.get(0)?, row.get::<_, i64>(1)?.max(0) as u64)),
        )
        .map_err(err)?;
    Ok(ReadingCacheStatus {
        entries,
        bytes,
        limit_bytes: preferences.reading_cache_limit_mb * 1024 * 1024,
        retention_days: preferences.reading_cache_days,
    })
}

pub fn get(store: &Store, mail: &Mail) -> Result<Option<Vec<u8>>> {
    let preferences = store.preferences()?;
    let conn = store.db()?;
    let Some(cached) = record(&conn, &mail.id)? else {
        return Ok(None);
    };
    if preferences.reading_cache_days == 0
        || cached.account_id != mail.account_id
        || cached.header_hash != mail.hash
        || (!cached.message_id.is_empty()
            && !mail.message_id.is_empty()
            && cached.message_id != mail.message_id)
    {
        remove_record(&conn, store, &mail.id);
        return Ok(None);
    }
    let ttl = i64::from(preferences.reading_cache_days) * 24 * 60 * 60;
    if now_seconds().saturating_sub(cached.last_used_at) > ttl {
        remove_record(&conn, store, &mail.id);
        return Ok(None);
    }
    let Some(path) = file_path(store, &cached.cache_file) else {
        remove_record(&conn, store, &mail.id);
        return Ok(None);
    };
    let raw = match fs::read(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            remove_record(&conn, store, &mail.id);
            return Ok(None);
        }
        Err(error) => return Err(err(error)),
    };
    if raw.len() as u64 != cached.size || archive::digest(&raw) != cached.content_hash {
        remove_record(&conn, store, &mail.id);
        return Ok(None);
    }
    let _ = conn.execute(
        "UPDATE reading_cache SET last_used_at=?2 WHERE mail_id=?1",
        params![mail.id, now_seconds()],
    );
    Ok(Some(raw))
}

pub fn put(store: &Store, mail: &Mail, raw: &[u8]) -> Result<bool> {
    let preferences = store.preferences()?;
    if preferences.reading_cache_days == 0 {
        return Ok(false);
    }
    let limit = preferences.reading_cache_limit_mb * 1024 * 1024;
    if raw.is_empty() || raw.len() as u64 > limit {
        return Ok(false);
    }
    let current = store.mail(&mail.id)?;
    if current.saved_locally || current.hash != mail.hash {
        return Ok(false);
    }
    let dir = cache_dir(store);
    private_dir(&dir)?;
    let name = file_name(&current);
    let path = dir.join(&name);
    let content_hash = archive::digest(raw);
    if fs::read(&path).ok().as_deref() != Some(raw) {
        archive::atomic_write(&path, raw)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(err)?;
    }
    let size = raw.len() as i64;
    let now = now_seconds();
    store
        .db()?
        .execute(
            "INSERT INTO reading_cache(
                mail_id,account_id,header_hash,message_id,cache_file,content_hash,size,cached_at,last_used_at
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)
             ON CONFLICT(mail_id) DO UPDATE SET
                account_id=excluded.account_id,
                header_hash=excluded.header_hash,
                message_id=excluded.message_id,
                cache_file=excluded.cache_file,
                content_hash=excluded.content_hash,
                size=excluded.size,
                cached_at=excluded.cached_at,
                last_used_at=excluded.last_used_at",
            params![
                current.id,
                current.account_id,
                current.hash,
                current.message_id,
                name,
                content_hash,
                size,
                now
            ],
        )
        .map_err(err)?;
    prune(store)?;
    Ok(true)
}

pub fn prune(store: &Store) -> Result<()> {
    let preferences = store.preferences()?;
    let conn = store.db()?;
    if preferences.reading_cache_days == 0 {
        let ids = records_by_age(&conn)?
            .into_iter()
            .map(|(id, _, _, _)| id)
            .collect::<Vec<_>>();
        for id in ids {
            remove_record(&conn, store, &id);
        }
        prune_orphans(store, &conn)?;
        return Ok(());
    }
    let ttl = i64::from(preferences.reading_cache_days) * 24 * 60 * 60;
    let cutoff = now_seconds().saturating_sub(ttl);
    let expired = {
        let mut query = conn
            .prepare("SELECT mail_id FROM reading_cache WHERE last_used_at<?1")
            .map_err(err)?;
        let rows = query
            .query_map([cutoff], |row| row.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    for id in expired {
        remove_record(&conn, store, &id);
    }
    let limit = preferences.reading_cache_limit_mb * 1024 * 1024;
    let mut total = conn
        .query_row(
            "SELECT COALESCE(SUM(size),0) FROM reading_cache",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(err)?
        .max(0) as u64;
    if total > limit {
        for (id, _file, size, _last_used) in records_by_age(&conn)? {
            if total <= limit {
                break;
            }
            remove_record(&conn, store, &id);
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

pub fn maintenance(store: &Store) -> Result<()> {
    prune(store)?;
    let conn = store.db()?;
    prune_orphans(store, &conn)
}

pub fn clear(store: &Store) -> Result<ReadingCacheStatus> {
    {
        let conn = store.db()?;
        let rows = records_by_age(&conn)?;
        conn.execute("DELETE FROM reading_cache", []).map_err(err)?;
        for (_, file, _, _) in rows {
            remove_file(store, &file);
        }
        prune_orphans(store, &conn)?;
    }
    status(store)
}

pub fn remove_for_mail(store: &Store, mail_id: &str) -> Result<()> {
    let conn = store.db()?;
    remove_record(&conn, store, mail_id);
    Ok(())
}

pub fn remove_account(store: &Store, account_id: &str) -> Result<()> {
    let conn = store.db()?;
    let ids = {
        let mut query = conn
            .prepare("SELECT mail_id FROM reading_cache WHERE account_id=?1")
            .map_err(err)?;
        let rows = query
            .query_map([account_id], |row| row.get::<_, String>(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        rows
    };
    for id in ids {
        remove_record(&conn, store, &id);
    }
    Ok(())
}

pub fn validate_preferences(preferences: &Preferences) -> Result<()> {
    if preferences.reading_cache_days > MAX_RETENTION_DAYS {
        return Err("阅读缓存保留时间不能超过 3650 天".into());
    }
    if !(MIN_LIMIT_MB..=MAX_LIMIT_MB).contains(&preferences.reading_cache_limit_mb) {
        return Err("阅读缓存容量上限需在 64 MB 到 10 GB 之间".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::{Account, Mail},
        Store,
    };

    fn account(root: &Path) -> Account {
        let account = Account {
            id: "account".into(),
            email: "reader@example.com".into(),
            name: "Reader".into(),
            provider: "custom".into(),
            protocol: "imap".into(),
            incoming_host: "imap.example.com".into(),
            incoming_port: 993,
            incoming_tls: "tls".into(),
            smtp_host: "smtp.example.com".into(),
            smtp_port: 465,
            smtp_tls: "tls".into(),
            username: "reader@example.com".into(),
            smtp_username: "reader@example.com".into(),
            auth: "password".into(),
            oauth_client_id: String::new(),
            enabled: true,
            save_locally: false,
            server_retention_days: None,
            last_sync: None,
            error: None,
        };
        let store = Store::new(root.to_path_buf()).unwrap();
        store.save_account(&account).unwrap();
        account
    }

    fn online_mail(id: &str, raw: &[u8], account: &Account, folder: &str) -> Mail {
        let (mut mail, _, _) = archive::parse(raw, account, folder).unwrap();
        mail.id = id.into();
        mail.saved_locally = false;
        mail
    }

    fn insert_online(store: &Store, account: &Account, mail: &Mail) {
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO messages(id,account_id,hash,data) VALUES(?1,?2,?3,?4)",
                params![
                    mail.id,
                    account.id,
                    mail.hash,
                    serde_json::to_string(mail).unwrap()
                ],
            )
            .unwrap();
    }

    #[test]
    fn cached_content_expires_and_is_removed() {
        let dir = tempfile::tempdir().unwrap();
        let account = account(dir.path());
        let raw = b"From: a@example.com\r\nSubject: cache\r\n\r\nBody\r\n";
        let mail = online_mail("mail-1", raw, &account, "INBOX");
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        insert_online(&store, &account, &mail);
        assert!(put(&store, &mail, raw).unwrap());
        assert_eq!(get(&store, &mail).unwrap().as_deref(), Some(raw.as_slice()));

        store
            .db()
            .unwrap()
            .execute(
                "UPDATE reading_cache SET last_used_at=last_used_at-2592001",
                [],
            )
            .unwrap();
        assert!(get(&store, &mail).unwrap().is_none());
        assert_eq!(status(&store).unwrap().entries, 0);
    }

    #[test]
    fn cache_is_ignored_when_the_header_identity_changes() {
        let dir = tempfile::tempdir().unwrap();
        let account = account(dir.path());
        let raw = b"From: a@example.com\r\nSubject: old\r\n\r\nOld body\r\n";
        let mut mail = online_mail("mail-1", raw, &account, "INBOX");
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        insert_online(&store, &account, &mail);
        assert!(put(&store, &mail, raw).unwrap());

        mail.hash = archive::digest(b"different header");
        assert!(get(&store, &mail).unwrap().is_none());
        assert_eq!(status(&store).unwrap().entries, 0);
    }

    #[test]
    fn capacity_pruning_drops_least_recently_used_entries() {
        let dir = tempfile::tempdir().unwrap();
        let account = account(dir.path());
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let mut preferences = store.preferences().unwrap();
        preferences.reading_cache_limit_mb = 64;
        store.save_preferences(&preferences).unwrap();

        for (index, size) in [
            (1, 24 * 1024 * 1024),
            (2, 24 * 1024 * 1024),
            (3, 24 * 1024 * 1024),
        ] {
            let body = format!("Subject: {index}\r\n\r\n{}", "x".repeat(size));
            let raw = body.as_bytes();
            let mail = online_mail(&format!("mail-{index}"), raw, &account, "INBOX");
            insert_online(&store, &account, &mail);
            put(&store, &mail, raw).unwrap();
        }
        let status = status(&store).unwrap();
        assert!(status.bytes <= 64 * 1024 * 1024);
        assert!(status.entries <= 2);
    }
}
