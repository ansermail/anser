use crate::{models::*, store::Store};
use rusqlite::{params, OptionalExtension};
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailSignature {
    pub enabled: bool,
    pub use_html: bool,
    pub text: String,
    pub file_name: String,
    pub file_text: String,
    pub file_html: String,
}
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeSignature {
    pub account_id: String,
    pub included: bool,
    pub body: String,
    pub html: String,
}
impl Store {
    pub fn mail_signature(&self, account_id: &str) -> Result<MailSignature> {
        self.account(account_id)?;
        let data: Option<String> = self
            .db()?
            .query_row(
                "SELECT data FROM preferences WHERE key=?1",
                [format!("signature:{account_id}")],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        data.map(|data| serde_json::from_str(&data).map_err(err))
            .transpose()
            .map(|value| value.unwrap_or_default())
    }
    pub fn save_mail_signature(&self, account_id: &str, signature: &MailSignature) -> Result<()> {
        let data = serde_json::to_string(signature).map_err(err)?;
        if data.len() > 4 * 1024 * 1024 {
            return Err("签名内容过大，请使用不超过 2 MB 的文件".into());
        }
        let mut db = self.db()?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(err)?;
        let exists: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=?1)",
                [account_id],
                |r| r.get(0),
            )
            .map_err(err)?;
        if !exists {
            return Err("账号已移除，签名未保存".into());
        }
        tx.execute("INSERT INTO preferences(key,data) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET data=excluded.data", params![format!("signature:{account_id}"),data]).map_err(err)?;
        tx.commit().map_err(err)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signatures_are_account_scoped_persistent_and_do_not_require_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let a = crate::tests::account();
        store.save_account(&a).unwrap();
        assert!(!store.mail_signature(&a.id).unwrap().enabled);
        let s = MailSignature {
            enabled: true,
            text: "Best regards".into(),
            ..Default::default()
        };
        store.save_mail_signature(&a.id, &s).unwrap();
        let reopened = Store::new(dir.path().into()).unwrap();
        assert_eq!(reopened.mail_signature(&a.id).unwrap().text, s.text);
        let mut second = a.clone();
        second.id = "another".into();
        store.save_account(&second).unwrap();
        assert!(store.mail_signature(&second.id).unwrap().text.is_empty());
        assert!(store.save_mail_signature("missing", &s).is_err());
        let oversized = MailSignature {
            text: "x".repeat(4 * 1024 * 1024),
            ..Default::default()
        };
        assert!(store.save_mail_signature(&a.id, &oversized).is_err());
        assert_eq!(store.mail_signature(&a.id).unwrap().text, s.text);
    }
    #[test]
    fn draft_roundtrip_preserves_signature_snapshot_and_disabled_choice() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let mut d = crate::tests::draft();
        d.signature = Some(ComposeSignature {
            account_id: d.account_id.clone(),
            included: false,
            body: "Frozen".into(),
            html: "<b>Frozen</b>".into(),
        });
        store.save_draft(&d).unwrap();
        let read = store.drafts().unwrap().pop().unwrap();
        assert!(!read.signature.as_ref().unwrap().included);
        assert_eq!(read.signature.unwrap().body, "Frozen");
    }
}
