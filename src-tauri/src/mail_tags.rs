use crate::{models::*, store::Store};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS mail_tags(
            name TEXT PRIMARY KEY COLLATE NOCASE,
            position INTEGER NOT NULL
        );",
    )
    .map_err(err)
}

pub(crate) fn names(db: &Connection) -> Result<Vec<String>> {
    let mut query = db
        .prepare("SELECT name FROM mail_tags ORDER BY position,name COLLATE NOCASE")
        .map_err(err)?;
    let names = query
        .query_map([], |row| row.get(0))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    Ok(names)
}

fn validated_name(value: &str) -> Result<String> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 48 || name.contains(['\r', '\n', '\0']) {
        return Err("标签名称需为 1–48 个字符，且不能包含换行".into());
    }
    Ok(name.into())
}

fn canonical_tag(db: &Connection, name: &str) -> Result<String> {
    db.query_row(
        "SELECT name FROM mail_tags WHERE name=?1 COLLATE NOCASE",
        [name],
        |row| row.get(0),
    )
    .optional()
    .map_err(err)?
    .ok_or_else(|| "标签不存在".into())
}

fn replace_tag(tags: &mut Vec<String>, current: &str, replacement: &str) {
    for tag in tags.iter_mut() {
        if tag.eq_ignore_ascii_case(current) {
            *tag = replacement.into();
        }
    }
    let mut seen = std::collections::HashSet::new();
    tags.retain(|tag| seen.insert(tag.to_lowercase()));
}

