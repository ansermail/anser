use crate::{archive, models::*, rules, store::Store};

#[test]
fn activity_displays_decoded_folders_in_existing_and_new_logs_without_changing_wire_names() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().to_path_buf()).unwrap();
    let message = "文件夹「&UXZO1mWHTvZZOQ-」UID 2：RFC822.SIZE 为 5340，完整响应为 5342 字节；按完整响应保存";
    let mut a = account();
    a.error = Some("文件夹「&UXZO1mWHTvZZOQ-」：Connection Lost".into());
    store.save_account(&a).unwrap();
    // Existing records are stored in their original diagnostic form.
    store
        .db()
        .unwrap()
        .execute(
            "INSERT INTO logs(time,message) VALUES('10-03 21:30',?1)",
            [message],
        )
        .unwrap();
    store.log("文件夹「INBOX」：Connection Lost").unwrap();
    let snapshot = store.snapshot(&query()).unwrap();
    assert_eq!(
        snapshot.accounts[0].error.as_deref(),
        Some("文件夹「其他文件夹」：Connection Lost")
    );
    assert_eq!(store.account(&a.id).unwrap().error, a.error);
    assert!(snapshot
        .logs
        .iter()
        .any(|line| line.contains("文件夹「其他文件夹」UID 2：RFC822.SIZE 为 5340")));
    assert!(snapshot
        .logs
        .iter()
        .any(|line| line.contains("文件夹「收件箱」：Connection Lost")));
    let original: String = store
        .db()
        .unwrap()
        .query_row("SELECT message FROM logs WHERE id=1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(original, message);
    assert_eq!(
        crate::remote::display_activity("文件夹「其他/&ZeVnLIqe-」和文件夹「R&-D」"),
        "文件夹「其他/日本語」和文件夹「R&D」"
    );
    for unchanged in [
        "普通日志 &ZeVnLIqe-",
        "文件夹「&bad-」",
        "文件夹「未结束",
        "文件夹「中文目录」",
    ] {
        assert_eq!(crate::remote::display_activity(unchanged), unchanged);
    }
}

#[test]
fn local_account_preferences_save_during_sync_and_are_not_overwritten_by_sync_status() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().to_path_buf()).unwrap();
    let mut original = account();
    original.error = Some("previous server error".into());
    store.save_account(&original).unwrap();
    store
        .ingest(&original, "INBOX", "existing", &raw(), false)
        .unwrap();
    let gate = std::sync::Mutex::new(());
    let _sync = gate.lock().unwrap();
    let mut edited = original.clone();
    edited.name = "在线邮箱".into();
    edited.save_locally = false;
    // Preferences preserve server errors, sync status and original archives.
    store.edit_account_preferences(&edited).unwrap();
    assert_eq!(store.account(&edited.id).unwrap().error, original.error);
    let mut completed = original.clone();
    completed.last_sync = Some("2026-10-03T21:00:00+08:00".into());
    completed.error = None;
    store.save_sync_status(&completed).unwrap();
    let current = store.account(&edited.id).unwrap();
    assert!(!current.save_locally);
    assert_eq!(current.name, "在线邮箱");
    assert_eq!(current.last_sync, completed.last_sync);
    assert_eq!(current.error, None);
    let next = String::from_utf8(raw())
        .unwrap()
        .replace("Project invoice", "Online invoice");
    store
        .ingest(&current, "INBOX", "new", next.as_bytes(), false)
        .unwrap();
    let snap = store.snapshot(&query()).unwrap();
    assert_eq!(snap.stats.saved, 1);
    let all = store
        .snapshot(&Query {
            view: "all".into(),
            ..query()
        })
        .unwrap();
    assert!(all
        .messages
        .iter()
        .any(|m| m.subject == "Online invoice" && !m.saved_locally));
    let mut invalid = current.clone();
    invalid.smtp_host = "different.example.com".into();
    assert!(store.edit_account_preferences(&invalid).is_err());
    assert_eq!(
        store.account(&current.id).unwrap().smtp_host,
        current.smtp_host
    );
}

#[test]
fn smtp_submission_is_independent_of_receiving_and_cannot_repeat_a_confirmed_send() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().to_path_buf()).unwrap();
    store.save_account(&account()).unwrap();
    let draft = draft();
    store.save_draft(&draft).unwrap();
    let receiving = std::sync::Mutex::new(());
    let _receiving = receiving.lock().unwrap();
    let sending = std::sync::Mutex::new(());
    let submitted = std::cell::Cell::new(0);
    crate::with_send_gate(&sending, || {
        crate::network::send_with(
            &store,
            &draft,
            |account| {
                assert_eq!(account.email, "test@example.com");
                Ok(())
            },
            |(), message| {
                assert_eq!(store.outbox().unwrap()[0].status, "sending");
                let parsed = mailparse::parse_mail(&message.formatted()).is_ok();
                assert!(parsed);
                submitted.set(submitted.get() + 1);
                Ok(())
            },
        )
    })
    .unwrap();
    assert_eq!(submitted.get(), 1);
    assert_eq!(store.outbox().unwrap()[0].status, "sent");
    assert!(store.drafts().unwrap().is_empty());
    assert_eq!(store.snapshot(&query()).unwrap().stats.saved, 1);
    assert!(
        crate::with_send_gate(&sending, || crate::network::send_with(
            &store,
            &draft,
            |_| panic!("must not reconnect for a previously submitted mail"),
            |(): (), _| panic!("must not submit twice"),
        ))
        .is_err()
    );
    assert_eq!(submitted.get(), 1);
}

#[test]
fn only_an_active_send_blocks_another_send_and_leaves_the_draft_intact() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().to_path_buf()).unwrap();
    store.save_account(&account()).unwrap();
    let draft = draft();
    store.save_draft(&draft).unwrap();
    let gate = std::sync::Mutex::new(());
    let guard = gate.lock().unwrap();
    let result = crate::with_send_gate(&gate, || {
        crate::network::send_with(
            &store,
            &draft,
            |_| panic!("busy send must not touch credentials"),
            |(): (), _| panic!("busy send must not submit"),
        )
    });
    assert!(result.unwrap_err().contains("已有邮件正在发送"));
    assert_eq!(store.drafts().unwrap()[0].id, draft.id);
    assert!(store.outbox().unwrap().is_empty());
    drop(guard);
    assert!(crate::with_send_gate(&gate, || Ok(())).is_ok());
}

#[test]
fn independent_sends_keep_failed_and_uncertain_results_protected() {
    for status in ["failed", "uncertain"] {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().to_path_buf()).unwrap();
        store.save_account(&account()).unwrap();
        let draft = draft();
        let sending = std::sync::Mutex::new(());
        let result = crate::with_send_gate(&sending, || {
            crate::network::send_with(
                &store,
                &draft,
                |_| Ok(()),
                |(), _| Err((status, "模拟 SMTP 故障".into())),
            )
        });
        assert!(result.is_err());
        assert_eq!(store.outbox().unwrap()[0].status, status);
        assert_eq!(store.drafts().unwrap()[0].id, draft.id);
        assert!(crate::network::send_with(
            &store,
            &draft,
            |_| Ok(()),
            |(), _| panic!("no automatic retry")
        )
        .is_err());
        assert!(crate::notifications::receipt(&store, &draft, &result).status == status);
    }
}

#[test]
fn attachment_preview_keeps_names_and_bytes_isolated_from_archive() {
    let temp = tempfile::tempdir().unwrap();
    let cache = temp.path().join("preview");
    let raw = raw();
    let path = crate::attachment_preview::prepare(&cache, &raw, &account(), 1).unwrap();
    assert_eq!(path.file_name().unwrap(), "invoice.txt");
    assert_eq!(std::fs::read(&path).unwrap(), b"invoice content");
    assert_eq!(
        crate::attachment_preview::prepare(&cache, &raw, &account(), 1).unwrap(),
        path
    );
    std::fs::write(&path, b"edited in viewer").unwrap();
    crate::attachment_preview::prepare(&cache, &raw, &account(), 1).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"invoice content");
    assert!(!temp.path().join("archive").exists());
    assert!(crate::attachment_preview::prepare(&cache, &raw, &account(), 0).is_err());
    assert!(crate::attachment_preview::prepare(&cache, &raw, &account(), 999).is_err());
    let hostile = String::from_utf8(raw.clone())
        .unwrap()
        .replace("invoice.txt", "../../invoice.txt");
    let safe =
        crate::attachment_preview::prepare(&cache, hostile.as_bytes(), &account(), 1).unwrap();
    assert_eq!(safe.parent().unwrap().parent().unwrap(), cache);
    assert_eq!(std::fs::read(&safe).unwrap(), b"invoice content");
    assert_ne!(path.parent(), safe.parent());
    let damaged = String::from_utf8(raw)
        .unwrap()
        .replace("aW52b2ljZSBjb250ZW50", "aW52!b2ljZSBjb250ZW50");
    assert!(crate::attachment_preview::prepare(&cache, damaged.as_bytes(), &account(), 1).is_err());
}

#[test]
fn preview_does_not_launch_programs_and_only_prunes_owned_expired_cache() {
    let temp = tempfile::tempdir().unwrap();
    let cache = temp.path().join("preview");
    let raw = String::from_utf8(raw())
        .unwrap()
        .replace("invoice.txt", "invoice.command");
    assert!(
        crate::attachment_preview::prepare(&cache, raw.as_bytes(), &account(), 1)
            .unwrap_err()
            .contains("不支持直接预览")
    );
    let raw = raw
        .replace("invoice.command", "invoice.txt")
        .replace("aW52b2ljZSBjb250ZW50", "IyEvYmluL3NoCg==");
    assert!(crate::attachment_preview::prepare(&cache, raw.as_bytes(), &account(), 1).is_err());
    let path = crate::attachment_preview::prepare(&cache, &self::raw(), &account(), 1).unwrap();
    let keep = cache.join("other-data");
    std::fs::create_dir(&keep).unwrap();
    crate::attachment_preview::prune(&cache, std::time::SystemTime::now());
    assert!(path.exists());
    crate::attachment_preview::prune(
        &cache,
        std::time::SystemTime::now() + std::time::Duration::from_secs(8 * 86400),
    );
    assert!(!path.exists());
    assert!(keep.exists());
}

