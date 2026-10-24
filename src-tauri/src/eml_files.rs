//! Read-only external EML documents. Never uses the mailbox database or credentials.
use crate::{archive, models::*};
use serde::Serialize;
use std::{
    collections::VecDeque,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone, Default)]
pub struct EmlFiles(Arc<Mutex<Documents>>);
#[derive(Default)]
struct Documents {
    pending: VecDeque<String>,
    current: Option<(String, Arc<Vec<u8>>)>,
    source: Option<PathBuf>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmlDocument {
    pub token: String,
    pub filename: String,
    pub detail: Detail,
}
pub fn window_label(token: &str) -> String {
    format!("external-mail-{token}")
}
pub fn account() -> Account {
    Account {
        id: "external-eml".into(),
        name: "邮件文件".into(),
        email: String::new(),
        provider: String::new(),
        protocol: "imap".into(),
        incoming_host: String::new(),
        incoming_port: 993,
        incoming_tls: "tls".into(),
        smtp_host: String::new(),
        smtp_port: 465,
        smtp_tls: "tls".into(),
        username: String::new(),
        smtp_username: String::new(),
        auth: "password".into(),
        oauth_client_id: String::new(),
        enabled: false,
        save_locally: false,
        server_retention_days: None,
        last_sync: None,
        error: None,
    }
}
pub fn is_eml(path: &Path) -> bool {
    crate::mail_formats::single(path)
}
fn argument_path(value: &str, cwd: &Path) -> Option<PathBuf> {
    if value.starts_with('-') {
        return None;
    }
    let path = if value.starts_with("file:") {
        tauri::Url::parse(value).ok()?.to_file_path().ok()?
    } else {
        if value.contains("://") {
            return None;
        }
        let path = PathBuf::from(value);
        if path.is_absolute() {
            path
        } else {
            cwd.join(path)
        }
    };
    is_eml(&path).then_some(path)
}
impl EmlFiles {
    pub fn queue_args(&self, args: impl IntoIterator<Item = String>, cwd: &Path) -> bool {
        let mut accepted = false;
        for arg in args {
            if let Some(path) = argument_path(&arg, cwd) {
                self.queue(path);
                accepted = true;
            }
        }
        accepted
    }
    pub fn queue(&self, path: PathBuf) {
        if !is_eml(&path) {
            return;
        }
        if let Ok(mut docs) = self.0.lock() {
            let path = path.to_string_lossy().into_owned();
            if docs.pending.len() < 32 && !docs.pending.contains(&path) {
                docs.pending.push_back(path);
            }
        }
    }
    pub fn take_pending(&self) -> Result<Vec<String>> {
        Ok(self.0.lock().map_err(err)?.pending.drain(..).collect())
    }
    pub fn document_for_label(&self, label: &str) -> Result<EmlDocument> {
        let (token, raw, source) = {
            let docs = self.0.lock().map_err(err)?;
            let (token, raw) = docs.current.clone().ok_or("邮件文件已关闭，请重新打开")?;
            if window_label(&token) != label {
                return Err("邮件文件不属于当前窗口".into());
            }
            (token, raw, docs.source.clone().ok_or("邮件文件来源已关闭")?)
        };
        let (mut mail, html, attachments) = archive::parse(&raw, &account(), "")?;
        mail.saved_locally = false;
        let (reply_to, to, cc, bcc) = archive::reply_addresses(&raw)?;
        Ok(EmlDocument {
            token,
            filename: source
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            detail: Detail {
                original_hash: archive::digest(&raw),
                mail,
                html,
                attachments,
                reply_to,
                to,
                cc,
                bcc,
            },
        })
    }
    pub fn close_label(&self, label: &str) -> Result<()> {
        let mut docs = self.0.lock().map_err(err)?;
        if docs
            .current
            .as_ref()
            .is_some_and(|(token, _)| window_label(token) == label)
        {
            docs.current = None;
            docs.source = None;
        }
        Ok(())
    }
    pub fn open(&self, path: &Path) -> Result<EmlDocument> {
        if !is_eml(path) {
            return Err("invalidFile".into());
        }
        let raw = crate::eml_input::read(path, None)?;
        let (mut mail, html, attachments) = archive::parse(&raw, &account(), "")?;
        mail.saved_locally = false;
        let (reply_to, to, cc, bcc) = archive::reply_addresses(&raw)?;
        let token = uuid::Uuid::new_v4().to_string();
        let original_hash = archive::digest(&raw);
        let source = path.canonicalize().map_err(err)?;
        let mut docs = self.0.lock().map_err(err)?;
        docs.current = Some((token.clone(), Arc::new(raw)));
        docs.source = Some(source);
        drop(docs);
        Ok(EmlDocument {
            token,
            filename: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            detail: Detail {
                original_hash,
                mail,
                html,
                attachments,
                reply_to,
                to,
                cc,
                bcc,
            },
        })
    }
    pub fn raw(&self, token: &str) -> Result<Arc<Vec<u8>>> {
        let docs = self.0.lock().map_err(err)?;
        match &docs.current {
            Some((current, raw)) if current == token => Ok(raw.clone()),
            _ => Err("邮件文件已关闭或切换，请重新打开后操作附件".into()),
        }
    }
    pub fn save_attachment(&self, token: &str, index: usize, path: &Path) -> Result<()> {
        let docs = self.0.lock().map_err(err)?;
        let raw = match &docs.current {
            Some((current, raw)) if current == token => raw.clone(),
            _ => return Err("邮件文件已关闭或切换，请重新打开后操作附件".into()),
        };
        let source = docs.source.clone();
        drop(docs);
        let normalized = path
            .parent()
            .and_then(|p| p.canonicalize().ok())
            .zip(path.file_name())
            .map(|(parent, name)| parent.join(name));
        if source.is_some() && (path.canonicalize().ok() == source || normalized == source) {
            return Err("附件不能覆盖正在查看的原始邮件文件，请选择其他位置".into());
        }
        archive::atomic_write(path, &archive::attachment(&raw, index)?)
    }
    pub fn close(&self, token: &str) -> Result<()> {
        let mut docs = self.0.lock().map_err(err)?;
        if docs
            .current
            .as_ref()
            .is_some_and(|(current, _)| current == token)
        {
            docs.current = None;
            docs.source = None;
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::eml_input::MAX_BYTES;
    use std::fs::File;
    fn fixture(name: &str, raw: &[u8]) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("anser-eml-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, raw).unwrap();
        (dir, path)
    }
    const MIME: &[u8] = b"From: Sample <sample@example.com>\r\nTo: reader@example.com\r\nDate: Thu, 8 Oct 2026 10:00:00 +0800\r\nSubject: EML sample\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=sample\r\n\r\n--sample\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Sample body</p>\r\n--sample\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=sample.bin\r\nContent-Transfer-Encoding: base64\r\n\r\nAAH/gA==\r\n--sample--\r\n";
    #[test]
    fn read_original_date_html_and_exact_attachment_without_changing_file() {
        let (dir, path) = fixture("sample.EML", MIME);
        let docs = EmlFiles::default();
        let document = docs.open(&path).unwrap();
        assert_eq!(document.detail.mail.subject, "EML sample");
        assert!(document.detail.mail.date.contains("2026-10-08"));
        assert!(document.detail.html.contains("Sample body"));
        assert!(!document.detail.mail.saved_locally);
        let raw = docs.raw(&document.token).unwrap();
        assert_eq!(
            archive::attachment(&raw, document.detail.attachments[0].index).unwrap(),
            [0, 1, 255, 128]
        );
        assert!(docs
            .save_attachment(&document.token, document.detail.attachments[0].index, &path)
            .is_err());
        docs.save_attachment(
            &document.token,
            document.detail.attachments[0].index,
            &dir.join("attachment.bin"),
        )
        .unwrap();
        assert_eq!(
            std::fs::read(dir.join("attachment.bin")).unwrap(),
            [0, 1, 255, 128]
        );
        assert_eq!(std::fs::read(&path).unwrap(), MIME);
        std::fs::write(&path, b"changed").unwrap();
        assert_eq!(docs.raw(&document.token).unwrap().as_slice(), MIME);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn stale_token_cannot_read_another_document_or_close_it() {
        let (dir, path) = fixture("sample.eml", MIME);
        let docs = EmlFiles::default();
        let old = docs.open(&path).unwrap().token;
        let new = docs.open(&path).unwrap().token;
        assert!(docs.raw(&old).is_err());
        docs.close(&old).unwrap();
        assert!(docs.raw(&new).is_ok());
        docs.close(&new).unwrap();
        assert!(docs.raw(&new).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_non_mail_and_oversized_files() {
        let (dir, path) = fixture("sample.eml", b"not an email");
        let docs = EmlFiles::default();
        assert!(docs.open(&path).is_err());
        assert!(docs.open(&dir).is_err());
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_BYTES + 1)
            .unwrap();
        assert_eq!(docs.open(&path).unwrap_err(), "tooLarge");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn startup_and_url_arguments_are_queued_once_and_drained() {
        let docs = EmlFiles::default();
        assert!(docs.queue_args(
            [
                "--autostart".into(),
                "test.EML".into(),
                "https://example.com/test.eml".into(),
                "file:///tmp/test.EML".into(),
            ],
            Path::new("/tmp"),
        ));
        assert_eq!(docs.take_pending().unwrap(), ["/tmp/test.EML"]);
        assert!(docs.take_pending().unwrap().is_empty());
        assert!(!docs.queue_args(["--autostart".into()], Path::new("/tmp")));
    }
}
