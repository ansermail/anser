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
    #[serde(default)]
    pub last_sync: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}
impl Account {
    pub fn validate(&self) -> Result<()> {
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
    pub local_folder: String,
    pub trashed: bool,
    pub has_attachments: bool,
    pub hash: String,
    pub size: u64,
    pub saved_at: String,
    pub source_folder: String,
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
    pub unread_only: bool,
    #[serde(default)]
    pub starred_only: bool,
    #[serde(default)]
    pub attachments_only: bool,
    #[serde(default)]
    pub search_field: String,
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
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInfo {
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
    pub attachments: Vec<String>,
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
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub sync_interval_minutes: u32,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            sync_interval_minutes: 5,
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