#[test]
fn concurrent_receiving_and_read_actions_do_not_upgrade_stale_snapshots() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().to_path_buf()).unwrap();
    let account = account();
    store.save_account(&account).unwrap();
    store
        .ingest(&account, "INBOX", "seed", &raw(), false)
        .unwrap();
    let id = store.snapshot(&query()).unwrap().messages[0].id.clone();
    // A reader may keep an old WAL snapshot while writers continue to commit.
    let mut db = store.db().unwrap();
    let reader = db.transaction().unwrap();
    let _: String = reader
        .query_row("SELECT data FROM messages WHERE id=?1", [&id], |r| r.get(0))
        .unwrap();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    std::thread::scope(|scope| {
        for action in ["read", "star"] {
            let store = store.clone();
            let id = id.clone();
            let barrier = barrier.clone();
            scope.spawn(move || {
                barrier.wait();
                for _ in 0..100 {
                    store.change_mail(&id, action, "true").unwrap();
                }
            });
        }
        let store = store.clone();
        let account = account.clone();
        scope.spawn(move || {
            barrier.wait();
            for n in 0..100 {
                let raw = String::from_utf8(raw())
                    .unwrap()
                    .replace("Project invoice", &format!("Concurrent invoice {n}"));
                store
                    .ingest(&account, "INBOX", &n.to_string(), raw.as_bytes(), false)
                    .unwrap();
            }
        });
    });
    reader.commit().unwrap();
    let mail = store.mail(&id).unwrap();
    assert!(mail.is_read && mail.starred);
    assert_eq!(store.snapshot(&query()).unwrap().stats.total, 101);
}
pub(super) fn account() -> Account {
    Account {
        id: "test-account".into(),
        name: "Test".into(),
        email: "test@example.com".into(),
        provider: "custom".into(),
        protocol: "imap".into(),
        incoming_host: "imap.example.com".into(),
        incoming_port: 993,
        incoming_tls: "tls".into(),
        smtp_host: "smtp.example.com".into(),
        smtp_port: 465,
        smtp_tls: "tls".into(),
        username: "test@example.com".into(),
        smtp_username: "".into(),
        auth: "password".into(),
        oauth_client_id: "".into(),
        enabled: true,
        save_locally: true,
        server_retention_days: None,
        last_sync: None,
        error: None,
    }
}
pub(super) fn raw() -> Vec<u8> {
    b"From: Alice <alice@example.com>\r\nTo: test@example.com\r\nSubject: Project invoice\r\nDate: Tue, 29 Sep 2026 10:00:00 +0800\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=boundary123\r\n\r\n--boundary123\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease keep this invoice.\r\n--boundary123\r\nContent-Type: application/octet-stream; name=invoice.txt\r\nContent-Disposition: attachment; filename=invoice.txt\r\nContent-Transfer-Encoding: base64\r\n\r\naW52b2ljZSBjb250ZW50\r\n--boundary123--\r\n".to_vec()
}
pub(super) fn query() -> Query {
    Query {
        view: "local".into(),
        account_id: "".into(),
        folder: "".into(),
        search: "".into(),
        limit: 100,
        remote_folder: String::new(),
        unread_only: false,
        starred_only: false,
        attachments_only: false,
        search_field: String::new(),
        list_mode: ListMode::Conversations,
    }
}
fn rule(id: &str, action: &str, stop: bool) -> Rule {
    Rule {
        id: id.into(),
        name: id.into(),
        account_id: "".into(),
        enabled: true,
        mode: "all".into(),
        conditions: vec![Condition {
            field: "subject".into(),
            operator: "contains".into(),
            value: "invoice".into(),
        }],
        action: action.into(),
        destination: "财务/发票".into(),
        source_folder: String::new(),
        stop,
    }
}
#[test]
fn server_and_account_removal_preserve_full_mime() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    store.ingest(&a, "INBOX", "1:1", &raw(), false).unwrap();
    store
        .db()
        .unwrap()
        .execute("DELETE FROM sources", [])
        .unwrap();
    store.remove_account(&a.id).unwrap();
    drop(store);
    let store = Store::new(dir.path().into()).unwrap();
    let snapshot = store.snapshot(&query()).unwrap();
    assert_eq!(snapshot.messages.len(), 1);
    assert!(snapshot.accounts.is_empty());
    let m = &snapshot.messages[0];
    assert_eq!(archive::read_raw(dir.path(), &m.hash).unwrap(), raw());
    let detail = store.detail(&m.id).unwrap();
    assert_eq!(detail.attachments[0].name, "invoice.txt");
    assert_eq!(
        archive::attachment(&raw(), detail.attachments[0].index).unwrap(),
        b"invoice content"
    );
}
#[test]
fn dedupe_reconnect_and_multiple_labels() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    assert!(s.ingest(&account(), "INBOX", "1:1", &raw(), false).unwrap());
    assert!(!s
        .ingest(&account(), "INBOX", "2:12", &raw(), false)
        .unwrap());
    assert!(!s.ingest(&account(), "Label", "1:8", &raw(), false).unwrap());
    assert_eq!(s.snapshot(&query()).unwrap().stats.saved, 1);
}
#[test]
fn rule_order_stop_and_idempotence() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.save_rules(&[
        rule("first", "folder", true),
        rule("second", "trash", false),
    ])
    .unwrap();
    s.ingest(&account(), "INBOX", "1", &raw(), false).unwrap();
    s.run_rules().unwrap();
    let snap = s.snapshot(&query()).unwrap();
    assert_eq!(snap.stats.saved, 1);
    assert_eq!(snap.messages[0].local_folder, "财务/发票");
    assert!(!snap.messages[0].trashed);
}
#[test]
fn failed_save_cannot_run_rules_or_publish_success() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    std::fs::write(dir.path().join("archive"), b"blocks-directory").unwrap();
    s.save_rules(&[rule("delete", "trash", true)]).unwrap();
    assert!(s.ingest(&account(), "INBOX", "1", &raw(), false).is_err());
    assert_eq!(s.snapshot(&query()).unwrap().stats.saved, 0);
    assert!(!s.has_source("test-account", "INBOX", "1").unwrap());
}
#[test]
fn backup_restore_is_complete_and_deduplicated() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.save_account(&account()).unwrap();
    s.ingest(&account(), "INBOX", "1", &raw(), false).unwrap();
    s.save_rules(&[rule("finance", "folder", false)]).unwrap();
    s.run_rules().unwrap();
    let output = tempfile::tempdir().unwrap();
    let backup = s.backup(output.path()).unwrap();
    let target = tempfile::tempdir().unwrap();
    let restored = Store::new(target.path().into()).unwrap();
    assert_eq!(restored.restore(std::path::Path::new(&backup)).unwrap(), 1);
    assert_eq!(restored.restore(std::path::Path::new(&backup)).unwrap(), 0);
    let snap = restored.snapshot(&query()).unwrap();
    assert!(snap.accounts.is_empty());
    assert_eq!(snap.messages[0].local_folder, "财务/发票");
    assert_eq!(
        archive::read_raw(target.path(), &snap.messages[0].hash).unwrap(),
        raw()
    );
}
#[test]
fn corruption_blocks_rules_and_restore() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.ingest(&account(), "INBOX", "1", &raw(), false).unwrap();
    let m = s.snapshot(&query()).unwrap().messages[0].clone();
    std::fs::write(
        dir.path().join("archive").join(format!("{}.eml", m.hash)),
        b"corrupt",
    )
    .unwrap();
    assert!(s.apply_rules(&m.id).is_err());
    assert!(s.detail(&m.id).is_err());
}
#[test]
fn historical_rules_skip_unmatched_archives_but_verify_matched_originals() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.ingest(&account(), "INBOX", "1", &raw(), false).unwrap();
    let m = s.snapshot(&query()).unwrap().messages[0].clone();
    std::fs::write(
        dir.path().join("archive").join(format!("{}.eml", m.hash)),
        b"corrupt",
    )
    .unwrap();
    let mut r = rule("scoped", "star", true);
    r.conditions[0].value = "unrelated subject".into();
    s.save_rules(&[r.clone()]).unwrap();
    assert_eq!(s.run_rules().unwrap(), 0);
    assert!(!s.mail(&m.id).unwrap().starred);
    r.conditions[0].value = m.subject;
    s.save_rules(&[r]).unwrap();
    assert!(s.run_rules().is_err());
    assert!(!s.mail(&m.id).unwrap().starred);
}
#[test]
fn historical_rule_candidates_preserve_body_conditions_and_stop_order() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.ingest(&account(), "INBOX", "1", &raw(), false).unwrap();
    let m = s.snapshot(&query()).unwrap().messages[0].clone();
    let mut first = rule("body", "star", true);
    first.conditions = vec![Condition {
        field: "body".into(),
        operator: "equals".into(),
        value: s.mail(&m.id).unwrap().body,
    }];
    s.save_rules(&[first, rule("later", "trash", false)])
        .unwrap();
    assert_eq!(s.run_rules().unwrap(), 1);
    let after = s.mail(&m.id).unwrap();
    assert!(after.starred);
    assert!(!after.trashed);
}
#[test]
fn rule_conditions_and_validation() {
    let (m, _, _) = archive::parse(&raw(), &account(), "INBOX").unwrap();
    let mut r = rule("r", "star", false);
    r.conditions.push(Condition {
        field: "sender".into(),
        operator: "equals".into(),
        value: "nobody".into(),
    });
    assert!(!rules::matches(&r, &m));
    r.mode = "any".into();
    assert!(rules::matches(&r, &m));
    r.account_id = "other".into();
    assert!(!rules::matches(&r, &m));
    r.conditions[0].value = "".into();
    assert!(rules::validate(&r).is_err());
}

#[test]
fn server_cleanup_removes_inbox_location_but_keeps_archive() {
    let d = tempfile::tempdir().unwrap();
    let s = Store::new(d.path().into()).unwrap();
    s.save_account(&account()).unwrap();
    s.ingest(&account(), "INBOX", "1:1", &raw(), false).unwrap();
    let mut inbox = query();
    inbox.view = "all".into();
    assert_eq!(s.snapshot(&inbox).unwrap().matched, 1);
    s.reconcile_folder(&account().id, "INBOX", &[]).unwrap();
    assert_eq!(s.snapshot(&inbox).unwrap().matched, 0);
    assert_eq!(s.snapshot(&query()).unwrap().matched, 1);
}
#[test]
fn preview_does_not_modify_or_log() {
    let d = tempfile::tempdir().unwrap();
    let s = Store::new(d.path().into()).unwrap();
    s.ingest(&account(), "INBOX", "1", &raw(), false).unwrap();
    let before = s.snapshot(&query()).unwrap();
    assert_eq!(
        s.preview_rule(&rule("preview", "trash", false))
            .unwrap()
            .len(),
        1
    );
    let after = s.snapshot(&query()).unwrap();
    assert_eq!(before.messages[0].trashed, after.messages[0].trashed);
    assert_eq!(before.logs, after.logs);
}

#[test]
fn mail_links_only_open_web_urls() {
    assert!(crate::web_link("https://example.com/page").is_ok());
    assert!(crate::web_link("http://example.com").is_ok());
    for url in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,test",
        "mailto:x@example.com",
    ] {
        assert!(crate::web_link(url).is_err());
    }
}