impl Store {
    pub fn create_mail_tag(&self, name: &str) -> Result<String> {
        let name = validated_name(name)?;
        let db = self.db()?;
        let position: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(position),-1)+1 FROM mail_tags",
                [],
                |row| row.get(0),
            )
            .map_err(err)?;
        db.execute(
            "INSERT INTO mail_tags(name,position) VALUES(?1,?2)",
            params![name, position],
        )
        .map_err(|error| {
            if error.sqlite_error_code() == Some(rusqlite::ErrorCode::ConstraintViolation) {
                "已有同名标签".into()
            } else {
                err(error)
            }
        })?;
        Ok(name)
    }

    pub fn rename_mail_tag(&self, current: &str, replacement: &str) -> Result<()> {
        let current = validated_name(current)?;
        let replacement = validated_name(replacement)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let current = canonical_tag(&tx, &current)?;
        if current == replacement {
            return Ok(());
        }
        let collision: bool = tx
            .query_row(
                "SELECT EXISTS(
                   SELECT 1 FROM mail_tags WHERE name=?1 COLLATE NOCASE AND name<>?2
                 )",
                params![replacement, current],
                |row| row.get(0),
            )
            .map_err(err)?;
        if collision {
            return Err("已有同名标签".into());
        }
        tx.execute(
            "UPDATE mail_tags SET name=?2 WHERE name=?1",
            params![current, replacement],
        )
        .map_err(err)?;
        let rows = {
            let mut query = tx
                .prepare(
                    "SELECT data FROM messages
                     WHERE EXISTS(
                       SELECT 1 FROM json_each(data,'$.tags') WHERE value=?1 COLLATE NOCASE
                     )",
                )
                .map_err(err)?;
            let values = query
                .query_map([&current], |row| row.get::<_, String>(0))
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
            drop(query);
            values
        };
        for data in rows {
            let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
            replace_tag(&mut mail.tags, &current, &replacement);
            tx.execute(
                "UPDATE messages SET data=?2 WHERE id=?1",
                params![mail.id, serde_json::to_string(&mail).map_err(err)?],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }

    pub fn delete_mail_tag(&self, name: &str) -> Result<u64> {
        let name = validated_name(name)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let name = canonical_tag(&tx, &name)?;
        let rows = {
            let mut query = tx
                .prepare(
                    "SELECT data FROM messages
                     WHERE EXISTS(
                       SELECT 1 FROM json_each(data,'$.tags') WHERE value=?1 COLLATE NOCASE
                     )",
                )
                .map_err(err)?;
            let values = query
                .query_map([&name], |row| row.get::<_, String>(0))
                .map_err(err)?
                .collect::<std::result::Result<Vec<_>, _>>()
                .map_err(err)?;
            drop(query);
            values
        };
        let mut affected = 0;
        for data in rows {
            let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
            let before = mail.tags.len();
            mail.tags.retain(|tag| !tag.eq_ignore_ascii_case(&name));
            if mail.tags.len() != before {
                affected += 1;
                tx.execute(
                    "UPDATE messages SET data=?2 WHERE id=?1",
                    params![mail.id, serde_json::to_string(&mail).map_err(err)?],
                )
                .map_err(err)?;
            }
        }
        tx.execute("DELETE FROM mail_tags WHERE name=?1", [&name])
            .map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(affected)
    }

    pub fn set_mail_tag(&self, id: &str, name: &str, enabled: bool) -> Result<()> {
        let selected = self.mail(id)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(err)?;
        let name = canonical_tag(&tx, name)?;
        let rows = tx
            .prepare(
                "SELECT data FROM messages
                 WHERE id=?1 OR (
                   account_id=?2 AND (
                     (?3!='' AND json_extract(data,'$.messageId')=?3) OR
                     (?4!='' AND COALESCE(
                       NULLIF(json_extract(data,'$.serverMessageId'),''),
                       json_extract(data,'$.messageId')
                     )=?4)
                   )
                 )",
            )
            .map_err(err)?
            .query_map(
                params![
                    id,
                    selected.account_id,
                    selected.message_id,
                    if selected.server_message_id.is_empty() {
                        &selected.message_id
                    } else {
                        &selected.server_message_id
                    }
                ],
                |row| row.get::<_, String>(0),
            )
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?;
        for data in rows {
            let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
            mail.tags.retain(|tag| !tag.eq_ignore_ascii_case(&name));
            if enabled {
                mail.tags.push(name.clone());
            }
            tx.execute(
                "UPDATE messages SET data=?2 WHERE id=?1",
                params![mail.id, serde_json::to_string(&mail).map_err(err)?],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        models::ListMode,
        tests::{account, query, raw},
    };

    #[test]
    fn tag_catalog_crud_and_filters_keep_messages_intact() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let account = account();
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "tag-1", &raw(), false)
            .unwrap();
        let other = String::from_utf8(raw())
            .unwrap()
            .replace("Project invoice", "Second invoice");
        store
            .ingest(&account, "INBOX", "tag-2", other.as_bytes(), false)
            .unwrap();
        let messages = store.snapshot(&query()).unwrap().messages;
        let first = messages
            .iter()
            .find(|mail| mail.subject == "Project invoice")
            .unwrap()
            .clone();
        let total_before = messages.len();

        assert_eq!(store.create_mail_tag("  项目  ").unwrap(), "项目");
        assert!(store.create_mail_tag("项目").is_err());
        store.set_mail_tag(&first.id, "项目", true).unwrap();
        let tagged = store
            .snapshot(&Query {
                tag: "项目".into(),
                list_mode: ListMode::Messages,
                ..query()
            })
            .unwrap();
        assert_eq!(tagged.matched, 1);
        assert_eq!(tagged.messages[0].tags, vec!["项目"]);
        assert_eq!(tagged.tags, vec!["项目"]);
        let page = store
            .mail_page(&crate::paging::PageRequest {
                query: Query {
                    tag: "项目".into(),
                    list_mode: ListMode::Messages,
                    limit: 1,
                    ..query()
                },
                cursor: String::new(),
                date_from: String::new(),
                date_before: String::new(),
            })
            .unwrap();
        assert_eq!(page.snapshot.matched, 1);
        assert_eq!(page.snapshot.messages[0].tags, vec!["项目"]);

        store.rename_mail_tag("项目", "客户").unwrap();
        let renamed = store
            .snapshot(&Query {
                tag: "客户".into(),
                list_mode: ListMode::Messages,
                ..query()
            })
            .unwrap();
        assert_eq!(renamed.matched, 1);
        assert_eq!(renamed.tags, vec!["客户"]);
        assert_eq!(store.delete_mail_tag("客户").unwrap(), 1);
        assert_eq!(
            store.snapshot(&query()).unwrap().messages.len(),
            total_before
        );
        assert!(store.mail(&first.id).unwrap().tags.is_empty());
        assert!(store
            .snapshot(&Query {
                tag: "客户".into(),
                ..query()
            })
            .unwrap()
            .messages
            .is_empty());
    }

    #[test]
    fn complete_archive_upgrade_preserves_local_tags() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let mut account = account();
        account.save_locally = false;
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "upgrade", &raw(), false)
            .unwrap();
        let mail = store
            .snapshot(&Query {
                view: "all".into(),
                ..query()
            })
            .unwrap()
            .messages
            .remove(0);
        store.create_mail_tag("待处理").unwrap();
        store.set_mail_tag(&mail.id, "待处理", true).unwrap();
        account.save_locally = true;
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "upgrade", &raw(), false)
            .unwrap();
        assert_eq!(store.mail(&mail.id).unwrap().tags, vec!["待处理"]);
    }
}
