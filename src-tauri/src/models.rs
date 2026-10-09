fn default_true() -> bool {
    true
}
use serde::{Deserialize, Serialize};
pub type Result<T> = std::result::Result<T, String>;
pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    pub provider: String,
    pub protocol: String,
    pub incoming_host: String,
    pub incoming_port: u16,
    pub incoming_tls: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_tls: String,
    pub username: String,
    pub smtp_username: String,
    pub auth: String,
    #[serde(default)]
    pub oauth_client_id: String,
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub save_locally: bool,
    #[serde(default)]
    pub server_retention_days: Option<u32>,
    #[serde(default)]
    pub last_sync: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}
impl Account {
    pub fn same_connection(&self, other: &Self) -> bool {
        self.id == other.id
            && self.email == other.email
            && self.provider == other.provider
            && self.protocol == other.protocol
            && self.incoming_host == other.incoming_host
            && self.incoming_port == other.incoming_port
            && self.incoming_tls == other.incoming_tls
            && self.smtp_host == other.smtp_host
            && self.smtp_port == other.smtp_port
            && self.smtp_tls == other.smtp_tls
            && self.username == other.username
            && self.smtp_username == other.smtp_username
            && self.auth == other.auth
            && self.oauth_client_id == other.oauth_client_id
    }
    pub fn validate(&self) -> Result<()> {
        if self
            .server_retention_days
            .is_some_and(|days| days == 0 || days > 3650)
        {
            return Err("服务器保留期请填写 1–3650 天，未知时留空".into());
        }
        if self.email.parse::<lettre::Address>().is_err() {
            return Err("请输入有效的邮箱地址".into());
        }
        if !["imap", "pop3"].contains(&self.protocol.as_str()) {
            return Err("收件协议无效".into());
        }
        if !["password", "oauth"].contains(&self.auth.as_str()) {
            return Err("认证方式无效".into());
        }
        for (host, port, tls) in [
            (&self.incoming_host, self.incoming_port, &self.incoming_tls),
            (&self.smtp_host, self.smtp_port, &self.smtp_tls),
        ] {
            if host.is_empty() || host.contains(['\r', '\n', '/', ' ', '\t']) || port == 0 {
                return Err("请检查服务器地址与端口".into());
            }
            if !["tls", "starttls"].contains(&tls.as_str()) {
                return Err("请选择 TLS 或 STARTTLS 加密".into());
            }
        }
        if self.username.is_empty()
            || self.username.contains(['\r', '\n'])
            || self.smtp_username.contains(['\r', '\n'])
        {
            return Err("请检查登录用户名".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mail {
    #[serde(default)]
    pub parse_warnings: Vec<String>,
    pub id: String,
    pub account_id: String,
    pub account_email: String,
    pub sender: String,
    pub recipients: String,
    pub subject: String,
    pub preview: String,
    pub body: String,
    pub date: String,
    pub is_read: bool,
    pub starred: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_read_override: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_star_override: Option<bool>,
    pub local_folder: String,
    pub trashed: bool,
    pub has_attachments: bool,
    #[serde(default)]
    pub attachment_metadata_known: bool,
    pub hash: String,
    pub size: u64,
    pub saved_at: String,
    #[serde(default = "default_true")]
    pub saved_locally: bool,
    #[serde(default)]
    pub server_date: String,
    pub source_folder: String,
    #[serde(default)]
    pub message_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub server_message_id: String,
    #[serde(default)]
    pub in_reply_to: Vec<String>,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub conversation_count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub field: String,
    pub operator: String,
    pub value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub name: String,
    pub account_id: String,
    pub enabled: bool,
    pub mode: String,
    pub conditions: Vec<Condition>,
    pub action: String,
    pub destination: String,
    #[serde(default)]
    pub source_folder: String,
    pub stop: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub view: String,
    pub account_id: String,
    pub search: String,
    pub folder: String,
    pub limit: u32,
    #[serde(default)]
    pub remote_folder: String,
    #[serde(default)]
    pub unread_only: bool,
    #[serde(default)]
    pub starred_only: bool,
    #[serde(default)]
    pub attachments_only: bool,
    #[serde(default)]
    pub search_field: String,
    #[serde(default)]
    pub list_mode: ListMode,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ListMode {
    #[default]
    Conversations,
    Messages,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: u64,
    pub unread: u64,
    pub saved: u64,
    pub bytes: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub accounts: Vec<Account>,
    pub messages: Vec<Mail>,
    pub rules: Vec<Rule>,
    pub folders: Vec<String>,
    pub stats: Stats,
    pub logs: Vec<String>,
    pub data_dir: String,
    pub matched: u64,
    pub remote_folders: Vec<RemoteFolder>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
    #[serde(default)]
    pub error: String,
    pub index: usize,
    pub name: String,
    pub size: usize,
    pub mime: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub mail: Mail,
    pub html: String,
    pub attachments: Vec<AttachmentInfo>,
    pub reply_to: Vec<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotedMail {
    pub kind: String,
    pub included: bool,
    pub sender: String,
    pub recipients: String,
    pub date: String,
    pub subject: String,
    pub body: String,
    pub html: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Compose {
    pub id: String,
    pub account_id: String,
    pub to: String,
    pub cc: String,
    pub bcc: String,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub html: String,
    #[serde(default)]
    pub format: String,
    #[serde(default)]
    pub source: String,
    pub attachments: Vec<String>,
    #[serde(default)]
    pub in_reply_to: String,
    #[serde(default)]
    pub reply_anchor_id: String,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub quote: Option<QuotedMail>,
    #[serde(default)]
    pub delivery_body: Option<String>,
    #[serde(default)]
    pub delivery_html: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Address {
    pub name: String,
    pub email: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: String,
    pub name: String,
    pub email: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRecord {
    pub id: String,
    pub status: String,
    pub draft: Compose,
    pub error: String,
    pub updated_at: String,
    pub archived: bool,
    pub scheduled_at: String,
    pub server_copy: Option<crate::sent_uploads::SentUpload>,
    #[serde(default)]
    pub server_copy_available: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    #[serde(default = "default_true")]
    pub new_mail_notifications: bool,
    #[serde(default = "default_true")]
    pub send_result_notifications: bool,
    pub sync_interval_minutes: u32,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            sync_interval_minutes: 5,
            new_mail_notifications: true,
            send_result_notifications: true,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveProblem {
    pub mail_id: String,
    pub subject: String,
    pub error: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveHealth {
    pub checked: usize,
    pub healthy: usize,
    pub problems: Vec<ArchiveProblem>,
    pub checked_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFolder {
    pub account_id: String,
    pub name: String,
    pub display_name: String,
    pub delimiter: Option<String>,
    pub selectable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync_error: Option<String>,
    #[serde(default)]
    pub roles: Vec<FolderRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detected_roles: Option<Vec<FolderRole>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMapping {
    pub role: FolderRole,
    // None explicitly disables a role; an absent mapping uses discovery.
    pub folder: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSettings {
    pub folders: Vec<RemoteFolder>,
    pub mappings: Vec<FolderMapping>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderRole {
    Inbox,
    Sent,
    Drafts,
    Trash,
    Junk,
    Archive,
    All,
    Flagged,
}