fn legacy_report_raw() -> Vec<u8> {
    let from = encoding_rs::GB18030.encode("腾讯企业邮箱").0.into_owned();
    let body = encoding_rs::GB18030.encode("<meta name=viewport><style>p{margin:0}.report{color:red}</style><div class=report><h2>每周概况</h2><p>收信量 &amp; 发信量&nbsp;7</p><script>unwanted_script</script></div>").0.into_owned();
    let mut raw = b"From: \"".to_vec();
    raw.extend(from);
    raw.extend(b"\" <report@example.com>;\r\nTo: test@example.com\r\nSubject: ");
    raw.extend("每周报告".as_bytes());
    raw.extend(b"\r\nContent-Type: text/html; charset=gb18030\r\n\r\n");
    raw.extend(body);
    raw
}

#[test]
fn legacy_header_charset_and_html_text_are_readable() {
    let (m, html, _) = archive::parse(&legacy_report_raw(), &account(), "INBOX").unwrap();
    assert_eq!(m.sender, "\"腾讯企业邮箱\" <report@example.com>;");
    assert_eq!(m.subject, "每周报告");
    assert_eq!(m.preview, "每周概况 收信量 & 发信量 7");
    assert!(!m.body.contains("margin"));
    assert!(!m.body.contains("unwanted_script"));
    assert!(html.contains(".report{color:red}"));
}

#[test]
fn standard_headers_keep_their_own_charset() {
    use base64::Engine;
    let encoded =
        base64::engine::general_purpose::STANDARD.encode(encoding_rs::GBK.encode("腾讯企业邮箱").0);
    for (header, expected) in [
        (
            format!("=?GBK?B?{encoded}?= <report@example.com>"),
            "腾讯企业邮箱 <report@example.com>",
        ),
        (
            "=?ISO-8859-1?Q?Andr=E9?= <report@example.com>".into(),
            "André <report@example.com>",
        ),
        (
            "中文名称 <report@example.com>".into(),
            "中文名称 <report@example.com>",
        ),
    ] {
        let raw = format!("From: {header}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nhello");
        assert_eq!(
            archive::parse(raw.as_bytes(), &account(), "INBOX")
                .unwrap()
                .0
                .sender,
            expected
        );
    }
    let raw = b"From: Andr\xe9 <report@example.com>\r\nContent-Type: text/plain; charset=iso-8859-1\r\n\r\nhello";
    assert_eq!(
        archive::parse(raw, &account(), "INBOX").unwrap().0.sender,
        "André <report@example.com>"
    );
}

#[test]
fn metadata_upgrade_preserves_archive_identity_and_local_state() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let raw = legacy_report_raw();
    s.ingest(&account(), "INBOX", "1:7", &raw, false).unwrap();
    let mut original = s.snapshot(&query()).unwrap().messages.remove(0);
    original.sender = "garbled".into();
    original.subject = "old title".into();
    original.body = "p{margin:0}".into();
    original.preview = original.body.clone();
    original.is_read = true;
    original.starred = true;
    original.trashed = true;
    original.local_folder = "自定义归档".into();
    s.update_mail(&original).unwrap();
    s.db()
        .unwrap()
        .execute("UPDATE messages SET parser_version=0", [])
        .unwrap();
    drop(s);
    let s = Store::new(dir.path().into()).unwrap();
    let repaired = s.mail(&original.id).unwrap();
    assert_eq!(repaired.sender, "\"腾讯企业邮箱\" <report@example.com>;");
    assert_eq!(repaired.subject, "每周报告");
    assert_eq!(repaired.preview, "每周概况 收信量 & 发信量 7");
    let mut expected = original.clone();
    expected.sender = repaired.sender.clone();
    expected.subject = repaired.subject.clone();
    expected.body = repaired.body.clone();
    expected.preview = repaired.preview.clone();
    assert_eq!(
        serde_json::to_value(&repaired).unwrap(),
        serde_json::to_value(expected).unwrap()
    );
    assert!(s.has_source(&account().id, "INBOX", "1:7").unwrap());
    assert_eq!(archive::read_raw(dir.path(), &original.hash).unwrap(), raw);
    s.update_mail(&original).unwrap(); // A completed migration must not run again.
    drop(s);
    let s = Store::new(dir.path().into()).unwrap();
    assert_eq!(s.mail(&original.id).unwrap().sender, "garbled");
}

#[test]
fn metadata_upgrade_leaves_corrupt_archives_untouched_and_retries() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let raw = legacy_report_raw();
    s.ingest(&account(), "INBOX", "1:7", &raw, false).unwrap();
    let mut original = s.snapshot(&query()).unwrap().messages.remove(0);
    original.sender = "old name".into();
    s.update_mail(&original).unwrap();
    s.db()
        .unwrap()
        .execute("UPDATE messages SET parser_version=0", [])
        .unwrap();
    let path = dir
        .path()
        .join("archive")
        .join(format!("{}.eml", original.hash));
    std::fs::write(&path, b"corrupt").unwrap();
    drop(s);
    let s = Store::new(dir.path().into()).unwrap();
    assert_eq!(
        serde_json::to_value(s.mail(&original.id).unwrap()).unwrap(),
        serde_json::to_value(&original).unwrap()
    );
    std::fs::write(path, raw).unwrap();
    drop(s);
    let s = Store::new(dir.path().into()).unwrap();
    assert!(s
        .mail(&original.id)
        .unwrap()
        .sender
        .contains("腾讯企业邮箱"));
}

#[test]
fn unread_filter_preserves_mailbox_category_account_and_search_scope() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let a = account();
    let mut b = a.clone();
    b.id = "other-account".into();
    b.email = "other@example.com".into();
    s.save_account(&a).unwrap();
    s.save_account(&b).unwrap();
    for (name, source, read, starred, trashed, folder, acc) in [
        ("inbox-unread", "INBOX", false, true, false, "项目", &a),
        ("inbox-read", "INBOX", true, true, false, "项目", &a),
        ("archive-unread", "Archive", false, false, false, "项目", &a),
        ("sent-unread", "Sent", false, false, false, "全部存档", &a),
        ("trash-unread", "INBOX", false, true, true, "项目", &a),
        ("other-unread", "INBOX", false, false, false, "项目", &b),
        ("inactive-unread", "INBOX", false, true, false, "项目", &a),
    ] {
        let raw = format!("From: test@example.com\r\nSubject: {name}\r\n\r\nScope test");
        s.ingest(acc, source, name, raw.as_bytes(), read).unwrap();
        let mut q = query();
        q.search = name.into();
        let mut m = s.snapshot(&q).unwrap().messages.remove(0);
        m.starred = starred;
        m.trashed = trashed;
        m.local_folder = folder.into();
        s.update_mail(&m).unwrap();
    }
    s.reconcile_folder(
        &a.id,
        "INBOX",
        &[
            "inbox-unread".into(),
            "inbox-read".into(),
            "trash-unread".into(),
        ],
    )
    .unwrap();
    for (view, folder, account_id, search, expected) in [
        ("all", "", "", "", vec!["inbox-unread", "other-unread"]),
        ("all", "", a.id.as_str(), "", vec!["inbox-unread"]),
        ("all", "", "", "archive", vec![]),
        ("local", "", "", "archive", vec!["archive-unread"]),
        (
            "local",
            "项目",
            a.id.as_str(),
            "",
            vec!["archive-unread", "inactive-unread", "inbox-unread"],
        ),
        (
            "starred",
            "",
            "",
            "",
            vec!["inactive-unread", "inbox-unread"],
        ),
        ("sent", "", "", "", vec!["sent-unread"]),
        ("trash", "项目", "", "", vec!["trash-unread"]),
    ] {
        let mut q = query();
        q.view = view.into();
        q.folder = folder.into();
        q.account_id = account_id.into();
        q.search = search.into();
        q.unread_only = true;
        let snap = s.snapshot(&q).unwrap();
        assert_eq!(snap.matched as usize, expected.len());
        assert!(snap.messages.iter().all(|m| !m.is_read));
        let mut subjects: Vec<_> = snap.messages.iter().map(|m| m.subject.as_str()).collect();
        subjects.sort_unstable();
        assert_eq!(
            subjects, expected,
            "scope {view}/{folder}/{account_id}/{search}"
        );
        q.unread_only = false;
        assert!(s.snapshot(&q).unwrap().matched >= snap.matched);
    }
}

#[test]
fn older_snapshot_queries_default_to_all_read_states() {
    let mut value = serde_json::to_value(query()).unwrap();
    value.as_object_mut().unwrap().remove("unreadOnly");
    assert!(!serde_json::from_value::<Query>(value).unwrap().unread_only);
}

