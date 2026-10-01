use crate::{archive, models::*, rules, store::Store};
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
        unread_only: false,
        starred_only: false,
        attachments_only: false,
        search_field: String::new(),
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

fn draft() -> Compose {
    Compose {
        id: "draft-1".into(),
        account_id: account().id,
        to: "\"Doe, Alex\" <alex@example.com>".into(),
        cc: "other@example.com".into(),
        bcc: "private@example.com".into(),
        subject: "Formatted note".into(),
        body: "Hello Alex".into(),
        html: "<p>Hello <strong>Alex</strong></p>".into(),
        attachments: vec![],
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
            sync_interval_minutes: 0
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
