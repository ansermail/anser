//! Local rotating diagnostic logs and redacted support-bundle export.
//! Passwords, authorization codes, tokens, and message bodies must never be
//! written here; exported reports additionally mask email addresses and omit
//! private subjects so users can share them safely for troubleshooting.
use crate::{archive, models::*, store::Store};
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const LOG_DIR: &str = "logs";
const LOG_FILE: &str = "anser.log";
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_FILES: usize = 5;
const MAX_LINE_CHARS: usize = 2000;
const EXPORT_MAX_BYTES: usize = 512 * 1024;
const EXPORT_MAX_LINES: usize = 2000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticLogStatus {
    pub path: String,
    pub file_count: usize,
    pub total_bytes: u64,
}

fn write_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
}

pub fn log_dir(root: &Path) -> PathBuf {
    root.join(LOG_DIR)
}

fn ensure_private_dir(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

/// Remove line breaks/control bytes, cap length, and redact obvious secret
/// patterns so a single error string can never corrupt log framing or leak
/// raw authentication material.
pub fn sanitize_message(input: &str) -> String {
    let mut cleaned = String::with_capacity(input.len().min(MAX_LINE_CHARS));
    let mut last_space = false;
    for ch in input.chars() {
        let mapped = if ch == '\r' || ch == '\n' || ch == '\t' {
            ' '
        } else if ch.is_control() {
            continue;
        } else {
            ch
        };
        if mapped == ' ' {
            if last_space {
                continue;
            }
            last_space = true;
        } else {
            last_space = false;
        }
        cleaned.push(mapped);
        if cleaned.chars().count() >= MAX_LINE_CHARS {
            cleaned.push('…');
            break;
        }
    }
    redact_secrets(cleaned.trim())
}

fn redact_secrets(text: &str) -> String {
    let mut out = text.to_string();
    for marker in [
        "Bearer ",
        "bearer ",
        "access_token=",
        "refresh_token=",
        "client_secret=",
        "password=",
        "PASS ",
    ] {
        out = redact_after_marker(&out, marker);
    }
    out
}

fn redact_after_marker(text: &str, marker: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(idx) = rest.find(marker) {
        out.push_str(&rest[..idx + marker.len()]);
        out.push_str("[REDACTED]");
        let after = &rest[idx + marker.len()..];
        let end = after
            .find(|c: char| c.is_whitespace() || matches!(c, '&' | '"' | '\'' | ';' | ',' | ')'))
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    out
}

/// Mask email local parts (`lalis@chaizhou.cn` -> `l***@chaizhou.cn`) while
/// preserving the domain so provider and DNS diagnostics stay actionable.
pub fn mask_emails(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'@' {
            // Walk back over local-part characters already pushed into `out`.
            let mut local_start = out.len();
            while local_start > 0 {
                let prev = out.as_bytes()[local_start - 1];
                if prev.is_ascii_alphanumeric() || b"._%+-".contains(&prev) {
                    local_start -= 1;
                } else {
                    break;
                }
            }
            let mut domain_end = i + 1;
            while domain_end < bytes.len() {
                let b = bytes[domain_end];
                if b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-') {
                    domain_end += 1;
                } else {
                    break;
                }
            }
            let local_len = out.len() - local_start;
            let domain = &text[i + 1..domain_end];
            if local_len > 0
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
            {
                let first = out[local_start..].chars().next().unwrap_or('*');
                out.truncate(local_start);
                out.push(first);
                out.push_str("***@");
                out.push_str(domain);
                i = domain_end;
                continue;
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

pub fn append(root: &Path, level: &str, scope: &str, message: &str) {
    let _ = append_with_limit(root, level, scope, message, MAX_FILE_BYTES, MAX_FILES);
}

fn append_with_limit(
    root: &Path,
    level: &str,
    scope: &str,
    message: &str,
    max_bytes: u64,
    max_files: usize,
) -> Result<()> {
    let _guard = write_gate().lock().unwrap_or_else(|e| e.into_inner());
    let dir = log_dir(root);
    ensure_private_dir(&dir)?;
    let path = dir.join(LOG_FILE);
    let stamp = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, false);
    let safe_level = match level {
        "ERROR" | "WARN" | "INFO" | "DEBUG" => level,
        _ => "INFO",
    };
    let safe_scope: String = scope
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(32)
        .collect();
    let safe_scope = if safe_scope.is_empty() {
        "app"
    } else {
        safe_scope.as_str()
    };
    let line = format!(
        "{stamp} [{safe_level}] [{safe_scope}] {}\n",
        sanitize_message(message)
    );
    if max_files > 1
        && fs::metadata(&path)
            .map(|m| m.len().saturating_add(line.len() as u64) > max_bytes)
            .unwrap_or(false)
    {
        rotate_files(&dir, max_files);
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    file.write_all(line.as_bytes()).map_err(err)?;
    Ok(())
}

fn rotate_files(dir: &Path, max_files: usize) {
    let oldest = dir.join(format!("{LOG_FILE}.{}", max_files - 1));
    let _ = fs::remove_file(oldest);
    for idx in (1..max_files - 1).rev() {
        let from = dir.join(format!("{LOG_FILE}.{idx}"));
        let to = dir.join(format!("{LOG_FILE}.{}", idx + 1));
        if from.exists() {
            let _ = fs::rename(from, to);
        }
    }
    let active = dir.join(LOG_FILE);
    if active.exists() {
        let _ = fs::rename(active, dir.join(format!("{LOG_FILE}.1")));
    }
}

pub fn status(root: &Path) -> DiagnosticLogStatus {
    let dir = log_dir(root);
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    for name in log_file_names() {
        if let Ok(meta) = fs::metadata(dir.join(name)) {
            if meta.is_file() {
                file_count += 1;
                total_bytes = total_bytes.saturating_add(meta.len());
            }
        }
    }
    DiagnosticLogStatus {
        path: dir.to_string_lossy().into_owned(),
        file_count,
        total_bytes,
    }
}

fn log_file_names() -> Vec<String> {
    let mut names = vec![LOG_FILE.to_string()];
    for idx in 1..MAX_FILES {
        names.push(format!("{LOG_FILE}.{idx}"));
    }
    names
}

pub fn open_directory(root: &Path) -> Result<()> {
    let dir = log_dir(root);
    ensure_private_dir(&dir)?;
    open::that(&dir).map_err(err)
}

fn read_recent_log_lines(root: &Path) -> Vec<String> {
    let _guard = write_gate().lock().unwrap_or_else(|e| e.into_inner());
    let dir = log_dir(root);
    let mut combined = Vec::new();
    // Read previous file then active file so chronological order is preserved.
    for name in [format!("{LOG_FILE}.1"), LOG_FILE.to_string()] {
        let path = dir.join(name);
        if let Ok(bytes) = fs::read(&path) {
            let slice = if bytes.len() > EXPORT_MAX_BYTES {
                &bytes[bytes.len() - EXPORT_MAX_BYTES..]
            } else {
                &bytes[..]
            };
            let text = String::from_utf8_lossy(slice);
            for line in text.lines() {
                if !line.trim().is_empty() {
                    combined.push(mask_emails(&sanitize_message(line)));
                }
            }
        }
    }
    if combined.len() > EXPORT_MAX_LINES {
        combined.drain(..combined.len() - EXPORT_MAX_LINES);
    }
    combined
}

pub fn build_report(store: &Store) -> Result<String> {
    let mut out = String::new();
    let now_local = chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, false);
    let now_utc = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    out.push_str("# Anser Diagnostic Log (Redacted)\n");
    out.push_str(&format!("App Version: {}\n", env!("CARGO_PKG_VERSION")));
    out.push_str(&format!(
        "Platform: {} / {}\n",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    out.push_str(&format!("Exported At: {now_local} (UTC: {now_utc})\n"));
    out.push_str("Privacy: Passwords, tokens, message bodies, attachments, and subjects are excluded; email local parts are masked.\n\n");

    out.push_str("## Network Proxy\n");
    match crate::proxy::current() {
        Ok((Some(proxy), _)) => {
            out.push_str(&format!(
                "enabled=true kind={} port={} auth={} directOnFailure={}\n",
                proxy.kind,
                proxy.port,
                !proxy.username.is_empty(),
                proxy.direct_on_failure
            ));
        }
        Ok((None, _)) => out.push_str("enabled=false (direct)\n"),
        Err(error) => out.push_str(&format!(
            "status=error ({})\n",
            mask_emails(&sanitize_message(&error))
        )),
    }
    out.push('\n');

    out.push_str("## Accounts\n");
    let accounts = store.accounts()?;
    if accounts.is_empty() {
        out.push_str("(none)\n");
    } else {
        for (idx, account) in accounts.iter().enumerate() {
            let masked_email = mask_emails(&account.email);
            let error_note = account
                .error
                .as_deref()
                .map(|e| mask_emails(&sanitize_message(e)))
                .unwrap_or_else(|| "none".into());
            out.push_str(&format!(
                "{}. provider={} protocol={} email={} incoming={}:{}/{} smtp={}:{}/{} auth={} enabled={} saveLocally={} lastSync={} error={}\n",
                idx + 1,
                account.provider,
                account.protocol,
                masked_email,
                account.incoming_host,
                account.incoming_port,
                account.incoming_tls,
                account.smtp_host,
                account.smtp_port,
                account.smtp_tls,
                account.auth,
                account.enabled,
                account.save_locally,
                account.last_sync.as_deref().unwrap_or("never"),
                error_note
            ));
        }
    }
    out.push('\n');

    out.push_str("## Sync Failures\n");
    let failures = store.sync_failures()?;
    if failures.is_empty() {
        out.push_str("(none)\n");
    } else {
        for item in failures {
            let size_label = item
                .size
                .map(crate::sync_failures::format_size_label)
                .unwrap_or_else(|| "unknown".into());
            out.push_str(&format!(
                "- account={} folder={} uid={} size={} status={} failedAt={} stage={} reason={}\n",
                mask_emails(&item.account_email),
                item.display_name,
                item.uid,
                size_label,
                item.status,
                item.failed_at,
                sanitize_message(&item.stage),
                mask_emails(&sanitize_message(&item.reason))
            ));
        }
    }
    out.push('\n');

    out.push_str("## Quarantined Folders\n");
    let health = store.folder_health()?;
    if health.is_empty() {
        out.push_str("(none)\n");
    } else {
        for item in health {
            out.push_str(&format!(
                "- account={} folder={} checkedAt={} exists={:?} uidCount={:?} reason={}\n",
                mask_emails(&item.account_email),
                item.display_name,
                item.checked_at,
                item.evidence.exists,
                item.evidence.uid_count,
                mask_emails(&sanitize_message(&item.reason))
            ));
        }
    }
    out.push('\n');

    out.push_str("## Recent File Logs\n");
    let lines = read_recent_log_lines(&store.root);
    if lines.is_empty() {
        out.push_str("(no local file log entries yet)\n");
    } else {
        for line in lines {
            out.push_str(&line);
            out.push('\n');
        }
    }
    Ok(out)
}

pub fn export_report(store: &Store, destination: &Path) -> Result<u64> {
    let report = build_report(store)?;
    archive::atomic_write(destination, report.as_bytes())?;
    Ok(report.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_secrets_and_masks_email_local_parts() {
        let cleaned = sanitize_message(
            "Auth failed: Bearer secret-tok-123\nPASS mypass123 access_token=abc&ok=1",
        );
        assert!(!cleaned.contains("secret-tok-123"));
        assert!(!cleaned.contains("mypass123"));
        assert!(!cleaned.contains("access_token=abc"));
        assert!(!cleaned.contains('\n'));
        assert!(cleaned.contains("[REDACTED]"));

        assert_eq!(
            mask_emails("账号 alice@example.com 与 bob.smith@chaizhou.cn 连接失败"),
            "账号 a***@example.com 与 b***@chaizhou.cn 连接失败"
        );
    }

    #[test]
    fn rotates_log_files_when_size_limit_exceeded() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..8 {
            append_with_limit(
                dir.path(),
                "INFO",
                "sync",
                &format!("entry-{i}-{}", "x".repeat(40)),
                120,
                3,
            )
            .unwrap();
        }
        let logs = log_dir(dir.path());
        assert!(logs.join("anser.log").exists());
        assert!(logs.join("anser.log.1").exists());
        assert!(logs.join("anser.log.2").exists());
        assert!(!logs.join("anser.log.3").exists());
        let st = status(dir.path());
        assert_eq!(st.file_count, 3);
        assert!(st.total_bytes > 0);
    }

    #[test]
    fn builds_redacted_diagnostic_report_without_subjects_or_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().to_path_buf()).unwrap();
        let account = Account {
            id: "acc-diag".into(),
            name: "Work".into(),
            email: "lalis@example.cn".into(),
            provider: "exmail".into(),
            protocol: "imap".into(),
            incoming_host: "imap.exmail.qq.com".into(),
            incoming_port: 993,
            incoming_tls: "tls".into(),
            smtp_host: "smtp.exmail.qq.com".into(),
            smtp_port: 465,
            smtp_tls: "tls".into(),
            username: "lalis@example.cn".into(),
            smtp_username: String::new(),
            auth: "password".into(),
            oauth_client_id: String::new(),
            enabled: true,
            save_locally: true,
            server_retention_days: None,
            last_sync: None,
            error: Some("IMAP 登录失败：No Response: Login fail".into()),
        };
        store.save_account(&account).unwrap();
        store
            .record_sync_failure(
                &account.id,
                "INBOX",
                "7:55",
                55,
                "下载完整邮件",
                "读取超时",
                Some(&crate::sync_failures::SyncFailureEnvelope {
                    subject: "机密合同正文标题".into(),
                    sender: "boss@example.cn".into(),
                    date: String::new(),
                    size: Some(20 * 1024 * 1024),
                }),
            )
            .unwrap();
        store
            .log("测试日志：lalis@example.cn 触发连接检查")
            .unwrap();

        let report = build_report(&store).unwrap();
        assert!(report.contains("imap.exmail.qq.com:993/tls"));
        assert!(report.contains("smtp.exmail.qq.com:465/tls"));
        assert!(report.contains("l***@example.cn"));
        assert!(!report.contains("lalis@example.cn"));
        assert!(!report.contains("机密合同正文标题"));
        assert!(report.contains("uid=55"));
        assert!(report.contains("读取超时"));
    }
}