pub(super) fn draft() -> Compose {
    Compose {
        id: "draft-1".into(),
        account_id: account().id,
        to: "\"Doe, Alex\" <alex@example.com>".into(),
        cc: "other@example.com".into(),
        bcc: "private@example.com".into(),
        subject: "Formatted note".into(),
        body: "Hello Alex".into(),
        html: "<p>Hello <strong>Alex</strong></p>".into(),
        format: "rich".into(),
        source: String::new(),
        attachments: vec![],
        quote: None,
        in_reply_to: String::new(),
        reply_anchor_id: String::new(),
        references: vec![],
        delivery_body: None,
        delivery_html: None,
    }
}
#[test]
fn rich_mime_preserves_plain_alternative_and_bcc_only_in_envelope() {
    let mut d = draft();
    d.to.push_str(", ");
    let message = crate::network::build_message(&account(), &d).unwrap();
    assert_eq!(message.envelope().to().len(), 3);
    let raw = message.formatted();
    let parsed = mailparse::parse_mail(&raw).unwrap();
    use mailparse::MailHeaderMap;
    assert!(parsed.headers.get_first_value("Bcc").is_none());
    let (_, html, _) = archive::parse(&raw, &account(), "Sent").unwrap();
    assert!(html.contains("<strong>Alex</strong>"));
    let mut parts = vec![];
    archive::leaves(&parsed, &mut parts);
    assert!(parts
        .iter()
        .any(|p| p.ctype.mimetype == "text/plain" && p.get_body().unwrap().contains("Hello Alex")));
    let mut bad = draft();
    bad.to = "invalid".into();
    assert!(crate::network::build_message(&account(), &bad).is_err());
}
#[test]
fn outgoing_attachments_and_ascii_inline_images_survive_smtp_line_normalization_byte_for_byte() {
    use mailparse::MailHeaderMap;
    let dir = tempfile::tempdir().unwrap();
    let files: Vec<Vec<u8>> = vec![
        b"line one\nline two\n".to_vec(),
        b"CRLF\r\nCR\rLF\n".to_vec(),
        vec![0, 255, 13, 10, 128],
        "中文\n多行文件\n".as_bytes().to_vec(),
    ];
    let mut d = draft();
    d.attachments = files
        .iter()
        .enumerate()
        .map(|(i, bytes)| {
            let path = dir.path().join(format!("file-{i}.dat"));
            std::fs::write(&path, bytes).unwrap();
            path.to_string_lossy().into_owned()
        })
        .collect();
    let svg = b"<svg>\n<path d=\"M0 0L1 1\"/>\n</svg>\n";
    use base64::Engine;
    d.delivery_html = Some(format!(
        "<p>inline</p><img src=\"data:image/svg+xml;base64,{}\">",
        base64::engine::general_purpose::STANDARD.encode(svg)
    ));
    let raw = crate::network::build_message(&account(), &d)
        .unwrap()
        .formatted();
    // SMTP DATA requires CRLF. Even a relay normalizing every bare LF must
    // leave file bytes intact, since attachments are encoded as binary Base64.
    let mut wire = Vec::new();
    for (i, b) in raw.iter().enumerate() {
        if *b == b'\n' && (i == 0 || raw[i - 1] != b'\r') {
            wire.push(b'\r');
        }
        wire.push(*b);
    }
    let parsed = mailparse::parse_mail(&wire).unwrap();
    let mut leaves = Vec::new();
    archive::leaves(&parsed, &mut leaves);
    let parts = leaves
        .iter()
        .filter(|p| p.ctype.mimetype == "application/octet-stream")
        .collect::<Vec<_>>();
    assert_eq!(parts.len(), files.len());
    for (part, original) in parts.iter().zip(files) {
        assert_eq!(
            part.headers
                .get_first_value("Content-Transfer-Encoding")
                .as_deref(),
            Some("base64")
        );
        assert_eq!(part.get_body_raw().unwrap(), original);
    }
    let image = leaves
        .iter()
        .find(|p| p.ctype.mimetype == "image/svg+xml")
        .unwrap();
    assert_eq!(
        image
            .headers
            .get_first_value("Content-Transfer-Encoding")
            .as_deref(),
        Some("base64")
    );
    assert_eq!(image.get_body_raw().unwrap(), svg);
}
#[test]
fn quoted_delivery_keeps_html_and_embedded_images_in_mime() {
    let mut d = draft();
    d.delivery_body = Some("New reply\nOriginal text".into());
    d.delivery_html = Some("<html><head><style>.report{color:red}</style></head><body class=\"report\"><p>New reply</p><table><tr><td>Original text</td></tr></table><img src=\"data:image/png;base64,aGVsbG8=\"><img src=\"data:image/png;base64,aGVsbG8=\"></body></html>".into());
    let raw = crate::network::build_message(&account(), &d)
        .unwrap()
        .formatted();
    let parsed = mailparse::parse_mail(&raw).unwrap();
    let mut parts = vec![];
    archive::leaves(&parsed, &mut parts);
    let html_part = parts
        .iter()
        .find(|p| p.ctype.mimetype == "text/html")
        .unwrap()
        .get_body()
        .unwrap();
    assert!(html_part.contains("<table>"));
    assert!(html_part.contains(".report{color:red}"));
    assert!(html_part.contains("cid:yanxin-"));
    assert!(!html_part.contains("data:image/"));
    let images: Vec<_> = parts
        .iter()
        .filter(|p| p.ctype.mimetype == "image/png")
        .collect();
    assert_eq!(images.len(), 1);
    assert_eq!(images[0].get_body_raw().unwrap(), b"hello");
    assert!(parts.iter().any(
        |p| p.ctype.mimetype == "text/plain" && p.get_body().unwrap().contains("Original text")
    ));
    let (_, archived_html, attachments) = archive::parse(&raw, &account(), "Sent").unwrap();
    assert!(archived_html.contains("data:image/png;base64,aGVsbG8="));
    assert!(attachments.is_empty());
    // Excluded quotes use the fresh delivery fields, never stale HTML.
    d.delivery_body = Some("New reply".into());
    d.delivery_html = Some(String::new());
    let raw = crate::network::build_message(&account(), &d)
        .unwrap()
        .formatted();
    let (_, html, _) = archive::parse(&raw, &account(), "Sent").unwrap();
    assert!(html.is_empty());
    assert!(!String::from_utf8_lossy(&raw).contains("Original text"));
}
#[test]
fn reply_headers_parse_groups_and_reply_to_without_bcc() {
    let raw=b"From: original@example.com\r\nReply-To: \"Service, China\" <reply@example.com>\r\nTo: Team: me@example.com, peer@example.com;\r\nCc: other@example.com\r\nBcc: hidden@example.com\r\n\r\nHello";
    let (reply, to, cc) = archive::reply_addresses(raw).unwrap();
    assert_eq!(reply[0].email, "reply@example.com");
    assert_eq!(reply[0].name, "Service, China");
    assert_eq!(to.len(), 2);
    assert_eq!(cc[0].email, "other@example.com");
    assert!(!to
        .iter()
        .chain(cc.iter())
        .any(|a| a.email == "hidden@example.com"));
}
#[test]
fn editing_server_restarts_source_tracking_and_retains_original_archive() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let mut a = account();
    s.save_account(&a).unwrap();
    s.ingest(&a, "INBOX", "123:7", &raw(), true).unwrap();
    a.name = "New label".into();
    s.edit_account(&a).unwrap();
    assert!(s.has_source(&a.id, "INBOX", "123:7").unwrap());
    a.incoming_host = "new-imap.example.com".into();
    a.enabled = false;
    s.edit_account(&a).unwrap();
    assert!(!s.has_source(&a.id, "INBOX", "123:7").unwrap());
    assert!(s.account(&a.id).unwrap().enabled);
    let mail = &s.snapshot(&query()).unwrap().messages[0];
    assert_eq!(archive::read_raw(dir.path(), &mail.hash).unwrap(), raw());
    assert!(mail.is_read);
    a.email = "different@example.com".into();
    assert!(s.edit_account(&a).is_err());
    assert_eq!(s.account(&a.id).unwrap().email, "test@example.com");
}
#[test]
fn local_contacts_validate_deduplicate_and_override_history_names() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.ingest(&account(), "INBOX", "1:1", &raw(), false).unwrap();
    let c = Contact {
        id: "contact-1".into(),
        name: "My Alice".into(),
        email: "alice@example.com".into(),
    };
    s.save_contact(&c).unwrap();
    assert!(s
        .save_contact(&Contact {
            id: "contact-2".into(),
            email: "ALICE@example.com".into(),
            ..c.clone()
        })
        .is_err());
    assert!(s
        .save_contact(&Contact {
            email: "invalid".into(),
            ..c.clone()
        })
        .is_err());
    let suggestions = s.contact_suggestions().unwrap();
    let alice: Vec<_> = suggestions
        .iter()
        .filter(|a| a.email.eq_ignore_ascii_case("alice@example.com"))
        .collect();
    assert_eq!(alice.len(), 1);
    assert_eq!(alice[0].name, "My Alice");
    assert_eq!(
        Store::new(dir.path().into()).unwrap().contacts().unwrap()[0].name,
        "My Alice"
    );
}
#[test]
fn filters_stack_with_category_and_field_search_and_legacy_query_defaults() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.save_account(&account()).unwrap();
    s.ingest(&account(), "INBOX", "1:1", &raw(), false).unwrap();
    let mut m = s.snapshot(&query()).unwrap().messages.remove(0);
    m.starred = true;
    s.update_mail(&m).unwrap();
    let mut q = query();
    q.view = "all".into();
    q.unread_only = true;
    q.starred_only = true;
    q.attachments_only = true;
    q.search_field = "sender".into();
    q.search = "alice".into();
    assert_eq!(s.snapshot(&q).unwrap().matched, 1);
    q.search_field = "subject".into();
    assert_eq!(s.snapshot(&q).unwrap().matched, 0);
    q.search = "invoice".into();
    assert_eq!(s.snapshot(&q).unwrap().matched, 1);
    m.is_read = true;
    s.update_mail(&m).unwrap();
    assert_eq!(s.snapshot(&q).unwrap().matched, 0);
    let legacy: Query = serde_json::from_str(
        r#"{"view":"local","accountId":"","search":"","folder":"","limit":200}"#,
    )
    .unwrap();
    assert!(!legacy.starred_only && !legacy.attachments_only && legacy.search_field.is_empty());
}
#[test]
fn uncertain_send_is_preserved_and_never_automatically_retried_after_restart() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.save_account(&account()).unwrap();
    let d = draft();
    let raw = crate::network::build_message(&account(), &d)
        .unwrap()
        .formatted();
    s.db()
        .unwrap()
        .execute(
            "INSERT INTO outbox(id,status,data,raw) VALUES(?1,'sending',?2,?3)",
            rusqlite::params![d.id, serde_json::to_string(&d).unwrap(), raw],
        )
        .unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    assert_eq!(s.outbox().unwrap()[0].status, "uncertain");
    assert!(s.outbox_draft(&d.id, false).is_err());
    let prepared = s.outbox_draft(&d.id, true).unwrap();
    assert_ne!(prepared.id, d.id);
    assert_eq!(prepared.html, d.html);
    assert_eq!(s.outbox().unwrap().len(), 1);
    assert_eq!(s.outbox().unwrap()[0].status, "uncertain");
    assert!(crate::network::send(&s, &d)
        .unwrap_err()
        .contains("已有发送记录"));
    s.db()
        .unwrap()
        .execute("UPDATE outbox SET status='sent'", [])
        .unwrap();
    assert!(!s.outbox().unwrap()[0].archived);
    s.archive_outbox(&d.id).unwrap();
    s.archive_outbox(&d.id).unwrap();
    assert!(s.outbox().unwrap()[0].archived);
    assert_eq!(s.snapshot(&query()).unwrap().matched, 1);
    let saved = &s.snapshot(&query()).unwrap().messages[0];
    std::fs::write(
        dir.path()
            .join("archive")
            .join(format!("{}.eml", saved.hash)),
        b"corrupt",
    )
    .unwrap();
    assert!(!s.outbox().unwrap()[0].archived);
}

#[test]
fn backup_restores_contacts_and_missing_rules_without_overwriting_current_settings() {
    let original = tempfile::tempdir().unwrap();
    let backups = tempfile::tempdir().unwrap();
    let destination = tempfile::tempdir().unwrap();
    let s = Store::new(original.path().into()).unwrap();
    s.save_account(&account()).unwrap();
    s.ingest(&account(), "INBOX", "1:1", &raw(), false).unwrap();
    s.save_contact(&Contact {
        id: "saved-contact".into(),
        name: "Alice".into(),
        email: "alice@example.com".into(),
    })
    .unwrap();
    s.save_rules(&[
        rule("existing", "star", false),
        rule("missing", "folder", true),
    ])
    .unwrap();
    let path = s.backup(backups.path()).unwrap();
    let restored = Store::new(destination.path().into()).unwrap();
    restored
        .save_rules(&[rule("existing", "read", false)])
        .unwrap();
    restored
        .save_contact(&Contact {
            id: "local-contact".into(),
            name: "My Alice".into(),
            email: "ALICE@example.com".into(),
        })
        .unwrap();
    assert_eq!(restored.restore(std::path::Path::new(&path)).unwrap(), 1);
    assert_eq!(restored.restore(std::path::Path::new(&path)).unwrap(), 0);
    assert_eq!(restored.contacts().unwrap().len(), 1);
    assert_eq!(restored.contacts().unwrap()[0].name, "My Alice");
    let rules = restored.rules().unwrap();
    assert_eq!(rules.len(), 2);
    assert_eq!(rules[0].action, "read");
    assert_eq!(rules[1].id, "missing");
    assert!(restored.accounts().unwrap().is_empty());
    assert!(restored.drafts().unwrap().is_empty());
    assert!(restored.outbox().unwrap().is_empty());
}

