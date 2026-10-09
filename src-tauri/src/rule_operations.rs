//! Rules schedule existing durable directory operations. A match and its task
//! are committed together; repeats cannot replay COPY/MOVE, including failures.
use crate::{archive, models::*, rules, store::Store};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleExecution {
    pub id: String,
    pub rule_name: String,
    pub account_email: String,
    pub subject: String,
    pub action: String,
    pub source: String,
    pub target: String,
    pub status: String,
    pub error: String,
    pub operation_id: Option<String>,
    pub updated_at: String,
}

pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch(
        "CREATE TABLE IF NOT EXISTS rule_executions(
        id TEXT PRIMARY KEY,rule_id TEXT NOT NULL,mail_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,rule_data TEXT NOT NULL,data TEXT NOT NULL,
        operation_id TEXT,status TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,UNIQUE(rule_id,mail_id,fingerprint));
        CREATE INDEX IF NOT EXISTS rule_execution_recent ON rule_executions(updated_at);",
    )
    .map_err(err)
}
fn fingerprint(rule: &Rule) -> Result<String> {
    // Renaming/enabling a rule doesn't create a new remote action.
    let mut frozen = rule.clone();
    frozen.name.clear();
    frozen.enabled = true;
    Ok(archive::digest(&serde_json::to_vec(&frozen).map_err(err)?))
}
impl Store {
    pub fn rule_has_source(&self, rule: &Rule, mail: &Mail) -> Result<bool> {
        self.db()?.query_row("SELECT EXISTS(SELECT 1 FROM sources WHERE account_id=?1 AND mail_id=?2 AND folder=?3 AND active=1)",params![mail.account_id,mail.id,rule.source_folder],|r|r.get(0)).map_err(err)
    }
    pub fn apply_remote_rule(&self, rule: &Rule, mail: &Mail, retry: bool) -> Result<bool> {
        rules::validate(rule)?;
        if !rules::remote(rule)
            || rules::match_state(rule, mail, rules::body_available(&mail))
                != rules::MatchState::Match
        {
            return Err("邮件不匹配此服务器规则".into());
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let result = Self::apply_remote_rule_in(&tx, rule, mail, retry)?;
        tx.commit().map_err(err)?;
        Ok(result)
    }
    pub(crate) fn apply_remote_rule_in(
        tx: &rusqlite::Connection,
        rule: &Rule,
        mail: &Mail,
        retry: bool,
    ) -> Result<bool> {
        rules::validate(rule)?;
        let frozen = fingerprint(rule)?;
        let has_source: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM sources WHERE account_id=?1 AND mail_id=?2 AND folder=?3 AND active=1)",params![mail.account_id,mail.id,rule.source_folder],|r|r.get(0)).map_err(err)?;
        let existing: Option<(String, Option<String>, String)> = tx.query_row("SELECT id,operation_id,status FROM rule_executions WHERE rule_id=?1 AND mail_id=?2 AND fingerprint=?3",params![rule.id,mail.id,frozen],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(err)?;
        if !has_source {
            if retry {
                return Err("邮件已不在规则的来源文件夹，请重新收取后核对".into());
            }
            return Ok(false);
        }
        if let Some((_, task, status)) = &existing {
            if !retry {
                return Ok(true);
            } // Still counts as a match for stop ordering.
            if task.is_some() || status != "blocked" {
                return Err("已有服务器任务，请在设置的文件夹操作中处理，不会重复执行规则".into());
            }
        }
        let data: String = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&mail.account_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        let account: Account = serde_json::from_str(&data).map_err(err)?;
        // A savepoint leaves a rejected enqueue with no partial journal writes.
        tx.execute_batch("SAVEPOINT rule_enqueue").map_err(err)?;
        let source_count: u32 = tx.query_row("SELECT COUNT(*) FROM sources WHERE account_id=?1 AND mail_id=?2 AND folder=?3 AND active=1",params![mail.account_id,mail.id,rule.source_folder],|r|r.get(0)).map_err(err)?;
        let queued = if source_count != 1 {
            Err("来源目录包含多个邮件来源，无法确定规则操作对象，请先核对".into())
        } else if account.provider == "gmail" {
            Err("Gmail 标签规则尚未支持，请使用本地归类动作".into())
        } else {
            Self::queue_directory_in(
                &tx,
                mail,
                &rule.source_folder,
                &rule.destination,
                if rule.action == "serverCopy" {
                    "copy"
                } else {
                    "move"
                },
            )
        };
        let (operation_id, status, error) = match queued {
            Ok(id) => {
                tx.execute_batch("RELEASE rule_enqueue").map_err(err)?;
                (Some(id), "queued", String::new())
            }
            Err(error) => {
                tx.execute_batch("ROLLBACK TO rule_enqueue; RELEASE rule_enqueue;")
                    .map_err(err)?;
                (None, "blocked", error)
            }
        };
        let execution = RuleExecution {
            id: existing
                .map(|v| v.0)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            rule_name: rule.name.clone(),
            account_email: account.email,
            subject: mail.subject.clone(),
            action: rule.action.clone(),
            source: rule.source_folder.clone(),
            target: rule.destination.clone(),
            status: status.into(),
            error: error.clone(),
            operation_id: operation_id.clone(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        tx.execute("INSERT INTO rule_executions(id,rule_id,mail_id,fingerprint,rule_data,data,operation_id,status,error,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(rule_id,mail_id,fingerprint) DO UPDATE SET operation_id=excluded.operation_id,status=excluded.status,error=excluded.error,updated_at=excluded.updated_at",params![execution.id,rule.id,mail.id,frozen,serde_json::to_string(rule).map_err(err)?,serde_json::to_string(&execution).map_err(err)?,operation_id,status,error,execution.updated_at]).map_err(err)?;
        Ok(true)
    }
    pub fn retry_rule_execution(&self, id: &str) -> Result<()> {
        let (rule_id, mail_id, frozen): (String,String,String) = self.db()?.query_row("SELECT rule_id,mail_id,fingerprint FROM rule_executions WHERE id=?1 AND operation_id IS NULL AND status='blocked'",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|_| "此规则记录不能重试，请查看关联服务器任务")?;
        let rule = self
            .rules()?
            .into_iter()
            .find(|r| r.id == rule_id && r.enabled)
            .ok_or("规则已删除或停用，不能重试")?;
        if fingerprint(&rule)? != frozen {
            return Err("规则配置已变化，请预览新规则后执行，旧记录保留".into());
        }
        let mail = self.mail(&mail_id)?;
        if !rules::matches(&rule, &mail) {
            return Err("邮件已不再匹配规则".into());
        }
        self.apply_remote_rule(&rule, &mail, true)?;
        Ok(())
    }
    pub fn rule_executions(&self) -> Result<Vec<RuleExecution>> {
        let db = self.db()?;
        let mut st = db.prepare("SELECT e.data,CASE WHEN e.operation_id IS NOT NULL AND d.id IS NULL THEN 'blocked' ELSE COALESCE(d.status,e.status) END,CASE WHEN e.operation_id IS NOT NULL AND d.id IS NULL THEN '关联服务器任务已移除，请核对目录状态；不会自动重发' ELSE COALESCE(d.error,e.error) END,e.operation_id,e.updated_at FROM rule_executions e LEFT JOIN directory_operations d ON d.id=e.operation_id ORDER BY e.updated_at DESC,e.rowid DESC LIMIT 50").map_err(err)?;
        let rows = st
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })
            .map_err(err)?;
        rows.map(|row| {
            let (data, status, error, task, time) = row.map_err(err)?;
            let mut execution: RuleExecution = serde_json::from_str(&data).map_err(err)?;
            execution.status = status;
            execution.error = error;
            execution.operation_id = task;
            execution.updated_at = time;
            for name in [&mut execution.source, &mut execution.target] {
                *name = crate::remote::display_name(name);
            }
            Ok(execution)
        })
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn remote_rule(account: &Account, kind: &str) -> Rule {
        Rule {
            id: "remote-rule".into(),
            name: "复制发票".into(),
            account_id: account.id.clone(),
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "subject".into(),
                operator: "contains".into(),
                value: "invoice".into(),
            }],
            action: kind.into(),
            destination: "Archive".into(),
            source_folder: "INBOX".into(),
            stop: true,
        }
    }
    #[test]
    fn new_mail_and_repeated_scans_schedule_only_one_task_and_preserve_mime() {
        let (temp, store, a, id) = crate::directory_operations::tests::fixture();
        let r = remote_rule(&a, "serverCopy");
        store.save_rules(&[r]).unwrap();
        let before = store.mail(&id).unwrap();
        store
            .ingest(&a, "INBOX", "7:12", &crate::tests::raw(), false)
            .unwrap();
        store.run_rules().unwrap();
        store.run_rules().unwrap();
        assert_eq!(store.directory_operations().unwrap().len(), 1);
        let hit = store.rule_executions().unwrap().remove(0);
        assert_eq!(hit.status, "queued");
        assert!(hit.operation_id.is_some());
        assert_eq!(store.mail(&id).unwrap().local_folder, before.local_folder);
        assert_eq!(
            store.message_raw(&store.mail(&id).unwrap()).unwrap(),
            crate::tests::raw()
        );
        drop(store);
        let store = Store::new(temp.path().into()).unwrap();
        store.run_rules().unwrap();
        assert_eq!(store.rule_executions().unwrap().len(), 1);
        assert_eq!(store.directory_operations().unwrap().len(), 1);
    }
    #[test]
    fn journal_and_task_are_atomic_even_if_record_write_fails() {
        let (_temp, store, a, _id) = crate::directory_operations::tests::fixture();
        store.save_rules(&[remote_rule(&a, "serverMove")]).unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER reject_rule BEFORE INSERT ON rule_executions BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        assert!(store.run_rules().is_err());
        assert!(store.directory_operations().unwrap().is_empty());
        store
            .db()
            .unwrap()
            .execute_batch("DROP TRIGGER reject_rule")
            .unwrap();
        store.run_rules().unwrap();
        assert_eq!(store.directory_operations().unwrap().len(), 1);
    }
    #[test]
    fn isolated_source_reports_blocked_hit_stops_later_rules_and_requires_explicit_retry() {
        let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
        let r = remote_rule(&a, "serverCopy");
        let mut later = r.clone();
        later.id = "later".into();
        later.action = "trash".into();
        store.save_rules(&[r, later]).unwrap();
        store
            .isolate_folder(&a, "INBOX", "bad", &Default::default())
            .unwrap();
        store.run_rules().unwrap();
        let hit = store.rule_executions().unwrap().remove(0);
        assert_eq!(hit.status, "blocked");
        assert!(hit.error.contains("来源"));
        assert!(hit.operation_id.is_none());
        assert!(!store.mail(&id).unwrap().trashed);
        store.restore_folder_trust(&a, "INBOX").unwrap();
        store.run_rules().unwrap();
        assert!(store.directory_operations().unwrap().is_empty());
        store.retry_rule_execution(&hit.id).unwrap();
        assert_eq!(store.rule_executions().unwrap()[0].status, "queued");
    }
    #[test]
    fn submitted_move_never_replays_and_feedback_follows_the_directory_task() {
        let (_temp, store, a, _id) = crate::directory_operations::tests::fixture();
        store.save_rules(&[remote_rule(&a, "serverMove")]).unwrap();
        store.run_rules().unwrap();
        let hit = store.rule_executions().unwrap().remove(0);
        let op = store
            .directory_operation(hit.operation_id.as_ref().unwrap())
            .unwrap();
        store.claim_copy(&op).unwrap();
        store.submit_copy(&op, "hash").unwrap();
        store.fail_copy(&op.id, "Disconnected", false).unwrap();
        store.run_rules().unwrap();
        assert_eq!(store.rule_executions().unwrap()[0].status, "uncertain");
        assert_eq!(store.rule_executions().unwrap()[0].error, "Disconnected");
        assert!(store.retry_rule_execution(&hit.id).is_err());
        assert!(store.due_copies(&a.id).unwrap().is_empty());
        assert_eq!(store.directory_operations().unwrap().len(), 1);
    }
    #[test]
    fn later_discovered_source_triggers_remote_rules_but_respects_local_stop_rules() {
        let (_temp, store, a, _id) = crate::directory_operations::tests::fixture();
        let mut r = remote_rule(&a, "serverCopy");
        r.source_folder = "Later".into();
        store.save_rules(&[r.clone()]).unwrap();
        store.run_rules().unwrap();
        assert!(store.rule_executions().unwrap().is_empty());
        assert_eq!(store.preview_rule(&r).unwrap().len(), 0);
        store
            .ingest(&a, "Later", "8:2", &crate::tests::raw(), false)
            .unwrap();
        assert_eq!(store.directory_operations().unwrap().len(), 1);
        assert_eq!(store.preview_rule(&r).unwrap().len(), 1);
        let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
        let before = store.mail(&id).unwrap().local_folder;
        let mut first = r.clone();
        first.id = "first".into();
        first.action = "folder".into();
        first.destination = "local".into();
        store.save_rules(&[first, r]).unwrap();
        store
            .ingest(&a, "Later", "8:2", &crate::tests::raw(), false)
            .unwrap();
        assert!(store.rule_executions().unwrap().is_empty());
        // Deduplicated scans don't reapply local actions.
        assert_eq!(store.mail(&id).unwrap().local_folder, before);
    }
    #[test]
    fn changed_or_disabled_rules_cannot_retry_old_failures() {
        let (_temp, store, a, _) = crate::directory_operations::tests::fixture();
        let mut r = remote_rule(&a, "serverCopy");
        r.destination = "Missing".into();
        store.save_rules(&[r.clone()]).unwrap();
        store.run_rules().unwrap();
        let hit = store.rule_executions().unwrap().remove(0);
        r.destination = "Archive".into();
        store.save_rules(&[r.clone()]).unwrap();
        assert!(store
            .retry_rule_execution(&hit.id)
            .unwrap_err()
            .contains("配置已变化"));
        r.enabled = false;
        store.save_rules(&[r]).unwrap();
        assert!(store
            .retry_rule_execution(&hit.id)
            .unwrap_err()
            .contains("停用"));
    }
    #[test]
    fn ambiguous_sources_and_gmail_labels_never_enqueue() {
        let (_temp, store, mut a, id) = crate::directory_operations::tests::fixture();
        let r = remote_rule(&a, "serverCopy");
        store.save_rules(&[r]).unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO sources VALUES(?1,'INBOX','7:99',?2,1)",
                params![a.id, id],
            )
            .unwrap();
        store.run_rules().unwrap();
        assert!(store.rule_executions().unwrap()[0].error.contains("多个"));
        assert!(store.directory_operations().unwrap().is_empty());
        store
            .db()
            .unwrap()
            .execute("DELETE FROM sources WHERE remote_id='7:99'", [])
            .unwrap();
        a.provider = "gmail".into();
        store.save_account(&a).unwrap();
        store
            .retry_rule_execution(&store.rule_executions().unwrap()[0].id)
            .unwrap();
        assert!(store.rule_executions().unwrap()[0].error.contains("Gmail"));
        assert!(store.directory_operations().unwrap().is_empty());
    }
    #[test]
    fn remote_rule_validation_requires_scoped_source_and_different_target() {
        let a = crate::tests::account();
        let mut r = remote_rule(&a, "serverCopy");
        r.account_id.clear();
        assert!(rules::validate(&r).is_err());
        r.account_id = a.id;
        r.source_folder.clear();
        assert!(rules::validate(&r).is_err());
        r.source_folder = "Archive".into();
        assert!(rules::validate(&r).is_err());
        r.source_folder = "INBOX".into();
        r.destination = "Archive\r\nCOPY".into();
        assert!(rules::validate(&r).is_err());
    }
    #[test]
    fn concurrent_matches_share_one_task_and_rule_record() {
        let (_temp, store, a, _) = crate::directory_operations::tests::fixture();
        store.save_rules(&[remote_rule(&a, "serverCopy")]).unwrap();
        std::thread::scope(|scope| {
            let one = scope.spawn(|| store.run_rules().unwrap());
            let two = scope.spawn(|| store.run_rules().unwrap());
            one.join().unwrap();
            two.join().unwrap();
        });
        assert_eq!(store.rule_executions().unwrap().len(), 1);
        assert_eq!(store.directory_operations().unwrap().len(), 1);
    }
    #[test]
    fn first_ingest_can_schedule_and_backup_does_not_restore_pending_rule_tasks() {
        let (_temp, store, a, _) = crate::directory_operations::tests::fixture();
        store.save_rules(&[remote_rule(&a, "serverCopy")]).unwrap();
        let raw = crate::tests::raw();
        let mut unique = b"X-Rule-Fixture: new-mail\r\n".to_vec();
        unique.extend(raw);
        assert!(store.ingest(&a, "INBOX", "7:15", &unique, false).unwrap());
        assert_eq!(store.rule_executions().unwrap().len(), 1);
        let dest = tempfile::tempdir().unwrap();
        let path = store.backup(dest.path()).unwrap();
        let snap = rusqlite::Connection::open(std::path::Path::new(&path).join("snapshot.sqlite3"))
            .unwrap();
        assert_eq!(
            snap.query_row("SELECT COUNT(*) FROM rule_executions", [], |r| r
                .get::<_, u32>(0))
                .unwrap(),
            0
        );
        assert_eq!(store.rule_executions().unwrap().len(), 1);
    }
}
