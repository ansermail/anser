//! Ordered rule continuations. Only metadata and a read proof are durable;
//! fetched online bodies remain in memory unless a save action is matched.
use crate::{
    archive,
    archive_jobs::{self, ArchiveJob},
    models::*,
    operations, rules,
    store::Store,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuleRun {
    pub id: String,
    pub mail_id: String,
    pub source: ArchiveJob,
    pub configuration: String,
    pub rules: Vec<Rule>,
    pub remote_only: bool,
    #[serde(default)]
    pub retry_queues: bool,
    pub cursor: usize,
    pub applied: u32,
    pub local_state: String,
    pub operations: Vec<String>,
    pub status: String,
    pub revision: i64,
    pub error: String,
    pub updated_at: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleRunView {
    pub id: String,
    pub account_email: String,
    pub subject: String,
    pub step: String,
    pub cursor: usize,
    pub total: usize,
    pub applied: u32,
    pub status: String,
    pub error: String,
    pub updated_at: String,
}
pub fn initialize(db: &rusqlite::Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS rule_runs(id TEXT PRIMARY KEY,mail_id TEXT NOT NULL UNIQUE,data TEXT NOT NULL,status TEXT NOT NULL,cursor INTEGER NOT NULL,revision INTEGER NOT NULL,error TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS rule_runs_pending ON rule_runs(status,updated_at);
    UPDATE rule_runs SET status='queued',revision=revision+1,error='应用退出后继续规则处理' WHERE status='running';").map_err(err)
}
pub(crate) fn configuration(rs: &[Rule]) -> Result<String> {
    let mut rs = rs.to_vec();
    for rule in &mut rs {
        rule.name.clear();
    }
    Ok(archive::digest(&serde_json::to_vec(&rs).map_err(err)?))
}
fn current_configuration(db: &rusqlite::Connection) -> Result<String> {
    let mut q = db
        .prepare("SELECT data FROM rules ORDER BY position")
        .map_err(err)?;
    let rows = q.query_map([], |r| r.get::<_, String>(0)).map_err(err)?;
    let rs = rows
        .map(|r| serde_json::from_str::<Rule>(&r.map_err(err)?).map_err(err))
        .collect::<Result<Vec<_>>>()?;
    configuration(&rs)
}
fn local_state(m: &Mail) -> Result<String> {
    serde_json::to_string(&(
        m.local_read_override,
        m.local_star_override,
        &m.local_folder,
        m.trashed,
    ))
    .map_err(err)
}
fn check_local_intent(job: &RuleRun, m: &Mail, rule: &Rule) -> Result<()> {
    let (read, star, folder, trashed): (Option<bool>, Option<bool>, String, bool) =
        serde_json::from_str(&job.local_state).map_err(|_| "旧规则任务缺少意图记录，请重新检查")?;
    let changed = match rule.action.as_str() {
        "read" | "unread" => read != m.local_read_override,
        "star" => star != m.local_star_override,
        "folder" | "saveFolder" => folder != m.local_folder,
        "trash" => trashed != m.trashed,
        _ => false,
    };
    if changed {
        return Err("此字段已被用户修改，未覆盖新的标记或归类；请核对后重试".into());
    }
    Ok(())
}
fn advance_local_intent(job: &mut RuleRun, m: &Mail, rule: &Rule) -> Result<()> {
    let mut state: (Option<bool>, Option<bool>, String, bool) =
        serde_json::from_str(&job.local_state).map_err(err)?;
    match rule.action.as_str() {
        "read" | "unread" => state.0 = m.local_read_override,
        "star" => state.1 = m.local_star_override,
        "folder" | "saveFolder" => state.2 = m.local_folder.clone(),
        "trash" => state.3 = m.trashed,
        _ => {}
    }
    job.local_state = serde_json::to_string(&state).map_err(err)?;
    Ok(())
}
const COLUMNS: &str = "data,status,cursor,revision,error,updated_at";
fn decode(row: &rusqlite::Row<'_>) -> rusqlite::Result<RuleRun> {
    let mut job: RuleRun = serde_json::from_str(&row.get::<_, String>(0)?).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    job.status = row.get(1)?;
    job.cursor = row.get(2)?;
    job.revision = row.get(3)?;
    job.error = row.get(4)?;
    job.updated_at = row.get(5)?;
    Ok(job)
}
fn read_plan(db: &rusqlite::Connection, m: &Mail) -> Result<ArchiveJob> {
    let account: Option<String> = db
        .query_row(
            "SELECT data FROM accounts WHERE id=?1",
            [&m.account_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let account = account
        .map(|a| serde_json::from_str::<Account>(&a).map_err(err))
        .transpose()?;
    let source: Option<(String,String)> = db.query_row("SELECT folder,remote_id FROM trusted_sources WHERE account_id=?1 AND mail_id=?2 AND active=1 ORDER BY folder='INBOX' COLLATE NOCASE DESC,folder,remote_id LIMIT 1",params![m.account_id,m.id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
    let (folder, remote_id) = source.unwrap_or_default();
    Ok(ArchiveJob {
        id: String::new(),
        mail_id: m.id.clone(),
        account_id: m.account_id.clone(),
        account_email: m.account_email.clone(),
        subject: m.subject.clone(),
        folder,
        remote_id,
        identity: account
            .as_ref()
            .map(operations::identity)
            .unwrap_or_default(),
        expected_hash: m.hash.clone(),
        status: "read".into(),
        error: String::new(),
        revision: 0,
        updated_at: String::new(),
    })
}
fn content_matches(plan: &ArchiveJob, m: &Mail, hash: &str, header_hash: &str) -> Result<()> {
    if hash != plan.expected_hash && header_hash != plan.expected_hash {
        return Err("规则原件内容已变化，未执行后续动作".into());
    }
    if m.saved_locally && m.hash != hash {
        return Err("邮件已被另一原件替代，未执行旧规则任务".into());
    }
    Ok(())
}
fn load(db: &rusqlite::Connection, id: &str) -> Result<RuleRun> {
    db.query_row(
        &format!("SELECT {COLUMNS} FROM rule_runs WHERE id=?1"),
        [id],
        decode,
    )
    .map_err(err)
}
fn guard(
    db: &rusqlite::Connection,
    expected: &RuleRun,
    hash: &str,
    header_hash: &str,
) -> Result<(RuleRun, Account, Mail)> {
    let job = load(db, &expected.id)?;
    if job.status != "running" || job.revision != expected.revision {
        return Err("规则处理已暂停、取消或重新安排".into());
    }
    if current_configuration(db)? != job.configuration {
        return Err("规则配置已变化，旧任务不再执行".into());
    }
    let (a, m) = archive_jobs::proof(db, &job.source)?;
    content_matches(&job.source, &m, hash, header_hash)?;
    Ok((job, a, m))
}
fn write(db: &rusqlite::Connection, job: &mut RuleRun) -> Result<()> {
    job.updated_at = chrono::Utc::now().to_rfc3339();
    db.execute("UPDATE rule_runs SET data=?2,status=?3,cursor=?4,error=?5,updated_at=?6 WHERE id=?1 AND revision=?7",params![job.id,serde_json::to_string(job).map_err(err)?,job.status,job.cursor,job.error,job.updated_at,job.revision]).map_err(err)?;
    Ok(())
}
pub(crate) fn cancel_in(db: &rusqlite::Connection, ids: &[String]) -> Result<()> {
    let ids = serde_json::to_string(ids).map_err(err)?;
    db.execute("UPDATE directory_operations SET status='cancelled',error='规则处理已取消，未提交服务器操作' WHERE status IN ('queued','preparing','blocked') AND id IN (SELECT j.value FROM rule_runs r JOIN json_each(r.data,'$.operations') j WHERE r.status NOT IN ('completed','cancelled') AND r.id IN (SELECT value FROM json_each(?1)))",[&ids]).map_err(err)?;
    db.execute("UPDATE rule_runs SET status='cancelled',revision=revision+1,error='规则处理已取消' WHERE status NOT IN ('completed','cancelled') AND id IN (SELECT value FROM json_each(?1))",[ids]).map_err(err)?;
    Ok(())
}
pub(crate) fn cancel_account_in(db: &rusqlite::Connection, account: &str) -> Result<()> {
    let mut q=db.prepare("SELECT id FROM rule_runs WHERE status NOT IN ('completed','cancelled') AND (?1='' OR json_extract(data,'$.source.accountId')=?1)").map_err(err)?;
    let ids = q
        .query_map([account], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    cancel_in(db, &ids)
}
pub(crate) fn cancel_mail_in(db: &rusqlite::Connection, mail: &str) -> Result<()> {
    let id: Option<String> = db
        .query_row(
            "SELECT id FROM rule_runs WHERE mail_id=?1 AND status NOT IN ('completed','cancelled')",
            [mail],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    cancel_in(db, &id.into_iter().collect::<Vec<_>>())
}

impl Store {
    pub(crate) fn defer_rules(
        &self,
        mail: &Mail,
        configured: &[Rule],
        offset: usize,
        remote_only: bool,
    ) -> Result<bool> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let fingerprint = configuration(configured)?;
        if current_configuration(&tx)? != fingerprint {
            return Err("规则配置已变化，请重新执行".into());
        }
        let old = tx
            .query_row(
                &format!("SELECT {COLUMNS} FROM rule_runs WHERE mail_id=?1"),
                [&mail.id],
                decode,
            )
            .optional()
            .map_err(err)?;
        if old.as_ref().is_some_and(|j| {
            j.configuration == fingerprint
                && !matches!(j.status.as_str(), "completed" | "cancelled")
        }) {
            return Ok(true);
        }
        if old.as_ref().is_some_and(|j| {
            j.configuration == fingerprint && remote_only && j.status == "completed"
        }) {
            return Ok(true);
        }
        let data: String = tx
            .query_row("SELECT data FROM messages WHERE id=?1", [&mail.id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let m: Mail = serde_json::from_str(&data).map_err(err)?;
        if m.hash != mail.hash {
            return Err("邮件原件已变化，请重新执行规则".into());
        }
        let source = read_plan(&tx, &m)?;
        let failure = archive_jobs::proof(&tx, &source).err();
        let job = RuleRun {
            id: old
                .as_ref()
                .map(|j| j.id.clone())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            mail_id: m.id.clone(),
            source,
            configuration: fingerprint,
            rules: configured[offset..].to_vec(),
            remote_only,
            retry_queues: false,
            cursor: 0,
            applied: 0,
            local_state: local_state(&m)?,
            operations: Vec::new(),
            status: if failure.is_some() {
                "blocked"
            } else {
                "queued"
            }
            .into(),
            revision: old.map(|j| j.revision + 1).unwrap_or(1),
            error: failure.unwrap_or_default(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        tx.execute("INSERT INTO rule_runs VALUES(?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(mail_id) DO UPDATE SET data=excluded.data,status=excluded.status,cursor=excluded.cursor,revision=excluded.revision,error=excluded.error,updated_at=excluded.updated_at",params![job.id,job.mail_id,serde_json::to_string(&job).map_err(err)?,job.status,job.cursor,job.revision,job.error,job.updated_at]).map_err(err)?;
        tx.commit().map_err(err)?;
        Ok(true)
    }
    pub fn rule_runs(&self) -> Result<Vec<RuleRunView>> {
        let db = self.db()?;
        let mut q = db
            .prepare(&format!(
                "SELECT {COLUMNS} FROM rule_runs ORDER BY updated_at DESC LIMIT 100"
            ))
            .map_err(err)?;
        let result = q
            .query_map([], decode)
            .map_err(err)?
            .map(|r| {
                let job = r.map_err(err)?;
                Ok(RuleRunView {
                    id: job.id,
                    account_email: job.source.account_email,
                    subject: job.source.subject,
                    step: job
                        .rules
                        .get(if job.status == "completed" {
                            job.cursor.saturating_sub(1)
                        } else {
                            job.cursor
                        })
                        .map(|r| r.name.clone())
                        .unwrap_or_default(),
                    cursor: job.cursor,
                    total: job.rules.len(),
                    applied: job.applied,
                    status: job.status,
                    error: job.error,
                    updated_at: job.updated_at,
                })
            })
            .collect();
        result
    }
    #[cfg(test)]
    pub(crate) fn rule_run(&self, id: &str) -> Result<RuleRun> {
        load(&self.db()?, id)
    }
    pub(crate) fn claim_rule_run(&self, job: &RuleRun) -> Result<bool> {
        Ok(self.db()?.execute("UPDATE rule_runs SET status='running',error='' WHERE id=?1 AND revision=?2 AND status='queued'",params![job.id,job.revision]).map_err(err)?==1)
    }
    pub(crate) fn rule_blocks_directory(
        db: &rusqlite::Connection,
        operation_id: &str,
    ) -> Result<bool> {
        db.query_row("SELECT EXISTS(SELECT 1 FROM rule_runs r JOIN json_each(r.data,'$.operations') j WHERE j.value=?1 AND r.status!='completed')",[operation_id],|row|row.get(0)).map_err(err)
    }
    pub(crate) fn rule_blocks_move(db: &rusqlite::Connection, mail_id: &str) -> Result<bool> {
        db.query_row("SELECT EXISTS(SELECT 1 FROM rule_runs WHERE mail_id=?1 AND status NOT IN ('completed','cancelled'))",[mail_id],|r|r.get(0)).map_err(err)
    }
    pub fn rule_run_action(&self, id: &str, action: &str) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mut job = load(&tx, id)?;
        match action {
            "pause" if matches!(job.status.as_str(), "queued" | "running") => {
                job.status = "paused".into()
            }
            "resume" if job.status == "paused" => job.status = "queued".into(),
            "cancel" if !matches!(job.status.as_str(), "completed" | "cancelled") => {
                cancel_in(&tx, &[job.id.clone()])?;
                tx.commit().map_err(err)?;
                return Ok(());
            }
            "retry" if job.status == "blocked" => {
                if current_configuration(&tx)? != job.configuration {
                    return Err("规则已变化，请预览后重新执行新规则".into());
                }
                let data: String = tx
                    .query_row(
                        "SELECT data FROM messages WHERE id=?1",
                        [&job.mail_id],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                let m: Mail = serde_json::from_str(&data).map_err(err)?;
                job.source = read_plan(&tx, &m)?;
                archive_jobs::proof(&tx, &job.source)?;
                job.local_state = local_state(&m)?;
                job.retry_queues = true;
                job.status = "queued".into();
            }
            _ => return Err("规则处理状态已变化，请刷新".into()),
        }
        job.revision += 1;
        job.error.clear();
        job.updated_at = chrono::Utc::now().to_rfc3339();
        tx.execute(
            "UPDATE rule_runs SET data=?2,status=?3,revision=?4,error='',updated_at=?5 WHERE id=?1",
            params![
                job.id,
                serde_json::to_string(&job).map_err(err)?,
                job.status,
                job.revision,
                job.updated_at
            ],
        )
        .map_err(err)?;
        tx.commit().map_err(err)
    }
    pub(crate) fn process_rule_run(&self, expected: &RuleRun, raw: &[u8]) -> Result<()> {
        let (a, _) = archive_jobs::proof(&self.db()?, &expected.source)?;
        let parsed = archive::parse(raw, &a, &expected.source.folder)?.0;
        let hash = archive::digest(raw);
        let end = raw
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|p| p + 4)
            .unwrap_or(raw.len());
        let header_hash = archive::digest(&raw[..end]);
        loop {
            let _archive = self.archive_gate.read().map_err(err)?;
            let (before, a, m) = guard(&self.db()?, expected, &hash, &header_hash)?;
            let prepared = if let Some(rule) = before.rules.get(before.cursor) {
                let mut evaluation = m.clone();
                evaluation.body = parsed.body.clone();
                evaluation.has_attachments = parsed.has_attachments;
                if rules::body_decode_failed(&parsed)
                    && rules::match_state(rule, &m, false) == rules::MatchState::NeedsBody
                {
                    return Err("原件含解码异常，未按不完整正文执行规则，请核对邮件内容".into());
                }
                let applicable = !before.remote_only || rules::remote(rule) || rules::saves(rule);
                let needs_save = rules::saves(rule)
                    || (rule.action == "serverMove"
                        && self.should_save_folder(&a, &rule.source_folder)?);
                if applicable && needs_save && m.saved_locally {
                    archive::read_raw(&self.root, &m.hash)?;
                }
                if applicable
                    && needs_save
                    && !m.saved_locally
                    && rules::match_state(rule, &evaluation, !rules::body_decode_failed(&parsed))
                        == rules::MatchState::Match
                {
                    Some(self.prepare_archive(&before.source, raw)?)
                } else {
                    None
                }
            } else {
                None
            };
            let mut db = self.db()?;
            let tx = db
                .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
                .map_err(err)?;
            let (mut job, a, mut m) = guard(&tx, expected, &hash, &header_hash)?;
            if job.cursor >= job.rules.len() {
                job.status = "completed".into();
                write(&tx, &mut job)?;
                tx.commit().map_err(err)?;
                return Ok(());
            }
            let r = job.rules[job.cursor].clone();
            let mut evaluation = m.clone();
            evaluation.body = parsed.body.clone();
            evaluation.has_attachments = parsed.has_attachments;
            if r.conditions.iter().any(|c| c.field == "body")
                && rules::match_state(&r, &m, false) == rules::MatchState::NeedsBody
                && rules::body_decode_failed(&parsed)
            {
                return Err("原件含解码异常，未按不完整正文执行规则，请核对邮件内容".into());
            }
            let matched=rules::match_state(&r,&evaluation,!rules::body_decode_failed(&parsed)) == rules::MatchState::Match && (!rules::remote(&r)||tx.query_row("SELECT EXISTS(SELECT 1 FROM sources WHERE mail_id=?1 AND account_id=?2 AND folder=?3 AND active=1)",params![m.id,m.account_id,r.source_folder],|row|row.get::<_,bool>(0)).map_err(err)?);
            let applicable = !job.remote_only || rules::remote(&r) || rules::saves(&r);
            if matched && applicable {
                let needs_save = rules::saves(&r)
                    || (r.action == "serverMove"
                        && crate::retention::effective_save(&tx, &a, &r.source_folder)?);
                if needs_save {
                    if !m.saved_locally {
                        Self::queue_archive_in(&tx, &m.id)?;
                        let saved = Self::archive_job_for_mail_in(&tx, &m.id)?;
                        if saved.status != "queued" {
                            return Err(format!(
                                "完整保存任务{}，请在保存任务中处理后重试规则",
                                saved.status
                            ));
                        }
                        tx.execute("UPDATE archive_jobs SET status='running' WHERE id=?1 AND revision=?2 AND status='queued'",params![saved.id,saved.revision]).map_err(err)?;
                        self.complete_archive_in(
                            &tx,
                            &saved,
                            prepared.as_ref().ok_or("保存策略已变化，请重新核对规则")?,
                        )?;
                        let data: String = tx
                            .query_row("SELECT data FROM messages WHERE id=?1", [&m.id], |row| {
                                row.get(0)
                            })
                            .map_err(err)?;
                        m = serde_json::from_str(&data).map_err(err)?;
                    }
                }
                if let Err(error) = check_local_intent(&job, &m, &r) {
                    if r.action == "saveFolder" {
                        job.status = "blocked".into();
                        job.error = format!("完整原件已保存，但归类未执行：{error}");
                        write(&tx, &mut job)?;
                        tx.commit().map_err(err)?;
                        return Ok(());
                    }
                    return Err(error);
                }
                if rules::remote(&r) {
                    let mut remote_mail = m.clone();
                    remote_mail.body = evaluation.body.clone();
                    remote_mail.has_attachments = evaluation.has_attachments;
                    Self::apply_remote_rule_in(
                        &tx,
                        &r,
                        &remote_mail,
                        job.retry_queues && Self::unqueued_rule_failure_in(&tx, &r, &m.id)?,
                    )?;
                    let item:Option<(Option<String>,String,String)>=tx.query_row("SELECT operation_id,status,error FROM rule_executions WHERE rule_id=?1 AND mail_id=?2 ORDER BY rowid DESC LIMIT 1",params![r.id,m.id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional().map_err(err)?;
                    if let Some((op, status, error)) = item {
                        if status == "blocked" && op.is_none() {
                            job.status = "blocked".into();
                            job.error = error;
                            write(&tx, &mut job)?;
                            tx.commit().map_err(err)?;
                            return Ok(());
                        }
                        if let Some(id) = op {
                            if !job.operations.contains(&id) {
                                job.operations.push(id);
                            }
                        }
                    }
                } else {
                    m.has_attachments = parsed.has_attachments;
                    m.attachment_metadata_known = true;
                    match r.action.as_str() {
                        "folder" => m.local_folder = r.destination.clone(),
                        "saveFolder" if !job.remote_only => m.local_folder = r.destination.clone(),
                        "save" | "saveFolder" => {}
                        "read" => {
                            m.is_read = true;
                            m.local_read_override = Some(true);
                        }
                        "unread" => {
                            m.is_read = false;
                            m.local_read_override = Some(false);
                        }
                        "star" => {
                            m.starred = true;
                            m.local_star_override = Some(true);
                        }
                        "trash" => m.trashed = true,
                        _ => return Err("未知规则动作".into()),
                    }
                    tx.execute(
                        "UPDATE messages SET data=?2 WHERE id=?1",
                        params![m.id, serde_json::to_string(&m).map_err(err)?],
                    )
                    .map_err(err)?;
                }
                job.applied += 1;
                advance_local_intent(&mut job, &m, &r)?;
            }
            job.cursor += 1;
            if (matched && r.stop) || job.cursor == job.rules.len() {
                job.status = "completed".into();
            }
            write(&tx, &mut job)?;
            tx.commit().map_err(err)?;
            if job.status == "completed" {
                return Ok(());
            }
        }
    }
    fn fail_rule_run(&self, job: &RuleRun, error: &str) -> Result<()> {
        self.db()?.execute("UPDATE rule_runs SET status='blocked',error=?3,updated_at=?4 WHERE id=?1 AND revision=?2 AND status='running'",params![job.id,job.revision,error,chrono::Utc::now().to_rfc3339()]).map_err(err)?;
        Ok(())
    }
}
pub fn start(store: Store, app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        let next = (|| -> Result<Option<RuleRun>> {
            store.db()?.query_row(&format!("SELECT {COLUMNS} FROM rule_runs WHERE status='queued' ORDER BY updated_at LIMIT 1"),[],decode).optional().map_err(err)
        })();
        if let Ok(Some(job)) = next {
            let result = (|| -> Result<()> {
                let gate = crate::sync_control::folder_gate(
                    &store.root,
                    &job.source.account_id,
                    &job.source.folder,
                )?;
                let _folder = gate.lock().map_err(err)?;
                if !store.claim_rule_run(&job)? {
                    return Ok(());
                }
                let (a, m) = archive_jobs::proof(&store.db()?, &job.source)?;
                let raw = if m.saved_locally {
                    archive::read_raw(&store.root, &m.hash)?
                } else {
                    crate::network::read_remote_source(
                        &store,
                        &a,
                        &m,
                        &job.source.folder,
                        &job.source.remote_id,
                    )?
                };
                store.process_rule_run(&job, &raw)
            })();
            if let Err(error) = result {
                let _ = store.fail_rule_run(&job, &error);
            }
            let _ = app.emit("mail-updated", ());
        }
        std::thread::sleep(std::time::Duration::from_secs(1));
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Store, Account, String, Vec<u8>) {
        let root = tempfile::tempdir().unwrap();
        let store = Store::new(root.path().into()).unwrap();
        let mut a = crate::tests::account();
        a.save_locally = false;
        store.save_account(&a).unwrap();
        let full = crate::tests::raw();
        let end = full.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        store
            .ingest(&a, "INBOX", "7:12", &full[..end], false)
            .unwrap();
        let id = store
            .db()
            .unwrap()
            .query_row("SELECT id FROM messages", [], |r| r.get::<_, String>(0))
            .unwrap();
        (root, store, a, id, full)
    }
    fn rule(a: &Account, action: &str) -> Rule {
        Rule {
            id: format!("rule-{action}"),
            name: action.into(),
            account_id: a.id.clone(),
            enabled: true,
            mode: "all".into(),
            conditions: vec![Condition {
                field: "subject".into(),
                operator: "contains".into(),
                value: "invoice".into(),
            }],
            action: action.into(),
            destination: if matches!(action, "saveFolder" | "folder") {
                "Invoices".into()
            } else {
                String::new()
            },
            source_folder: String::new(),
            stop: false,
        }
    }
    fn pending(store: &Store) -> RuleRun {
        let id = store.rule_runs().unwrap()[0].id.clone();
        store.rule_run(&id).unwrap()
    }
    #[test]
    fn online_body_negative_condition_is_unknown_not_a_match_and_known_headers_short_circuit() {
        let (_root, store, a, id, _raw) = fixture();
        let mut r = rule(&a, "trash");
        r.conditions[0] = Condition {
            field: "body".into(),
            operator: "notContains".into(),
            value: "invoice".into(),
        };
        let m = store.mail(&id).unwrap();
        assert_eq!(
            rules::match_state(&r, &m, false),
            rules::MatchState::NeedsBody
        );
        r.conditions.push(Condition {
            field: "subject".into(),
            operator: "contains".into(),
            value: "missing".into(),
        });
        assert_eq!(
            rules::match_state(&r, &m, false),
            rules::MatchState::NoMatch
        );
        r.mode = "any".into();
        r.conditions[1].value = "invoice".into();
        assert_eq!(rules::match_state(&r, &m, false), rules::MatchState::Match);
    }
    #[test]
    fn save_folder_and_continuation_publish_full_bytes_and_keep_identity() {
        let (_root, store, a, id, raw) = fixture();
        let mut save = rule(&a, "saveFolder");
        save.stop = false;
        let mut star = rule(&a, "star");
        star.stop = true;
        store.save_rules(&[save, star]).unwrap();
        assert_eq!(store.run_rules().unwrap(), 1);
        let before = store.mail(&id).unwrap();
        let job = pending(&store);
        assert!(store.claim_rule_run(&job).unwrap());
        store.process_rule_run(&job, &raw).unwrap();
        let m = store.mail(&id).unwrap();
        assert_eq!(m.id, before.id);
        assert!(m.saved_locally && m.starred);
        assert_eq!(m.local_folder, "Invoices");
        assert_eq!(store.message_raw(&m).unwrap(), raw);
        assert!(!store.account(&a.id).unwrap().save_locally);
        let job = store.rule_run(&job.id).unwrap();
        assert_eq!(
            (job.status.as_str(), job.cursor, job.applied),
            ("completed", 2, 2)
        );
        assert_eq!(store.archive_jobs().unwrap()[0].status, "completed");
    }
    #[test]
    fn body_evaluation_does_not_persist_online_body_or_raw_when_no_save_matches() {
        let (root, store, a, id, raw) = fixture();
        let mut r = rule(&a, "folder");
        r.conditions[0] = Condition {
            field: "body".into(),
            operator: "contains".into(),
            value: "keep this invoice".into(),
        };
        store.save_rules(&[r]).unwrap();
        assert!(store.preview_rule(&store.rules().unwrap()[0]).unwrap()[0].contains("等待正文核对"));
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        let m = store.mail(&id).unwrap();
        assert_eq!(m.local_folder, "Invoices");
        assert!(m.body.is_empty() && !m.saved_locally);
        assert!(store.archive_jobs().unwrap().is_empty());
        assert!(!root.path().join("archive").exists());
        let serialized: String = store
            .db()
            .unwrap()
            .query_row("SELECT data FROM rule_runs", [], |r| r.get(0))
            .unwrap();
        assert!(!serialized.contains("Please keep this invoice"));
    }
    #[test]
    fn failed_save_rolls_back_archive_status_classification_and_cursor() {
        let (root, store, a, id, raw) = fixture();
        store
            .save_rules(&[rule(&a, "saveFolder"), rule(&a, "trash")])
            .unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        std::fs::write(root.path().join("archive"), b"not a directory").unwrap();
        assert!(store.process_rule_run(&job, &raw).is_err());
        let m = store.mail(&id).unwrap();
        assert!(!m.saved_locally && !m.trashed && m.local_folder == "全部存档");
        assert_eq!(store.rule_run(&job.id).unwrap().cursor, 0);
        assert!(store.archive_jobs().unwrap().is_empty());
        store.fail_rule_run(&job, "disk error").unwrap();
        assert_eq!(store.rule_run(&job.id).unwrap().status, "blocked");
        std::fs::remove_file(root.path().join("archive")).unwrap();
        store.rule_run_action(&job.id, "retry").unwrap();
        let job = store.rule_run(&job.id).unwrap();
        store.claim_rule_run(&job).unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        assert!(store.mail(&id).unwrap().saved_locally);
    }
    #[test]
    fn user_read_intent_during_save_is_preserved_and_later_unread_cannot_override_it() {
        let (_root, store, a, id, raw) = fixture();
        store
            .save_rules(&[rule(&a, "save"), rule(&a, "unread")])
            .unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        let mut m = store.mail(&id).unwrap();
        m.is_read = true;
        m.local_read_override = Some(true);
        store.update_mail(&m).unwrap();
        assert!(store.process_rule_run(&job, &raw).is_err());
        let m = store.mail(&id).unwrap();
        assert!(m.saved_locally && m.is_read);
        assert_eq!(store.rule_run(&job.id).unwrap().cursor, 1);
    }
    #[test]
    fn changed_user_folder_preserves_archive_but_does_not_classify_until_explicit_retry() {
        let (_root, store, a, id, raw) = fixture();
        store.save_rules(&[rule(&a, "saveFolder")]).unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        let mut m = store.mail(&id).unwrap();
        m.local_folder = "User folder".into();
        store.update_mail(&m).unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        assert!(store.mail(&id).unwrap().saved_locally);
        assert_eq!(store.mail(&id).unwrap().local_folder, "User folder");
        assert_eq!(store.rule_run(&job.id).unwrap().status, "blocked");
        store.rule_run_action(&job.id, "retry").unwrap();
        let job = store.rule_run(&job.id).unwrap();
        store.claim_rule_run(&job).unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        assert_eq!(store.mail(&id).unwrap().local_folder, "Invoices");
    }
    #[test]
    fn pause_cancel_and_rule_change_revoke_inflight_results() {
        let (_root, store, a, id, raw) = fixture();
        let r = rule(&a, "save");
        store.save_rules(&[r.clone()]).unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        store.rule_run_action(&job.id, "pause").unwrap();
        assert!(store.process_rule_run(&job, &raw).is_err());
        assert!(!store.mail(&id).unwrap().saved_locally);
        store.rule_run_action(&job.id, "resume").unwrap();
        let job = store.rule_run(&job.id).unwrap();
        store.claim_rule_run(&job).unwrap();
        let mut changed = r;
        changed.enabled = false;
        store.save_rules(&[changed]).unwrap();
        assert_eq!(store.rule_run(&job.id).unwrap().status, "cancelled");
        assert!(store.process_rule_run(&job, &raw).is_err());
        assert!(!store.mail(&id).unwrap().saved_locally);
    }
    #[test]
    fn restart_keeps_cursor_and_backup_omits_executable_rules() {
        let (root, store, a, id, raw) = fixture();
        store.save_rules(&[rule(&a, "save")]).unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        drop(store);
        let store = Store::new(root.path().into()).unwrap();
        let restarted = store.rule_run(&job.id).unwrap();
        assert_eq!(restarted.status, "queued");
        assert_ne!(restarted.revision, job.revision);
        store.claim_rule_run(&restarted).unwrap();
        assert!(store.process_rule_run(&job, &raw).is_err());
        store.process_rule_run(&restarted, &raw).unwrap();
        let output = tempfile::tempdir().unwrap();
        let path = store.backup(output.path()).unwrap();
        let db = rusqlite::Connection::open(std::path::Path::new(&path).join("snapshot.sqlite3"))
            .unwrap();
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM rule_runs", [], |r| r.get::<_, u32>(0))
                .unwrap(),
            0
        );
        assert!(store.mail(&id).unwrap().saved_locally);
    }
    fn target(store: &Store, a: &Account) {
        store
            .save_remote_folders(
                &a.id,
                &[RemoteFolder {
                    account_id: a.id.clone(),
                    name: "Archive".into(),
                    display_name: "归档".into(),
                    delimiter: None,
                    selectable: true,
                    roles: vec![],
                    detected_roles: None,
                    sync_error: None,
                }],
            )
            .unwrap();
    }
    fn remote_rule(a: &Account, action: &str) -> Rule {
        let mut r = rule(a, action);
        r.source_folder = "INBOX".into();
        r.destination = "Archive".into();
        r
    }
    #[test]
    fn prior_copy_and_move_are_held_on_later_save_failure_and_cancelled_without_submission() {
        for action in ["serverCopy", "serverMove"] {
            let (root, store, a, id, raw) = fixture();
            target(&store, &a);
            store
                .save_rules(&[remote_rule(&a, action), rule(&a, "save"), rule(&a, "trash")])
                .unwrap();
            store.run_rules().unwrap();
            assert!(store.directory_operations().unwrap().is_empty());
            let job = pending(&store);
            store.claim_rule_run(&job).unwrap();
            std::fs::write(root.path().join("archive"), b"disk unavailable").unwrap();
            let error = store.process_rule_run(&job, &raw).unwrap_err();
            store.fail_rule_run(&job, &error).unwrap();
            let stalled = store.rule_run(&job.id).unwrap();
            assert_eq!(stalled.cursor, 1);
            let op = store.directory_operation(&stalled.operations[0]).unwrap();
            assert!(!store.claim_copy(&op).unwrap());
            assert!(store.submit_copy(&op, "hash").is_err());
            assert!(!store.mail(&id).unwrap().saved_locally && !store.mail(&id).unwrap().trashed);
            store.rule_run_action(&job.id, "cancel").unwrap();
            assert_eq!(
                store.directory_operation(&op.id).unwrap().status,
                "cancelled"
            );
            assert!(!store.claim_copy(&op).unwrap());
        }
    }
    #[test]
    fn save_before_move_preserves_original_and_only_releases_after_chain_completion() {
        let (_root, store, a, id, raw) = fixture();
        target(&store, &a);
        store
            .save_rules(&[rule(&a, "save"), remote_rule(&a, "serverMove")])
            .unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        assert_eq!(store.message_raw(&store.mail(&id).unwrap()).unwrap(), raw);
        let done = store.rule_run(&job.id).unwrap();
        assert_eq!(done.status, "completed");
        assert_eq!(store.rule_runs().unwrap()[0].step, "serverMove");
        let op = store.directory_operation(&done.operations[0]).unwrap();
        assert!(store.claim_copy(&op).unwrap());
        store.run_rules().unwrap();
        assert_eq!(store.directory_operations().unwrap().len(), 1);
    }
    #[test]
    fn isolated_active_remote_source_blocks_chain_and_explicit_retry_queues_once() {
        let (_root, store, a, id, raw) = fixture();
        target(&store, &a);
        let end = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
        store
            .ingest(&a, "Archive", "8:20", &raw[..end], false)
            .unwrap();
        store
            .save_rules(&[
                rule(&a, "save"),
                remote_rule(&a, "serverCopy"),
                rule(&a, "trash"),
            ])
            .unwrap();
        store
            .isolate_folder(&a, "INBOX", "bad", &Default::default())
            .unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        assert_eq!(job.source.folder, "Archive");
        store.claim_rule_run(&job).unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        assert_eq!(store.rule_run(&job.id).unwrap().status, "blocked");
        assert_eq!(store.rule_run(&job.id).unwrap().cursor, 1);
        assert!(store.mail(&id).unwrap().saved_locally && !store.mail(&id).unwrap().trashed);
        assert!(store.rule_executions().unwrap()[0].operation_id.is_none());
        let hit = store.rule_executions().unwrap().remove(0);
        assert!(store
            .retry_rule_execution(&hit.id)
            .unwrap_err()
            .contains("关联规则链"));
        store.restore_folder_trust(&a, "INBOX").unwrap();
        store.run_rules().unwrap();
        assert!(store.directory_operations().unwrap().is_empty());
        store.rule_run_action(&job.id, "retry").unwrap();
        let retry = store.rule_run(&job.id).unwrap();
        store.claim_rule_run(&retry).unwrap();
        store.process_rule_run(&retry, &raw).unwrap();
        assert!(store.mail(&id).unwrap().trashed);
        assert_eq!(store.directory_operations().unwrap().len(), 1);
    }
    #[test]
    fn cancelling_only_owned_unsubmitted_operations_preserves_manual_and_submitted_results() {
        let (_root, store, a, id) = crate::directory_operations::tests::fixture();
        store.save_rules(&[rule(&a, "save")]).unwrap();
        store
            .defer_rules(&store.mail(&id).unwrap(), &store.rules().unwrap(), 0, false)
            .unwrap();
        let mut job = pending(&store);
        let owned = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        job.operations.push(owned.clone());
        write(&store.db().unwrap(), &mut job).unwrap();
        for state in ["queued", "preparing", "blocked", "submitted", "uncertain"] {
            let db = store.db().unwrap();
            db.execute(
                "UPDATE directory_operations SET status=?2 WHERE id=?1",
                params![owned, state],
            )
            .unwrap();
            db.execute(
                "UPDATE rule_runs SET status='paused' WHERE id=?1",
                [&job.id],
            )
            .unwrap();
            store.rule_run_action(&job.id, "cancel").unwrap();
            assert_eq!(
                store.directory_operation(&owned).unwrap().status,
                if matches!(state, "submitted" | "uncertain") {
                    state
                } else {
                    "cancelled"
                }
            );
        }
        let db = store.db().unwrap();
        db.execute(
            "UPDATE directory_operations SET status='queued' WHERE id=?1",
            [&owned],
        )
        .unwrap();
        job = store.rule_run(&job.id).unwrap();
        job.operations.clear();
        job.status = "paused".into();
        write(&db, &mut job).unwrap();
        store.rule_run_action(&job.id, "cancel").unwrap();
        assert_eq!(store.directory_operation(&owned).unwrap().status, "queued");
    }
    #[test]
    fn prepared_file_does_not_hold_sqlite_writer_and_source_changes_reject_publication() {
        let (root, store, a, id, raw) = fixture();
        store.queue_archives(&[id.clone()], false).unwrap();
        let job = Store::archive_job_for_mail_in(&store.db().unwrap(), &id).unwrap();
        store.claim_archive(&job).unwrap();
        let prepared = store.prepare_archive(&job, &raw).unwrap();
        let db = store.db().unwrap();
        db.execute("UPDATE sources SET active=0 WHERE mail_id=?1", [&id])
            .unwrap();
        let mut db = store.db().unwrap();
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        assert!(store.complete_archive_in(&tx, &job, &prepared).is_err());
        drop(tx);
        drop(prepared);
        assert!(!store.mail(&id).unwrap().saved_locally);
        assert_eq!(
            std::fs::read_dir(root.path().join("archive"))
                .unwrap()
                .count(),
            0
        );
        assert!(!store.account(&a.id).unwrap().save_locally);
    }
    #[test]
    fn publication_database_rollback_does_not_mark_saved_or_advance_rules() {
        let (_root, store, a, id, raw) = fixture();
        store.save_rules(&[rule(&a, "saveFolder")]).unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER reject_rule_cursor BEFORE UPDATE ON rule_runs WHEN NEW.cursor>0 BEGIN SELECT RAISE(ABORT,'fixture rollback'); END;").unwrap();
        assert!(store.process_rule_run(&job, &raw).is_err());
        let m = store.mail(&id).unwrap();
        assert!(!m.saved_locally);
        assert_eq!(m.local_folder, "全部存档");
        assert_eq!(store.rule_run(&job.id).unwrap().cursor, 0);
        assert!(store.archive_jobs().unwrap().is_empty());
        store
            .db()
            .unwrap()
            .execute_batch("DROP TRIGGER reject_rule_cursor")
            .unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        assert_eq!(store.message_raw(&store.mail(&id).unwrap()).unwrap(), raw);
    }
    #[test]
    fn unknown_attachment_combinations_wait_but_known_headers_short_circuit() {
        let (_root, store, a, id, _raw) = fixture();
        let m = store.mail(&id).unwrap();
        let mut r = rule(&a, "trash");
        r.conditions = vec![Condition {
            field: "attachment".into(),
            operator: "equals".into(),
            value: "false".into(),
        }];
        assert_eq!(
            rules::match_state(&r, &m, false),
            rules::MatchState::NeedsBody
        );
        let mut known = m.clone();
        known.attachment_metadata_known = true;
        assert_eq!(
            rules::match_state(&r, &known, false),
            rules::MatchState::Match
        );
        r.conditions.push(Condition {
            field: "subject".into(),
            operator: "contains".into(),
            value: "missing".into(),
        });
        assert_eq!(
            rules::match_state(&r, &m, false),
            rules::MatchState::NoMatch
        );
        r.mode = "any".into();
        r.conditions[1].value = "invoice".into();
        assert_eq!(rules::match_state(&r, &m, false), rules::MatchState::Match);
    }
    #[test]
    fn completed_stop_view_names_last_checked_not_next_rule() {
        let (_root, store, a, _id, raw) = fixture();
        let mut first = rule(&a, "save");
        first.stop = true;
        store.save_rules(&[first, rule(&a, "trash")]).unwrap();
        store.run_rules().unwrap();
        let job = pending(&store);
        store.claim_rule_run(&job).unwrap();
        store.process_rule_run(&job, &raw).unwrap();
        let view = &store.rule_runs().unwrap()[0];
        assert_eq!(view.cursor, 1);
        assert_eq!(view.total, 2);
        assert_eq!(view.step, "save");
    }
    #[test]
    fn undecodable_body_blocks_negative_rule_but_bad_attachment_allows_known_body() {
        for bad_body in [true, false] {
            let (_root, store, a, id, raw) = fixture();
            let raw = if bad_body {
                String::from_utf8(raw).unwrap().replace("Content-Type: text/plain; charset=utf-8\r\n\r\nPlease keep this invoice.","Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n***invalid***").into_bytes()
            } else {
                String::from_utf8(raw)
                    .unwrap()
                    .replace("aW52b2ljZSBjb250ZW50", "***invalid***")
                    .into_bytes()
            };
            let mut r = rule(&a, "star");
            r.conditions = vec![Condition {
                field: "body".into(),
                operator: if bad_body { "notContains" } else { "contains" }.into(),
                value: "keep this invoice".into(),
            }];
            store.save_rules(&[r]).unwrap();
            store.run_rules().unwrap();
            let job = pending(&store);
            store.claim_rule_run(&job).unwrap();
            if bad_body {
                assert!(store
                    .process_rule_run(&job, &raw)
                    .unwrap_err()
                    .contains("解码异常"));
                assert!(!store.mail(&id).unwrap().starred);
            } else {
                store.process_rule_run(&job, &raw).unwrap();
                assert!(store.mail(&id).unwrap().starred);
            }
        }
    }
    #[test]
    fn pause_invalidates_preparing_copy_submission_until_resume_finishes_chain() {
        let (_root, store, a, id) = crate::directory_operations::tests::fixture();
        store.save_rules(&[rule(&a, "save")]).unwrap();
        store
            .defer_rules(&store.mail(&id).unwrap(), &store.rules().unwrap(), 0, false)
            .unwrap();
        let mut job = pending(&store);
        let copy = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&copy).unwrap();
        store.claim_copy(&op).unwrap();
        job.operations.push(copy);
        write(&store.db().unwrap(), &mut job).unwrap();
        store.rule_run_action(&job.id, "pause").unwrap();
        assert!(store.submit_copy(&op, "hash").is_err());
        store.rule_run_action(&job.id, "resume").unwrap();
        let next = store.rule_run(&job.id).unwrap();
        assert_ne!(next.revision, job.revision);
        store.claim_rule_run(&next).unwrap();
        store.process_rule_run(&next, &crate::tests::raw()).unwrap();
        store.submit_copy(&op, "hash").unwrap();
    }
}