#[test]
fn archive_health_reports_missing_and_corrupt_files_without_modifying_mail() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    s.ingest(&account(), "INBOX", "1:1", &raw(), false).unwrap();
    let original = s.snapshot(&query()).unwrap().messages.remove(0);
    assert_eq!(s.archive_health().unwrap().healthy, 1);
    let path = dir
        .path()
        .join("archive")
        .join(format!("{}.eml", original.hash));
    std::fs::write(&path, b"changed").unwrap();
    let report = s.archive_health().unwrap();
    assert_eq!(report.checked, 1);
    assert_eq!(report.healthy, 0);
    assert_eq!(report.problems[0].mail_id, original.id);
    assert!(report.problems[0].error.contains("校验失败"));
    std::fs::remove_file(path).unwrap();
    assert_eq!(s.archive_health().unwrap().problems.len(), 1);
    assert_eq!(s.mail(&original.id).unwrap().hash, original.hash);
    assert!(!s.mail(&original.id).unwrap().is_read);
}
#[test]
fn configurable_sync_interval_and_wakeup_are_persistent_and_keep_busy_catchup_pending() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    assert_eq!(s.preferences().unwrap().sync_interval_minutes, 5);
    s.save_preferences(&Preferences {
        sync_interval_minutes: 15,
        ..Default::default()
    })
    .unwrap();
    assert_eq!(
        Store::new(dir.path().into())
            .unwrap()
            .preferences()
            .unwrap()
            .sync_interval_minutes,
        15
    );
    assert!(s
        .save_preferences(&Preferences {
            sync_interval_minutes: 0,
            ..Default::default()
        })
        .is_err());
    let mut schedule = crate::productivity::SyncSchedule::default();
    assert!(schedule.due(100, 900));
    schedule.completed(100);
    assert!(!schedule.due(110, 900));
    assert!(schedule.due(300, 900)); // clock gap during sleep
    assert!(schedule.due(310, 900)); // busy gate must not lose pending catch-up
    schedule.completed(350);
    assert!(!schedule.due(360, 900));
    for now in (370..=410).step_by(10) {
        schedule.due(now, 900);
    }
    assert!(schedule.due(410, 60)); // shorter user-selected interval takes effect
    schedule.completed(420);
    assert!(schedule.due(400, 900)); // clock adjustment
}

#[test]
fn conversation_combines_inbox_and_sent_with_scope_pagination_and_old_archive_upgrade() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    let original = b"From: alice@example.com\r\nTo: test@example.com\r\nSubject: Plan\r\nMessage-ID: <root@example.com>\r\nDate: Thu, 1 Oct 2026 08:00:00 +0800\r\n\r\nOriginal";
    let reply = b"From: test@example.com\r\nTo: alice@example.com\r\nSubject: Re: Plan\r\nMessage-ID: <reply@example.com>\r\nIn-Reply-To: <root@example.com>\r\nReferences: <root@example.com>\r\nDate: Thu, 1 Oct 2026 09:00:00 +0800\r\nContent-Type: text/html\r\n\r\n<table><tr><td>Reply</td></tr></table>";
    let recent = b"From: alice@example.com\r\nTo: test@example.com\r\nSubject: Re: Plan\r\nMessage-ID: <recent@example.com>\r\nIn-Reply-To: <reply@example.com>\r\nReferences: <root@example.com> <reply@example.com>\r\nDate: Thu, 1 Oct 2026 10:00:00 +0800\r\n\r\nLatest";
    store.ingest(&a, "INBOX", "1", original, false).unwrap();
    store.ingest(&a, "Sent", "2", reply, true).unwrap();
    store.ingest(&a, "INBOX", "3", recent, false).unwrap();
    let mut q = query();
    q.limit = 1;
    let snapshot = store.snapshot(&q).unwrap();
    assert_eq!(snapshot.matched, 1);
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.messages[0].conversation_count, 3);
    let turns = store.conversation(&snapshot.messages[0].id).unwrap();
    q.list_mode = ListMode::Messages;
    let single = store.snapshot(&q).unwrap();
    assert_eq!(single.matched, 3);
    assert_eq!(single.messages.len(), 1);
    assert_eq!(single.messages[0].id, turns[2].id);
    assert_eq!(single.messages[0].conversation_count, 1);
    assert!(single.messages[0].conversation_id.is_empty());
    assert!(single.messages[0].body.is_empty());
    q.limit = 10;
    q.view = "all".into();
    let inbox = store.snapshot(&q).unwrap();
    assert_eq!(inbox.matched, 2);
    assert_eq!(inbox.messages[1].id, turns[0].id);
    q.search = "Latest".into();
    assert_eq!(store.snapshot(&q).unwrap().matched, 1);
    assert_eq!(store.snapshot(&q).unwrap().messages[0].id, turns[2].id);
    q.search.clear();
    q.list_mode = ListMode::Conversations;
    assert_eq!(
        turns.iter().map(|m| m.body.as_str()).collect::<Vec<_>>(),
        vec!["Original", "Reply", "Latest"]
    );
    assert!(store.detail(&turns[1].id).unwrap().html.contains("<table>"));
    q.view = "all".into();
    q.unread_only = true;
    assert_eq!(
        store.snapshot(&q).unwrap().messages[0].conversation_count,
        3
    );
    // Upgrade original JSON without touching read/star/local folder identity.
    let mut old = turns[0].clone();
    old.message_id.clear();
    old.references.clear();
    old.is_read = true;
    old.starred = true;
    old.local_folder = "Keep".into();
    store.update_mail(&old).unwrap();
    store
        .db()
        .unwrap()
        .execute(
            "UPDATE messages SET parser_version=1 WHERE id=?1",
            [&old.id],
        )
        .unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let upgraded = store.mail(&old.id).unwrap();
    assert_eq!(upgraded.message_id, "<root@example.com>");
    assert!(upgraded.is_read && upgraded.starred);
    assert_eq!(upgraded.local_folder, "Keep");
    assert_eq!(upgraded.hash, old.hash);
    assert_eq!(store.conversation(&old.id).unwrap().len(), 3);
    let mut trashed = turns[1].clone();
    trashed.trashed = true;
    store.update_mail(&trashed).unwrap();
    assert_eq!(store.conversation(&old.id).unwrap().len(), 2);
    assert_eq!(store.conversation(&trashed.id).unwrap().len(), 1);
}
#[test]
fn legacy_query_defaults_to_conversations_and_rejects_unknown_list_modes() {
    let mut value = serde_json::to_value(query()).unwrap();
    value.as_object_mut().unwrap().remove("listMode");
    let old: Query = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(old.list_mode, ListMode::Conversations);
    value["listMode"] = "messages".into();
    assert_eq!(
        serde_json::from_value::<Query>(value.clone())
            .unwrap()
            .list_mode,
        ListMode::Messages
    );
    value["listMode"] = "unknown".into();
    assert!(serde_json::from_value::<Query>(value).is_err());
}
#[test]
fn outgoing_reply_has_rfc_thread_headers_without_quoting_and_rejects_header_injection() {
    use mailparse::MailHeaderMap;
    let mut d = draft();
    d.in_reply_to = "<parent@example.com>".into();
    d.references = vec!["<root@example.com>".into()];
    let raw = crate::network::build_message(&account(), &d)
        .unwrap()
        .formatted();
    let parsed = mailparse::parse_mail(&raw).unwrap();
    assert_eq!(
        parsed.headers.get_first_value("In-Reply-To").unwrap(),
        "<parent@example.com>"
    );
    assert_eq!(
        parsed.headers.get_first_value("References").unwrap(),
        "<root@example.com> <parent@example.com>"
    );
    assert!(parsed.headers.get_first_value("Message-ID").is_some());
    d.in_reply_to = "<parent@example.com>\r\nBcc: injected@example.com".into();
    assert!(crate::network::build_message(&account(), &d).is_err());
}

#[test]
fn sent_duplicate_copies_share_local_actions_without_crossing_accounts_or_changing_mime() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    let original=b"From: test@example.com\r\nTo: alice@example.com\r\nSubject: Note\r\nMessage-ID: <same@example.com>\r\n\r\nBody";
    let copy=b"From: test@example.com\r\nTo: alice@example.com\r\nSubject: Note\r\nMessage-ID: <same@example.com>\r\nX-Server: copied\r\n\r\nBody";
    store.ingest(&a, "Sent", "1", original, false).unwrap();
    store.ingest(&a, "Sent", "2", copy, false).unwrap();
    let mut foreign = a.clone();
    foreign.id = "foreign".into();
    store
        .ingest(&foreign, "Sent", "1", original, false)
        .unwrap();
    let snapshot = store.snapshot(&query()).unwrap();
    let mail = snapshot
        .messages
        .iter()
        .find(|m| m.account_id == a.id)
        .unwrap();
    assert_eq!(mail.conversation_count, 1);
    store.change_mail(&mail.id, "read", "true").unwrap();
    store.change_mail(&mail.id, "star", "true").unwrap();
    let db = store.db().unwrap();
    let rows = db
        .prepare("SELECT data FROM messages WHERE account_id=?1")
        .unwrap()
        .query_map([&a.id], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    for data in rows {
        let m: Mail = serde_json::from_str(&data).unwrap();
        assert!(m.is_read && m.starred);
        archive::read_raw(&store.root, &m.hash).unwrap();
    }
    let mail = store
        .snapshot(&query())
        .unwrap()
        .messages
        .into_iter()
        .find(|m| m.account_id == foreign.id)
        .unwrap();
    assert!(!mail.is_read && !mail.starred);
}

