//! Fixed-size SQL pages. Scope and revision bind every continuation cursor.
use crate::{conversation, models::*, search, store::Store};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{
    params, params_from_iter, types::Value, Connection, OptionalExtension, Transaction,
    TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    pub query: Query,
    #[serde(default)]
    pub cursor: String,
    #[serde(default)]
    pub date_from: String,
    #[serde(default)]
    pub date_before: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    #[serde(flatten)]
    pub snapshot: Snapshot,
    pub next_cursor: Option<String>,
    pub revision: i64,
    pub reset: bool,
    pub body_coverage: Coverage,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub known: u64,
    pub unknown: u64,
}
#[derive(Debug, Serialize)]
pub struct Neighbor {
    pub mail: Option<Mail>,
    pub revision: i64,
}
#[derive(Serialize, Deserialize)]
struct Cursor {
    version: u8,
    revision: i64,
    scope: String,
    instant: Option<f64>,
    id: String,
}
pub fn initialize(db: &Connection) -> Result<()> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate).map_err(err)?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS query_revision(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
        INSERT OR IGNORE INTO query_revision VALUES(1,1);
        CREATE TABLE IF NOT EXISTS graph_projection(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
        INSERT OR IGNORE INTO graph_projection VALUES(1,-1);
        CREATE TABLE IF NOT EXISTS conversation_members(mail_id TEXT PRIMARY KEY,root TEXT NOT NULL,trashed INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS conversation_members_root ON conversation_members(root,trashed);
        CREATE TABLE IF NOT EXISTS conversation_counts(root TEXT NOT NULL,trashed INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(root,trashed));
        DROP TRIGGER IF EXISTS listing_update;
        CREATE TRIGGER listing_update AFTER UPDATE OF data,account_id,id ON messages BEGIN
            UPDATE message_listing SET id=NEW.id,account_id=NEW.account_id,data=json_set(NEW.data,'$.body','') WHERE id=OLD.id;
            UPDATE conversation_revision SET version=version+1 WHERE OLD.id IS NOT NEW.id OR OLD.account_id IS NOT NEW.account_id OR
                json_extract(OLD.data,'$.messageId','$.serverMessageId','$.inReplyTo','$.references','$.trashed','$.savedLocally') IS NOT
                json_extract(NEW.data,'$.messageId','$.serverMessageId','$.inReplyTo','$.references','$.trashed','$.savedLocally');
        END;
        CREATE TRIGGER IF NOT EXISTS paging_message_insert AFTER INSERT ON messages BEGIN UPDATE query_revision SET version=version+1; END;
        CREATE TRIGGER IF NOT EXISTS paging_message_update AFTER UPDATE OF data,account_id,hash,id ON messages
            WHEN OLD.data IS NOT NEW.data OR OLD.account_id IS NOT NEW.account_id OR OLD.hash IS NOT NEW.hash OR OLD.id IS NOT NEW.id
            BEGIN UPDATE query_revision SET version=version+1; END;
        CREATE TRIGGER IF NOT EXISTS paging_message_delete AFTER DELETE ON messages BEGIN UPDATE query_revision SET version=version+1; END;
        CREATE TRIGGER IF NOT EXISTS paging_account_insert AFTER INSERT ON accounts BEGIN UPDATE query_revision SET version=version+1; END;
        CREATE TRIGGER IF NOT EXISTS paging_account_delete AFTER DELETE ON accounts BEGIN UPDATE query_revision SET version=version+1; END;
        CREATE TRIGGER IF NOT EXISTS paging_account_update AFTER UPDATE ON accounts
            WHEN OLD.id IS NOT NEW.id OR json_remove(OLD.data,'$.lastSync','$.error','$.name') IS NOT json_remove(NEW.data,'$.lastSync','$.error','$.name')
            BEGIN UPDATE query_revision SET version=version+1; END;
        ").map_err(err)?;
    for (table, changed) in [
        ("sources","OLD.active IS NOT NEW.active OR OLD.mail_id IS NOT NEW.mail_id OR OLD.folder IS NOT NEW.folder OR OLD.account_id IS NOT NEW.account_id OR OLD.remote_id IS NOT NEW.remote_id"),
        ("folder_health","OLD.account_id IS NOT NEW.account_id OR OLD.folder IS NOT NEW.folder OR OLD.identity IS NOT NEW.identity"),
        ("remote_folders","OLD.account_id IS NOT NEW.account_id OR OLD.name IS NOT NEW.name OR OLD.data IS NOT NEW.data"),
        ("outbox","OLD.id IS NOT NEW.id OR OLD.status IS NOT NEW.status"),
    ] {
        for action in ["insert", "delete", "update"] {
            let condition=if action=="update" {format!("WHEN {changed}")}else{String::new()};
            // Sources and server receipt changes may affect membership/filter
            // visibility even when no message JSON was updated.
            tx.execute_batch(&format!("DROP TRIGGER IF EXISTS paging_{table}_{action}; CREATE TRIGGER paging_{table}_{action} AFTER {action} ON {table} {condition} BEGIN UPDATE query_revision SET version=version+1; END;")).map_err(err)?;
        }
    }
    tx.commit().map_err(err)
}
fn graph_revision(db: &Connection) -> Result<i64> {
    db.query_row(
        "SELECT version FROM conversation_revision WHERE id=1",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}
fn projection_revision(db: &Connection) -> Result<i64> {
    db.query_row(
        "SELECT revision FROM graph_projection WHERE id=1",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}
fn materialize_graph(db: &Connection) -> Result<()> {
    let tx = Transaction::new_unchecked(db, TransactionBehavior::Immediate).map_err(err)?;
    let revision = graph_revision(&tx)?;
    if revision != projection_revision(&tx)? {
        let (graph, members) = conversation::projection(&tx)?;
        tx.execute_batch("DELETE FROM conversation_members; DELETE FROM conversation_counts;")
            .map_err(err)?;
        {
            let mut insert = tx
                .prepare("INSERT INTO conversation_members VALUES(?1,?2,?3)")
                .map_err(err)?;
            for m in members {
                insert
                    .execute(params![m.id, m.root, m.trashed])
                    .map_err(err)?;
            }
            let mut counts = tx
                .prepare("INSERT INTO conversation_counts VALUES(?1,?2,?3)")
                .map_err(err)?;
            for ((root, trashed), count) in graph.counts {
                counts.execute(params![root, trashed, count]).map_err(err)?;
            }
        }
        tx.execute(
            "UPDATE graph_projection SET revision=?1 WHERE id=1",
            [revision],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)
}
fn date_bound(input: &str) -> Result<Option<f64>> {
    if input.is_empty() {
        return Ok(None);
    }
    let date = chrono::DateTime::parse_from_rfc3339(input).map_err(|_| "时间筛选格式无效")?;
    // Match SQLite's integer Julian-millisecond numerator before division so
    // exact inclusive boundaries cannot shift by a floating addition ULP.
    Ok(Some(
        (210866760000000_i64 + date.timestamp_millis()) as f64 / 86400000.0,
    ))
}
fn decode(value: &str) -> Result<Option<Cursor>> {
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > 4096 {
        return Err("分页游标无效，请重新搜索".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| "分页游标无效，请重新搜索")?;
    let c: Cursor = serde_json::from_slice(&bytes).map_err(|_| "分页游标无效，请重新搜索")?;
    if c.version != 1
        || c.revision < 0
        || c.scope.len() != 64
        || c.id.is_empty()
        || c.instant.is_some_and(|v| !v.is_finite())
    {
        return Err("分页游标无效，请重新搜索".into());
    }
    Ok(Some(c))
}
fn scope(request: &PageRequest) -> Result<String> {
    let mut clean = request.clone();
    clean.cursor.clear();
    clean.query.limit = 0;
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&clean).map_err(err)?)
    ))
}
fn bindings(
    request: &PageRequest,
    from: Option<f64>,
    before: Option<f64>,
    searching: bool,
) -> Vec<Value> {
    let q = &request.query;
    vec![
        q.account_id.clone().into(),
        if searching {
            q.search.clone()
        } else {
            String::new()
        }
        .into(),
        q.folder.clone().into(),
        q.view.clone().into(),
        (q.unread_only as i64).into(),
        (q.starred_only as i64).into(),
        (q.attachments_only as i64).into(),
        q.search_field.clone().into(),
        q.remote_folder.clone().into(),
        if searching {
            search::phrase(&q.search).unwrap_or_default()
        } else {
            String::new()
        }
        .into(),
        from.into(),
        before.into(),
    ]
}
fn filtered(indexed: bool) -> String {
    // The projection carries scalar filters; only Sent's role/source fallback
    // still needs the small body-free JSON record.
    let mut where_sql = search::listing_predicate(indexed);
    for (json, column) in [
        ("localFolder", "local_folder"),
        ("isRead", "is_read"),
        ("trashed", "trashed"),
        ("starred", "starred"),
        ("hasAttachments", "has_attachments"),
    ] {
        where_sql = where_sql.replace(
            &format!("json_extract(data,'$.{json}')"),
            &format!("d.{column}"),
        );
    }
    where_sql = where_sql.replace(
        "COALESCE(json_extract(data,'$.savedLocally'),1)",
        "d.saved_locally",
    );
    format!("FROM readable_listing listing JOIN search_documents d ON d.mail_id=listing.id WHERE {where_sql} AND (?11 IS NULL OR d.instant>=?11) AND (?12 IS NULL OR d.instant<?12)")
}
fn units(request: &PageRequest) -> String {
    let source = filtered(search::phrase(&request.query.search).is_some());
    if request.query.list_mode == ListMode::Messages {
        return format!("WITH units AS (SELECT listing.id,d.instant,d.is_read,d.starred,d.has_attachments,'' AS root,1 AS count {source})");
    }
    format!("WITH eligible AS MATERIALIZED (SELECT listing.id,d.instant,d.is_read,d.starred,d.has_attachments,d.trashed,cm.root FROM readable_listing listing JOIN search_documents d ON d.mail_id=listing.id JOIN conversation_members cm ON cm.mail_id=listing.id WHERE {}),
        grouped AS (SELECT root,MIN(is_read) AS is_read,MAX(starred) AS starred,MAX(has_attachments) AS has_attachments FROM eligible GROUP BY root),
        ranked AS (SELECT id,instant,root,trashed,ROW_NUMBER() OVER(PARTITION BY root ORDER BY instant DESC,id ASC) AS n FROM eligible),
        units AS (SELECT r.id,r.instant,g.is_read,g.starred,g.has_attachments,r.root,c.count FROM ranked r JOIN grouped g ON g.root=r.root JOIN conversation_counts c ON c.root=r.root AND c.trashed=r.trashed WHERE n=1)",source.split_once(" WHERE ").expect("static filter").1)
}

impl Store {
    /// Jump next to the current reader without replaying every earlier page.
    /// The anchor may have left an unread filter; results still obey the current
    /// filter and never repeat the current conversation.
    pub fn mail_neighbor(
        &self,
        request: &PageRequest,
        id: &str,
        direction: &str,
    ) -> Result<Neighbor> {
        if !matches!(direction, "previous" | "next") || !request.cursor.is_empty() {
            return Err("阅读跳转参数无效".into());
        }
        let from = date_bound(&request.date_from)?;
        let before = date_bound(&request.date_before)?;
        if from.zip(before).is_some_and(|(a, b)| a >= b) {
            return Err("结束时间必须晚于开始时间".into());
        }
        self.read_listing(request.query.list_mode, |tx,revision| {
            let anchor:Option<(Option<f64>,Option<String>)>=tx.query_row("SELECT d.instant,cm.root FROM readable_listing listing JOIN search_documents d ON d.mail_id=listing.id LEFT JOIN conversation_members cm ON cm.mail_id=listing.id WHERE listing.id=?1 AND (?2='' OR listing.account_id=?2)",params![id,request.query.account_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(err)?;
            let (instant,root)=anchor.ok_or("当前邮件已无可用来源，无法跳转")?;
            let mut values=bindings(request,from,before,true);
            values.extend([instant.into(),id.to_string().into(),if request.query.list_mode==ListMode::Conversations {root.unwrap_or_default()}else{String::new()}.into()]);
            let (condition,order)=if direction=="next" {
                ("CASE WHEN ?13 IS NULL THEN u.instant IS NULL AND u.id>?14 ELSE u.instant<?13 OR u.instant IS NULL OR (u.instant=?13 AND u.id>?14) END","u.instant DESC,u.id ASC")
            }else{
                ("CASE WHEN ?13 IS NULL THEN u.instant IS NOT NULL OR (u.instant IS NULL AND u.id<?14) ELSE u.instant>?13 OR (u.instant=?13 AND u.id<?14) END","u.instant ASC,u.id DESC")
            };
            let sql=format!("{} SELECT listing.data,u.is_read,u.starred,u.has_attachments,u.root,u.count FROM units u JOIN message_listing listing ON listing.id=u.id WHERE ({condition}) AND (?15='' OR u.root!=?15) ORDER BY {order} LIMIT 1",units(request));
            let mut stmt=tx.prepare(&sql).map_err(err)?;let mut rows=stmt.query(params_from_iter(values.iter())).map_err(err)?;
            let mail=if let Some(row)=rows.next().map_err(err)? {
                let mut mail:Mail=serde_json::from_str(&row.get::<_,String>(0).map_err(err)?).map_err(err)?;
                mail.is_read=row.get(1).map_err(err)?;mail.starred=row.get(2).map_err(err)?;mail.has_attachments=row.get(3).map_err(err)?;mail.conversation_id=row.get(4).map_err(err)?;mail.conversation_count=row.get(5).map_err(err)?;
                Some(mail)
            }else{None};
            Ok(Neighbor{mail,revision})
        })
    }
    pub fn mail_page(&self, request: &PageRequest) -> Result<Page> {
        let from = date_bound(&request.date_from)?;
        let before = date_bound(&request.date_before)?;
        if from.zip(before).is_some_and(|(a, b)| a >= b) {
            return Err("结束时间必须晚于开始时间".into());
        }
        let old = decode(&request.cursor)?;
        let fingerprint = scope(request)?;
        if old.as_ref().is_some_and(|c| c.scope != fingerprint) {
            return Err("分页范围已变化，请重新搜索".into());
        }
        self.read_listing(request.query.list_mode, |tx, revision| {
            let reset = old.as_ref().is_some_and(|c| c.revision != revision);
            let cursor = old.as_ref().filter(|_| !reset);
            let cte = units(request);
            let values = bindings(request, from, before, true);
            let matched: u64 = tx
                .query_row(
                    &format!("{cte} SELECT COUNT(*) FROM units"),
                    params_from_iter(values.iter()),
                    |r| r.get(0),
                )
                .map_err(err)?;
            if let Some(c) = cursor {
                let mut anchor = values.clone();
                anchor.push(c.id.clone().into());
                anchor.push(c.instant.into());
                let exists:bool=tx.query_row(&format!("{cte} SELECT EXISTS(SELECT 1 FROM units WHERE id=?13 AND instant IS ?14)"),params_from_iter(anchor.iter()),|r|r.get(0)).map_err(err)?;
                if !exists {
                    return Err("分页位置无效，请重新搜索".into());
                }
            }
            let size = request.query.limit.clamp(1, 200) as usize;
            let mut page_values = values.clone();
            page_values.extend([
                (cursor.is_some() as i64).into(),
                cursor.and_then(|c| c.instant).into(),
                cursor.map(|c| c.id.clone()).unwrap_or_default().into(),
                ((size + 1) as i64).into(),
            ]);
            let sql=format!("{cte} SELECT listing.data,u.instant,u.is_read,u.starred,u.has_attachments,u.root,u.count FROM units u JOIN message_listing listing ON listing.id=u.id
                WHERE ?13=0 OR CASE WHEN ?14 IS NULL THEN u.instant IS NULL AND u.id>?15 ELSE u.instant<?14 OR u.instant IS NULL OR (u.instant=?14 AND u.id>?15) END
                ORDER BY u.instant DESC,u.id ASC LIMIT ?16");
            let mut stmt = tx.prepare(&sql).map_err(err)?;
            let mut rows = stmt
                .query(params_from_iter(page_values.iter()))
                .map_err(err)?;
            let mut messages = Vec::with_capacity(size);
            let mut last = None;
            let mut more = false;
            while let Some(row) = rows.next().map_err(err)? {
                if messages.len() == size {
                    more = true;
                    break;
                }
                let data: String = row.get(0).map_err(err)?;
                let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
                mail.is_read = row.get(2).map_err(err)?;
                mail.starred = row.get(3).map_err(err)?;
                mail.has_attachments = row.get(4).map_err(err)?;
                mail.conversation_id = row.get(5).map_err(err)?;
                mail.conversation_count = row.get(6).map_err(err)?;
                last = Some(Cursor {
                    version: 1,
                    revision,
                    scope: fingerprint.clone(),
                    instant: row.get(1).map_err(err)?,
                    id: mail.id.clone(),
                });
                messages.push(mail);
            }
            let next_cursor = if more {
                Some(
                    URL_SAFE_NO_PAD
                        .encode(serde_json::to_vec(&last.ok_or("分页内部状态无效")?).map_err(err)?),
                )
            } else {
                None
            };
            let coverage_sql = format!(
                "SELECT COALESCE(SUM(d.body_known),0),COUNT(*)-COALESCE(SUM(d.body_known),0) {}",
                filtered(false)
            );
            let body_coverage = tx
                .query_row(
                    &coverage_sql,
                    params_from_iter(bindings(request, from, before, false).iter()),
                    |r| {
                        Ok(Coverage {
                            known: r.get(0)?,
                            unknown: r.get(1)?,
                        })
                    },
                )
                .map_err(err)?;
            let snapshot = self.snapshot_metadata(&tx, messages, matched)?;
            return Ok(Page {
                snapshot,
                next_cursor,
                revision,
                reset,
                body_coverage,
            })
        })
    }
    fn read_listing<T>(
        &self,
        mode: ListMode,
        mut read: impl FnMut(&Connection, i64) -> Result<T>,
    ) -> Result<T> {
        let mut db = self.db()?;
        // No write lock during filtering/counting/reading. If topology changed,
        // materialize once separately and then pin a new coherent WAL snapshot.
        for _ in 0..4 {
            let tx = db.transaction().map_err(err)?;
            let revision: i64 = tx
                .query_row("SELECT version FROM query_revision WHERE id=1", [], |r| {
                    r.get(0)
                })
                .map_err(err)?;
            if mode == ListMode::Conversations && graph_revision(&tx)? != projection_revision(&tx)?
            {
                drop(tx);
                materialize_graph(&db)?;
                continue;
            }
            return read(&tx, revision);
        }
        Err("邮件列表持续变化，请刷新后重试".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        archive,
        tests::{account, query, raw},
    };
    use std::collections::HashSet;

    fn seed(size: usize) -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        let (base, _, _) = archive::parse(&raw(), &a, "INBOX").unwrap();
        let mut db = store.db().unwrap();
        let tx = db.transaction().unwrap();
        {
            let mut insert=tx.prepare("INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,3)").unwrap();
            let mut source=tx.prepare("INSERT INTO sources(account_id,folder,remote_id,mail_id) VALUES(?1,'INBOX',?2,?3)").unwrap();
            for i in 0..size {
                let mut m = base.clone();
                m.id = format!("fictional-{i:05}");
                m.hash = format!("synthetic-{i}");
                m.message_id = format!("<row-{i}@example.com>");
                m.references = if i > 0 && i % 10 == 0 {
                    vec![format!("<row-{}@example.com>", i - 1)]
                } else {
                    vec![]
                };
                m.date = if i == size - 1 {
                    String::new()
                } else {
                    "2026-10-10T19:53:37.001+08:00".into()
                };
                m.is_read = i % 3 == 0;
                m.starred = i % 5 == 0;
                m.has_attachments = i % 7 == 0;
                m.local_folder = if i % 2 == 0 { "Keep" } else { "全部存档" }.into();
                insert
                    .execute(params![
                        m.id,
                        a.id,
                        m.hash,
                        serde_json::to_string(&m).unwrap()
                    ])
                    .unwrap();
                source
                    .execute(params![a.id, format!("7:{i}"), m.id])
                    .unwrap();
            }
        }
        tx.commit().unwrap();
        (dir, store)
    }
    fn request(mode: ListMode, size: u32) -> PageRequest {
        PageRequest {
            query: Query {
                list_mode: mode,
                limit: size,
                ..query()
            },
            cursor: String::new(),
            date_from: String::new(),
            date_before: String::new(),
        }
    }
    fn all(store: &Store, mut r: PageRequest) -> Vec<Mail> {
        let mut list = vec![];
        let mut cursors = HashSet::new();
        loop {
            let page = store.mail_page(&r).unwrap();
            assert!(!page.reset);
            assert!(page.snapshot.messages.len() <= r.query.limit.min(200) as usize);
            assert!(page.snapshot.messages.iter().all(|m| m.body.is_empty()));
            list.extend(page.snapshot.messages);
            if let Some(c) = page.next_cursor {
                assert!(cursors.insert(c.clone()));
                r.cursor = c;
            } else {
                assert_eq!(list.len() as u64, page.snapshot.matched);
                break;
            }
        }
        assert_eq!(
            list.len(),
            list.iter().map(|m| &m.id).collect::<HashSet<_>>().len()
        );
        list
    }
    #[test]
    fn both_modes_page_past_5000_with_ties_unknown_dates_and_no_duplicate_threads() {
        let (_dir, store) = seed(6103);
        for mode in [ListMode::Messages, ListMode::Conversations] {
            let r = request(mode, 197);
            let list = all(&store, r.clone());
            assert!(list.len() > 5000);
            assert!(list.last().unwrap().date.is_empty());
            let old = store
                .snapshot(&Query {
                    limit: 5000,
                    list_mode: mode,
                    ..query()
                })
                .unwrap();
            assert_eq!(old.matched, list.len() as u64);
            assert_eq!(
                old.messages.iter().map(|m| &m.id).collect::<Vec<_>>(),
                list[..5000].iter().map(|m| &m.id).collect::<Vec<_>>()
            );
            if mode == ListMode::Conversations {
                assert_eq!(
                    list.len(),
                    list.iter()
                        .map(|m| &m.conversation_id)
                        .collect::<HashSet<_>>()
                        .len()
                );
                assert!(list.iter().any(|m| m.conversation_count == 2));
            }
        }
    }
    #[test]
    fn sql_group_state_and_scoped_search_match_legacy_before_limits() {
        let (_dir, store) = seed(31);
        for mode in [ListMode::Messages, ListMode::Conversations] {
            for filter in [
                "none",
                "unread",
                "starred",
                "attachments",
                "folder",
                "body",
                "sender",
                "remote",
            ] {
                let mut r = request(mode, 2);
                match filter {
                    "unread" => r.query.unread_only = true,
                    "starred" => r.query.starred_only = true,
                    "attachments" => r.query.attachments_only = true,
                    "folder" => r.query.folder = "Keep".into(),
                    "remote" => {
                        r.query.view = "all".into();
                        r.query.remote_folder = "INBOX".into();
                    }
                    "body" => {
                        r.query.search = "invoice".into();
                        r.query.search_field = "body".into();
                    }
                    "sender" => {
                        r.query.search = "alice".into();
                        r.query.search_field = "sender".into();
                    }
                    _ => {}
                }
                let paged = all(&store, r.clone());
                r.query.limit = 200;
                let old = store.snapshot(&r.query).unwrap();
                assert_eq!(
                    serde_json::to_value(&paged).unwrap(),
                    serde_json::to_value(&old.messages).unwrap(),
                    "mode={mode:?} filter={filter}"
                );
            }
        }
    }
    #[test]
    fn stale_cursor_resets_read_changes_without_rebuilding_topology_and_rejects_wrong_scopes() {
        let (_dir, store) = seed(21);
        let mut r = request(ListMode::Conversations, 2);
        let first = store.mail_page(&r).unwrap();
        r.cursor = first.next_cursor.unwrap();
        let db = store.db().unwrap();
        let topology = graph_revision(&db).unwrap();
        let materialized = projection_revision(&db).unwrap();
        let mut m = store.mail("fictional-00001").unwrap();
        m.is_read = true;
        store.update_mail(&m).unwrap();
        assert_eq!(graph_revision(&db).unwrap(), topology);
        assert_eq!(projection_revision(&db).unwrap(), materialized);
        let reset = store.mail_page(&r).unwrap();
        assert!(reset.reset);
        assert!(reset.revision > first.revision);
        assert_ne!(reset.next_cursor.as_ref(), Some(&r.cursor));
        r.query.folder = "Keep".into();
        assert!(store.mail_page(&r).unwrap_err().contains("范围已变化"));
        r.cursor = "invalid".into();
        assert!(store.mail_page(&r).unwrap_err().contains("游标无效"));
        m.references.push("<row-3@example.com>".into());
        store.update_mail(&m).unwrap();
        assert!(graph_revision(&db).unwrap() > topology);
    }
    #[test]
    fn date_boundaries_are_inclusive_exclusive_across_offsets_and_cursor_unknown_anchor_is_rejected(
    ) {
        let (_dir, store) = seed(6);
        let mut r = request(ListMode::Messages, 2);
        r.date_from = "2026-10-10T11:53:37.001Z".into();
        r.date_before = "2026-10-10T11:53:37.002Z".into();
        assert_eq!(all(&store, r.clone()).len(), 5);
        r.date_before = r.date_from.clone();
        assert!(store.mail_page(&r).unwrap_err().contains("结束时间"));
        r.date_from = "invalid".into();
        assert!(store.mail_page(&r).unwrap_err().contains("时间筛选"));
        r.date_from.clear();
        r.date_before.clear();
        let page = store.mail_page(&r).unwrap();
        let mut c = decode(&page.next_cursor.unwrap()).unwrap().unwrap();
        c.id = "no-such-anchor".into();
        r.cursor = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&c).unwrap());
        assert!(store.mail_page(&r).unwrap_err().contains("分页位置"));
    }
    #[test]
    fn coverage_and_trusted_visibility_share_filter_snapshot_and_source_changes_reset() {
        let (_dir, store) = seed(7);
        let mut m = store.mail("fictional-00001").unwrap();
        m.saved_locally = false;
        m.body.clear();
        store.update_mail(&m).unwrap();
        let mut r = request(ListMode::Messages, 2);
        r.query.view = "all".into();
        let page = store.mail_page(&r).unwrap();
        assert_eq!(
            (page.body_coverage.known, page.body_coverage.unknown),
            (6, 1)
        );
        r.cursor = page.next_cursor.unwrap();
        store
            .isolate_folder(
                &account(),
                "INBOX",
                "fictional invalid directory",
                &Default::default(),
            )
            .unwrap();
        let new = store.mail_page(&r).unwrap();
        assert!(new.reset);
        assert_eq!(new.snapshot.matched, 0);
        assert!(new.snapshot.messages.is_empty());
        assert_eq!(new.body_coverage.known + new.body_coverage.unknown, 0);
    }

    #[test]
    fn identical_sources_and_background_status_do_not_reset_a_valid_cursor() {
        let (_dir, store) = seed(12);
        let mut r = request(ListMode::Conversations, 2);
        let first = store.mail_page(&r).unwrap();
        r.cursor = first.next_cursor.unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "UPDATE sources SET active=active,mail_id=mail_id,remote_id=remote_id",
                [],
            )
            .unwrap();
        let mut a = account();
        a.last_sync = Some("2026-10-10T23:01:00+08:00".into());
        a.error = Some("fictional status".into());
        store.save_sync_status(&a).unwrap();
        let next = store.mail_page(&r).unwrap();
        assert!(!next.reset);
        assert_eq!(next.revision, first.revision);
        assert!(next.snapshot.messages.iter().all(|m| !first
            .snapshot
            .messages
            .iter()
            .any(|old| old.id == m.id)));
    }

    #[test]
    fn page_filters_counts_and_metadata_remain_on_one_wal_snapshot_while_writer_commits() {
        let (_dir, store) = seed(21);
        let r = request(ListMode::Messages, 3);
        let mut db = store.db().unwrap();
        let tx = db.transaction().unwrap();
        let revision: i64 = tx
            .query_row("SELECT version FROM query_revision WHERE id=1", [], |row| {
                row.get(0)
            })
            .unwrap();
        // A writer can commit without waiting for the reader's WAL snapshot.
        let mut changed = store.mail("fictional-00000").unwrap();
        changed.starred = false;
        store.update_mail(&changed).unwrap();
        let cte = units(&r);
        let vals = bindings(&r, None, None, true);
        let count: i64 = tx
            .query_row(
                &format!("{cte} SELECT COUNT(*) FROM units"),
                params_from_iter(vals.iter()),
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 21);
        let old_star: bool = tx
            .query_row(
                &format!("{cte} SELECT starred FROM units WHERE id='fictional-00000'"),
                params_from_iter(vals.iter()),
                |row| row.get(0),
            )
            .unwrap();
        assert!(old_star);
        let page = store.mail_page(&r).unwrap();
        assert!(page.revision > revision);
        assert!(!page.snapshot.messages[0].starred);
        assert_eq!(
            tx.query_row("SELECT version FROM query_revision WHERE id=1", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap(),
            revision
        );
    }
    #[test]
    fn reader_neighbors_seek_far_anchors_left_by_unread_filter_without_prefix_loading_or_same_thread(
    ) {
        let (_dir, store) = seed(6103);
        for mode in [ListMode::Messages, ListMode::Conversations] {
            let r = request(mode, 2);
            assert_eq!(
                store
                    .mail_neighbor(&r, "fictional-05000", "next")
                    .unwrap()
                    .mail
                    .unwrap()
                    .id,
                "fictional-05001"
            );
            let previous = store
                .mail_neighbor(&r, "fictional-05000", "previous")
                .unwrap()
                .mail
                .unwrap();
            assert_eq!(
                previous.id,
                if mode == ListMode::Conversations {
                    "fictional-04998"
                } else {
                    "fictional-04999"
                }
            );
            assert!(previous.body.is_empty());
        }
        let mut r = request(ListMode::Conversations, 2);
        r.query.unread_only = true;
        let mut anchor = store.mail("fictional-05000").unwrap();
        anchor.is_read = true;
        store.update_mail(&anchor).unwrap();
        let next = store
            .mail_neighbor(&r, &anchor.id, "next")
            .unwrap()
            .mail
            .unwrap();
        assert_eq!(next.id, "fictional-05002");
        assert!(!next.is_read);
        assert_eq!(
            store
                .mail_neighbor(&r, &anchor.id, "previous")
                .unwrap()
                .mail
                .unwrap()
                .id,
            "fictional-04997"
        );
        r.query.unread_only = false;
        assert!(store
            .mail_neighbor(&r, "fictional-06102", "next")
            .unwrap()
            .mail
            .is_none());
        assert_eq!(
            store
                .mail_neighbor(&r, "fictional-06102", "previous")
                .unwrap()
                .mail
                .unwrap()
                .id,
            "fictional-06101"
        );
        r.query.account_id = "different-account".into();
        assert!(store.mail_neighbor(&r, &anchor.id, "next").is_err());
        assert!(store
            .mail_neighbor(&r, &anchor.id, "invalid-direction")
            .is_err());
    }
}
