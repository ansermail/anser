use crate::{
    archive,
    auth::{self, Secret},
    models::*,
    store::Store,
};
use lettre::{
    message::{header::ContentType, Attachment, MultiPart, SinglePart},
    transport::smtp::authentication::{Credentials, Mechanism},
    Message, SmtpTransport, Transport,
};
use native_tls::{TlsConnector, TlsStream};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpStream, ToSocketAddrs},
    panic::{catch_unwind, AssertUnwindSafe},
    time::Duration,
};
fn socket(host: &str, port: u16) -> Result<TcpStream> {
    let addresses = (host, port).to_socket_addrs().map_err(err)?;
    let mut last = "服务器没有可用地址".into();
    for address in addresses {
        match TcpStream::connect_timeout(&address, Duration::from_secs(12)) {
            Ok(s) => {
                s.set_read_timeout(Some(Duration::from_secs(45)))
                    .map_err(err)?;
                s.set_write_timeout(Some(Duration::from_secs(45)))
                    .map_err(err)?;
                return Ok(s);
            }
            Err(e) => last = err(e),
        }
    }
    Err(last)
}
struct Xoauth {
    user: String,
    token: String,
}
impl imap::Authenticator for Xoauth {
    type Response = String;
    fn process(&self, challenge: &[u8]) -> String {
        if challenge.is_empty() {
            format!("user={}\x01auth=Bearer {}\x01\x01", self.user, self.token)
        } else {
            String::new()
        }
    }
}
fn imap_session(a: &Account, s: &Secret) -> Result<imap::Session<TlsStream<TcpStream>>> {
    let tcp = socket(&a.incoming_host, a.incoming_port)?;
    let tls = TlsConnector::new().map_err(err)?;
    let client = if a.incoming_tls == "starttls" {
        let mut c = imap::Client::new(tcp);
        c.read_greeting().map_err(err)?;
        c.secure(&a.incoming_host, &tls).map_err(err)?
    } else {
        let stream = tls.connect(&a.incoming_host, tcp).map_err(err)?;
        let mut c = imap::Client::new(stream);
        c.read_greeting().map_err(err)?;
        c
    };
    let mut session = if a.auth == "oauth" {
        client
            .authenticate(
                "XOAUTH2",
                &Xoauth {
                    user: a.username.clone(),
                    token: s.access_token.clone(),
                },
            )
            .map_err(|(e, _)| format!("IMAP 授权失败：{e}"))
    } else {
        client
            .login(&a.username, &s.password)
            .map_err(|(e, _)| format!("IMAP 登录失败：{e}"))
    }?;
    if a.provider == "netease" || a.provider == "neteaseWork" {
        let _ = session.run_command_and_check_ok("ID (\"name\" \"Yanxin\" \"version\" \"0.1.0\")");
    }
    Ok(session)
}
fn smtp(a: &Account, s: &Secret) -> Result<SmtpTransport> {
    let builder = if a.smtp_tls == "starttls" {
        SmtpTransport::starttls_relay(&a.smtp_host)
    } else {
        SmtpTransport::relay(&a.smtp_host)
    }
    .map_err(err)?;
    let user = if a.smtp_username.is_empty() {
        a.username.clone()
    } else {
        a.smtp_username.clone()
    };
    let pass = if a.auth == "oauth" {
        s.access_token.clone()
    } else if s.smtp_password.is_empty() {
        s.password.clone()
    } else {
        s.smtp_password.clone()
    };
    let mut builder = builder
        .port(a.smtp_port)
        .timeout(Some(Duration::from_secs(45)))
        .credentials(Credentials::new(user, pass));
    if a.auth == "oauth" {
        builder = builder.authentication(vec![Mechanism::Xoauth2]);
    }
    Ok(builder.build())
}
fn pop_line<T: BufRead>(r: &mut T) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    std::io::Read::take(&mut *r, 100 * 1024 * 1024)
        .read_until(b'\n', &mut bytes)
        .map_err(err)?;
    if bytes.is_empty() || !bytes.ends_with(b"\n") {
        return Err("POP3 响应中断或超过大小限制".into());
    }
    Ok(bytes)
}
fn pop_command<T: std::io::Read + Write>(r: &mut BufReader<T>, command: &str) -> Result<()> {
    if command.contains(['\r', '\n']) {
        return Err("无效 POP3 命令".into());
    }
    r.get_mut()
        .write_all(format!("{command}\r\n").as_bytes())
        .map_err(err)?;
    r.get_mut().flush().map_err(err)?;
    let response = pop_line(r)?;
    if !response.starts_with(b"+OK") {
        return Err("POP3 服务器拒绝操作，请检查认证信息与协议开通状态".into());
    }
    Ok(())
}
fn pop_multiline<T: BufRead>(r: &mut T) -> Result<Vec<u8>> {
    let mut all = Vec::new();
    loop {
        let mut line = pop_line(r)?;
        if line == b".\r\n" || line == b".\n" {
            break;
        }
        if line.starts_with(b"..") {
            line.remove(0);
        }
        if all.len() + line.len() > 100 * 1024 * 1024 {
            return Err("单封邮件超过当前 100 MB 收取上限".into());
        }
        all.extend(line);
    }
    Ok(all)
}
fn pop_session(a: &Account, s: &Secret) -> Result<BufReader<TlsStream<TcpStream>>> {
    let tcp = socket(&a.incoming_host, a.incoming_port)?;
    let tls = TlsConnector::new().map_err(err)?;
    let mut r = if a.incoming_tls == "starttls" {
        let mut p = BufReader::new(tcp);
        if !pop_line(&mut p)?.starts_with(b"+OK") {
            return Err("POP3 欢迎响应无效".into());
        }
        pop_command(&mut p, "STLS")?;
        BufReader::new(tls.connect(&a.incoming_host, p.into_inner()).map_err(err)?)
    } else {
        let mut p = BufReader::new(tls.connect(&a.incoming_host, tcp).map_err(err)?);
        if !pop_line(&mut p)?.starts_with(b"+OK") {
            return Err("POP3 欢迎响应无效".into());
        }
        p
    };
    if a.auth == "oauth" {
        use base64::Engine;
        let token = base64::engine::general_purpose::STANDARD.encode(format!(
            "user={}\x01auth=Bearer {}\x01\x01",
            a.username, s.access_token
        ));
        pop_command(&mut r, &format!("AUTH XOAUTH2 {token}"))?;
    } else {
        pop_command(&mut r, &format!("USER {}", a.username))?;
        pop_command(&mut r, &format!("PASS {}", s.password))?;
    }
    Ok(r)
}
pub fn test(a: &Account, s: &Secret) -> Result<()> {
    a.validate()?;
    if a.protocol == "imap" {
        imap_session(a, s)?.logout().map_err(err)?;
    } else {
        let mut pop = pop_session(a, s)?;
        pop_command(&mut pop, "QUIT")?;
    }
    if !smtp(a, s)?
        .test_connection()
        .map_err(|e| format!("收件成功，但 SMTP 连接失败：{e}"))?
    {
        return Err("SMTP 未通过连接测试".into());
    }
    Ok(())
}
fn mailbox_uid_validity<T: std::io::Read + Write>(
    session: &mut imap::Session<T>,
    folder: &str,
    mailbox: &imap::types::Mailbox,
) -> Result<Option<u32>> {
    if let Some(validity) = mailbox.uid_validity.filter(|v| *v != 0) {
        return Ok(Some(validity));
    }

    // imap 2.4 sends STATUS attributes to unsolicited_responses instead of
    // filling the returned Mailbox. Discard older events before this query.
    for _ in session.unsolicited_responses.try_iter() {}
    let status = match session.status(folder, "(UIDVALIDITY)") {
        Ok(status) => status,
        // Some servers omit or do not implement this item. Re-fetch content
        // rather than trusting a made-up UID namespace across sessions.
        Err(imap::error::Error::No(_)) | Err(imap::error::Error::Bad(_)) => return Ok(None),
        Err(imap::error::Error::Parse(imap::error::ParseError::Invalid(data))) => {
            let diagnostic: String = String::from_utf8_lossy(&data).chars().take(256).collect();
            return Err(format!("查询 UIDVALIDITY 响应无法解析：{diagnostic:?}"));
        }
        Err(e) => return Err(format!("查询 UIDVALIDITY 失败：{e}")),
    };
    let mut validity = status.uid_validity.filter(|v| *v != 0);
    for response in session.unsolicited_responses.try_iter() {
        if let imap::types::UnsolicitedResponse::Status {
            mailbox,
            attributes,
        } = response
        {
            if mailbox != folder
                && !(mailbox.eq_ignore_ascii_case("INBOX") && folder.eq_ignore_ascii_case("INBOX"))
            {
                continue;
            }
            for attribute in attributes {
                if let imap::types::StatusAttribute::UidValidity(v) = attribute {
                    validity = (v != 0).then_some(v);
                }
            }
        }
    }
    Ok(validity)
}