#[test]
fn large_mailbox_lists_only_metadata_and_caches_thread_links() {
    use std::{sync::Arc, time::Instant};
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    let mut mail = archive::parse(&raw(), &a, "INBOX").unwrap().0;
    mail.body = format!("{} body-search-marker", "Long body ".repeat(800));
    let mut db = store.db().unwrap();
    let tx = db.transaction().unwrap();
    for i in 0..10_000 {
        mail.id = format!("fixture-{i:05}");
        mail.hash = format!("hash-{i}");
        mail.message_id = format!("<fixture-{i}@example.com>");
        tx.execute(
            "INSERT INTO messages(id,account_id,hash,data,parser_version) VALUES(?1,?2,?3,?4,2)",
            rusqlite::params![
                mail.id,
                a.id,
                mail.hash,
                serde_json::to_string(&mail).unwrap()
            ],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO sources VALUES(?1,'INBOX',?2,?2,1)",
            rusqlite::params![a.id, mail.id],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    let mut q = query();
    q.view = "all".into();
    q.limit = 200;
    let start = Instant::now();
    let snapshot = store.snapshot(&q).unwrap();
    let elapsed = start.elapsed();
    assert_eq!(snapshot.matched, 10_000);
    assert_eq!(snapshot.messages.len(), 200);
    assert!(snapshot.messages.iter().all(|m| m.body.is_empty()));
    assert!(serde_json::to_vec(&snapshot).unwrap().len() < 500_000);
    let graph = store.conversation_index("").unwrap();
    assert!(Arc::ptr_eq(
        &graph,
        &store.clone().conversation_index(&a.id).unwrap()
    ));
    store
        .change_mail(&snapshot.messages[0].id, "trash", "true")
        .unwrap();
    assert!(!Arc::ptr_eq(&graph, &store.conversation_index("").unwrap()));
    q.search = "body-search-marker".into();
    q.search_field = "body".into();
    assert_eq!(store.snapshot(&q).unwrap().matched, 9_999);
    // Long bodies remain intact; a list projection must never overwrite archives.
    assert!(store
        .mail(&snapshot.messages[0].id)
        .unwrap()
        .body
        .contains("body-search-marker"));
    eprintln!(
        "10,000-mail inbox snapshot: {elapsed:?}, payload: {} bytes",
        serde_json::to_vec(&snapshot).unwrap().len()
    );
    assert!(
        elapsed.as_secs() < 5,
        "indexed metadata listing unexpectedly slow: {elapsed:?}"
    );
}

#[test]
fn online_mail_has_no_mime_archive_and_can_be_upgraded_without_losing_identity() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let mut a = account();
    a.save_locally = false;
    store.save_account(&a).unwrap();
    let raw = raw();
    assert!(store.ingest(&a, "INBOX", "7:12", &raw, false).unwrap());
    let mut q = query();
    q.view = "all".into();
    let s = store.snapshot(&q).unwrap();
    let mail = store.mail(&s.messages[0].id).unwrap();
    assert!(!mail.saved_locally);
    assert!(mail.body.is_empty());
    assert!(archive::read_raw(dir.path(), &mail.hash).is_err());
    assert_eq!(s.stats.saved, 0);
    assert_eq!(s.stats.bytes, 0);
    assert!(store.snapshot(&query()).unwrap().messages.is_empty());
    assert_eq!(store.archive_health().unwrap().checked, 0);
    let backup_dir = tempfile::tempdir().unwrap();
    let backup = store.backup(backup_dir.path()).unwrap();
    assert_eq!(
        std::fs::read_dir(std::path::Path::new(&backup).join("archive"))
            .unwrap()
            .count(),
        0
    );
    store.change_mail(&mail.id, "star", "true").unwrap();
    a.save_locally = true;
    store.save_account(&a).unwrap();
    assert!(!store.source_available(&a, "INBOX", "7:12").unwrap());
    store.ingest(&a, "INBOX", "7:12", &raw, false).unwrap();
    // Same bytes still need an upgrade when the original only had metadata.
    let upgraded = store.mail(&mail.id).unwrap();
    assert!(upgraded.saved_locally);
    assert!(upgraded.starred);
    assert!(!upgraded.body.is_empty());
    assert_eq!(store.detail(&mail.id).unwrap().attachments.len(), 1);
    store.reconcile_folder(&a.id, "INBOX", &[]).unwrap();
    assert_eq!(store.snapshot(&query()).unwrap().messages.len(), 1);
}

#[test]
fn online_metadata_is_removed_when_server_mail_disappears_but_archives_remain() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let mut a = account();
    store.save_account(&a).unwrap();
    store.ingest(&a, "INBOX", "7:1", &raw(), false).unwrap();
    a.save_locally = false;
    let other = String::from_utf8(raw())
        .unwrap()
        .replace("Project invoice", "Online only");
    store
        .ingest(&a, "INBOX", "7:2", other.as_bytes(), false)
        .unwrap();
    store.reconcile_folder(&a.id, "INBOX", &[]).unwrap();
    assert_eq!(store.snapshot(&query()).unwrap().stats.total, 1);
}

#[test]
fn server_folder_query_uses_locations_not_local_classification() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    store
        .ingest(&a, "Team/Reports", "7:1", &raw(), false)
        .unwrap();
    store
        .save_remote_folders(
            &a.id,
            &[RemoteFolder {
                account_id: a.id.clone(),
                detected_roles: None,
                name: "Team/Reports".into(),
                display_name: "Team/Reports".into(),
                delimiter: Some("/".into()),
                selectable: true,
                sync_error: None,
                roles: vec![],
            }],
        )
        .unwrap();
    let mut q = query();
    q.view = "remote".into();
    q.account_id = a.id.clone();
    q.remote_folder = "Team/Reports".into();
    let snapshot = store.snapshot(&q).unwrap();
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.remote_folders.len(), 1);
    q.remote_folder = "INBOX".into();
    assert!(store.snapshot(&q).unwrap().messages.is_empty());
    assert_eq!(crate::remote::display_name("&ZeVnLIqe-"), "日本語");
}

#[test]
fn absent_or_invalid_date_never_uses_download_time_and_server_date_repairs_old_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    let raw=b"From: Alice <alice@example.com>\r\nTo: test@example.com\r\nSubject: Old mail\r\nContent-Type: text/plain\r\n\r\nOld content";
    let parsed = archive::parse(raw, &a, "INBOX").unwrap().0;
    assert!(parsed.date.is_empty());
    store.ingest(&a, "INBOX", "7:1", raw, false).unwrap();
    let id = store.snapshot(&query()).unwrap().messages[0].id.clone();
    let hash = store.mail(&id).unwrap().hash;
    // Model the old fallback without altering original archived bytes.
    let mut old = store.mail(&id).unwrap();
    old.date = old.saved_at.clone();
    store.update_mail(&old).unwrap();
    store
        .db()
        .unwrap()
        .execute("UPDATE messages SET parser_version=2", [])
        .unwrap();
    drop(store);
    let store = Store::new(dir.path().into()).unwrap();
    assert!(store.mail(&id).unwrap().date.is_empty());
    store
        .set_server_date(&a.id, "INBOX", "7:1", "2021-03-29T17:48:00+08:00")
        .unwrap();
    assert!(store.mail(&id).unwrap().date.starts_with("2021-03-29"));
    assert_eq!(store.mail(&id).unwrap().hash, hash);
    assert_eq!(archive::read_raw(dir.path(), &hash).unwrap(), raw);
    let traced=b"From: a@example.com\r\nDate: invalid\r\nReceived: from server; Mon, 29 Mar 2021 17:48:00 +0800\r\n\r\nHello";
    assert!(archive::parse(traced, &a, "INBOX")
        .unwrap()
        .0
        .date
        .starts_with("2021-03-29"));
}

#[test]
fn malformed_base64_part_keeps_original_and_does_not_block_other_mail() {
    let raw = b"From: sender@example.com\r\nTo: me@example.com\r\nSubject: broken attachment\r\nContent-Type: multipart/mixed; boundary=parts\r\n\r\n--parts\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>valid body</p>\r\n--parts\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=broken.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\naGVs!bG8=\r\n--parts--\r\n";
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let account = account();
    store.save_account(&account).unwrap();
    assert!(store
        .ingest(&account, "INBOX", "broken", raw, false)
        .unwrap());
    let snapshot = store.snapshot(&query()).unwrap();
    let detail = store.detail(&snapshot.messages[0].id).unwrap();
    assert!(detail.html.contains("valid body"));
    assert!(!detail.mail.parse_warnings.is_empty());
    assert!(!detail.attachments[0].error.is_empty());
    assert_eq!(
        archive::read_raw(&store.root, &detail.mail.hash).unwrap(),
        raw
    );
    assert!(archive::attachment(raw, detail.attachments[0].index).is_err());
    assert!(store
        .ingest(&account, "INBOX", "next", &self::raw(), false)
        .unwrap());
    assert_eq!(store.snapshot(&query()).unwrap().stats.total, 2);
    assert_eq!(store.archive_health().unwrap().problems.len(), 1);
}
#[test]
fn base64_known_variants_decode_without_discarding_invalid_symbols() {
    for (encoded, expected) in [
        ("aGVsbG8", b"hello".as_slice()),
        ("-_8=", b"\xfb\xff".as_slice()),
    ] {
        let raw=format!("Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\n{encoded}");
        let parsed = mailparse::parse_mail(raw.as_bytes()).unwrap();
        assert_eq!(archive::decoded_bytes(&parsed).unwrap(), expected);
    }
    let (_,html,_) = archive::parse(b"Content-Type: multipart/alternative; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n!!!!\r\n--b\r\nContent-Type: text/html\r\n\r\n<p>usable</p>\r\n--b--",&account(),"INBOX").unwrap();
    assert!(html.contains("usable"));
}
#[test]
fn notifications_skip_history_read_sent_duplicates_and_preserve_preferences() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let mut a = account();
    store.save_account(&a).unwrap();
    let checkpoint = crate::notifications::checkpoint(&store);
    let recent = format!(
        "From: other@example.com\r\nSubject: recent\r\nDate: {}\r\n\r\nnew",
        chrono::Utc::now().to_rfc2822()
    );
    store
        .ingest(&a, "INBOX", "new", recent.as_bytes(), false)
        .unwrap();
    assert!(
        crate::notifications::incoming(&store, &a, checkpoint, chrono::Utc::now())
            .unwrap()
            .is_empty()
    );
    a.last_sync = Some(chrono::Utc::now().to_rfc3339());
    assert_eq!(
        crate::notifications::incoming(&store, &a, checkpoint, chrono::Utc::now())
            .unwrap()
            .len(),
        1
    );
    store
        .ingest(&a, "INBOX", "duplicate", recent.as_bytes(), false)
        .unwrap();
    let sent = recent.replace("Subject: recent", "Subject: sent");
    store
        .ingest(&a, "Sent", "sent", sent.as_bytes(), false)
        .unwrap();
    let old = recent
        .replace(&chrono::Utc::now().format("%Y").to_string(), "2021")
        .replace("Subject: recent", "Subject: old");
    store
        .ingest(&a, "INBOX", "old", old.as_bytes(), false)
        .unwrap();
    assert_eq!(
        crate::notifications::incoming(&store, &a, checkpoint, chrono::Utc::now())
            .unwrap()
            .len(),
        1
    );
    let mut prefs = store.preferences().unwrap();
    prefs.new_mail_notifications = false;
    store.save_preferences(&prefs).unwrap();
    assert!(!store.preferences().unwrap().new_mail_notifications);
    assert!(store.preferences().unwrap().send_result_notifications);
    let legacy: Preferences = serde_json::from_str(r#"{"syncIntervalMinutes":5}"#).unwrap();
    assert!(legacy.new_mail_notifications);
    let id = store
        .snapshot(&query())
        .unwrap()
        .messages
        .iter()
        .find(|m| m.subject == "recent")
        .unwrap()
        .id
        .clone();
    store.change_mail(&id, "read", "true").unwrap();
    assert!(
        crate::notifications::incoming(&store, &a, checkpoint, chrono::Utc::now())
            .unwrap()
            .is_empty()
    );
}
#[test]
fn send_receipts_distinguish_smtp_acceptance_failure_and_ambiguity() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let draft = draft();
    assert_eq!(
        crate::notifications::receipt(&store, &draft, &Err("连接失败".into())).status,
        "failed"
    );
    for (status, label) in [
        ("sent", "sent"),
        ("uncertain", "uncertain"),
        ("sending", "uncertain"),
        ("failed", "failed"),
    ] {
        store
            .db()
            .unwrap()
            .execute(
                "INSERT OR REPLACE INTO outbox(id,status,data,raw) VALUES(?1,?2,?3,?4)",
                rusqlite::params![
                    draft.id,
                    status,
                    serde_json::to_string(&draft).unwrap(),
                    b"raw".as_slice()
                ],
            )
            .unwrap();
        let receipt = crate::notifications::receipt(&store, &draft, &Err("连接中断".into()));
        assert_eq!(receipt.status, label);
        if status == "sent" {
            assert!(receipt.message.contains("服务器已接受"));
        }
    }
}

