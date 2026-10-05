use crate::{
    archive,
    auth::{self, Secret},
    idle::{ConnectionControl, MailboxActivity, ObservedStream, TimedStream},
    models::*,
    store::Store,
};
use base64::Engine;
use lettre::{
    message::{header::ContentType, Attachment, MultiPart, SinglePart},
    transport::smtp::authentication::{Credentials, Mechanism},
    Message, SmtpTransport, Transport,
};
use native_tls::{TlsConnector, TlsStream};
use scraper::{Html, Selector};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpStream, ToSocketAddrs},
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Arc, Mutex},
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
fn prepare_starttls(tcp: TcpStream) -> Result<TcpStream> {
    let mut reader = BufReader::new(tcp);
    fn line(reader: &mut BufReader<TcpStream>) -> Result<String> {
        let mut bytes = Vec::new();
        std::io::Read::take(&mut *reader, 64 * 1024)
            .read_until(b'\n', &mut bytes)
            .map_err(err)?;
        if bytes.is_empty() || !bytes.ends_with(b"\n") {
            return Err("IMAP STARTTLS 响应中断或超出大小限制".into());
        }
        String::from_utf8(bytes).map_err(err)
    }
    let greeting = line(&mut reader)?;
    let greeting_fields = greeting.split_whitespace().collect::<Vec<_>>();
    if greeting_fields.first() != Some(&"*")
        || !greeting_fields
            .get(1)
            .is_some_and(|s| s.eq_ignore_ascii_case("OK"))
    {
        return Err("IMAP STARTTLS 服务器问候无效".into());
    }
    reader
        .get_mut()
        .write_all(b"yxTLS STARTTLS\r\n")
        .map_err(err)?;
    reader.get_mut().flush().map_err(err)?;
    for _ in 0..100 {
        let line = line(&mut reader)?;
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.first() == Some(&"yxTLS") {
            if fields
                .get(1)
                .is_some_and(|status| status.eq_ignore_ascii_case("OK"))
            {
                return Ok(reader.into_inner());
            }
            return Err("服务器拒绝 IMAP STARTTLS 加密升级".into());
        }
        if line.to_ascii_uppercase().starts_with("* BYE") {
            break;
        }
    }
    Err("IMAP STARTTLS 响应无效".into())
}
fn imap_session_using<T: std::io::Read + Write>(
    a: &Account,
    s: &Secret,
    control: Option<&ConnectionControl>,
    wrap: impl FnOnce(TlsStream<TcpStream>) -> T,
) -> Result<imap::Session<T>> {
    let tcp = socket(&a.incoming_host, a.incoming_port)?;
    if let Some(control) = control {
        control.attach(&tcp)?;
    }
    let tls = TlsConnector::new().map_err(err)?;
    let starttls = a.incoming_tls == "starttls";
    let tcp = if starttls {
        prepare_starttls(tcp)?
    } else {
        tcp
    };
    let stream = tls.connect(&a.incoming_host, tcp).map_err(err)?;
    let mut client = imap::Client::new(wrap(stream));
    if !starttls {
        client.read_greeting().map_err(err)?;
    }
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
fn imap_session(a: &Account, s: &Secret) -> Result<imap::Session<TlsStream<TcpStream>>> {
    imap_session_using(a, s, None, |stream| stream)
}

// Ask for RFC 6154 attributes only when the server advertises SPECIAL-USE.
// A tagged NO/BAD is synchronized and permits ordinary LIST fallback;
// parse/transport errors must discard the connection instead.
fn discover_remote_folders<T: std::io::Read + Write>(
    account: &str,
    session: &mut imap::Session<T>,
) -> Result<Vec<RemoteFolder>> {
    let special_use = session.capabilities().map_err(err)?.iter().any(|cap| {
        matches!(cap, imap_proto::types::Capability::Atom(name) if name.eq_ignore_ascii_case("SPECIAL-USE"))
    });
    if special_use {
        match session.run_command_and_read_response("LIST \"\" \"*\" RETURN (SPECIAL-USE)") {
            Ok(response) => {
                let mut remaining = response.as_slice();
                let mut folders = Vec::new();
                while !remaining.is_empty() {
                    let (rest, response) = imap_proto::parse_response(remaining)
                        .map_err(|_| "特殊文件夹响应无法解析".to_string())?;
                    remaining = rest;
                    if let imap_proto::Response::MailboxData(imap_proto::MailboxDatum::List {
                        flags,
                        delimiter,
                        name,
                    }) = response
                    {
                        let mut folder = RemoteFolder {
                            account_id: account.into(),
                            name: name.into(),
                            display_name: crate::remote::display_name(name),
                            delimiter: delimiter.map(str::to_string),
                            selectable: !flags
                                .iter()
                                .any(|flag| flag.eq_ignore_ascii_case("\\Noselect")),
                            roles: crate::remote::folder_roles(
                                name,
                                delimiter,
                                flags.iter().copied(),
                            ),
                        };
                        crate::remote::normalize_folder(&mut folder);
                        folders.push(folder);
                    }
                }
                return Ok(folders);
            }
            Err(imap::error::Error::No(_) | imap::error::Error::Bad(_)) => {}
            Err(e) => return Err(format!("特殊文件夹查询失败：{e}")),
        }
    }
    Ok(session
        .list(None, Some("*"))
        .map_err(err)?
        .iter()
        .map(|name| crate::remote::listed_folder(account, name))
        .collect())
}

#[derive(Debug, PartialEq, Eq)]
pub enum WatchOutcome {
    Stopped,
    Unsupported,
}
fn watch_session<T: TimedStream>(
    session: &mut imap::Session<ObservedStream<T>>,
    activity: &Arc<Mutex<MailboxActivity>>,
    control: &ConnectionControl,
    mut ready: impl FnMut(),
    mut changed: impl FnMut(),
    idle_timeout: Duration,
) -> Result<WatchOutcome> {
    if !session.capabilities().map_err(|e| match e {
        other => format!("查询 IDLE 能力失败：{other}"),
    })?.iter().any(|cap| matches!(cap, imap_proto::types::Capability::Atom(name) if name.eq_ignore_ascii_case("IDLE"))) {
        return Ok(WatchOutcome::Unsupported);
    }
    session
        .examine("INBOX")
        .map_err(|e| format!("打开实时收件箱失败：{e}"))?;
    activity.lock().map_err(err)?.take_changed();
    let mut connected = false;
    while !control.stopped() {
        // Start listening before queueing a catch-up, covering the SELECT/IDLE gap.
        let idle = session.idle().map_err(|e| format!("启动 IDLE 失败：{e}"))?;
        if !connected {
            ready();
            changed();
            connected = true;
        }
        idle.wait_with_timeout(idle_timeout)
            .map_err(|e| format!("等待 IDLE 通知失败：{e}"))?;
        if control.stopped() {
            break;
        }
        if activity.lock().map_err(err)?.take_changed() {
            changed();
        }
    }
    Ok(WatchOutcome::Stopped)
}
pub fn watch_imap(
    a: &Account,
    secret: &Secret,
    control: &ConnectionControl,
    ready: impl FnMut(),
    changed: impl FnMut(),
) -> Result<WatchOutcome> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let activity = Arc::new(Mutex::new(MailboxActivity::default()));
        let observed = activity.clone();
        let mut session = imap_session_using(a, secret, Some(control), |stream| {
            ObservedStream::new(stream, observed)
        })?;
        watch_session(
            &mut session,
            &activity,
            control,
            ready,
            changed,
            Duration::from_secs(20 * 60),
        )
    }))
    .unwrap_or_else(|_| Err("服务器实时通知响应不兼容，继续使用定时补查".into()));
    control.clear();
    result
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
        Err(imap::error::Error::No(_)) | Err(imap::error::Error::Bad(_)) => {
            imap::types::Mailbox::default()
        }
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
    // Some servers clear the selected mailbox when STATUS is issued for it.
    // Restore read-only selection before SEARCH/FETCH. Never use CLOSE (which
    // can expunge messages), and reject a namespace rollover between queries.
    let reopened = session
        .examine(folder)
        .map_err(|e| format!("重新打开文件夹失败：{e}"))?;
    if let Some(current) = reopened.uid_validity.filter(|v| *v != 0) {
        if validity.is_some_and(|previous| previous != current) {
            return Err("文件夹在查询期间已重建，请重新收取".into());
        }
        validity = Some(current);
    }
    Ok(validity)
}