fn parse_full_fetch(response: &[u8], uid: u32) -> Result<(&[u8], Option<u32>, bool)> {
    use imap_proto::{AttributeValue, Response};
    let mut remaining = response;
    let mut body = None;
    let mut size = None;
    let mut read = false;
    while !remaining.is_empty() {
        let (rest, response) = imap_proto::parse_response(remaining)
            .map_err(|_| "服务器邮件响应无效或未完整传输".to_string())?;
        remaining = rest;
        if let Response::Fetch(_, attributes) = response {
            if !attributes
                .iter()
                .any(|a| matches!(a, AttributeValue::Uid(v) if *v == uid))
            {
                continue;
            }
            for attribute in attributes {
                match attribute {
                    AttributeValue::BodySection {
                        section: None,
                        index: Some(_),
                        ..
                    } => {
                        return Err("服务器仅返回了部分邮件，未标记为完整保存".into());
                    }
                    AttributeValue::BodySection {
                        section: None,
                        index: None,
                        data: Some(raw),
                    }
                    | AttributeValue::Rfc822(Some(raw)) => body = Some(raw),
                    AttributeValue::Rfc822Size(v) => size = Some(v),
                    AttributeValue::Flags(flags) => read = flags.contains(&"\\Seen"),
                    _ => {}
                }
            }
        }
    }
    // The parser consumes precisely the literal's {N} bytes. This is the
    // transport completeness check; RFC822.SIZE is separate server metadata.
    Ok((body.ok_or("服务器未返回完整邮件内容")?, size, read))
}