#[test]
fn mail_navigation_routes_only_valid_web_and_mailto_links() {
    for target in [
        "https://example.com/path?x=1&y=2",
        "http://example.com",
        "mailto:team@example.com?subject=hello",
    ] {
        let mut routed = url::Url::parse("https://yanxin-mail-link.invalid/open").unwrap();
        routed.query_pairs_mut().append_pair("url", target);
        assert_eq!(
            crate::mail_navigation_target(&routed),
            Some(url::Url::parse(target).unwrap().to_string())
        );
    }
    for routed in [
        "https://yanxin-mail-link.invalid/open?url=file%3A%2F%2F%2Ftmp%2Fprivate",
        "https://yanxin-mail-link.invalid/open?url=javascript%3Aalert%281%29",
        "https://yanxin-mail-link.invalid/open?url=relative",
        "https://other.invalid/open?url=https%3A%2F%2Fexample.com",
        "https://example.com/?url=https%3A%2F%2Fexample.com",
        "https://yanxin-mail-link.invalid/open",
    ] {
        assert!(crate::mail_navigation_target(&url::Url::parse(routed).unwrap()).is_none());
    }
}

#[test]
fn sent_view_uses_active_special_use_locations_and_preserves_local_sent_copy() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    let folders = [
        RemoteFolder {
            account_id: a.id.clone(),
            detected_roles: None,
            name: "Sent Messages".into(),
            display_name: "Sent Messages".into(),
            delimiter: Some("/".into()),
            selectable: true,
            sync_error: None,
            roles: vec![FolderRole::Sent],
        },
        RemoteFolder {
            account_id: a.id.clone(),
            detected_roles: None,
            name: "Sent".into(),
            display_name: "Sent".into(),
            delimiter: None,
            selectable: true,
            sync_error: None,
            roles: vec![FolderRole::Archive],
        },
    ];
    store.save_remote_folders(&a.id, &folders).unwrap();
    // The same MIME is first encountered in another location. The sent view
    // must use active sources, rather than whichever sourceFolder was stored first.
    store.ingest(&a, "INBOX", "7:1", &raw(), true).unwrap();
    store
        .ingest(&a, "Sent Messages", "8:5", &raw(), true)
        .unwrap();
    let q = Query {
        view: "sent".into(),
        ..query()
    };
    assert_eq!(store.snapshot(&q).unwrap().matched, 1);
    store.reconcile_folder(&a.id, "Sent Messages", &[]).unwrap();
    assert_eq!(store.snapshot(&q).unwrap().matched, 0);
    let other = String::from_utf8(raw())
        .unwrap()
        .replace("Project invoice", "Not sent");
    store
        .ingest(&a, "Sent", "9:8", other.as_bytes(), true)
        .unwrap();
    assert_eq!(store.snapshot(&q).unwrap().matched, 0);
    // A confirmed SMTP submission is still visible if a server labels Sent as
    // another special use. No transport is contacted by this test.
    crate::network::send_with(&store, &draft(), |_| Ok(()), |(), _| Ok(())).unwrap();
    assert_eq!(store.snapshot(&q).unwrap().matched, 1);
}

fn mapping_folder(account: &Account, name: &str, roles: Vec<FolderRole>) -> RemoteFolder {
    RemoteFolder {
        account_id: account.id.clone(),
        name: name.into(),
        display_name: name.into(),
        delimiter: Some("/".into()),
        selectable: true,
        sync_error: None,
        roles,
        detected_roles: None,
    }
}
#[test]
fn custom_folder_mapping_survives_discovery_and_restart_and_reset_restores_original_roles() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    let folders = vec![
        mapping_folder(&a, "INBOX", vec![FolderRole::Inbox]),
        mapping_folder(&a, "Sent Messages", vec![FolderRole::Sent]),
        mapping_folder(&a, "Work/Out", vec![]),
        mapping_folder(&a, "Junk", vec![FolderRole::Junk]),
    ];
    store.save_remote_folders(&a.id, &folders).unwrap();
    let mappings = vec![
        FolderMapping {
            role: FolderRole::Sent,
            folder: Some("Work/Out".into()),
        },
        FolderMapping {
            role: FolderRole::Junk,
            folder: None,
        },
    ];
    store.save_folder_mappings(&a.id, &mappings).unwrap();
    for _ in 0..2 {
        store.save_remote_folders(&a.id, &folders).unwrap();
        let settings = store.folder_settings(&a.id).unwrap();
        let out = settings
            .folders
            .iter()
            .find(|f| f.name == "Work/Out")
            .unwrap();
        assert_eq!(out.roles, vec![FolderRole::Sent]);
        assert_eq!(out.display_name, "Work/已发送");
        assert_eq!(out.detected_roles, Some(vec![]));
        let junk = settings.folders.iter().find(|f| f.name == "Junk").unwrap();
        assert!(junk.roles.is_empty());
        assert_eq!(junk.display_name, "Junk");
        assert!(!crate::remote::excluded_from_auto_sync(junk));
        assert!(settings
            .folders
            .iter()
            .find(|f| f.name == "Sent Messages")
            .unwrap()
            .roles
            .is_empty());
    }
    drop(store);
    let store = Store::new(dir.path().into()).unwrap();
    assert_eq!(store.folder_settings(&a.id).unwrap().mappings.len(), 2);
    store.save_folder_mappings(&a.id, &[]).unwrap();
    let settings = store.folder_settings(&a.id).unwrap();
    assert!(settings.mappings.is_empty());
    assert_eq!(
        settings
            .folders
            .iter()
            .find(|f| f.name == "Sent Messages")
            .unwrap()
            .roles,
        vec![FolderRole::Sent]
    );
    assert_eq!(
        settings
            .folders
            .iter()
            .find(|f| f.name == "Work/Out")
            .unwrap()
            .display_name,
        "Work/Out"
    );
    assert_eq!(
        settings
            .folders
            .iter()
            .find(|f| f.name == "Junk")
            .unwrap()
            .roles,
        vec![FolderRole::Junk]
    );
}
#[test]
fn mapping_destinations_override_conflicting_discovery_and_missing_paths_never_fall_back() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    let folders = vec![
        mapping_folder(&a, "Sent", vec![FolderRole::Sent]),
        mapping_folder(&a, "VendorTrash", vec![FolderRole::Trash]),
    ];
    store.save_remote_folders(&a.id, &folders).unwrap();
    let mappings = vec![
        FolderMapping {
            role: FolderRole::Archive,
            folder: Some("Sent".into()),
        },
        FolderMapping {
            role: FolderRole::Trash,
            folder: Some("VendorTrash".into()),
        },
    ];
    store.save_folder_mappings(&a.id, &mappings).unwrap();
    assert_eq!(
        store
            .remote_folders(Some(&a.id))
            .unwrap()
            .iter()
            .find(|f| f.name == "Sent")
            .unwrap()
            .roles,
        vec![FolderRole::Archive]
    );
    store
        .save_remote_folders(
            &a.id,
            &[
                folders[0].clone(),
                mapping_folder(&a, "Trash", vec![FolderRole::Trash]),
            ],
        )
        .unwrap();
    let settings = store.folder_settings(&a.id).unwrap();
    assert!(settings
        .folders
        .iter()
        .all(|f| !f.roles.contains(&FolderRole::Trash)));
    assert_eq!(settings.mappings[1].folder.as_deref(), Some("VendorTrash"));
    assert!(store.save_folder_mappings(&a.id, &mappings).is_err());
    assert_eq!(store.folder_settings(&a.id).unwrap().mappings.len(), 2);
}
#[test]
fn mapping_rejects_wrong_roles_invalid_or_duplicate_destinations_without_changing_saved_data() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    let mut parent = mapping_folder(&a, "Parent", vec![]);
    parent.selectable = false;
    store
        .save_remote_folders(
            &a.id,
            &[
                mapping_folder(&a, "INBOX", vec![FolderRole::Inbox]),
                mapping_folder(&a, "Personal", vec![]),
                parent,
            ],
        )
        .unwrap();
    let valid = FolderMapping {
        role: FolderRole::Sent,
        folder: Some("Personal".into()),
    };
    store
        .save_folder_mappings(&a.id, std::slice::from_ref(&valid))
        .unwrap();
    for invalid in [
        vec![FolderMapping {
            role: FolderRole::Inbox,
            folder: None,
        }],
        vec![FolderMapping {
            role: FolderRole::Sent,
            folder: Some("INBOX".into()),
        }],
        vec![FolderMapping {
            role: FolderRole::Sent,
            folder: Some("Parent".into()),
        }],
        vec![FolderMapping {
            role: FolderRole::Sent,
            folder: Some("unknown".into()),
        }],
        vec![valid.clone(), valid.clone()],
        vec![
            valid.clone(),
            FolderMapping {
                role: FolderRole::Archive,
                folder: valid.folder.clone(),
            },
        ],
    ] {
        assert!(store.save_folder_mappings(&a.id, &invalid).is_err());
        assert_eq!(store.folder_settings(&a.id).unwrap().mappings.len(), 1);
    }
    let mut pop = a.clone();
    pop.id = "pop".into();
    pop.protocol = "pop3".into();
    store.save_account(&pop).unwrap();
    assert!(store.save_folder_mappings(&pop.id, &[]).is_err());
    assert!(store.save_folder_mappings("removed", &[]).is_err());
}
#[test]
fn sent_view_obeys_manual_mapping_and_mapping_does_not_alter_mail_or_sources() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    store.save_account(&a).unwrap();
    store
        .save_remote_folders(
            &a.id,
            &[
                mapping_folder(&a, "Sent", vec![FolderRole::Sent]),
                mapping_folder(&a, "Custom", vec![]),
            ],
        )
        .unwrap();
    store.ingest(&a, "Sent", "1:1", &raw(), true).unwrap();
    let other = String::from_utf8(raw())
        .unwrap()
        .replace("Project invoice", "Different mail");
    store
        .ingest(&a, "Custom", "2:2", other.as_bytes(), false)
        .unwrap();
    let before = store.snapshot(&query()).unwrap();
    store
        .save_folder_mappings(
            &a.id,
            &[FolderMapping {
                role: FolderRole::Sent,
                folder: Some("Custom".into()),
            }],
        )
        .unwrap();
    let sent = store
        .snapshot(&Query {
            view: "sent".into(),
            ..query()
        })
        .unwrap();
    assert_eq!(sent.messages.len(), 1);
    assert_eq!(sent.messages[0].subject, "Different mail");
    let after = store.snapshot(&query()).unwrap();
    assert_eq!(before.stats.total, after.stats.total);
    assert_eq!(before.stats.saved, after.stats.saved);
    assert!(store.source_available(&a, "Sent", "1:1").unwrap());
}
#[test]
fn mappings_are_account_scoped_and_clear_when_server_identity_changes() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().into()).unwrap();
    let a = account();
    let mut b = a.clone();
    b.id = "other".into();
    store.save_account(&a).unwrap();
    store.save_account(&b).unwrap();
    for account in [&a, &b] {
        store
            .save_remote_folders(&account.id, &[mapping_folder(account, "Custom", vec![])])
            .unwrap();
    }
    store
        .save_folder_mappings(
            &a.id,
            &[FolderMapping {
                role: FolderRole::Junk,
                folder: Some("Custom".into()),
            }],
        )
        .unwrap();
    assert!(store.remote_folders(Some(&b.id)).unwrap()[0]
        .roles
        .is_empty());
    let mut edited = a.clone();
    edited.name = "New label".into();
    store.edit_account_preferences(&edited).unwrap();
    assert_eq!(store.folder_settings(&a.id).unwrap().mappings.len(), 1);
    edited.incoming_host = "different.example.org".into();
    store.edit_account(&edited).unwrap();
    assert!(store.folder_settings(&a.id).unwrap().mappings.is_empty());
    assert!(store.remote_folders(Some(&a.id)).unwrap().is_empty());
}