fn response_outline(data: &[u8]) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < data.len() && out.len() < 600 {
        match data[i] {
            b'"' => {
                i += 1;
                let start = i;
                let mut escaped = false;
                while i < data.len() {
                    if data[i] == b'\\' {
                        escaped = true;
                        i = (i + 2).min(data.len());
                    } else if data[i] == b'"' {
                        break;
                    } else {
                        i += 1;
                    }
                }
                let value = &data[start..i];
                let text = std::str::from_utf8(value);
                // Only fixed MIME grammar tokens can be shown. Parameters,
                // names, IDs, boundaries and dates remain redacted.
                const MIME_TOKENS: &[&str] = &[
                    "TEXT",
                    "PLAIN",
                    "HTML",
                    "APPLICATION",
                    "OCTET-STREAM",
                    "IMAGE",
                    "JPEG",
                    "PNG",
                    "GIF",
                    "MESSAGE",
                    "RFC822",
                    "MULTIPART",
                    "MIXED",
                    "ALTERNATIVE",
                    "RELATED",
                    "INLINE",
                    "ATTACHMENT",
                    "7BIT",
                    "8BIT",
                    "BINARY",
                    "BASE64",
                    "QUOTED-PRINTABLE",
                    "CHARSET",
                    "BOUNDARY",
                    "NAME",
                    "FILENAME",
                ];
                if !escaped
                    && text.is_ok_and(|s| MIME_TOKENS.contains(&s.to_ascii_uppercase().as_str()))
                {
                    out.push('"');
                    out.push_str(text.unwrap());
                    out.push('"');
                } else if text.is_err() {
                    out.push_str(&format!("\"<non-utf8:{} bytes>\"", value.len()));
                } else {
                    out.push_str("\"…\"");
                }
                if i < data.len() {
                    i += 1;
                }
            }
            b'{' => {
                if let Some(end) = data[i..].iter().position(|&b| b == b'}') {
                    let length = std::str::from_utf8(&data[i + 1..i + end])
                        .ok()
                        .and_then(|n| n.parse::<usize>().ok());
                    if let Some(length) = length {
                        let start = i + end + 1;
                        if data.get(start..start + 2) == Some(b"\r\n") {
                            out.push_str(&format!("{{{length}}}<literal>"));
                            i = (start + 2).saturating_add(length).min(data.len());
                            continue;
                        }
                    }
                }
                out.push('{');
                i += 1;
            }
            b'\r' | b'\n' => {
                out.push(' ');
                i += 1;
            }
            b if b.is_ascii_digit() || b.is_ascii_whitespace() || b"*()[]\\{}".contains(&b) => {
                out.push(b as char);
                i += 1;
            }
            _ => {
                let start = i;
                while i < data.len()
                    && (data[i].is_ascii_alphanumeric() || b"._-/".contains(&data[i]))
                {
                    i += 1;
                }
                if start == i {
                    i += 1;
                    out.push('?');
                    continue;
                }
                let atom = String::from_utf8_lossy(&data[start..i]);
                if [
                    "FETCH",
                    "UID",
                    "FLAGS",
                    "INTERNALDATE",
                    "RFC822.SIZE",
                    "BODYSTRUCTURE",
                    "BODY",
                    "HEADER",
                    "NIL",
                    "SEEN",
                    "ANSWERED",
                    "FLAGGED",
                    "DELETED",
                    "DRAFT",
                    "RECENT",
                ]
                .contains(&atom.to_ascii_uppercase().as_str())
                {
                    out.push_str(&atom);
                } else {
                    out.push_str("<atom>");
                }
            }
        }
    }
    out
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

#[cfg(test)]
fn sync_imap<T: std::io::Read + Write>(
    store: &Store,
    a: &Account,
    session: &mut imap::Session<T>,
) -> Result<u32> {
    sync_imap_with_updates(store, a, session, &|| {})
}
fn sync_imap_with_updates<T: std::io::Read + Write>(
    store: &Store,
    a: &Account,
    session: &mut imap::Session<T>,
    updated: &impl Fn(),
) -> Result<u32> {
    sync_imap_scope(store, a, session, updated, None)
}
fn sync_imap_scope<T: std::io::Read + Write>(
    store: &Store,
    a: &Account,
    session: &mut imap::Session<T>,
    updated: &impl Fn(),
    only: Option<&str>,
) -> Result<u32> {
    let mut count = 0;
    let remote_folders = discover_remote_folders(&a.id, session)?;
    store.save_remote_folders(&a.id, &remote_folders)?;
    let mut folders = remote_folders
        .iter()
        .filter(|folder| folder.selectable)
        .filter(|folder| only.is_some() || !crate::remote::excluded_from_auto_sync(folder))
        .map(|folder| folder.name.clone())
        .collect::<Vec<_>>();
    folders.sort_by_key(|f| !f.eq_ignore_ascii_case("INBOX"));
    for folder in folders {
        if only.is_some_and(|name| name != folder) {
            continue;
        }
        let folder_gate = crate::sync_control::folder_gate(&store.root, &a.id, &folder)?;
        let _folder_guard = folder_gate.lock().map_err(err)?;
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
            // Repair previously downloaded messages that had no Date header.
            // Batch requests avoid one network round trip per old message.
            if let Some(validity) = validity {
                let missing = store
                    .unknown_dates(&a.id, &folder)?
                    .into_iter()
                    .filter_map(|remote| {
                        remote
                            .strip_prefix(&format!("{validity}:"))
                            .and_then(|s| s.parse::<u32>().ok())
                    })
                    .collect::<Vec<_>>();
                for chunk in missing.chunks(100) {
                    let set = chunk
                        .iter()
                        .map(u32::to_string)
                        .collect::<Vec<_>>()
                        .join(",");
                    let response = session
                        .run_command_and_read_response(format!(
                            "UID FETCH {set} (UID INTERNALDATE)"
                        ))
                        .map_err(err)?;
                    for (uid, date) in internal_dates(&response)? {
                        store.set_server_date(
                            &a.id,
                            &folder,
                            &format!("{validity}:{uid}"),
                            &date,
                        )?;
                    }
                }
            }
            ids.sort_unstable();
            ids.reverse();
            let mut remote_ids = Vec::with_capacity(ids.len());
            for uid in ids {
                let current = store.account(&a.id)?;
                if !current.enabled || !current.same_connection(a) {
                    return Err("账号已暂停或连接配置已修改，停止旧收取任务".into());
                }
                let stable_remote = validity.map(|v| format!("{v}:{uid}"));
                if let Some(ref remote) = stable_remote {
                    if store.source_available(&current, &folder, remote)? {
                        remote_ids.push(remote.clone());
                        continue;
                    }
                }
                stage = format!("下载 UID {uid} 的完整邮件");
                let (fetched, full, latest) = loop {
                    let current = store.account(&a.id)?;
                    let full = current.save_locally;
                    stage = format!(
                        "下载 UID {uid} 的{}",
                        if full {
                            "完整邮件"
                        } else {
                            "邮件头与结构"
                        }
                    );
                    let fetched = session.run_command_and_read_response(
                        if full { format!("UID FETCH {uid} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])") }
                        else { format!("UID FETCH {uid} (UID FLAGS INTERNALDATE RFC822.SIZE BODYSTRUCTURE BODY.PEEK[HEADER])") }
                    ).map_err(|e| match e {
                        imap::error::Error::Parse(imap::error::ParseError::Invalid(data)) => {
                            let outline = response_outline(&data);
                            let _ = store.log(&format!("文件夹「{folder}」UID {uid} 协议诊断（正文与地址已隐藏）：{outline}"));
                            "服务器邮件响应格式不兼容，已保留诊断信息".into()
                        }
                        imap::error::Error::Parse(_) => "服务器邮件响应无效或未完整传输".into(),
                        other => err(other),
                    })?;
                    let latest = store.account(&a.id)?;
                    if !latest.enabled || !latest.same_connection(a) {
                        return Err("账号已暂停或连接配置已修改，停止旧收取任务".into());
                    }
                    // Never archive headers as a complete message if retention was
                    // enabled while this request was in flight; fetch the body first.
                    if latest.save_locally && !full {
                        continue;
                    }
                    break (fetched, full, latest);
                };
                let (raw, size, read) = if full {
                    parse_full_fetch(&fetched, uid)?
                } else {
                    parse_header_fetch(&fetched, uid)?
                };
                if let Some(size) = size.filter(|_| full) {
                    if raw.len() != size as usize {
                        store.log(&format!("文件夹「{folder}」UID {uid}：RFC822.SIZE 为 {size}，完整响应为 {} 字节；按完整响应保存", raw.len()))?;
                    }
                }
                let remote = stable_remote
                    .unwrap_or_else(|| format!("content:{uid}:{}", archive::digest(raw)));
                if store
                    .ingest(&latest, &folder, &remote, raw, read)
                    .map_err(|e| format!("UID {uid}：{e}"))?
                {
                    count += 1;
                    updated();
                }
                if !full {
                    let attachments = header_attachments(&fetched, uid)?;
                    store.set_remote_metadata(&a.id, &folder, &remote, size, attachments)?;
                }
                for (_, date) in internal_dates(&fetched)? {
                    store.set_server_date(&a.id, &folder, &remote, &date)?;
                }
                remote_ids.push(remote);
            }
            // Only replace the current server locations after every fetch and
            // archive write succeeds. Prior local MIME files always remain.
            let current = store.account(&a.id)?;
            if !current.enabled || !current.same_connection(a) {
                return Err("账号已暂停或连接配置已修改，停止旧收取任务".into());
            }
            store.reconcile_folder(&a.id, &folder, &remote_ids)
        };
        let result = catch_unwind(AssertUnwindSafe(&mut sync_folder)).unwrap_or_else(|_| {
            Err(format!(
                "{stage}时，邮件协议库处理响应异常；已下载的本地存档已保留"
            ))
        });
        result.map_err(|e| format!("文件夹「{folder}」{stage}失败：{e}"))?;
    }
    Ok(count)
}