fn sync_imap<T: std::io::Read + Write>(
    store: &Store,
    a: &Account,
    session: &mut imap::Session<T>,
) -> Result<u32> {
    let mut count = 0;
    let mut folders = session
        .list(None, Some("*"))
        .map_err(err)?
        .iter()
        .filter(|n| {
            !n.attributes()
                .iter()
                .any(|attr| matches!(attr, imap::types::NameAttribute::NoSelect))
        })
        .map(|n| n.name().to_string())
        .collect::<Vec<_>>();
    folders.sort_by_key(|f| !f.eq_ignore_ascii_case("INBOX"));
    for folder in folders {
        let lower = folder.to_lowercase();
        if ["trash", "junk", "spam", "deleted"]
            .iter()
            .any(|s| lower.contains(s))
        {
            continue;
        }
        let mut stage = "打开文件夹".to_string();
        let mut sync_folder = || -> Result<()> {
            let mailbox = session.examine(&folder).map_err(err)?;
            stage = "查询邮件 UID".into();
            let mut ids = session
                .uid_search("ALL")
                .map_err(err)?
                .into_iter()
                .collect::<Vec<_>>();
            // Empty mailboxes need no UID namespace. Tencent returns STATUS
            // () here, which older IMAP parsers cannot consume safely.
            if ids.is_empty() {
                return store.reconcile_folder(&a.id, &folder, &[]);
            }
            stage = "查询 UIDVALIDITY".into();
            let validity = mailbox_uid_validity(session, &folder, &mailbox)?;
            if validity.is_none() {
                store.log(&format!(
                    "文件夹「{folder}」未提供 UIDVALIDITY，使用完整内容核对与去重（每次重新下载）"
                ))?;
            }
            ids.sort_unstable();
            ids.reverse();
            let mut remote_ids = Vec::with_capacity(ids.len());
            for uid in ids {
                let stable_remote = validity.map(|v| format!("{v}:{uid}"));
                if let Some(ref remote) = stable_remote {
                    if store.has_source(&a.id, &folder, remote)? {
                        remote_ids.push(remote.clone());
                        continue;
                    }
                }
                stage = format!("下载 UID {uid} 的完整邮件");
                let fetched = session
                    .run_command_and_read_response(format!(
                        "UID FETCH {uid} (UID FLAGS RFC822.SIZE BODY.PEEK[])"
                    ))
                    .map_err(|e| match e {
                        imap::error::Error::Parse(_) => "服务器邮件响应无效或未完整传输".into(),
                        other => err(other),
                    })?;
                let (raw, size, read) = parse_full_fetch(&fetched, uid)?;
                if let Some(size) = size {
                    if raw.len() != size as usize {
                        store.log(&format!("文件夹「{folder}」UID {uid}：RFC822.SIZE 为 {size}，完整响应为 {} 字节；按完整响应保存", raw.len()))?;
                    }
                }
                let remote = stable_remote
                    .unwrap_or_else(|| format!("content:{uid}:{}", archive::digest(raw)));
                if store.ingest(a, &folder, &remote, raw, read)? {
                    count += 1;
                }
                remote_ids.push(remote);
            }
            // Only replace the current server locations after every fetch and
            // archive write succeeds. Prior local MIME files always remain.
            store.reconcile_folder(&a.id, &folder, &remote_ids)
        };
        let result = catch_unwind(AssertUnwindSafe(&mut sync_folder)).unwrap_or_else(|_| {
            Err(format!(
                "{stage}时，邮件协议库处理响应异常；已下载的本地存档已保留"
            ))
        });
        result.map_err(|e| format!("文件夹「{folder}」：{e}"))?;
    }
    Ok(count)
}

