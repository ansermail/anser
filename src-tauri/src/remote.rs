use crate::{archive, models::*, network, store::Store};
use rusqlite::{params, OptionalExtension};
/// Reuse prepared reads while receiving, without keeping a read transaction or
/// a snapshot across network requests. Account/retention/source edits remain
/// visible on the next check; writers never wait for this connection.
pub(crate) struct ReceiveLookup {
    db: rusqlite::Connection,
}
impl ReceiveLookup {
    pub fn new(store: &Store) -> Result<Self> {
        Ok(Self { db: store.db()? })
    }
    pub fn account(&self, id: &str) -> Result<Account> {
        let data: Option<String> = self
            .db
            .prepare_cached("SELECT data FROM accounts WHERE id=?1")
            .map_err(err)?
            .query_row([id], |r| r.get(0))
            .optional()
            .map_err(err)?;
        serde_json::from_str(&data.ok_or_else(|| "账号不存在".to_string())?).map_err(err)
    }
    pub fn source_available(&self, account: &Account, folder: &str, remote: &str) -> Result<bool> {
        let save = crate::retention::effective_save(&self.db, account, folder)?;
        let data: Option<String> = self.db.prepare_cached("SELECT m.data FROM sources s JOIN message_listing m ON m.id=s.mail_id AND m.account_id=s.account_id WHERE s.account_id=?1 AND s.folder=?2 AND s.remote_id=?3 AND NOT EXISTS(SELECT 1 FROM folder_health h WHERE h.account_id=s.account_id AND h.folder=s.folder)").map_err(err)?
            .query_row(params![account.id, folder, remote], |r| r.get(0)).optional().map_err(err)?;
        Ok(data
            .and_then(|s| serde_json::from_str::<Mail>(&s).ok())
            .is_some_and(|m| !save || m.saved_locally))
    }
}
impl Store {
    pub fn save_remote_folders(&self, account: &str, folders: &[RemoteFolder]) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let mappings = read_mappings(&tx, account)?;
        tx.execute("DELETE FROM remote_folders WHERE account_id=?1", [account])
            .map_err(err)?;
        for folder in folders {
            let mut folder = folder.clone();
            normalize_folder(&mut folder);
            folder.detected_roles = Some(
                folder
                    .detected_roles
                    .clone()
                    .unwrap_or_else(|| folder.roles.clone()),
            );
            apply_mappings(&mut folder, &mappings);
            tx.execute(
                "INSERT INTO remote_folders VALUES(?1,?2,?3)",
                params![
                    account,
                    folder.name,
                    serde_json::to_string(&folder).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    // Cached pre-role LIST results remain usable before a network connection.
    pub(crate) fn migrate_folder_roles(&self) -> Result<()> {
        let folders = self.remote_folders(None)?;
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        for folder in folders {
            tx.execute(
                "UPDATE remote_folders SET data=?3 WHERE account_id=?1 AND name=?2",
                params![
                    folder.account_id,
                    folder.name,
                    serde_json::to_string(&folder).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn remote_folders(&self, account: Option<&str>) -> Result<Vec<RemoteFolder>> {
        let db = self.db()?;
        let mut q = db.prepare("SELECT data FROM remote_folders WHERE ?1='' OR account_id=?1 ORDER BY name COLLATE NOCASE").map_err(err)?;
        let rows = q
            .query_map([account.unwrap_or("")], |r| r.get::<_, String>(0))
            .map_err(err)?
            .map(|r| {
                let mut folder: RemoteFolder =
                    serde_json::from_str(&r.map_err(err)?).map_err(err)?;
                folder.sync_error =
                    self.folder_isolated_reason(&folder.account_id, &folder.name)?;
                if folder.detected_roles.is_none() {
                    normalize_folder(&mut folder);
                    folder.detected_roles = Some(folder.roles.clone());
                }
                Ok(folder)
            })
            .collect();
        rows
    }
    pub fn folder_settings(&self, account: &str) -> Result<FolderSettings> {
        self.account(account)?;
        Ok(FolderSettings {
            folders: self.remote_folders(Some(account))?,
            mappings: read_mappings(&self.db()?, account)?,
        })
    }
    pub fn save_folder_mappings(&self, account: &str, mappings: &[FolderMapping]) -> Result<()> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let data: String = tx
            .query_row("SELECT data FROM accounts WHERE id=?1", [account], |r| {
                r.get(0)
            })
            .map_err(|_| "账号不存在".to_string())?;
        let a: Account = serde_json::from_str(&data).map_err(err)?;
        if a.protocol != "imap" {
            return Err("POP3 不支持服务器文件夹映射".into());
        }
        let mut statement = tx
            .prepare("SELECT data FROM remote_folders WHERE account_id=?1")
            .map_err(err)?;
        let mut folders = statement
            .query_map([account], |r| r.get::<_, String>(0))
            .map_err(err)?
            .map(|row| serde_json::from_str::<RemoteFolder>(&row.map_err(err)?).map_err(err))
            .collect::<Result<Vec<_>>>()?;
        drop(statement);
        let mut roles = Vec::new();
        let mut destinations = Vec::new();
        for mapping in mappings {
            if mapping.role == FolderRole::Inbox {
                return Err("收件箱由服务器定义，不能重新指定".into());
            }
            if roles.contains(&mapping.role) {
                return Err("同一用途只能设置一次".into());
            }
            roles.push(mapping.role);
            if let Some(name) = &mapping.folder {
                let folder = folders
                    .iter()
                    .find(|f| &f.name == name)
                    .ok_or("选择的服务器文件夹已不存在，请刷新目录")?;
                if !folder.selectable || self.folder_isolated_reason(account, name)?.is_some() {
                    return Err("该目录不能存放邮件，请选择子文件夹".into());
                }
                if folder.name.eq_ignore_ascii_case("INBOX")
                    || folder.roles.contains(&FolderRole::Inbox)
                {
                    return Err("不能将收件箱指定为其他特殊用途".into());
                }
                if destinations.contains(name) {
                    return Err("一个文件夹只能手动指定为一种用途".into());
                }
                destinations.push(name.clone());
            }
        }
        tx.execute("INSERT INTO folder_mappings VALUES(?1,?2) ON CONFLICT(account_id) DO UPDATE SET data=excluded.data", params![account, serde_json::to_string(mappings).map_err(err)?]).map_err(err)?;
        for folder in &mut folders {
            if folder.detected_roles.is_none() {
                folder.detected_roles = Some(folder.roles.clone());
            }
            apply_mappings(folder, mappings);
            tx.execute(
                "UPDATE remote_folders SET data=?3 WHERE account_id=?1 AND name=?2",
                params![
                    account,
                    folder.name,
                    serde_json::to_string(folder).map_err(err)?
                ],
            )
            .map_err(err)?;
        }
        tx.commit().map_err(err)
    }
    pub fn source(&self, id: &str) -> Result<(String, String)> {
        let db = self.db()?;
        let source=db.query_row("SELECT folder,remote_id FROM trusted_sources WHERE mail_id=?1 AND active=1 ORDER BY folder='INBOX' COLLATE NOCASE DESC LIMIT 1",[id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(err)?;
        if let Some(source) = source {
            return Ok(source);
        }
        let isolated:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sources s JOIN folder_health h ON h.account_id=s.account_id AND h.folder=s.folder WHERE s.mail_id=?1 AND s.active=1)",[id],|r|r.get(0)).map_err(err)?;
        Err(if isolated {
            "这封邮件的服务器来源尚未通过核查，请重新收取真实文件夹后再打开"
        } else {
            "邮件已不在服务器上，且没有本地副本"
        }
        .into())
    }
    pub fn source_available(&self, a: &Account, folder: &str, remote: &str) -> Result<bool> {
        ReceiveLookup::new(self)?.source_available(a, folder, remote)
    }
    pub(crate) fn cached_flag_uids(
        &self,
        account: &Account,
        folder: &str,
        validity: u32,
    ) -> Result<std::collections::HashSet<u32>> {
        if self.folder_isolated_reason(&account.id, folder)?.is_some() {
            return Ok(Default::default());
        }
        let db = self.db()?;
        let mut stmt = db.prepare("SELECT s.remote_id FROM sources s JOIN message_listing m ON m.id=s.mail_id AND m.account_id=s.account_id WHERE s.account_id=?1 AND s.folder=?2 AND (?3=0 OR json_extract(m.data,'$.savedLocally')=1)").map_err(err)?;
        let rows = stmt
            .query_map(
                params![
                    account.id,
                    folder,
                    self.should_save_folder(account, folder)?
                ],
                |r| r.get::<_, String>(0),
            )
            .map_err(err)?;
        let mut uids = std::collections::HashSet::new();
        for row in rows {
            if let Some((Some(v), uid, None)) =
                crate::operations::remote_identity(&row.map_err(err)?)
            {
                if v == validity {
                    uids.insert(uid);
                }
            }
        }
        Ok(uids)
    }
    /// Merge observations without enqueueing a write back to the server. A
    /// single canonical active location controls flags on a deduplicated mail:
    /// INBOX first, then its original location, then a deterministic fallback.
    pub(crate) fn merge_remote_flags(
        &self,
        account: &Account,
        folder: &str,
        flags: &[(String, bool, bool)],
    ) -> Result<usize> {
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let current: Option<String> = tx
            .query_row(
                "SELECT data FROM accounts WHERE id=?1",
                [&account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        let Some(current) = current else {
            return Ok(0);
        };
        let current: Account = serde_json::from_str(&current).map_err(err)?;
        let identity = crate::operations::identity(account);
        if !current.enabled
            || current.protocol != "imap"
            || crate::operations::identity(&current) != identity
        {
            return Ok(0);
        }
        let mut changed = 0;
        let mut stmt = tx.prepare("WITH observed AS (SELECT m.id,json_set(data,
                '$.isRead',CASE WHEN json_extract(m.data,'$.localReadOverride') IS NOT NULL OR EXISTS(SELECT 1 FROM server_operations o WHERE o.account_id=?1 AND o.folder=?2 AND o.remote_id=?3 AND json_extract(o.data,'$.mailId')=m.id AND o.action='read' AND o.status IN ('queued','running','blocked') AND json_extract(o.data,'$.identity')=?6 AND json_extract(o.data,'$.value')=json_extract(m.data,'$.isRead')) THEN json(CASE json_extract(m.data,'$.isRead') WHEN 1 THEN 'true' ELSE 'false' END) ELSE json(?4) END,
                '$.starred',CASE WHEN json_extract(m.data,'$.localStarOverride') IS NOT NULL OR EXISTS(SELECT 1 FROM server_operations o WHERE o.account_id=?1 AND o.folder=?2 AND o.remote_id=?3 AND json_extract(o.data,'$.mailId')=m.id AND o.action='star' AND o.status IN ('queued','running','blocked') AND json_extract(o.data,'$.identity')=?6 AND json_extract(o.data,'$.value')=json_extract(m.data,'$.starred')) THEN json(CASE json_extract(m.data,'$.starred') WHEN 1 THEN 'true' ELSE 'false' END) ELSE json(?5) END) AS next_data
                FROM trusted_sources target JOIN messages m ON m.id=target.mail_id AND m.account_id=target.account_id WHERE target.account_id=?1 AND target.folder=?2 AND target.remote_id=?3 AND target.active=1
                AND ?2=(SELECT s.folder FROM trusted_sources s JOIN message_listing origin ON origin.id=s.mail_id WHERE s.account_id=?1 AND s.mail_id=m.id AND s.active=1 ORDER BY s.folder='INBOX' COLLATE NOCASE DESC,s.folder=json_extract(origin.data,'$.sourceFolder') DESC,s.folder COLLATE NOCASE,s.folder LIMIT 1))
                UPDATE messages SET data=(SELECT next_data FROM observed WHERE observed.id=messages.id) WHERE id IN (SELECT observed.id FROM observed JOIN messages original ON original.id=observed.id WHERE observed.next_data!=original.data)").map_err(err)?;
        for (remote, read, star) in flags {
            // Pending, running and rejected writes protect each flag separately.
            // Completed writes don't suppress later changes from other clients.
            // Only an intention for this exact current account/source applies.
            changed += stmt
                .execute(params![
                    account.id,
                    folder,
                    remote,
                    read.to_string(),
                    star.to_string(),
                    identity
                ])
                .map_err(err)?;
        }
        drop(stmt);
        tx.commit().map_err(err)?;
        Ok(changed)
    }
    pub fn unknown_dates(&self, account: &str, folder: &str) -> Result<Vec<String>> {
        let db = self.db()?;
        let mut q=db.prepare("SELECT s.remote_id FROM sources s JOIN message_listing m ON m.id=s.mail_id WHERE s.account_id=?1 AND s.folder=?2 AND s.active=1 AND json_extract(m.data,'$.date')=''").map_err(err)?;
        let rows = q
            .query_map(params![account, folder], |r| r.get(0))
            .map_err(err)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(err);
        rows
    }
    pub fn set_server_date(
        &self,
        account: &str,
        folder: &str,
        remote: &str,
        date: &str,
    ) -> Result<()> {
        let Some(date) = archive::parse_date(date).or_else(|| {
            chrono::DateTime::parse_from_rfc3339(date)
                .ok()
                .map(|d| d.to_rfc3339())
        }) else {
            return Ok(());
        };
        self.db()?.execute("UPDATE messages SET data=json_set(data,'$.serverDate',?4,'$.date',CASE WHEN json_extract(data,'$.date')='' THEN ?4 ELSE json_extract(data,'$.date') END) WHERE id IN (SELECT mail_id FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3)",params![account,folder,remote,date]).map_err(err)?;
        Ok(())
    }
    pub fn set_remote_metadata(
        &self,
        account: &str,
        folder: &str,
        remote: &str,
        size: Option<u32>,
        attachments: Option<bool>,
    ) -> Result<()> {
        self.db()?.execute("UPDATE messages SET data=json_set(data,'$.size',COALESCE(?4,json_extract(data,'$.size')),'$.hasAttachments',json(CASE COALESCE(?5,json_extract(data,'$.hasAttachments')) WHEN 1 THEN 'true' ELSE 'false' END),'$.attachmentMetadataKnown',json(CASE WHEN ?5 IS NOT NULL OR json_extract(data,'$.attachmentMetadataKnown')=1 THEN 'true' ELSE 'false' END)) WHERE id IN (SELECT mail_id FROM sources WHERE account_id=?1 AND folder=?2 AND remote_id=?3)",params![account,folder,remote,size,attachments]).map_err(err)?;
        Ok(())
    }
    pub fn mail_metadata(&self, id: &str) -> Result<Mail> {
        let data: String = self
            .db()?
            .query_row("SELECT data FROM message_listing WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(err)?;
        let mut mail: Mail = serde_json::from_str(&data).map_err(err)?;
        let graph = self.conversation_index(&mail.account_id)?;
        mail.conversation_id = graph.roots.get(id).cloned().unwrap_or_else(|| id.into());
        mail.conversation_count = *graph
            .counts
            .get(&(mail.conversation_id.clone(), mail.trashed))
            .unwrap_or(&1);
        Ok(mail)
    }
    pub fn message_raw(&self, mail: &Mail) -> Result<Vec<u8>> {
        let _archive = self.archive_gate.read().map_err(err)?;
        let current = self.mail(&mail.id)?;
        let mail = &current;
        if mail.saved_locally {
            archive::read_raw(&self.root, &mail.hash)
        } else {
            network::read_remote(self, &self.account(&mail.account_id)?, mail)
        }
    }
}

fn read_mappings(db: &rusqlite::Connection, account: &str) -> Result<Vec<FolderMapping>> {
    let data: Option<String> = db
        .query_row(
            "SELECT data FROM folder_mappings WHERE account_id=?1",
            [account],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    data.map(|s| serde_json::from_str(&s).map_err(err))
        .unwrap_or_else(|| Ok(Vec::new()))
}
fn apply_mappings(folder: &mut RemoteFolder, mappings: &[FolderMapping]) {
    folder.roles = folder
        .detected_roles
        .clone()
        .unwrap_or_else(|| folder.roles.clone());
    // Explicit destinations override discovery on that folder. Unassigned roles
    // stay as discovered elsewhere; a missing destination never silently falls back.
    folder
        .roles
        .retain(|role| !mappings.iter().any(|m| &m.role == role));
    if let Some(mapping) = mappings
        .iter()
        .find(|m| m.folder.as_deref() == Some(&folder.name))
    {
        folder.roles = vec![mapping.role];
    }
    normalize_folder(folder);
}

// RFC 6154 roles are authoritative. Exact conventional names are a fallback
// for servers without SPECIAL-USE; never classify by a substring of a user path.
pub fn folder_roles<'a>(
    name: &str,
    delimiter: Option<&str>,
    attributes: impl IntoIterator<Item = &'a str>,
) -> Vec<FolderRole> {
    let mut roles = Vec::new();
    if name.eq_ignore_ascii_case("INBOX") {
        roles.push(FolderRole::Inbox);
    }
    for attr in attributes {
        let role = match attr.to_ascii_lowercase().as_str() {
            "\\sent" => FolderRole::Sent,
            "\\drafts" => FolderRole::Drafts,
            "\\trash" => FolderRole::Trash,
            "\\junk" | "\\spam" => FolderRole::Junk,
            "\\archive" => FolderRole::Archive,
            "\\all" | "\\allmail" => FolderRole::All,
            "\\flagged" | "\\starred" => FolderRole::Flagged,
            _ => continue,
        };
        if !roles.contains(&role) {
            roles.push(role);
        }
    }
    if !roles.is_empty() {
        return roles;
    }
    let decoded = display_name(name);
    let (parent, leaf) = delimiter
        .and_then(|d| decoded.rsplit_once(d))
        .unwrap_or(("", &decoded));
    if !["", "inbox", "[gmail]", "[googlemail]"].contains(&parent.to_ascii_lowercase().as_str()) {
        return roles;
    }
    let role = match leaf.to_lowercase().as_str() {
        "inbox" | "收件箱" => FolderRole::Inbox,
        "sent" | "sent messages" | "sent items" | "sent mail" | "已发送" | "已发送邮件" => {
            FolderRole::Sent
        }
        "drafts" | "draft" | "草稿" | "草稿箱" => FolderRole::Drafts,
        "trash" | "deleted messages" | "deleted items" | "已删除" | "已删除邮件" | "废纸篓" => {
            FolderRole::Trash
        }
        "junk" | "junk email" | "spam" | "垃圾邮件" | "垃圾箱" => FolderRole::Junk,
        "archive" | "archives" | "归档" | "存档" => FolderRole::Archive,
        "all mail" | "所有邮件" => FolderRole::All,
        "starred" | "星标邮件" => FolderRole::Flagged,
        _ => return roles,
    };
    roles.push(role);
    roles
}
pub fn listed_folder(account: &str, name: &imap::types::Name) -> RemoteFolder {
    let mut folder = RemoteFolder {
        account_id: account.into(),
        detected_roles: None,
        sync_error: None,
        name: name.name().into(),
        display_name: display_name(name.name()),
        delimiter: name.delimiter().map(str::to_string),
        selectable: !name
            .attributes()
            .contains(&imap::types::NameAttribute::NoSelect),
        roles: folder_roles(
            name.name(),
            name.delimiter(),
            name.attributes().iter().filter_map(|a| {
                if let imap::types::NameAttribute::Custom(value) = a {
                    Some(value.as_ref())
                } else {
                    None
                }
            }),
        ),
    };
    normalize_folder(&mut folder);
    folder
}
pub(crate) fn normalize_folder(folder: &mut RemoteFolder) {
    folder.display_name = display_name(&folder.name);
    if folder.roles.is_empty() && folder.detected_roles.is_none() {
        folder.roles = folder_roles(&folder.name, folder.delimiter.as_deref(), []);
    }
    let label = match folder.roles.first() {
        Some(FolderRole::Inbox) => "收件箱",
        Some(FolderRole::Sent) => "已发送",
        Some(FolderRole::Drafts) => "草稿箱",
        Some(FolderRole::Trash) => "已删除",
        Some(FolderRole::Junk) => "垃圾邮件",
        Some(FolderRole::Archive) => "归档",
        Some(FolderRole::All) => "所有邮件",
        Some(FolderRole::Flagged) => "星标邮件",
        None => return,
    };
    let decoded = display_name(&folder.name);
    folder.display_name = if let Some((parent, _)) = folder
        .delimiter
        .as_deref()
        .and_then(|d| decoded.rsplit_once(d))
    {
        format!("{parent}{}{label}", folder.delimiter.as_deref().unwrap())
    } else {
        label.into()
    };
}
pub fn excluded_from_auto_sync(folder: &RemoteFolder) -> bool {
    folder
        .roles
        .iter()
        .any(|role| matches!(role, FolderRole::Trash | FolderRole::Junk))
}
// IMAP modified UTF-7 is a wire name; never pass a decoded display name back
// to SELECT. Retain exact wire names in queries and source tracking.
pub fn display_name(name: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let mut out = String::new();
    let mut tail = name;
    while let Some(i) = tail.find('&') {
        out.push_str(&tail[..i]);
        tail = &tail[i + 1..];
        let Some(end) = tail.find('-') else {
            out.push('&');
            out.push_str(tail);
            return out;
        };
        let token = &tail[..end];
        if token.is_empty() {
            out.push('&');
        } else {
            let mut encoded = token.replace(',', "/");
            while encoded.len() % 4 != 0 {
                encoded.push('=');
            }
            let decoded = STANDARD
                .decode(encoded)
                .ok()
                .filter(|b| b.len() % 2 == 0)
                .and_then(|b| {
                    String::from_utf16(
                        &b.chunks_exact(2)
                            .map(|p| u16::from_be_bytes([p[0], p[1]]))
                            .collect::<Vec<_>>(),
                    )
                    .ok()
                });
            out.push_str(&decoded.unwrap_or_else(|| format!("&{token}-")));
        }
        tail = &tail[end + 1..];
    }
    out.push_str(tail);
    if out.eq_ignore_ascii_case("INBOX") {
        "收件箱".into()
    } else {
        out
    }
}

// Render folder names in activity/error text once at the display boundary.
// Keep stored diagnostics and protocol paths intact, including older logs.
pub fn display_activity(message: &str) -> String {
    const PREFIX: &str = "文件夹「";
    let mut out = String::with_capacity(message.len());
    let mut tail = message;
    while let Some(start) = tail.find(PREFIX) {
        let name_start = start + PREFIX.len();
        let Some(end) = tail[name_start..].find('」') else {
            break;
        };
        out.push_str(&tail[..name_start]);
        out.push_str(&display_name(&tail[name_start..name_start + end]));
        out.push('」');
        tail = &tail[name_start + end + '」'.len_utf8()..];
    }
    out.push_str(tail);
    out
}

#[cfg(test)]
mod folder_tests {
    use super::*;
    #[test]
    fn authoritative_roles_override_names_and_preserve_multiple_uses() {
        assert_eq!(
            folder_roles("Trash", Some("/"), ["\\Sent"]),
            vec![FolderRole::Sent]
        );
        assert_eq!(
            folder_roles("Custom", Some("/"), ["\\All", "\\Archive", "\\ALL"]),
            vec![FolderRole::All, FolderRole::Archive]
        );
        assert_eq!(
            folder_roles("INBOX", Some("/"), []),
            vec![FolderRole::Inbox]
        );
        assert_eq!(
            folder_roles("Important", None, ["\\Flagged"]),
            vec![FolderRole::Flagged]
        );
    }
    #[test]
    fn aliases_are_exact_and_do_not_skip_personal_folders() {
        for name in ["Sent Messages", "Sent Items", "INBOX.Sent"] {
            assert_eq!(folder_roles(name, Some("."), []), vec![FolderRole::Sent]);
        }
        assert_eq!(
            folder_roles("[Gmail]/Sent Mail", Some("/"), ["\\Sent"]),
            vec![FolderRole::Sent]
        );
        assert_eq!(
            folder_roles("[GoogleMail]/All Mail", Some("/"), []),
            vec![FolderRole::All]
        );
        assert_eq!(folder_roles("&UXZO1mWHTvZZOQ-", Some("/"), []), vec![]);
        for name in [
            "My Spam Research",
            "Work/Sent",
            "Team/Trash",
            "Deleted Reports",
            "literal/Sent",
        ] {
            assert!(folder_roles(name, Some("/"), []).is_empty());
        }
        assert!(folder_roles("literal/Sent", None, []).is_empty());
    }
    #[test]
    fn cache_migration_keeps_wire_names_and_role_labels_keep_hierarchy() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        store.db().unwrap().execute("INSERT INTO remote_folders VALUES('a','INBOX.Sent Items',?1)", [r#"{"accountId":"a","name":"INBOX.Sent Items","displayName":"INBOX.Sent Items","delimiter":".","selectable":true}"#]).unwrap();
        drop(store);
        let reopened = Store::new(dir.path().into()).unwrap();
        let folder = &reopened.remote_folders(None).unwrap()[0];
        assert_eq!(folder.name, "INBOX.Sent Items");
        assert_eq!(folder.display_name, "INBOX.已发送");
        assert_eq!(folder.roles, vec![FolderRole::Sent]);
        let json: String = reopened
            .db()
            .unwrap()
            .query_row("SELECT data FROM remote_folders", [], |r| r.get(0))
            .unwrap();
        assert!(json.contains("\"sent\""));
    }
    #[test]
    fn trash_and_junk_are_excluded_by_role_but_all_mail_is_not_an_archive_target() {
        let mut folder = RemoteFolder {
            account_id: "a".into(),
            detected_roles: None,
            name: "VendorCustom".into(),
            display_name: "VendorCustom".into(),
            delimiter: None,
            selectable: true,
            sync_error: None,
            roles: vec![FolderRole::Trash],
        };
        assert!(excluded_from_auto_sync(&folder));
        folder.roles = vec![FolderRole::Junk];
        assert!(excluded_from_auto_sync(&folder));
        folder.roles = vec![FolderRole::All];
        assert!(!excluded_from_auto_sync(&folder));
        assert!(!folder.roles.contains(&FolderRole::Archive));
    }
}
