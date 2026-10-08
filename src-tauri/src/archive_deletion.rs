use crate::{models::*, store::Store};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::{collections::BTreeMap, fs, path::Path};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveScope {
    account_id: String,
    name: String,
    email: String,
    count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        archive,
        tests::{account, query, raw},
    };
    fn seeded() -> (tempfile::TempDir, Store, Account) {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let a = account();
        store.save_account(&a).unwrap();
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        (temp, store, a)
    }
    fn remove(store: &Store, account: &str, stop: bool, count: usize) -> Result<DeletionResult> {
        let token = store.archive_deletion_preview(account)?.review_token;
        store.delete_local_archives(account, stop, count, &token)
    }
    #[test]
    fn changed_remote_availability_invalidates_review_even_with_same_count() {
        let (_temp, store, a) = seeded();
        let preview = store.archive_deletion_preview(&a.id).unwrap();
        store
            .db()
            .unwrap()
            .execute("UPDATE sources SET active=0", [])
            .unwrap();
        assert!(store
            .delete_local_archives(&a.id, true, preview.count, &preview.review_token)
            .is_err());
        assert!(store.account(&a.id).unwrap().save_locally);
        assert_eq!(store.archive_deletion_preview(&a.id).unwrap().count, 1);
        assert!(archive::read_raw(&store.root, &archive::digest(&raw())).is_ok());
    }
    #[test]
    fn cleanup_keeps_online_identity_actions_and_blocks_stale_retention() {
        let (_temp, store, a) = seeded();
        let before = store.snapshot(&query()).unwrap().messages[0].clone();
        store.change_mail(&before.id, "star", "true").unwrap();
        let preview = store.archive_deletion_preview(&a.id).unwrap();
        assert_eq!((preview.count, preview.offline_only), (1, 0));
        let result = remove(&store, &a.id, true, 1).unwrap();
        assert_eq!(result.deleted, 1);
        assert!(result.freed_bytes > 0);
        assert!(!result.cleanup_pending);
        assert!(!store.account(&a.id).unwrap().save_locally);
        let after = store.mail(&before.id).unwrap();
        assert!(!after.saved_locally);
        assert!(after.body.is_empty());
        assert!(after.starred);
        assert!(store.source(&after.id).is_ok());
        assert_eq!(store.snapshot(&query()).unwrap().stats.saved, 0);
        assert!(archive::read_raw(&store.root, &after.hash).is_err());
        store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
        assert!(!store.mail(&before.id).unwrap().saved_locally);
        assert!(!store
            .root
            .join("archive")
            .join(format!("{}.eml", before.hash))
            .exists());
    }
    #[test]
    fn account_scope_preserves_shared_file_and_other_accounts_until_last_copy() {
        let (_temp, store, a) = seeded();
        let mut b = a.clone();
        b.id = "second".into();
        b.email = "b@example.com".into();
        store.save_account(&b).unwrap();
        store.ingest(&b, "INBOX", "8:1", &raw(), false).unwrap();
        let hash = archive::digest(&raw());
        assert_eq!(store.archive_deletion_preview("").unwrap().count, 2);
        let first = remove(&store, &a.id, true, 1).unwrap();
        assert_eq!(first.freed_bytes, 0);
        assert!(archive::read_raw(&store.root, &hash).is_ok());
        assert!(store.account(&b.id).unwrap().save_locally);
        assert_eq!(store.archive_deletion_preview("").unwrap().count, 1);
        let second = remove(&store, &b.id, false, 1).unwrap();
        assert!(second.freed_bytes > 0);
        assert!(archive::read_raw(&store.root, &hash).is_err());
        assert!(store.account(&b.id).unwrap().save_locally);
    }
    #[test]
    fn removed_account_and_app_sent_copies_are_explicitly_offline() {
        let (_temp, store, a) = seeded();
        store.remove_account(&a.id).unwrap();
        let preview = store.archive_deletion_preview("").unwrap();
        assert_eq!(preview.offline_only, 1);
        assert_eq!(preview.accounts[0].name, "已移除账号");
        assert_eq!(remove(&store, "", true, 1).unwrap().offline_removed, 1);
        assert_eq!(store.snapshot(&query()).unwrap().stats.total, 0);
        store.save_account(&a).unwrap();
        store
            .ingest(&a, "Sent", "draft-uuid", &raw(), true)
            .unwrap();
        assert_eq!(store.archive_deletion_preview("").unwrap().offline_only, 1);
    }
    #[test]
    fn changed_count_and_database_failure_leave_archives_and_settings_intact() {
        let (_temp, store, a) = seeded();
        let hash = archive::digest(&raw());
        assert!(remove(&store, &a.id, true, 2).is_err());
        store.db().unwrap().execute_batch("CREATE TRIGGER fail_cleanup BEFORE INSERT ON logs BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        assert!(remove(&store, &a.id, true, 1).is_err());
        assert!(archive::read_raw(&store.root, &hash).is_ok());
        assert_eq!(store.archive_deletion_preview("").unwrap().count, 1);
        assert!(store.account(&a.id).unwrap().save_locally);
        assert!(!store.root.join(".archive-deletion").exists());
    }
    #[test]
    fn interrupted_cleanup_restores_referenced_files_and_discards_committed_files() {
        let (_temp, store, _) = seeded();
        let hash = archive::digest(&raw());
        let stage = store.root.join(".archive-deletion").join("interrupted");
        fs::create_dir_all(&stage).unwrap();
        fs::rename(
            store.root.join("archive").join(format!("{hash}.eml")),
            stage.join(format!("{hash}.eml")),
        )
        .unwrap();
        let unused = archive::digest(b"unreferenced MIME");
        fs::write(stage.join(format!("{unused}.eml")), b"unreferenced MIME").unwrap();
        let reopened = Store::new(store.root.clone()).unwrap();
        assert!(archive::read_raw(&reopened.root, &hash).is_ok());
        assert!(!stage.exists());
        assert!(!reopened
            .root
            .join("archive")
            .join(format!("{unused}.eml"))
            .exists());
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionPreview {
    pub count: usize,
    pub bytes: u64,
    pub offline_only: usize,
    pub review_token: String,
    pub accounts: Vec<ArchiveScope>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionResult {
    pub deleted: usize,
    pub offline_removed: usize,
    pub freed_bytes: u64,
    pub cleanup_pending: bool,
}
fn valid_hash(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit())
}
fn targets(db: &Connection, account: &str) -> Result<Vec<(Mail, bool)>> {
    let mut q = db.prepare("SELECT data FROM messages WHERE (?1='' OR account_id=?1) AND COALESCE(json_extract(data,'$.savedLocally'),1)=1").map_err(err)?;
    let mails = q
        .query_map([account], |r| r.get::<_, String>(0))
        .map_err(err)?
        .map(|r| serde_json::from_str::<Mail>(&r.map_err(err)?).map_err(err))
        .collect::<Result<Vec<_>>>()?;
    let mut result = Vec::new();
    for mail in mails {
        if !valid_hash(&mail.hash) {
            return Err("存档标识无效，请先校验存档".into());
        }
        // App-created Sent sources use draft IDs, not server UIDs. They must
        // not be mistaken for remotely readable messages after deleting MIME.
        let mut sources = db.prepare("SELECT s.folder,s.remote_id,json_extract(a.data,'$.protocol') FROM sources s JOIN accounts a ON a.id=s.account_id WHERE s.mail_id=?1 AND s.active=1").map_err(err)?;
        let online = sources
            .query_map([&mail.id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err)?
            .into_iter()
            .any(|(folder, remote, protocol)| {
                if protocol == "pop3" {
                    return folder.eq_ignore_ascii_case("INBOX");
                }
                let parts: Vec<_> = remote.split(':').collect();
                parts.len() >= 2
                    && (parts[0] == "content" || parts[0].parse::<u32>().is_ok())
                    && parts[1].parse::<u32>().is_ok()
            });
        result.push((mail, online));
    }
    Ok(result)
}
fn review_token(mails: &[(Mail, bool)]) -> String {
    let mut scope: Vec<_> = mails
        .iter()
        .map(|(m, online)| (&m.id, &m.hash, *online))
        .collect();
    scope.sort();
    crate::archive::digest(&serde_json::to_vec(&scope).expect("serializable archive scope"))
}
impl Store {
    pub fn archive_deletion_preview(&self, account: &str) -> Result<DeletionPreview> {
        let db = self.db()?;
        let mails = targets(&db, account)?;
        let accounts = self.accounts()?;
        let mut scopes = BTreeMap::<String, ArchiveScope>::new();
        let mut bytes = 0;
        let mut offline_only = 0;
        for (mail, online) in &mails {
            bytes += mail.size;
            offline_only += usize::from(!online);
            let current = accounts.iter().find(|a| a.id == mail.account_id);
            let scope = scopes
                .entry(mail.account_id.clone())
                .or_insert_with(|| ArchiveScope {
                    account_id: mail.account_id.clone(),
                    name: current
                        .map(|a| a.name.clone())
                        .unwrap_or_else(|| "已移除账号".into()),
                    email: mail.account_email.clone(),
                    count: 0,
                });
            scope.count += 1;
        }
        Ok(DeletionPreview {
            count: mails.len(),
            bytes,
            offline_only,
            review_token: review_token(&mails),
            accounts: scopes.into_values().collect(),
        })
    }
    pub fn delete_local_archives(
        &self,
        account: &str,
        stop_saving: bool,
        expected_count: usize,
        expected_token: &str,
    ) -> Result<DeletionResult> {
        let _archive = self.archive_gate.write().map_err(err)?;
        self.recover_archive_deletion()?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mails = targets(&tx, account)?;
        if mails.len() != expected_count || review_token(&mails) != expected_token {
            return Err("存档范围已变化，请重新查看删除范围后确认".into());
        }
        if mails.is_empty() {
            return Err("所选范围没有本地存档".into());
        }
        let mut offline_removed = 0;
        let mut hashes = std::collections::BTreeSet::new();
        for (mail, online) in &mails {
            hashes.insert(mail.hash.clone());
            tx.execute("UPDATE archive_jobs SET status='cancelled',revision=revision+1,error='本地存档已清理' WHERE mail_id=?1",[&mail.id]).map_err(err)?;
            if *online {
                tx.execute("UPDATE messages SET data=json_set(data,'$.savedLocally',json('false'),'$.body','') WHERE id=?1", [&mail.id]).map_err(err)?;
            } else {
                tx.execute("DELETE FROM sources WHERE mail_id=?1", [&mail.id])
                    .map_err(err)?;
                tx.execute("DELETE FROM messages WHERE id=?1", [&mail.id])
                    .map_err(err)?;
                offline_removed += 1;
            }
        }
        if stop_saving {
            tx.execute("UPDATE archive_jobs SET status='cancelled',revision=revision+1,error='已停止本地保存' WHERE (?1='' OR json_extract(data,'$.accountId')=?1) AND status NOT IN ('completed','cancelled')",[account]).map_err(err)?;
            tx.execute("UPDATE accounts SET data=json_set(data,'$.saveLocally',json('false')) WHERE ?1='' OR id=?1", [account]).map_err(err)?;
            tx.execute(
                "DELETE FROM folder_retention WHERE ?1='' OR account_id=?1",
                [account],
            )
            .map_err(err)?;
        }
        let stage = self
            .root
            .join(".archive-deletion")
            .join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&stage).map_err(err)?;
        let result = (|| -> Result<u64> {
            let mut bytes = 0;
            for hash in hashes {
                let used: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE hash=?1 AND COALESCE(json_extract(data,'$.savedLocally'),1)=1)", [&hash], |r| r.get(0)).map_err(err)?;
                if used {
                    continue;
                } // Other accounts may share the same MIME file.
                let from = self.root.join("archive").join(format!("{hash}.eml"));
                match fs::symlink_metadata(&from) {
                    Ok(metadata) if metadata.is_file() => {
                        fs::rename(&from, stage.join(format!("{hash}.eml"))).map_err(err)?;
                        bytes += metadata.len();
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Ok(_) => return Err("存档路径不是普通文件，已取消删除".into()),
                    Err(e) => return Err(err(e)),
                }
            }
            tx.execute(
                "INSERT INTO logs(time,message) VALUES(?1,?2)",
                params![
                    chrono::Local::now().format("%m-%d %H:%M").to_string(),
                    format!(
                        "清理本地存档：{} 封，移除仅本地邮件 {} 封",
                        mails.len(),
                        offline_removed
                    )
                ],
            )
            .map_err(err)?;
            tx.commit().map_err(err)?;
            Ok(bytes)
        })();
        // Rollback or process interruption restores still-referenced files.
        // After commit recovery removes only files with no saved references.
        let cleanup = self.recover_archive_deletion();
        let bytes = result.map_err(|e| match &cleanup {
            Ok(_) => e,
            Err(c) => format!("{e}；存档回滚待完成：{c}"),
        })?;
        Ok(DeletionResult {
            deleted: mails.len(),
            offline_removed,
            freed_bytes: if cleanup.is_ok() { bytes } else { 0 },
            cleanup_pending: cleanup.is_err(),
        })
    }
    pub(crate) fn recover_archive_deletion(&self) -> Result<()> {
        let staging = self.root.join(".archive-deletion");
        if !staging.exists() {
            return Ok(());
        }
        let db = self.db()?;
        for entry in fs::read_dir(&staging).map_err(err)? {
            let entry = entry.map_err(err)?;
            if !entry.file_type().map_err(err)?.is_dir() {
                return Err("存档清理暂存目录无效".into());
            }
            for file in fs::read_dir(entry.path()).map_err(err)? {
                let file = file.map_err(err)?;
                let name = file.file_name().to_string_lossy().into_owned();
                let hash = name
                    .strip_suffix(".eml")
                    .filter(|h| valid_hash(h))
                    .ok_or("存档清理暂存文件无效")?;
                if !file.file_type().map_err(err)?.is_file() {
                    return Err("存档清理暂存文件类型无效".into());
                }
                let used: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM messages WHERE hash=?1 AND COALESCE(json_extract(data,'$.savedLocally'),1)=1)", [hash], |r| r.get(0)).map_err(err)?;
                if used {
                    let target = self.root.join("archive").join(Path::new(&name));
                    if !target.exists() {
                        fs::rename(file.path(), target).map_err(err)?;
                    } else {
                        crate::archive::read_raw(&self.root, hash)?;
                        fs::remove_file(file.path()).map_err(err)?;
                    }
                } else {
                    fs::remove_file(file.path()).map_err(err)?;
                }
            }
            fs::remove_dir(entry.path()).map_err(err)?;
        }
        fs::remove_dir(staging).map_err(err)
    }
}