pub fn sync(store: &Store, a: &Account) -> Result<u32> {
    catch_unwind(AssertUnwindSafe(|| sync_inner(store, a))).unwrap_or_else(|_| {
        Err("邮件协议库处理响应异常；已下载的本地存档已保留，请重新收取".into())
    })
}

fn sync_inner(store: &Store, a: &Account) -> Result<u32> {
    let secret = auth::credentials(a)?;
    let mut count = 0;
    if a.protocol == "imap" {
        let mut session = imap_session(a, &secret)?;
        let result = sync_imap(store, a, &mut session);
        if result.is_ok() {
            // A failed session may have unread responses. Close the socket
            // directly on errors instead of issuing another command on it.
            let _ = catch_unwind(AssertUnwindSafe(|| session.logout()));
        }
        count = result?;
    } else {
        let mut pop = pop_session(a, &secret)?;
        pop_command(&mut pop, "UIDL")?;
        let uidl = String::from_utf8(pop_multiline(&mut pop)?).map_err(err)?;
        for line in uidl.lines().rev() {
            let columns = line.split_whitespace().collect::<Vec<_>>();
            if columns.len() != 2 || columns[0].parse::<u32>().is_err() {
                return Err("POP3 UIDL 响应无效".into());
            }
            if store.has_source(&a.id, "INBOX", columns[1])? {
                continue;
            }
            pop_command(&mut pop, &format!("RETR {}", columns[0]))?;
            let raw = pop_multiline(&mut pop)?;
            if store.ingest(a, "INBOX", columns[1], &raw, false)? {
                count += 1;
            }
        }
        pop_command(&mut pop, "QUIT")?;
    }
    Ok(count)
}
pub(crate) fn build_message(a: &Account, c: &Compose) -> Result<Message> {
    let mut builder = Message::builder()
        .from(a.email.parse().map_err(err)?)
        .subject(&c.subject);
    let to = archive::addresses(&c.to.replace(['，', '；'], ","))?;
    if to.is_empty() {
        return Err("请填写收件人".into());
    }
    for v in to {
        builder = builder.to(lettre::message::Mailbox::new(
            if v.name.is_empty() {
                None
            } else {
                Some(v.name)
            },
            v.email.parse().map_err(err)?,
        ));
    }
    for v in archive::addresses(&c.cc.replace(['，', '；'], ","))? {
        builder = builder.cc(lettre::message::Mailbox::new(
            if v.name.is_empty() {
                None
            } else {
                Some(v.name)
            },
            v.email.parse().map_err(err)?,
        ));
    }
    for v in archive::addresses(&c.bcc.replace(['，', '；'], ","))? {
        builder = builder.bcc(lettre::message::Mailbox::new(
            if v.name.is_empty() {
                None
            } else {
                Some(v.name)
            },
            v.email.parse().map_err(err)?,
        ));
    }
    let mut parts = if c.html.trim().is_empty() {
        MultiPart::mixed().singlepart(SinglePart::plain(c.body.clone()))
    } else {
        MultiPart::mixed().multipart(MultiPart::alternative_plain_html(
            c.body.clone(),
            c.html.clone(),
        ))
    };
    let mut total = 0usize;
    for path in &c.attachments {
        let p = std::path::Path::new(path);
        let bytes = std::fs::read(p).map_err(err)?;
        total += bytes.len();
        if total > 50 * 1024 * 1024 {
            return Err("开发版单封附件总大小上限为 50 MB".into());
        }
        parts = parts.singlepart(
            Attachment::new(
                p.file_name()
                    .ok_or("附件路径无效")?
                    .to_string_lossy()
                    .into(),
            )
            .body(
                bytes,
                ContentType::parse("application/octet-stream").map_err(err)?,
            ),
        );
    }
    builder.multipart(parts).map_err(err)
}
pub fn send(store: &Store, c: &Compose) -> Result<String> {
    let db = store.db()?;
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM outbox WHERE id=?1)",
            [&c.id],
            |r| r.get(0),
        )
        .map_err(err)?;
    if exists {
        return Err("这封邮件已有发送记录，请在发送记录中检查状态或准备重发".into());
    }
    let a = store.account(&c.account_id)?;
    if !a.enabled {
        return Err("此账号已暂停，请先启用".into());
    }
    let message = build_message(&a, c)?;
    let secret = auth::credentials(&a)?;
    let transport = smtp(&a, &secret)?;
    let raw = message.formatted();
    store.save_draft(c)?;
    db.execute(
        "INSERT INTO outbox(id,status,data,raw,updated_at) VALUES(?1,'sending',?2,?3,?4)",
        rusqlite::params![
            c.id,
            serde_json::to_string(c).map_err(err)?,
            raw,
            chrono::Utc::now().to_rfc3339()
        ],
    )
    .map_err(err)?;
    if let Err(e) = transport.send(&message) {
        let status = if e.is_permanent() || e.is_transient() {
            "failed"
        } else {
            "uncertain"
        };
        db.execute(
            "UPDATE outbox SET status=?2,error=?3,updated_at=?4 WHERE id=?1",
            rusqlite::params![c.id, status, e.to_string(), chrono::Utc::now().to_rfc3339()],
        )
        .map_err(err)?;
        return Err(format!(
            "发送未完成：{e}。草稿和发送记录已保留，请检查发送记录。"
        ));
    }
    db.execute(
        "UPDATE outbox SET status='sent',updated_at=?2 WHERE id=?1",
        rusqlite::params![c.id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(err)?;
    let saved = store.ingest(&a, "Sent", &c.id, &raw, true);
    db.execute("DELETE FROM drafts WHERE id=?1", [&c.id])
        .map_err(err)?;
    match saved {
        Ok(_) => Ok("邮件已提交 SMTP，本地已发送副本已保存".into()),
        Err(e) => Ok(format!(
            "邮件已提交 SMTP，但本地归档失败：{e}。原始邮件仍保存在发件记录中，请勿重复发送。"
        )),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};
    use std::sync::{Arc, Mutex};

    #[derive(Debug)]
    struct ImapTranscript {
        responses: Cursor<Vec<u8>>,
        commands: Arc<Mutex<Vec<u8>>>,
    }
    impl Read for ImapTranscript {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.responses.read(buf)
        }
    }
    impl Write for ImapTranscript {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.commands.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    // Exercise the real IMAP parser and command generation, without live
    // credentials. raw=None can represent an already archived UID.
    fn imap_round(
        store: &Store,
        validity: Option<u32>,
        status_response: &str,
        uid: Option<u32>,
        raw: Option<&[u8]>,
    ) -> (Result<u32>, String) {
        imap_round_with_size(store, validity, status_response, uid, raw, None)
    }

    fn imap_round_with_size(
        store: &Store,
        validity: Option<u32>,
        status_response: &str,
        uid: Option<u32>,
        raw: Option<&[u8]>,
        declared_size: Option<u32>,
    ) -> (Result<u32>, String) {
        let mut responses =
            b"a1 OK Logged in\r\n* LIST () \"/\" \"INBOX\"\r\na2 OK LIST completed\r\n".to_vec();
        responses.extend_from_slice(b"* FLAGS (\\Seen)\r\n");
        responses
            .extend_from_slice(format!("* {} EXISTS\r\n", u32::from(uid.is_some())).as_bytes());
        if let Some(v) = validity {
            responses
                .extend_from_slice(format!("* OK [UIDVALIDITY {v}] UIDs valid\r\n").as_bytes());
        }
        responses.extend_from_slice(b"a3 OK [READ-ONLY] EXAMINE completed\r\n");
        let mut tag = 4;
        responses.extend_from_slice(
            format!(
                "* SEARCH{}\r\na{tag} OK SEARCH completed\r\n",
                uid.map(|u| format!(" {u}")).unwrap_or_default()
            )
            .as_bytes(),
        );
        if validity.unwrap_or(0) == 0 && uid.is_some() {
            responses.extend_from_slice(status_response.as_bytes());
            tag += 1;
        }
        if let (Some(uid), Some(raw)) = (uid, raw) {
            tag += 1;
            responses.extend_from_slice(
                format!(
                    "* 1 FETCH (UID {uid} FLAGS () RFC822.SIZE {} BODY[] {{{}}}\r\n",
                    declared_size.unwrap_or(raw.len() as u32),
                    raw.len()
                )
                .as_bytes(),
            );
            responses.extend_from_slice(raw);
            responses.extend_from_slice(format!(")\r\na{tag} OK FETCH completed\r\n").as_bytes());
        }
        let commands = Arc::new(Mutex::new(Vec::new()));
        let stream = ImapTranscript {
            responses: Cursor::new(responses),
            commands: commands.clone(),
        };
        let mut session = imap::Client::new(stream)
            .login("test", "fixture-only")
            .unwrap();
        let result = sync_imap(store, &crate::tests::account(), &mut session);
        let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        (result, written)
    }

    #[test]
    fn empty_status_attributes_keep_connection_and_archive_nonempty_folder() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let raw = crate::tests::raw();
        let status = "* STATUS INBOX ()\r\na5 OK STATUS completed\r\n";
        let (result, commands) = imap_round(&store, None, status, Some(7), Some(&raw));
        assert_eq!(result.unwrap(), 1);
        assert!(commands.contains("UID FETCH"));
        assert_eq!(
            imap_round(&store, None, status, Some(7), Some(&raw))
                .0
                .unwrap(),
            0
        );
        assert_eq!(store.snapshot(&crate::tests::query()).unwrap().matched, 1);
    }

    #[test]
    fn empty_mailbox_does_not_query_unsupported_status() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let (result, commands) = imap_round(
            &store,
            None,
            "* STATUS INBOX ()\r\na5 OK STATUS completed\r\n",
            None,
            None,
        );
        assert_eq!(result.unwrap(), 0);
        assert!(commands.contains("UID SEARCH ALL"));
        assert!(!commands.contains("STATUS"));
    }

    #[test]
    fn missing_examine_validity_uses_status_and_keeps_incremental_sync() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let raw = crate::tests::raw();
        let status = "* STATUS INBOX (UIDVALIDITY 4321)\r\na5 OK STATUS completed\r\n";
        let (result, commands) = imap_round(&store, None, status, Some(7), Some(&raw));
        assert_eq!(result.unwrap(), 1);
        assert!(store.has_source("test-account", "INBOX", "4321:7").unwrap());
        assert!(commands.contains("STATUS \"INBOX\" (UIDVALIDITY)"));
        let (result, commands) = imap_round(&store, None, status, Some(7), None);
        assert_eq!(result.unwrap(), 0);
        assert!(!commands.contains("UID FETCH"));
    }

    #[test]
    fn normal_validity_remains_incremental_and_rollover_preserves_one_archive() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let raw = crate::tests::raw();
        let (result, commands) = imap_round(&store, Some(100), "", Some(7), Some(&raw));
        assert_eq!(result.unwrap(), 1);
        assert!(!commands.contains(" STATUS "));
        assert_eq!(
            imap_round(&store, Some(100), "", Some(7), None).0.unwrap(),
            0
        );
        // Server recreates the mailbox: re-fetch even if the UID stays the same.
        let (result, commands) = imap_round(&store, Some(101), "", Some(7), Some(&raw));
        assert_eq!(result.unwrap(), 0);
        assert!(commands.contains("UID FETCH"));
        assert_eq!(store.snapshot(&crate::tests::query()).unwrap().matched, 1);
        assert!(store.has_source("test-account", "INBOX", "101:7").unwrap());
    }

    #[test]
    fn absent_or_zero_validity_refetches_deduplicates_and_handles_uid_reuse() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        let raw = crate::tests::raw();
        let no_status = "a5 NO STATUS unsupported\r\n";
        assert_eq!(
            imap_round(&store, None, no_status, Some(7), Some(&raw))
                .0
                .unwrap(),
            1
        );
        let zero_status = "* STATUS INBOX (UIDVALIDITY 0)\r\na5 OK STATUS completed\r\n";
        let (result, commands) = imap_round(&store, Some(0), zero_status, Some(7), Some(&raw));
        assert_eq!(result.unwrap(), 0);
        assert!(commands.contains("BODY.PEEK[]"));
        assert!(!commands.contains(" STORE "));
        assert!(!commands.contains("EXPUNGE"));
        // Same UID can identify different content when the namespace is unknown.
        let changed = String::from_utf8(raw.clone())
            .unwrap()
            .replace("Project invoice", "New invoice")
            .into_bytes();
        assert_eq!(
            imap_round(&store, None, no_status, Some(7), Some(&changed))
                .0
                .unwrap(),
            1
        );
        let local = store.snapshot(&crate::tests::query()).unwrap();
        assert_eq!(local.matched, 2);
        let mut inbox = crate::tests::query();
        inbox.view = "all".into();
        let current = store.snapshot(&inbox).unwrap();
        assert_eq!(current.matched, 1);
        assert_eq!(current.messages[0].subject, "New invoice");
        let old = local
            .messages
            .iter()
            .find(|m| m.subject == "Project invoice")
            .unwrap();
        assert_eq!(archive::read_raw(d.path(), &old.hash).unwrap(), raw);
        assert_eq!(
            imap_round(&store, None, no_status, None, None).0.unwrap(),
            0
        );
        assert_eq!(store.snapshot(&inbox).unwrap().matched, 0);
        assert_eq!(store.snapshot(&crate::tests::query()).unwrap().matched, 2);
    }

    #[test]
    fn status_from_another_mailbox_cannot_set_inbox_namespace() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let raw = crate::tests::raw();
        let status = "* STATUS Archive (UIDVALIDITY 9876)\r\na5 OK STATUS completed\r\n";
        assert_eq!(
            imap_round(&store, None, status, Some(7), Some(&raw))
                .0
                .unwrap(),
            1
        );
        assert!(!store.has_source("test-account", "INBOX", "9876:7").unwrap());
        assert!(store
            .has_source(
                "test-account",
                "INBOX",
                &format!("content:7:{}", archive::digest(&raw))
            )
            .unwrap());
    }

    #[test]
    fn status_transport_failure_preserves_existing_inbox_and_archive() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "100:7", &crate::tests::raw(), false)
            .unwrap();
        let (result, commands) = imap_round(&store, None, "* BYE disconnected\r\n", Some(7), None);
        assert!(result.unwrap_err().contains("INBOX"));
        assert!(!commands.contains("UID FETCH"));
        let mut inbox = crate::tests::query();
        inbox.view = "all".into();
        assert_eq!(store.snapshot(&inbox).unwrap().matched, 1);
        assert_eq!(store.snapshot(&crate::tests::query()).unwrap().matched, 1);
    }

    #[test]
    fn malformed_command_tag_cannot_kill_sync_worker_or_poison_its_gate() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let gate = Mutex::new(());
        {
            let _guard = gate.lock().unwrap();
            let (result, _) = imap_round(&store, None, "a99 OK wrong tag\r\n", Some(7), None);
            assert!(result.unwrap_err().contains("查询 UIDVALIDITY"));
        }
        assert!(gate.try_lock().is_ok());
        assert_eq!(
            imap_round(&store, Some(100), "", Some(7), Some(&crate::tests::raw()))
                .0
                .unwrap(),
            1
        );
    }

    #[test]
    fn complete_literal_with_inaccurate_metadata_archives_exact_body_and_attachment() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let raw = crate::tests::raw();
        let (result, _) =
            imap_round_with_size(&store, Some(100), "", Some(7), Some(&raw), Some(9999));
        assert_eq!(result.unwrap(), 1);
        let saved = store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .remove(0);
        assert_eq!(archive::read_raw(d.path(), &saved.hash).unwrap(), raw);
        let detail = store.detail(&saved.id).unwrap();
        assert_eq!(
            archive::attachment(&raw, detail.attachments[0].index).unwrap(),
            b"invoice content"
        );
        assert!(store
            .snapshot(&crate::tests::query())
            .unwrap()
            .logs
            .iter()
            .any(|l| l.contains("9999")));
    }

    #[test]
    fn incomplete_partial_or_missing_fetch_body_is_rejected() {
        assert!(parse_full_fetch(b"* 1 FETCH (UID 7 BODY[] {999}\r\nshort", 7).is_err());
        assert!(parse_full_fetch(b"* 1 FETCH (UID 7 BODY[]<0> {5}\r\nshort)\r\n", 7).is_err());
        assert!(parse_full_fetch(b"* 1 FETCH (UID 7 BODY[TEXT] {5}\r\nshort)\r\n", 7).is_err());
        assert!(parse_full_fetch(b"* 1 FETCH (UID 8 BODY[] {5}\r\nshort)\r\n", 7).is_err());
    }
    #[test]
    fn pop_dot_stuff_and_truncation() {
        let mut r = std::io::Cursor::new(b"hello\r\n..dot\r\n.\r\n");
        assert_eq!(pop_multiline(&mut r).unwrap(), b"hello\r\n.dot\r\n");
        assert!(pop_multiline(&mut std::io::Cursor::new(b"unfinished")).is_err());
    }
}
