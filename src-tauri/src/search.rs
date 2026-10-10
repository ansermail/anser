//! Transactional derived search data. Never reads or rewrites original MIME.
use crate::models::{err, Result};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior};

const VERSION: i64 = 2;
const COLUMNS: &str = "mail_id,account_id,subject,sender,recipients,body,all_text,instant,is_read,starred,trashed,has_attachments,saved_locally,local_folder,body_known,fts_safe";

pub fn initialize(db: &Connection) -> Result<()> {
    // Acquire the write lock before reading the schema marker so concurrent
    // initializations cannot both rebuild, or upgrade a stale WAL snapshot.
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate).map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS search_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);").map_err(err)?;
    let version: Option<i64> = tx
        .query_row("SELECT version FROM search_schema WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(err)?;
    if version.is_some_and(|v| v > VERSION) {
        return Err("检索索引来自较新版本，请使用新版应用".into());
    }
    let objects: i64 = tx.query_row("SELECT COUNT(*) FROM sqlite_schema WHERE name IN ('search_documents','search_fts','search_source','search_message_insert','search_message_update','search_message_delete','search_text_insert','search_text_update','search_text_delete','search_account_time','search_time','search_unindexable')", [], |r| r.get(0)).map_err(err)?;
    if version == Some(VERSION) && objects == 12 {
        return tx.commit().map_err(err);
    }
    // Rebuild only derived objects, atomically. Missing objects or an interrupted
    // migration must not leave a valid marker with a partially populated index.
    tx.execute_batch("DROP TRIGGER IF EXISTS search_message_insert;
        DROP TRIGGER IF EXISTS search_message_update;
        DROP TRIGGER IF EXISTS search_message_delete;
        DROP TRIGGER IF EXISTS search_text_insert;
        DROP TRIGGER IF EXISTS search_text_update;
        DROP TRIGGER IF EXISTS search_text_delete;
        DROP TABLE IF EXISTS search_fts;
        DROP TABLE IF EXISTS search_documents;
        DROP VIEW IF EXISTS search_source;
        CREATE TABLE search_documents(
            rowid INTEGER PRIMARY KEY,mail_id TEXT NOT NULL UNIQUE,account_id TEXT NOT NULL,
            subject TEXT NOT NULL,sender TEXT NOT NULL,recipients TEXT NOT NULL,body TEXT NOT NULL,
            all_text TEXT NOT NULL,instant REAL,is_read INTEGER NOT NULL,starred INTEGER NOT NULL,
            trashed INTEGER NOT NULL,has_attachments INTEGER NOT NULL,saved_locally INTEGER NOT NULL,
            local_folder TEXT NOT NULL,body_known INTEGER NOT NULL,fts_safe INTEGER NOT NULL);
        CREATE INDEX search_account_time ON search_documents(account_id,instant DESC,mail_id);
        CREATE INDEX search_time ON search_documents(instant DESC,mail_id);
        CREATE INDEX search_unindexable ON search_documents(rowid) WHERE fts_safe=0;
        CREATE VIRTUAL TABLE search_fts USING fts5(all_text,content='search_documents',content_rowid='rowid',tokenize='trigram');
        CREATE VIEW search_source AS WITH projected AS (SELECT id AS mail_id,account_id,
            COALESCE(json_extract(data,'$.subject'),'') AS subject,
            COALESCE(json_extract(data,'$.sender'),'') AS sender,
            COALESCE(json_extract(data,'$.recipients'),'') AS recipients,
            COALESCE(json_extract(data,'$.body'),'') AS body,
            COALESCE(json_extract(data,'$.subject'),'') || ' ' || COALESCE(json_extract(data,'$.sender'),'') || ' ' || COALESCE(json_extract(data,'$.recipients'),'') || ' ' || COALESCE(json_extract(data,'$.body'),'') AS all_text,
            julianday(json_extract(data,'$.date')) AS instant,
            COALESCE(json_extract(data,'$.isRead'),0) AS is_read,
            COALESCE(json_extract(data,'$.starred'),0) AS starred,
            COALESCE(json_extract(data,'$.trashed'),0) AS trashed,
            COALESCE(json_extract(data,'$.hasAttachments'),0) AS has_attachments,
            COALESCE(json_extract(data,'$.savedLocally'),1) AS saved_locally,
            COALESCE(json_extract(data,'$.localFolder'),'全部存档') AS local_folder,
            COALESCE(json_extract(data,'$.savedLocally'),1)=1 AND NOT EXISTS(
                SELECT 1 FROM json_each(messages.data,'$.parseWarnings') w WHERE
                w.value LIKE 'text/plain 正文片段无法解码：%' OR w.value LIKE 'text/html 正文片段无法解码：%') AS body_known
            FROM messages) SELECT projected.*,instr(all_text,char(0))=0 AS fts_safe FROM projected;
        CREATE TRIGGER search_text_insert AFTER INSERT ON search_documents BEGIN
            INSERT INTO search_fts(rowid,all_text) VALUES(NEW.rowid,NEW.all_text); END;
        CREATE TRIGGER search_text_delete AFTER DELETE ON search_documents BEGIN
            INSERT INTO search_fts(search_fts,rowid,all_text) VALUES('delete',OLD.rowid,OLD.all_text); END;
        CREATE TRIGGER search_text_update AFTER UPDATE OF all_text ON search_documents
            WHEN OLD.all_text IS NOT NEW.all_text BEGIN
            INSERT INTO search_fts(search_fts,rowid,all_text) VALUES('delete',OLD.rowid,OLD.all_text);
            INSERT INTO search_fts(rowid,all_text) VALUES(NEW.rowid,NEW.all_text); END;
        ").map_err(err)?;
    tx.execute_batch(&format!("CREATE TRIGGER search_message_insert AFTER INSERT ON messages BEGIN
            INSERT INTO search_documents({COLUMNS}) SELECT {COLUMNS} FROM search_source WHERE mail_id=NEW.id; END;
        CREATE TRIGGER search_message_update AFTER UPDATE OF data,account_id,id ON messages BEGIN
            UPDATE search_documents SET ({COLUMNS})=(SELECT {COLUMNS} FROM search_source WHERE mail_id=NEW.id) WHERE mail_id=OLD.id; END;
        CREATE TRIGGER search_message_delete AFTER DELETE ON messages BEGIN
            DELETE FROM search_documents WHERE mail_id=OLD.id; END;
        INSERT INTO search_documents({COLUMNS}) SELECT {COLUMNS} FROM search_source;
        INSERT INTO search_schema VALUES(1,{VERSION}) ON CONFLICT(id) DO UPDATE SET version=excluded.version;")).map_err(err)?;
    tx.commit().map_err(err)
}

/// MATCH is only a candidate accelerator. Quoted literal phrases never execute
/// user Boolean syntax; short/NUL inputs retain the original substring scan.
pub fn phrase(input: &str) -> Option<String> {
    (input.chars().count() >= 3 && !input.contains('\0'))
        .then(|| format!("\"{}\"", input.replace('"', "\"\"")))
}

pub fn predicate(indexed: bool) -> String {
    let candidates = if indexed {
        // FTS truncates at embedded NUL. Such derived text still participates
        // in exact scans; never strip or rewrite MIME to make it indexable.
        "AND rowid IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?10 UNION ALL SELECT rowid FROM search_documents WHERE fts_safe=0)"
    } else {
        "AND ?10=''"
    };
    // Preserve field restrictions, exact ASCII-insensitive substring semantics
    // and cross-field concatenation. FTS Unicode folding may be broader, so it
    // cannot itself decide the final result. Trusted provenance stays outside.
    format!("(?2='' OR listing.id IN (SELECT mail_id FROM search_documents WHERE instr(lower(CASE ?8 WHEN 'subject' THEN subject WHEN 'sender' THEN sender WHEN 'recipients' THEN recipients WHEN 'body' THEN body ELSE all_text END),lower(?2))>0 {candidates}))")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        archive,
        models::*,
        store::Store,
        tests::{account, query, raw},
    };
    use rusqlite::params;

    fn fixture() -> (tempfile::TempDir, Store, Mail) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        store.ingest(&a, "INBOX", "1", &raw(), false).unwrap();
        let id = store.snapshot(&query()).unwrap().messages.remove(0).id;
        let mail = store.mail(&id).unwrap();
        (dir, store, mail)
    }
    fn search(store: &Store, term: &str, field: &str) -> Vec<String> {
        store
            .snapshot(&Query {
                search: term.into(),
                search_field: field.into(),
                list_mode: ListMode::Messages,
                ..query()
            })
            .unwrap()
            .messages
            .into_iter()
            .map(|m| m.id)
            .collect()
    }
    fn integrity(db: &Connection) {
        db.execute(
            "INSERT INTO search_fts(search_fts,rank) VALUES('integrity-check',1)",
            [],
        )
        .unwrap();
    }
    #[test]
    fn migration_and_missing_index_recovery_keep_original_metadata_and_bytes() {
        let (dir, store, original) = fixture();
        let raw = archive::read_raw(dir.path(), &original.hash).unwrap();
        let db = store.db().unwrap();
        db.execute("DELETE FROM search_schema", []).unwrap();
        initialize(&db).unwrap();
        assert_eq!(search(&store, "invoice", "body"), vec![original.id.clone()]);
        db.execute_batch("DROP TABLE search_fts").unwrap();
        initialize(&db).unwrap();
        integrity(&db);
        assert_eq!(store.mail(&original.id).unwrap().hash, original.hash);
        assert_eq!(
            serde_json::to_value(store.mail(&original.id).unwrap()).unwrap(),
            serde_json::to_value(&original).unwrap()
        );
        assert_eq!(archive::read_raw(dir.path(), &original.hash).unwrap(), raw);
        let rowid: i64 = db
            .query_row(
                "SELECT rowid FROM search_documents WHERE mail_id=?1",
                [&original.id],
                |r| r.get(0),
            )
            .unwrap();
        initialize(&db).unwrap();
        assert_eq!(
            rowid,
            db.query_row(
                "SELECT rowid FROM search_documents WHERE mail_id=?1",
                [&original.id],
                |r| r.get::<_, i64>(0)
            )
            .unwrap()
        );
    }
    #[test]
    fn projection_and_fts_follow_updates_deletes_and_transaction_rollbacks() {
        let (_dir, store, mut mail) = fixture();
        let mut db = store.db().unwrap();
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .unwrap();
        mail.body = "待撤销预算审核".into();
        tx.execute(
            "UPDATE messages SET data=?2 WHERE id=?1",
            params![mail.id, serde_json::to_string(&mail).unwrap()],
        )
        .unwrap();
        tx.rollback().unwrap();
        assert!(search(&store, "预算审核", "body").is_empty());
        assert_eq!(search(&store, "invoice", "body"), vec![mail.id.clone()]);
        mail.body = "预算审核已通过 ABC_100% \"quoted\"".into();
        mail.is_read = true;
        mail.starred = true;
        store.update_mail(&mail).unwrap();
        assert!(search(&store, "invoice", "body").is_empty());
        assert_eq!(search(&store, "预算审核", "body"), vec![mail.id.clone()]);
        assert_eq!(
            db.query_row(
                "SELECT is_read,starred FROM search_documents WHERE mail_id=?1",
                [&mail.id],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))
            )
            .unwrap(),
            (1, 1)
        );
        integrity(&db);
        db.execute("DELETE FROM messages WHERE id=?1", [&mail.id])
            .unwrap();
        assert!(search(&store, "预算审核", "body").is_empty());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM search_documents", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        integrity(&db);
    }
    #[test]
    fn chinese_short_words_symbols_quotes_unicode_and_cross_field_literals_keep_old_semantics() {
        let (_dir, store, mut mail) = fixture();
        mail.subject = "项目预算审核 Foo".into();
        mail.sender = "Bar <abc@example.com>".into();
        mail.recipients = "接收人@example.com".into();
        mail.body =
            "ABC_100% \"literal\" NOT OR café CAFÉ emoji😀😃😄 中文，标点 分隔   空格 \0尾部标记"
                .into();
        store.update_mail(&mail).unwrap();
        let db = store.db().unwrap();
        // Exercise the indexed path as well as the NUL fallback. A sole unsafe
        // row would otherwise make every candidate query pass via scanning.
        let mut safe = mail.clone();
        safe.id = "fictional-safe-text".into();
        safe.hash = "fictional-search-hash".into();
        safe.body = safe.body.replace('\0', "");
        db.execute(
            "INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,3)",
            params![
                safe.id,
                safe.account_id,
                safe.hash,
                serde_json::to_string(&safe).unwrap()
            ],
        )
        .unwrap();
        assert_eq!(
            db.query_row(
                "SELECT COUNT(*) FROM search_documents WHERE fts_safe=1",
                [],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            1
        );
        for field in ["subject", "sender", "recipients", "body", "", "unknown"] {
            for term in [
                "预",
                "预算",
                "预算审核",
                "项目预",
                "Foo Bar",
                "ABC_",
                "100%",
                "\"literal\"",
                "NOT",
                "OR",
                "café",
                "CAFÉ",
                "CAFé",
                "😀😃😄",
                "中文，",
                "尾部标记",
                "\0尾部",
                "   ",
                "\" OR \"",
                "abc@example.com",
                "接收人",
            ] {
                let expected:i64=db.query_row("SELECT COUNT(*) FROM messages WHERE instr(lower(CASE ?1 WHEN 'subject' THEN json_extract(data,'$.subject') WHEN 'sender' THEN json_extract(data,'$.sender') WHEN 'recipients' THEN json_extract(data,'$.recipients') WHEN 'body' THEN json_extract(data,'$.body') ELSE json_extract(data,'$.subject')||' '||json_extract(data,'$.sender')||' '||json_extract(data,'$.recipients')||' '||json_extract(data,'$.body') END),lower(?2))>0",params![field,term],|r|r.get(0)).unwrap();
                assert_eq!(
                    search(&store, term, field).len() as i64,
                    expected,
                    "field={field:?} term={term:?}"
                );
            }
        }
        integrity(&db);
    }
    #[test]
    fn unknown_body_and_quarantined_sources_do_not_gain_visibility_from_fts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let mut a = account();
        a.save_locally = false;
        store.save_account(&a).unwrap();
        store.ingest(&a, "INBOX", "1", &raw(), false).unwrap();
        let mut q = query();
        q.view = "all".into();
        q.search = "Project invoice".into();
        let m = store.snapshot(&q).unwrap().messages.remove(0);
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row(
                    "SELECT body_known,body FROM search_documents WHERE mail_id=?1",
                    [&m.id],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
                )
                .unwrap(),
            (0, String::new())
        );
        q.search = "Please keep".into();
        q.search_field = "body".into();
        assert!(store.snapshot(&q).unwrap().messages.is_empty());
        store
            .isolate_folder(
                &a,
                "INBOX",
                "fictional contradictory directory",
                &Default::default(),
            )
            .unwrap();
        q.search = "Project invoice".into();
        q.search_field = "subject".into();
        assert!(store.snapshot(&q).unwrap().messages.is_empty());
        assert_eq!(
            store
                .db()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM search_fts WHERE search_fts MATCH ?1",
                    [phrase(&q.search).unwrap()],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn parser_repair_refreshes_existing_index_and_preserves_user_actions() {
        let (dir, store, mut mail) = fixture();
        let original = archive::read_raw(dir.path(), &mail.hash).unwrap();
        mail.body = "stale-derived-text".into();
        mail.is_read = true;
        mail.starred = true;
        mail.local_folder = "Keep".into();
        store.update_mail(&mail).unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE messages SET parser_version=1 WHERE id=?1",
                [&mail.id],
            )
            .unwrap();
        assert_eq!(
            search(&store, "stale-derived-text", "body"),
            vec![mail.id.clone()]
        );
        let reopened = Store::new(dir.path().into()).unwrap();
        assert!(search(&reopened, "stale-derived-text", "body").is_empty());
        assert_eq!(search(&reopened, "invoice", "body"), vec![mail.id.clone()]);
        let repaired = reopened.mail(&mail.id).unwrap();
        assert!(repaired.is_read && repaired.starred);
        assert_eq!(repaired.local_folder, "Keep");
        assert_eq!(repaired.hash, mail.hash);
        assert_eq!(archive::read_raw(dir.path(), &mail.hash).unwrap(), original);
        integrity(&reopened.db().unwrap());
    }
}