pub fn sync_with_updates(store: &Store, a: &Account, updated: impl Fn()) -> Result<u32> {
    catch_unwind(AssertUnwindSafe(|| sync_inner(store, a, &updated))).unwrap_or_else(|_| {
        Err("邮件协议库处理响应异常；已下载的本地存档已保留，请重新收取".into())
    })
}

fn sync_inner(store: &Store, a: &Account, updated: &impl Fn()) -> Result<u32> {
    let secret = auth::credentials(a)?;
    let mut count = 0;
    if a.protocol == "imap" {
        let mut session = imap_session(a, &secret)?;
        let result = sync_imap_with_updates(store, a, &mut session, updated);
        if result.is_ok() {
            // A failed session may have unread responses. Close the socket
            // directly on errors instead of issuing another command on it.
            let _ = catch_unwind(AssertUnwindSafe(|| session.logout()));
        }
        count = result?;
    } else {
        let folder_gate = crate::sync_control::folder_gate(&store.root, &a.id, "INBOX")?;
        let _folder_guard = folder_gate.lock().map_err(err)?;
        let mut pop = pop_session(a, &secret)?;
        pop_command(&mut pop, "UIDL")?;
        let uidl = String::from_utf8(pop_multiline(&mut pop)?).map_err(err)?;
        let mut remote_ids = Vec::new();
        for line in uidl.lines().rev() {
            let columns = line.split_whitespace().collect::<Vec<_>>();
            if columns.len() != 2 || columns[0].parse::<u32>().is_err() {
                return Err("POP3 UIDL 响应无效".into());
            }
            remote_ids.push(columns[1].to_string());
            let current = store.account(&a.id)?;
            if store.source_available(&current, "INBOX", columns[1])? {
                continue;
            }
            pop_command(&mut pop, &format!("RETR {}", columns[0]))?;
            let raw = pop_multiline(&mut pop)?;
            let latest = store.account(&a.id)?;
            if store.ingest(&latest, "INBOX", columns[1], &raw, false)? {
                count += 1;
                updated();
            }
        }
        store.reconcile_folder(&a.id, "INBOX", &remote_ids)?;
        pop_command(&mut pop, "QUIT")?;
    }
    Ok(count)
}
fn inline_images(html: &str) -> Result<(String, Vec<SinglePart>, usize)> {
    let doc = Html::parse_document(html);
    let selector = Selector::parse("img[src]").map_err(err)?;
    let mut output = html.to_owned();
    let mut images = Vec::new();
    let mut sources = std::collections::HashSet::new();
    let mut total = 0usize;
    for image in doc.select(&selector) {
        let source = image.value().attr("src").unwrap_or_default();
        let Some(data) = source.strip_prefix("data:") else {
            continue;
        };
        let Some((mime, encoded)) = data.split_once(";base64,") else {
            continue;
        };
        if !mime.starts_with("image/") || !sources.insert(source.to_owned()) {
            continue;
        }
        let content_type = ContentType::parse(mime).map_err(err)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(err)?;
        total += bytes.len();
        if total > 50 * 1024 * 1024 {
            return Err("开发版单封附件总大小上限为 50 MB".into());
        }
        let cid = format!("yanxin-{}@local", uuid::Uuid::new_v4());
        output = output.replace(source, &format!("cid:{cid}"));
        images.push(Attachment::new_inline(cid).body(bytes, content_type));
    }
    Ok((output, images, total))
}