#[test]
fn server_flags_merge_atomically_without_replaying_or_losing_local_content() {
    let temp = tempfile::tempdir().unwrap();
    let s = Store::new(temp.path().into()).unwrap();
    let a = account();
    s.save_account(&a).unwrap();
    s.ingest(&a, "INBOX", "7:12", &raw(), false).unwrap();
    let id = s.snapshot(&query()).unwrap().messages[0].id.clone();
    let mut before = s.mail(&id).unwrap();
    before.local_folder = "归类".into();
    before.trashed = true;
    s.update_mail(&before).unwrap();
    let observation = vec![("7:12".into(), true, true)];
    assert_eq!(s.merge_remote_flags(&a, "INBOX", &observation).unwrap(), 1);
    assert_eq!(s.merge_remote_flags(&a, "INBOX", &observation).unwrap(), 0);
    let after = s.mail(&id).unwrap();
    assert!(after.is_read && after.starred && after.trashed);
    assert_eq!(after.hash, before.hash);
    assert_eq!(after.body, before.body);
    assert_eq!(after.local_folder, before.local_folder);
    assert_eq!(archive::read_raw(&s.root, &after.hash).unwrap(), raw());
    assert_eq!(s.server_operations().unwrap().pending, 0);
    assert_eq!(s.cached_flag_uids(&a, "INBOX", 7).unwrap().len(), 1);
    assert!(s.cached_flag_uids(&a, "INBOX", 8).unwrap().is_empty());
    let flags = [("7:12".into(), false, false)];
    assert_eq!(s.merge_remote_flags(&a, "INBOX", &flags).unwrap(), 1);
    let after = s.mail(&id).unwrap();
    assert!(!after.is_read && !after.starred);
}

#[test]
fn server_flags_protect_each_unfinished_intent_and_accept_later_external_changes() {
    use crate::operations::Failure;
    for status in ["queued", "running", "blocked", "completed"] {
        let temp = tempfile::tempdir().unwrap();
        let s = Store::new(temp.path().into()).unwrap();
        let a = account();
        s.save_account(&a).unwrap();
        s.ingest(&a, "INBOX", "7:12", &raw(), false).unwrap();
        let id = s.snapshot(&query()).unwrap().messages[0].id.clone();
        s.change_mail(&id, "read", "true").unwrap();
        let op = s.due_operations(&a.id).unwrap().remove(0);
        if status != "queued" {
            s.claim_operation(&op).unwrap();
        }
        if status == "blocked" {
            s.finish_operation(&op, Err(Failure::Blocked("rejected".into())))
                .unwrap();
        }
        if status == "completed" {
            s.finish_operation(&op, Ok(())).unwrap();
        }
        s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), false, true)])
            .unwrap();
        let m = s.mail(&id).unwrap();
        assert_eq!(m.is_read, status != "completed", "{status}");
        assert!(m.starred);
        // A protected read observation with unchanged star causes no write/cache churn.
        assert_eq!(
            s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), false, true)])
                .unwrap(),
            0
        );
        s.change_mail(&id, "star", "false").unwrap();
        s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), true, true)])
            .unwrap();
        assert!(!s.mail(&id).unwrap().starred);
    }
}

#[test]
fn server_flags_ignore_other_copies_accounts_and_stale_connection_observations() {
    let temp = tempfile::tempdir().unwrap();
    let s = Store::new(temp.path().into()).unwrap();
    let a = account();
    s.save_account(&a).unwrap();
    s.ingest(&a, "Other", "7:13", &raw(), false).unwrap();
    s.ingest(&a, "INBOX", "7:12", &raw(), false).unwrap();
    let id = s.snapshot(&query()).unwrap().messages[0].id.clone();
    let mut b = a.clone();
    b.id = "other-account".into();
    s.save_account(&b).unwrap();
    s.ingest(&b, "INBOX", "7:12", &raw(), false).unwrap();
    assert_eq!(
        s.merge_remote_flags(&a, "Other", &[("7:13".into(), true, true)])
            .unwrap(),
        0
    );
    assert_eq!(
        s.merge_remote_flags(&a, "INBOX", &[("8:12".into(), true, true)])
            .unwrap(),
        0
    );
    assert_eq!(
        s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), true, true)])
            .unwrap(),
        1
    );
    assert!(s.mail(&id).unwrap().starred);
    assert!(
        !s.snapshot(&query())
            .unwrap()
            .messages
            .iter()
            .find(|m| m.account_id == b.id)
            .unwrap()
            .starred
    );
    let mut edited = a.clone();
    edited.enabled = false;
    s.save_account(&edited).unwrap();
    assert_eq!(
        s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), false, false)])
            .unwrap(),
        0
    );
    edited.enabled = true;
    edited.incoming_host = "changed.example.com".into();
    s.save_account(&edited).unwrap();
    assert_eq!(
        s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), false, false)])
            .unwrap(),
        0
    );
    s.save_account(&a).unwrap();
    s.reconcile_folder(&a.id, "INBOX", &[]).unwrap();
    assert_eq!(
        s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), false, false)])
            .unwrap(),
        0
    );
    assert_eq!(
        s.merge_remote_flags(&a, "Other", &[("7:13".into(), false, false)])
            .unwrap(),
        1
    );
    assert!(!s.mail(&id).unwrap().starred);
}

#[test]
fn server_flag_batch_rolls_back_on_database_failure_and_initial_star_is_preserved() {
    let temp = tempfile::tempdir().unwrap();
    let s = Store::new(temp.path().into()).unwrap();
    let a = account();
    s.save_account(&a).unwrap();
    s.ingest_with_flags(&a, "INBOX", "7:12", &raw(), false, true)
        .unwrap();
    let initial = s.snapshot(&query()).unwrap().messages[0].clone();
    assert!(initial.starred);
    let second = String::from_utf8(raw())
        .unwrap()
        .replace("Project invoice", "Second invoice");
    s.ingest(&a, "INBOX", "7:13", second.as_bytes(), false)
        .unwrap();
    s.db().unwrap().execute_batch("CREATE TRIGGER reject_second BEFORE UPDATE ON messages WHEN json_extract(OLD.data,'$.subject')='Second invoice' BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(s
        .merge_remote_flags(
            &a,
            "INBOX",
            &[("7:12".into(), true, false), ("7:13".into(), true, true)]
        )
        .is_err());
    let m = s.mail(&initial.id).unwrap();
    assert!(!m.is_read && m.starred);
}

#[test]
fn local_rule_flags_survive_refresh_upgrade_and_restart_until_explicit_user_change() {
    let temp = tempfile::tempdir().unwrap();
    let s = Store::new(temp.path().into()).unwrap();
    let mut a = account();
    a.save_locally = false;
    s.save_account(&a).unwrap();
    s.save_rules(&[
        rule("read-rule", "read", false),
        rule("star-rule", "star", false),
    ])
    .unwrap();
    s.ingest_with_flags(&a, "INBOX", "7:12", &raw(), false, false)
        .unwrap();
    let mut all = query();
    all.view = "all".into();
    let id = s.snapshot(&all).unwrap().messages[0].id.clone();
    let observation = [("7:12".into(), false, false)];
    assert_eq!(s.merge_remote_flags(&a, "INBOX", &observation).unwrap(), 0);
    a.save_locally = true;
    s.save_account(&a).unwrap();
    s.ingest_with_flags(&a, "INBOX", "7:12", &raw(), false, false)
        .unwrap();
    let s = Store::new(temp.path().into()).unwrap();
    assert_eq!(s.merge_remote_flags(&a, "INBOX", &observation).unwrap(), 0);
    let m = s.mail(&id).unwrap();
    assert!(m.is_read && m.starred && m.saved_locally);
    assert_eq!(m.local_read_override, Some(true));
    assert_eq!(m.local_star_override, Some(true));
    assert_eq!(s.server_operations().unwrap().pending, 0);
    s.change_mail(&id, "read", "false").unwrap();
    let m = s.mail(&id).unwrap();
    assert_eq!(m.local_read_override, None);
    assert_eq!(m.local_star_override, Some(true));
    let op = s.due_operations(&a.id).unwrap().remove(0);
    s.claim_operation(&op).unwrap();
    s.finish_operation(&op, Ok(())).unwrap();
    s.merge_remote_flags(&a, "INBOX", &[("7:12".into(), true, false)])
        .unwrap();
    let m = s.mail(&id).unwrap();
    assert!(m.is_read && m.starred);
}