pub(crate) fn build_message(a: &Account, c: &Compose) -> Result<Message> {
    let mut builder = Message::builder()
        .from(a.email.parse().map_err(err)?)
        .message_id(Some(format!(
            "<{}@{}>",
            archive::digest(format!("{}\0{}", a.id, c.id).as_bytes()),
            a.email.rsplit('@').next().unwrap_or("yanxin.local")
        )))
        .subject(&c.subject);
    if !c.in_reply_to.is_empty() {
        if archive::message_ids(&c.in_reply_to) != vec![c.in_reply_to.clone()] {
            return Err("回复邮件标识无效".into());
        }
        builder = builder.in_reply_to(c.in_reply_to.clone());
        let mut references = c.references.clone();
        if !references.contains(&c.in_reply_to) {
            references.push(c.in_reply_to.clone());
        }
        if references.len() > 100
            || references
                .iter()
                .any(|id| archive::message_ids(id) != vec![id.clone()])
        {
            return Err("邮件对话引用无效".into());
        }
        builder = builder.references(references.join(" "));
    } else if !c.references.is_empty() {
        return Err("邮件引用缺少回复目标".into());
    }
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
    let body = c.delivery_body.as_deref().unwrap_or(&c.body);
    let html = c.delivery_html.as_deref().unwrap_or(&c.html);
    let (html, inline, mut total) = inline_images(html)?;
    let mut parts = if html.trim().is_empty() {
        MultiPart::mixed().singlepart(SinglePart::plain(body.to_owned()))
    } else if !inline.is_empty() {
        let mut related = MultiPart::related().singlepart(
            SinglePart::builder()
                .header(ContentType::TEXT_HTML)
                .body(html),
        );
        for image in inline {
            related = related.singlepart(image);
        }
        MultiPart::mixed().multipart(
            MultiPart::alternative()
                .singlepart(SinglePart::plain(body.to_owned()))
                .multipart(related),
        )
    } else {
        MultiPart::mixed().multipart(MultiPart::alternative_plain_html(body.to_owned(), html))
    };
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
    send_with(
        store,
        c,
        |account| smtp(account, &auth::credentials(account)?),
        |transport, message| {
            transport.send(message).map(|_| ()).map_err(|error| {
                let status = if error.is_permanent() || error.is_transient() {
                    "failed"
                } else {
                    "uncertain"
                };
                (status, error.to_string())
            })
        },
    )
}
// Injectable transport allows tests to verify submission and duplicate protection
// without sending a message to an actual mailbox.
pub(crate) fn send_with<T>(
    store: &Store,
    c: &Compose,
    prepare: impl FnOnce(&Account) -> Result<T>,
    deliver: impl FnOnce(T, &Message) -> std::result::Result<(), (&'static str, String)>,
) -> Result<String> {
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
    let transport = prepare(&a)?;
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
    if let Err((status, error)) = deliver(transport, &message) {
        db.execute(
            "UPDATE outbox SET status=?2,error=?3,updated_at=?4 WHERE id=?1",
            rusqlite::params![c.id, status, error, chrono::Utc::now().to_rfc3339()],
        )
        .map_err(err)?;
        return Err(format!(
            "发送未完成：{error}。草稿和发送记录已保留，请检查发送记录。"
        ));
    }
    db.execute(
        "UPDATE outbox SET status='sent',updated_at=?2 WHERE id=?1",
        rusqlite::params![c.id, chrono::Utc::now().to_rfc3339()],
    )
    .map_err(err)?;
    let mut sent_account = a.clone();
    sent_account.save_locally = true;
    let saved = store.ingest(&sent_account, "Sent", &c.id, &raw, true);
    db.execute("DELETE FROM drafts WHERE id=?1", [&c.id])
        .map_err(err)?;
    match saved {
        Ok(_) => Ok("邮件已提交 SMTP，本地已发送副本已保存".into()),
        Err(e) => Ok(format!(
            "邮件已提交 SMTP，但本地归档失败：{e}。原始邮件仍保存在发件记录中，请勿重复发送。"
        )),
    }
}

pub fn schedule(store: &Store, c: &Compose, at: &str) -> Result<()> {
    let a = store.account(&c.account_id)?;
    let message = build_message(&a, c)?;
    store.schedule_mail(c, &message.formatted(), at, chrono::Utc::now())
}

// MIME and attachments are frozen at scheduling time, independent of source files.
pub(crate) fn deliver_scheduled(
    store: &Store,
    scheduled: crate::scheduling::ScheduledMail,
    deliver: impl FnOnce(
        &lettre::address::Envelope,
        &[u8],
    ) -> std::result::Result<(), (&'static str, String)>,
) -> Result<String> {
    let c = &scheduled.draft;
    let a = store.account(&c.account_id)?;
    let recipients = [&c.to, &c.cc, &c.bcc]
        .into_iter()
        .map(|v| archive::addresses(&v.replace(['，', '；'], ",")))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .map(|v| v.email.parse::<lettre::Address>().map_err(err))
        .collect::<Result<Vec<_>>>()?;
    let envelope = lettre::address::Envelope::new(Some(a.email.parse().map_err(err)?), recipients)
        .map_err(err)?;
    if let Err((status, error)) = deliver(&envelope, &scheduled.raw) {
        store.finish_send(&c.id, status, &error)?;
        return Err(error);
    }
    store.finish_send(&c.id, "sent", "")?;
    let mut sent_account = a.clone();
    sent_account.save_locally = true;
    match store.ingest(&sent_account, "Sent", &c.id, &scheduled.raw, true) {
        Ok(_) => Ok("定时邮件已提交 SMTP，本地副本已保存".into()),
        Err(e) => Ok(format!(
            "SMTP 已确认，但本地归档失败：{e}，可从发送记录恢复副本"
        )),
    }
}
pub fn send_scheduled(
    store: &Store,
    scheduled: crate::scheduling::ScheduledMail,
) -> Result<String> {
    let id = scheduled.draft.id.clone();
    let transport = (|| {
        let a = store.account(&scheduled.draft.account_id)?;
        if !a.enabled {
            return Err("此账号已暂停".into());
        }
        smtp(&a, &auth::credentials(&a)?)
    })();
    let transport = match transport {
        Ok(t) => t,
        Err(e) => {
            store.finish_send(&id, "failed", &e)?;
            return Err(e);
        }
    };
    deliver_scheduled(store, scheduled, |envelope, raw| {
        transport.send_raw(envelope, raw).map(|_| ()).map_err(|e| {
            let status = if e.is_permanent() || e.is_transient() {
                "failed"
            } else {
                "uncertain"
            };
            (status, e.to_string())
        })
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};
    use std::sync::{Arc, Mutex};

    fn idle_round(mode: &'static str) -> (Result<WatchOutcome>, usize, Vec<String>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(socket);
            reader.get_mut().write_all(b"* OK Test IMAP\r\n").unwrap();
            let mut commands = Vec::new();
            let mut cycles = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                commands.push(line.trim().to_owned());
                let tag = line.split_whitespace().next().unwrap();
                let response = if line.contains("LOGIN") {
                    format!("{tag} OK Logged in\r\n")
                } else if line.contains("CAPABILITY") {
                    format!(
                        "* CAPABILITY {}\r\n{tag} OK Capabilities\r\n",
                        if mode == "unsupported" {
                            "IMAP4rev1"
                        } else if mode == "trailing-space" {
                            "IMAP4 IMAP4rev1 XLIST MOVE IDLE XAPPLEPUSHSERVICE NAMESPACE CHILDREN ID UIDPLUS "
                        } else {
                            "IMAP4rev1 idle"
                        }
                    )
                } else if line.contains("EXAMINE") {
                    format!("* FLAGS (\\Seen)\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] UIDs valid\r\n{tag} OK [READ-ONLY] Opened\r\n")
                } else if line.contains("IDLE") {
                    if mode == "rejected" {
                        reader
                            .get_mut()
                            .write_all(format!("{tag} NO IDLE disabled\r\n").as_bytes())
                            .unwrap();
                        break;
                    }
                    reader.get_mut().write_all(b"+ idling\r\n").unwrap();
                    if mode == "disconnected" {
                        break;
                    }
                    if mode == "keepalive" && cycles == 0 {
                        for _ in 0..8 {
                            reader.get_mut().write_all(b"* OK Still here\r\n").unwrap();
                            std::thread::sleep(Duration::from_millis(10));
                        }
                    } else {
                        reader
                            .get_mut()
                            .write_all(match cycles {
                                0 => b"* 1 EXISTS\r\n" as &[u8],
                                1 if mode != "keepalive" => b"* OK Still here\r\n* 0 RECENT\r\n",
                                _ => b"* 2 EXISTS\r\n",
                            })
                            .unwrap();
                    }
                    let mut done = String::new();
                    reader.read_line(&mut done).unwrap();
                    assert_eq!(done, "DONE\r\n");
                    commands.push("DONE".into());
                    cycles += 1;
                    format!("{tag} OK Idle completed\r\n")
                } else {
                    panic!("unexpected command: {line}")
                };
                reader.get_mut().write_all(response.as_bytes()).unwrap();
            }
            commands
        });
        let socket = TcpStream::connect(address).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let control = ConnectionControl::default();
        control.attach(&socket).unwrap();
        let activity = Arc::new(Mutex::new(MailboxActivity::default()));
        let mut client = imap::Client::new(ObservedStream::new(socket, activity.clone()));
        client.read_greeting().unwrap();
        let mut session = client.login("test", "test").map_err(|(e, _)| e).unwrap();
        let mut changes = 0;
        let result = watch_session(
            &mut session,
            &activity,
            &control,
            || {},
            || {
                changes += 1;
                if changes == 2 {
                    control.stop();
                }
            },
            if mode == "keepalive" {
                Duration::from_millis(25)
            } else {
                Duration::from_secs(1)
            },
        );
        control.stop();
        drop(session);
        (result, changes, server.join().unwrap())
    }
    #[test]
    fn idle_push_queues_catchup_and_new_mail_but_ignores_repeated_counts_and_keepalives() {
        let (result, changes, commands) = idle_round("notifications");
        assert_eq!(result.unwrap(), WatchOutcome::Stopped);
        assert_eq!(changes, 2);
        assert_eq!(commands.iter().filter(|c| c.ends_with("IDLE")).count(), 3);
        assert_eq!(commands.iter().filter(|c| *c == "DONE").count(), 3);
    }
    #[test]
    fn tencent_post_login_capability_trailing_space_keeps_connection_usable_for_idle() {
        let (result, changes, commands) = idle_round("trailing-space");
        assert_eq!(result.unwrap(), WatchOutcome::Stopped);
        assert_eq!(changes, 2);
        assert!(commands.iter().any(|c| c.ends_with("IDLE")));
    }
    #[test]
    fn idle_capability_is_required_and_server_rejection_or_disconnect_is_recoverable() {
        let (result, changes, commands) = idle_round("unsupported");
        assert_eq!(result.unwrap(), WatchOutcome::Unsupported);
        assert_eq!(changes, 0);
        assert!(!commands.iter().any(|c| c.ends_with("IDLE")));
        for mode in ["rejected", "disconnected"] {
            assert!(idle_round(mode).0.is_err());
        }
    }
    #[test]
    fn idle_renewal_uses_a_deadline_even_if_server_sends_periodic_keepalive_lines() {
        let (result, changes, commands) = idle_round("keepalive");
        assert_eq!(result.unwrap(), WatchOutcome::Stopped);
        assert_eq!(changes, 2);
        assert_eq!(commands.iter().filter(|c| c.ends_with("IDLE")).count(), 2);
    }
    #[test]
    fn starttls_never_returns_a_plain_connection_after_rejection() {
        for accepted in [true, false] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (socket, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(socket);
                reader
                    .get_mut()
                    .write_all(b"* OK [CAPABILITY IMAP4rev1 STARTTLS] Server ready\r\n")
                    .unwrap();
                let mut command = String::new();
                reader.read_line(&mut command).unwrap();
                assert_eq!(command, "yxTLS STARTTLS\r\n");
                reader
                    .get_mut()
                    .write_all(if accepted {
                        b"yxTLS OK Begin TLS\r\n"
                    } else {
                        b"yxTLS NO Denied\r\n"
                    })
                    .unwrap();
            });
            assert_eq!(
                prepare_starttls(TcpStream::connect(address).unwrap()).is_ok(),
                accepted
            );
            server.join().unwrap();
        }
    }

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

    fn discovery_round(responses: &[u8]) -> (Result<Vec<RemoteFolder>>, String) {
        let commands = Arc::new(Mutex::new(Vec::new()));
        let stream = ImapTranscript {
            responses: Cursor::new(responses.to_vec()),
            commands: commands.clone(),
        };
        let mut session = imap::Client::new(stream)
            .login("test", "fixture-only")
            .unwrap();
        let result = discover_remote_folders("test-account", &mut session);
        let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        (result, written)
    }
    #[test]
    fn special_use_discovery_requests_all_folders_and_maps_authoritative_attributes() {
        let (folders, commands) = discovery_round(b"a1 OK Login\r\n* CAPABILITY IMAP4rev1 SPECIAL-USE\r\na2 OK Capabilities\r\n* LIST (\\Sent) \"/\" \"History\"\r\n* LIST (\\Noselect) \"/\" \"Projects\"\r\n* LIST () \"/\" \"Projects/Sent\"\r\n* LIST (\\All) \"/\" \"[Gmail]/All Mail\"\r\na3 OK Listed\r\n");
        let folders = folders.unwrap();
        assert_eq!(folders.len(), 4);
        assert_eq!(folders[0].roles, vec![FolderRole::Sent]);
        assert_eq!(folders[0].display_name, "已发送");
        assert_eq!(folders[0].name, "History");
        assert!(!folders[1].selectable);
        assert!(folders[2].roles.is_empty());
        assert_eq!(folders[3].roles, vec![FolderRole::All]);
        assert!(commands.contains("LIST \"\" \"*\" RETURN (SPECIAL-USE)"));
        assert!(!commands.contains("LIST (SPECIAL-USE)"));
    }
    #[test]
    fn ordinary_list_keeps_special_flags_without_extension_capability() {
        let (folders, commands) = discovery_round(b"a1 OK Login\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST (\\Junk) \"/\" \"Custom spam folder\"\r\na3 OK Listed\r\n");
        assert_eq!(folders.unwrap()[0].roles, vec![FolderRole::Junk]);
        assert!(!commands.contains("RETURN"));
    }
    #[test]
    fn rejected_extended_list_falls_back_only_after_tagged_completion() {
        for status in ["NO", "BAD"] {
            let responses = format!("a1 OK Login\r\n* CAPABILITY IMAP4rev1 SPECIAL-USE\r\na2 OK Capabilities\r\na3 {status} Extension unavailable\r\n* LIST () \"/\" \"INBOX\"\r\na4 OK Listed\r\n");
            let (folders, commands) = discovery_round(responses.as_bytes());
            assert_eq!(folders.unwrap()[0].roles, vec![FolderRole::Inbox]);
            assert!(commands.contains("a4 LIST \"\" *\r\n"));
        }
    }
    #[test]
    fn malformed_extended_list_does_not_reuse_desynchronized_connection() {
        let (result, commands) = discovery_round(b"a1 OK Login\r\n* CAPABILITY IMAP4rev1 SPECIAL-USE\r\na2 OK Capabilities\r\n* LIST (\\Sent) \"/\" \"unfinished\r\n");
        assert!(result.is_err());
        assert!(!commands.contains("a4"));
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
        if store.account("test-account").is_err() {
            store.save_account(&crate::tests::account()).unwrap();
        }
        let mut responses =
            b"a1 OK Logged in\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST () \"/\" \"INBOX\"\r\na3 OK LIST completed\r\n".to_vec();
        responses.extend_from_slice(b"* FLAGS (\\Seen)\r\n");
        responses
            .extend_from_slice(format!("* {} EXISTS\r\n", u32::from(uid.is_some())).as_bytes());
        if let Some(v) = validity {
            responses
                .extend_from_slice(format!("* OK [UIDVALIDITY {v}] UIDs valid\r\n").as_bytes());
        }
        responses.extend_from_slice(b"a4 OK [READ-ONLY] EXAMINE completed\r\n");
        let mut tag = 5;
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
            responses.extend_from_slice(
                format!(
                    "* FLAGS (\\Seen)\r\n* 1 EXISTS\r\na{} OK [READ-ONLY] EXAMINE completed\r\n",
                    tag + 1
                )
                .as_bytes(),
            );
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
        let status = "* STATUS INBOX ()\r\na6 OK STATUS completed\r\n";
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
            "* STATUS INBOX ()\r\na6 OK STATUS completed\r\n",
            None,
            None,
        );
        assert_eq!(result.unwrap(), 0);
        assert!(commands.contains("UID SEARCH ALL"));
        assert!(!commands.contains("STATUS"));
    }

    #[test]
    fn status_clearing_selection_is_reopened_even_when_status_is_unsupported() {
        for unsupported in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::new(dir.path().into()).unwrap();
            let account = crate::tests::account();
            store.save_account(&account).unwrap();
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut reader = BufReader::new(socket);
                let mut selected = false;
                let mut commands = Vec::new();
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    commands.push(line.trim().to_owned());
                    let tag = line.split_whitespace().next().unwrap();
                    let response = if line.contains("LOGIN") {
                        format!("{tag} OK Login completed\r\n").into_bytes()
                    } else if line.contains("CAPABILITY") {
                        format!("* CAPABILITY IMAP4rev1\r\n{tag} OK Capabilities\r\n").into_bytes()
                    } else if line.contains("LIST") {
                        format!("* LIST () \"/\" \"INBOX\"\r\n{tag} OK List completed\r\n")
                            .into_bytes()
                    } else if line.contains("EXAMINE") {
                        selected = true;
                        format!("* 1 EXISTS\r\n{tag} OK [READ-ONLY] Opened\r\n").into_bytes()
                    } else if line.contains("STATUS") {
                        selected = false;
                        if unsupported {
                            format!("{tag} NO STATUS unsupported\r\n").into_bytes()
                        } else {
                            format!(
                                "* STATUS INBOX (UIDVALIDITY 7)\r\n{tag} OK STATUS completed\r\n"
                            )
                            .into_bytes()
                        }
                    } else if !selected {
                        format!("{tag} NO Need to SELECT first!\r\n").into_bytes()
                    } else if line.contains("UID SEARCH") {
                        format!("* SEARCH 8\r\n{tag} OK SEARCH completed\r\n").into_bytes()
                    } else if line.contains("UID FETCH") {
                        let raw = crate::tests::raw();
                        let mut response = format!(
                            "* 1 FETCH (UID 8 FLAGS () RFC822.SIZE {} BODY[] {{{}}}\r\n",
                            raw.len(),
                            raw.len()
                        )
                        .into_bytes();
                        response.extend(raw);
                        response.extend(format!(")\r\n{tag} OK FETCH completed\r\n").as_bytes());
                        response
                    } else {
                        panic!("unexpected test command");
                    };
                    reader.get_mut().write_all(&response).unwrap();
                }
                commands
            });
            let socket = TcpStream::connect(address).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut session = imap::Client::new(socket)
                .login("test", "fixture-only")
                .unwrap();
            assert_eq!(sync_imap(&store, &account, &mut session).unwrap(), 1);
            drop(session);
            let commands = server.join().unwrap();
            let status = commands
                .iter()
                .position(|command| command.contains("STATUS"))
                .unwrap();
            assert!(commands[status + 1].contains("EXAMINE \"INBOX\""));
            assert!(!commands
                .iter()
                .any(|command| command.contains("CLOSE") || command.contains("STORE")));
            assert_eq!(store.snapshot(&crate::tests::query()).unwrap().matched, 1);
        }
    }

    #[test]
    fn inbox_notification_never_opens_or_downloads_historical_folders() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::new(dir.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        let commands = Arc::new(Mutex::new(Vec::new()));
        let stream = ImapTranscript {
            responses: Cursor::new(b"a1 OK Logged in\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST () \"/\" \"Archive\"\r\n* LIST () \"/\" \"INBOX\"\r\na3 OK Listed\r\n* 0 EXISTS\r\na4 OK [READ-ONLY] Opened\r\n* SEARCH\r\na5 OK Searched\r\n".to_vec()),
            commands: commands.clone(),
        };
        let history_gate =
            crate::sync_control::folder_gate(&store.root, &account.id, "Archive").unwrap();
        let _history = history_gate.lock().unwrap();
        let mut session = imap::Client::new(stream)
            .login("test", "fixture-only")
            .unwrap();
        assert_eq!(
            sync_imap_scope(&store, &account, &mut session, &|| {}, Some("INBOX")).unwrap(),
            0
        );
        let commands = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert!(commands.contains("EXAMINE \"INBOX\""));
        assert!(!commands.contains("EXAMINE \"Archive\""));
        assert_eq!(store.remote_folders(Some(&account.id)).unwrap().len(), 2);
    }

    #[test]
    fn missing_examine_validity_uses_status_and_keeps_incremental_sync() {
        let d = tempfile::tempdir().unwrap();
        let store = Store::new(d.path().into()).unwrap();
        let raw = crate::tests::raw();
        let status = "* STATUS INBOX (UIDVALIDITY 4321)\r\na6 OK STATUS completed\r\n";
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
        let no_status = "a6 NO STATUS unsupported\r\n";
        assert_eq!(
            imap_round(&store, None, no_status, Some(7), Some(&raw))
                .0
                .unwrap(),
            1
        );
        let zero_status = "* STATUS INBOX (UIDVALIDITY 0)\r\na6 OK STATUS completed\r\n";
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
        let status = "* STATUS Archive (UIDVALIDITY 9876)\r\na6 OK STATUS completed\r\n";
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

fn internal_dates(response: &[u8]) -> Result<Vec<(u32, String)>> {
    let mut remaining = response;
    let mut out = Vec::new();
    while !remaining.is_empty() {
        let (rest, response) =
            imap_proto::parse_response(remaining).map_err(|_| "服务器日期响应无效")?;
        remaining = rest;
        if let imap_proto::Response::Fetch(_, attributes) = response {
            let uid = attributes.iter().find_map(|a| {
                if let imap_proto::AttributeValue::Uid(v) = a {
                    Some(*v)
                } else {
                    None
                }
            });
            let date = attributes.iter().find_map(|a| {
                if let imap_proto::AttributeValue::InternalDate(v) = a {
                    Some(*v)
                } else {
                    None
                }
            });
            if let (Some(uid), Some(date)) = (uid, date) {
                if let Ok(date) = chrono::DateTime::parse_from_str(date, "%d-%b-%Y %H:%M:%S %z") {
                    out.push((uid, date.to_rfc3339()));
                }
            }
        }
    }
    Ok(out)
}
fn parse_header_fetch(response: &[u8], uid: u32) -> Result<(&[u8], Option<u32>, bool)> {
    let mut remaining = response;
    let mut body = None;
    let mut size = None;
    let mut read = false;
    while !remaining.is_empty() {
        let (rest, response) =
            imap_proto::parse_response(remaining).map_err(|_| "服务器邮件头响应无效")?;
        remaining = rest;
        if let imap_proto::Response::Fetch(_, attributes) = response {
            if !attributes
                .iter()
                .any(|a| matches!(a,imap_proto::AttributeValue::Uid(v) if *v==uid))
            {
                continue;
            }
            for a in attributes {
                match a {
                    imap_proto::AttributeValue::BodySection {
                        data: Some(raw),
                        index: None,
                        ..
                    } => body = Some(raw),
                    imap_proto::AttributeValue::Rfc822Size(v) => size = Some(v),
                    imap_proto::AttributeValue::Flags(flags) => read = flags.contains(&"\\Seen"),
                    _ => {}
                }
            }
        }
    }
    Ok((body.ok_or("服务器未返回邮件头")?, size, read))
}
pub fn folder_list(store: &Store, a: &Account) -> Result<Vec<RemoteFolder>> {
    if a.protocol == "pop3" {
        return Ok(vec![RemoteFolder {
            account_id: a.id.clone(),
            name: "INBOX".into(),
            display_name: "收件箱".into(),
            delimiter: None,
            selectable: true,
            roles: vec![FolderRole::Inbox],
        }]);
    }
    let mut session = imap_session(a, &auth::credentials(a)?)?;
    let folders = discover_remote_folders(&a.id, &mut session)?;
    session.logout().map_err(err)?;
    store.save_remote_folders(&a.id, &folders)?;
    Ok(folders)
}
pub fn sync_folder(store: &Store, a: &Account, folder: &str) -> Result<u32> {
    sync_folder_with_updates(store, a, folder, || {})
}
pub fn sync_folder_with_updates(
    store: &Store,
    a: &Account,
    folder: &str,
    updated: impl Fn(),
) -> Result<u32> {
    if a.protocol != "imap" {
        return sync_with_updates(store, a, updated);
    }
    let mut session = imap_session(a, &auth::credentials(a)?)?;
    let result = catch_unwind(AssertUnwindSafe(|| {
        sync_imap_scope(store, a, &mut session, &updated, Some(folder))
    }))
    .unwrap_or_else(|_| Err("邮件协议库处理响应异常；已下载的本地存档已保留".into()));
    if result.is_ok() {
        let _ = session.logout();
    }
    result
}
pub fn read_remote(store: &Store, a: &Account, mail: &Mail) -> Result<Vec<u8>> {
    let (folder, remote) = store.source(&mail.id)?;
    let secret = auth::credentials(a)?;
    let raw = if a.protocol == "imap" {
        let mut session = imap_session(a, &secret)?;
        let mailbox = session.examine(&folder).map_err(err)?;
        let mut pieces = remote.split(':');
        let first = pieces.next().ok_or("服务器邮件标识无效")?;
        let uid = pieces
            .next()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or("服务器邮件标识无效")?;
        if first != "content"
            && mailbox_uid_validity(&mut session, &folder, &mailbox)?
                .is_some_and(|v| first != v.to_string())
        {
            return Err("服务器文件夹已重建，请刷新后再打开邮件".into());
        }
        let response = session
            .run_command_and_read_response(format!(
                "UID FETCH {uid} (UID FLAGS RFC822.SIZE BODY.PEEK[])"
            ))
            .map_err(err)?;
        let raw = parse_full_fetch(&response, uid)?.0.to_vec();
        let _ = session.logout();
        raw
    } else {
        let mut pop = pop_session(a, &secret)?;
        pop_command(&mut pop, "UIDL")?;
        let uidl = String::from_utf8(pop_multiline(&mut pop)?).map_err(err)?;
        let number = uidl
            .lines()
            .find_map(|line| {
                let mut words = line.split_whitespace();
                let n = words.next()?;
                (words.next()? == remote)
                    .then(|| n.parse::<u32>().ok())
                    .flatten()
            })
            .ok_or("邮件已不在服务器上")?;
        pop_command(&mut pop, &format!("RETR {number}"))?;
        let raw = pop_multiline(&mut pop)?;
        let _ = pop_command(&mut pop, "QUIT");
        raw
    };
    let parsed = archive::parse(&raw, a, &folder)?.0;
    // UID reuse must not display an unrelated message in an old open tab.
    if !mail.message_id.is_empty() && parsed.message_id != mail.message_id {
        return Err("服务器邮件标识已变化，请刷新后重试".into());
    }
    if mail.message_id.is_empty() {
        let end = raw
            .windows(4)
            .position(|p| p == b"\r\n\r\n")
            .map(|i| i + 4)
            .unwrap_or(raw.len());
        if archive::digest(&raw[..end]) != mail.hash && archive::digest(&raw) != mail.hash {
            return Err("服务器邮件内容已变化，请刷新后重试".into());
        }
    }
    Ok(raw)
}

fn header_attachments(response: &[u8], uid: u32) -> Result<Option<bool>> {
    use imap_proto::{AttributeValue, BodyStructure, Response};
    fn contains(body: &BodyStructure<'_>) -> bool {
        let common = match body {
            BodyStructure::Basic { common, .. }
            | BodyStructure::Text { common, .. }
            | BodyStructure::Message { common, .. }
            | BodyStructure::Multipart { common, .. } => common,
        };
        if common
            .disposition
            .as_ref()
            .is_some_and(|d| d.ty.eq_ignore_ascii_case("attachment"))
            || common.ty.params.iter().flatten().any(|(key, _)| {
                key.eq_ignore_ascii_case("name") || key.eq_ignore_ascii_case("filename")
            })
        {
            return true;
        }
        match body {
            BodyStructure::Multipart { bodies, .. } => bodies.iter().any(contains),
            BodyStructure::Message { .. } => true,
            _ => false,
        }
    }
    let mut remaining = response;
    while !remaining.is_empty() {
        let (rest, response) =
            imap_proto::parse_response(remaining).map_err(|_| "服务器 MIME 结构响应无效")?;
        remaining = rest;
        if let Response::Fetch(_, attributes) = response {
            if attributes
                .iter()
                .any(|a| matches!(a,AttributeValue::Uid(v) if *v==uid))
            {
                if let Some(body) = attributes.iter().find_map(|a| {
                    if let AttributeValue::BodyStructure(body) = a {
                        Some(body)
                    } else {
                        None
                    }
                }) {
                    return Ok(Some(contains(body)));
                }
            }
        }
    }
    Ok(None)
}
#[cfg(test)]
mod remote_tests {
    use super::*;
    fn attachment_name_fixture(value: &[u8], literal: bool) -> (Vec<u8>, Vec<u8>) {
        let raw = b"From: sender@example.com\r\nSubject: Legacy attachment\r\nDate: Mon, 29 Mar 2021 17:48:00 +0800\r\n\r\n".to_vec();
        // Match the observed shape, with entirely synthetic names and headers.
        let mut response = b"* 706 FETCH (UID 1339 FLAGS (\\Seen) INTERNALDATE \"29-Mar-2021 17:48:00 +0800\" RFC822.SIZE 108692 BODYSTRUCTURE ((\"TEXT\" \"HTML\" (\"charset\" \"UTF-8\") NIL NIL \"BASE64\" 96788 1242 NIL NIL NIL)(\"APPLICATION\" \"OCTET-STREAM\" (\"name\" \"encoded-name\") \"synthetic-content-id\" NIL \"BASE64\" 9294 NIL (\"attachment\" (\"filename\" ".to_vec();
        if literal {
            response.extend_from_slice(format!("{{{}}}\r\n", value.len()).as_bytes());
            response.extend_from_slice(value);
        } else {
            response.push(b'"');
            response.extend_from_slice(value);
            response.push(b'"');
        }
        response.extend_from_slice(
            b")) NIL) \"MIXED\" (\"BOUNDARY\" \"synthetic-boundary\") NIL NIL) ",
        );
        response.extend_from_slice(format!("BODY[HEADER] {{{}}}\r\n", raw.len()).as_bytes());
        response.extend_from_slice(&raw);
        response.extend_from_slice(b")\r\na2 OK FETCH completed\r\n");
        (response, raw)
    }
    #[test]
    fn legacy_filename_metadata_keeps_headers_attachment_and_following_completion() {
        for literal in [false, true] {
            let (response, raw) = attachment_name_fixture(b"legacy_\xd6\xd0\xce\xc4.pdf", literal);
            let (headers, size, read) = parse_header_fetch(&response, 1339).unwrap();
            assert_eq!(headers, raw);
            assert_eq!(size, Some(108692));
            assert!(read);
            assert_eq!(header_attachments(&response, 1339).unwrap(), Some(true));
            assert_eq!(
                internal_dates(&response).unwrap()[0].1,
                "2021-03-29T17:48:00+08:00"
            );
            let (rest, _) = imap_proto::parse_response(&response).unwrap();
            assert!(imap_proto::parse_response(rest).unwrap().0.is_empty());
            // A header FETCH must still never be treated as complete MIME.
            assert!(parse_full_fetch(&response, 1339).is_err());
            assert!(response.windows(4).any(|v| v == b"\xd6\xd0\xce\xc4"));
        }
    }
    #[test]
    fn valid_utf8_filename_remains_exact_in_structure() {
        let filename = "测试附件.pdf";
        let (response, _) = attachment_name_fixture(filename.as_bytes(), false);
        let (_, imap_proto::Response::Fetch(_, attrs)) =
            imap_proto::parse_response(&response).unwrap()
        else {
            panic!("not FETCH")
        };
        let body = attrs
            .iter()
            .find_map(|a| match a {
                imap_proto::AttributeValue::BodyStructure(body) => Some(body),
                _ => None,
            })
            .unwrap();
        let imap_proto::BodyStructure::Multipart { bodies, .. } = body else {
            panic!("not multipart")
        };
        let imap_proto::BodyStructure::Basic { common, .. } = &bodies[1] else {
            panic!("not attachment")
        };
        assert_eq!(
            common
                .disposition
                .as_ref()
                .unwrap()
                .params
                .as_ref()
                .unwrap()[0],
            ("filename", filename)
        );
    }
    #[test]
    fn filename_compatibility_does_not_relax_other_parameters_or_encoding() {
        for structure in [
            b"* 1 FETCH (BODYSTRUCTURE (\"TEXT\" \"HTML\" (\"charset\" \"\xff\") NIL NIL \"BASE64\" 4 1))\r\n".as_slice(),
            b"* 1 FETCH (BODYSTRUCTURE ((\"TEXT\" \"HTML\" NIL NIL NIL \"7BIT\" 4 1) \"MIXED\" (\"boundary\" \"\xff\")))\r\n".as_slice(),
            b"* 1 FETCH (BODYSTRUCTURE (\"APPLICATION\" \"OCTET-STREAM\" NIL NIL NIL \"\xff\" 4))\r\n".as_slice(),
        ] {
            assert!(imap_proto::parse_response(structure).is_err());
        }
    }
    #[test]
    fn legacy_filename_compatibility_rejects_truncated_values_and_header_literals() {
        for literal in [false, true] {
            let (response, _) = attachment_name_fixture(b"legacy_\xff.pdf", literal);
            let start = response.windows(7).position(|v| v == b"legacy_").unwrap();
            assert!(imap_proto::parse_response(&response[..start + 8]).is_err());
            let header = response.windows(5).position(|v| v == b"From:").unwrap();
            assert!(imap_proto::parse_response(&response[..header + 10]).is_err());
        }
    }
    #[test]
    fn nil_transfer_encoding_keeps_multipart_headers_and_following_response() {
        use imap_proto::{
            parse_response, AttributeValue, BodyStructure, ContentEncoding, Response,
        };
        // Sanitized structure observed on Tencent: the plain alternative has
        // no Content-Transfer-Encoding header, reported as an unquoted NIL.
        let raw = b"From: sender@example.com\r\nSubject: Missing encoding\r\n\r\n";
        let mut response = b"* 1 FETCH (UID 12 FLAGS (\\Seen) RFC822.SIZE 5500 BODYSTRUCTURE ((\"TEXT\" \"PLAIN\" (\"charset\" \"UTF-8\" \"format\" \"flowed\" \"delsp\" \"yes\") NIL NIL NIL 364 12 NIL NIL NIL)(\"TEXT\" \"HTML\" (\"charset\" \"UTF-8\") NIL NIL \"QUOTED-PRINTABLE\" 664 12 NIL NIL NIL) \"ALTERNATIVE\" (\"BOUNDARY\" \"synthetic-boundary\") NIL NIL) ".to_vec();
        response.extend_from_slice(format!("BODY[HEADER] {{{}}}\r\n", raw.len()).as_bytes());
        response.extend_from_slice(raw);
        response.extend_from_slice(b")\r\n");
        let (headers, size, read) = parse_header_fetch(&response, 12).unwrap();
        assert_eq!(headers, raw);
        assert_eq!(size, Some(5500));
        assert!(read);
        assert_eq!(header_attachments(&response, 12).unwrap(), Some(false));
        let (_, parsed) = parse_response(&response).unwrap();
        let Response::Fetch(_, attributes) = parsed else {
            panic!("not a FETCH")
        };
        let parts = attributes
            .iter()
            .find_map(|attr| match attr {
                AttributeValue::BodyStructure(BodyStructure::Multipart { bodies, .. }) => {
                    Some(bodies)
                }
                _ => None,
            })
            .unwrap();
        let BodyStructure::Text { other, .. } = &parts[0] else {
            panic!("not TEXT")
        };
        assert_eq!(other.transfer_encoding, ContentEncoding::SevenBit);
        let BodyStructure::Text { other, .. } = &parts[1] else {
            panic!("not TEXT")
        };
        assert_eq!(other.transfer_encoding, ContentEncoding::QuotedPrintable);
        assert!(parse_response(&response[..response.len() - 5]).is_err());
        response.extend_from_slice(b"a7 OK FETCH completed\r\n");
        let (remaining, _) = parse_response(&response).unwrap();
        let (remaining, _) = parse_response(remaining).unwrap();
        assert!(remaining.is_empty());
    }
    #[test]
    fn headers_and_internal_dates_preserve_old_dates_without_full_download() {
        let raw = b"From: a@example.com\r\nSubject: Old mail\r\n\r\n";
        let mut response=format!("* 1 FETCH (UID 12 FLAGS (\\Seen) INTERNALDATE \"29-Mar-2021 17:48:00 +0800\" RFC822.SIZE 900 BODY[HEADER] {{{}}}\r\n",raw.len()).into_bytes();
        response.extend_from_slice(raw);
        response.extend_from_slice(b")\r\n");
        let (headers, size, read) = parse_header_fetch(&response, 12).unwrap();
        assert_eq!(headers, raw);
        assert_eq!(size, Some(900));
        assert!(read);
        assert_eq!(
            internal_dates(&response).unwrap()[0].1,
            "2021-03-29T17:48:00+08:00"
        );
        assert!(parse_full_fetch(&response, 12).is_err());
    }
}

#[cfg(test)]
mod diagnostic_tests {
    use super::*;
    #[test]
    fn protocol_outline_redacts_private_strings_and_mime_literals() {
        let data = b"* 3 FETCH (UID 42 BODYSTRUCTURE (\"TEXT\" \"private@example.com\" NIL) BODY[HEADER] {22}\r\nprivate mail content!! INTERNALDATE \"secret date\")\r\n";
        let result = response_outline(data);
        assert!(result.contains("UID 42"));
        assert!(result.contains("<literal>"));
        assert!(!result.contains("private"));
        assert!(!result.contains("secret"));
        assert!(!result.contains("example"));
    }
    #[test]
    fn protocol_outline_shows_only_fixed_mime_tokens_and_invalid_utf8_length() {
        let data = b"* 1 FETCH (BODYSTRUCTURE (\"IMAGE\" \"JPEG\" (\"NAME\" \"\xd6\xd0\xce\xc4.jpg\") NIL NIL \"BASE64\" 9294 NIL (\"INLINE\" (\"FILENAME\" \"secret.png\")) NIL))\r\n";
        let result = response_outline(data);
        assert!(result.contains("\"IMAGE\" \"JPEG\""));
        assert!(result.contains("\"NAME\" \"<non-utf8:8 bytes>\""));
        assert!(result.contains("\"BASE64\""));
        assert!(result.contains("\"INLINE\""));
        assert!(!result.contains("secret"));
        assert!(!result.contains(".jpg"));
        assert!(!result.contains(".png"));
    }
    #[test]
    fn protocol_outline_keeps_escaped_and_unterminated_values_private() {
        for data in [
            b"\"TEXT\\\"private\"".as_slice(),
            b"\"unclosed private".as_slice(),
        ] {
            assert!(!response_outline(data).contains("private"));
        }
    }
}
