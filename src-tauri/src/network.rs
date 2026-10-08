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
        let _ = session.run_command_and_check_ok(concat!(
            "ID (\"name\" \"Yanxin\" \"version\" \"",
            env!("CARGO_PKG_VERSION"),
            "\")"
        ));
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
                            detected_roles: None,
                            sync_error: None,
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
pub fn test_with_progress(a: &Account, s: &Secret, progress: &impl Fn(&str)) -> Result<()> {
    a.validate()?;
    progress("incoming");
    if a.protocol == "imap" {
        imap_session(a, s)?.logout().map_err(err)?;
    } else {
        let mut pop = pop_session(a, s)?;
        pop_command(&mut pop, "QUIT")?;
    }
    progress("smtp");
    if !smtp(a, s)?
        .test_connection()
        .map_err(|e| format!("收件成功，但 SMTP 连接失败：{e}"))?
    {
        return Err("SMTP 未通过连接测试".into());
    }
    Ok(())
}
// A tagged OK alone is not a successful mailbox selection. Some servers
// acknowledge a hierarchy container without the required EXISTS response; the
// library otherwise returns a default Mailbox and subsequent commands can read
// the previously selected directory. Keep presence distinct from EXISTS 0.
const INCONSISTENT_SELECTION: &str =
    "服务器报告该文件夹为空，但又返回邮件 UID，目录响应相互矛盾；已停止读取，原来源与本地存档保留";
const UNVERIFIED_EMPTY_SELECTION: &str =
    "目录先前响应异常，本次空目录响应仍缺少 UIDVALIDITY，无法核对旧来源；继续隔离并保留本地存档";
fn unreliable_selection(e: &str) -> bool {
    matches!(
        e,
        MISSING_SELECTION | INCONSISTENT_SELECTION | UNVERIFIED_EMPTY_SELECTION
    )
}
const MISSING_SELECTION: &str =
    "服务器未返回该文件夹的邮件数量，无法确认目录已打开；已停止读取，原来源与本地存档保留";
fn examine_verified<T: std::io::Read + Write>(
    session: &mut imap::Session<T>,
    folder: &str,
) -> Result<imap::types::Mailbox> {
    use imap_proto::{MailboxDatum, Response, ResponseCode};
    if folder.bytes().any(|b| matches!(b, b'\r' | b'\n' | 0)) {
        return Err("文件夹名称无效".into());
    }
    let quoted = folder.replace('\\', "\\\\").replace('"', "\\\"");
    let response = session
        .run_command_and_read_response(format!("EXAMINE \"{quoted}\""))
        .map_err(err)?;
    let mut remaining = response.as_slice();
    let mut mailbox = imap::types::Mailbox::default();
    let mut exists = false;
    while !remaining.is_empty() {
        let (rest, parsed) = imap_proto::parse_response(remaining)
            .map_err(|_| "打开文件夹的响应无效或未完整传输".to_string())?;
        remaining = rest;
        match parsed {
            Response::MailboxData(MailboxDatum::Exists(n)) => {
                mailbox.exists = n;
                exists = true;
            }
            Response::MailboxData(MailboxDatum::Recent(n)) => mailbox.recent = n,
            Response::MailboxData(MailboxDatum::Flags(flags)) => mailbox.flags.extend(
                flags
                    .into_iter()
                    .map(String::from)
                    .map(imap::types::Flag::from),
            ),
            Response::Data {
                code: Some(code), ..
            } => match code {
                ResponseCode::UidValidity(v) => mailbox.uid_validity = Some(v),
                ResponseCode::UidNext(v) => mailbox.uid_next = Some(v),
                ResponseCode::Unseen(v) => mailbox.unseen = Some(v),
                ResponseCode::PermanentFlags(flags) => mailbox.permanent_flags.extend(
                    flags
                        .into_iter()
                        .map(String::from)
                        .map(imap::types::Flag::from),
                ),
                _ => {}
            },
            _ => {}
        }
    }
    if !exists {
        return Err(MISSING_SELECTION.into());
    }
    Ok(mailbox)
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
    let reopened =
        examine_verified(session, folder).map_err(|e| format!("重新打开文件夹失败：{e}"))?;
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

// UID and FLAGS must occur together in the same FETCH. Missing FLAGS is not
// evidence that either flag was cleared; unsolicited/out-of-set rows are ignored
// by the caller, and malformed responses are rejected before any store update.
fn remote_flags(response: &[u8]) -> Result<Vec<(u32, bool, bool)>> {
    use imap_proto::{AttributeValue, Response};
    let mut remaining = response;
    let mut rows = Vec::new();
    while !remaining.is_empty() {
        let (rest, parsed) = imap_proto::parse_response(remaining)
            .map_err(|_| "服务器标记响应无效或未完整传输".to_string())?;
        remaining = rest;
        if let Response::Fetch(_, attributes) = parsed {
            let uid = attributes.iter().find_map(|a| match a {
                AttributeValue::Uid(v) if *v > 0 => Some(*v),
                _ => None,
            });
            let flags = attributes.iter().find_map(|a| match a {
                AttributeValue::Flags(v) => Some(v),
                _ => None,
            });
            if let (Some(uid), Some(flags)) = (uid, flags) {
                rows.push((
                    uid,
                    flags.iter().any(|f| f.eq_ignore_ascii_case("\\Seen")),
                    flags.iter().any(|f| f.eq_ignore_ascii_case("\\Flagged")),
                ));
            }
        }
    }
    Ok(rows)
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
    let mut selection_errors = Vec::new();
    let remote_folders = discover_remote_folders(&a.id, session)?;
    store.save_remote_folders(&a.id, &remote_folders)?;
    let remote_folders = store.remote_folders(Some(&a.id))?;
    let saved_folders = store
        .retention_overrides(&a.id)?
        .into_iter()
        .filter(|item| item.save_locally)
        .map(|item| item.folder)
        .collect::<std::collections::HashSet<_>>();
    let mut folders = remote_folders
        .iter()
        .filter(|folder| folder.selectable)
        .filter(|folder| {
            only.is_some()
                || saved_folders.contains(&folder.name)
                || !crate::remote::excluded_from_auto_sync(folder)
        })
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
        let mut evidence = crate::folder_health::SelectionEvidence::default();
        let mut sync_folder = || -> Result<()> {
            let mailbox = examine_verified(session, &folder)?;
            stage = "查询邮件 UID".into();
            let mut ids = session
                .uid_search("ALL")
                .map_err(err)?
                .into_iter()
                .collect::<Vec<_>>();
            // SEARCH may include a newer unsolicited EXISTS when mail arrived
            // after EXAMINE. Otherwise an empty mailbox returning UIDs cannot
            // safely identify this directory (observed on Tencent/QQ containers).
            let mut exists = mailbox.exists;
            for response in session.unsolicited_responses.try_iter() {
                if let imap::types::UnsolicitedResponse::Exists(n) = response {
                    exists = n;
                }
            }
            evidence.exists = Some(exists);
            evidence.uid_count = Some(ids.len());
            if exists == 0 && !ids.is_empty() {
                store.log(&format!("文件夹「{folder}」目录诊断：EXAMINE/EXISTS=0，UID SEARCH={} 项；未执行 FETCH，也未更新来源",ids.len()))?;
                return Err(INCONSISTENT_SELECTION.into());
            }
            // Empty mailboxes need no UID namespace. Tencent returns STATUS
            // () here, which older IMAP parsers cannot consume safely.
            if ids.is_empty() {
                if mailbox.uid_validity.filter(|v| *v > 0).is_none()
                    && store.folder_isolated_reason(&a.id, &folder)?.is_some()
                {
                    return Err(UNVERIFIED_EMPTY_SELECTION.into());
                }
                store.reconcile_folder(&a.id, &folder, &[])?;
                return store.restore_folder_trust(a, &folder);
            }
            stage = "查询 UIDVALIDITY".into();
            let validity = mailbox_uid_validity(session, &folder, &mailbox)?;
            if validity.is_none() {
                store.log(&format!(
                    "文件夹「{folder}」未提供 UIDVALIDITY，使用完整内容核对与去重（每次重新下载）；只读打开响应：EXISTS={}，FLAGS={} 项，UID SEARCH={} 项",
                    mailbox.exists, mailbox.flags.len(), ids.len()
                ))?;
            }
            let mut cached_flags = Vec::new();
            if let Some(validity) = validity {
                let cached = store.cached_flag_uids(a, &folder, validity)?;
                let cached = ids
                    .iter()
                    .copied()
                    .filter(|uid| cached.contains(uid))
                    .collect::<Vec<_>>();
                for chunk in cached.chunks(100) {
                    stage = "回读已读与星标状态".into();
                    let current = store.account(&a.id)?;
                    if !current.enabled || !current.same_connection(a) {
                        return Err("账号已暂停或连接配置已修改，停止旧收取任务".into());
                    }
                    let set = chunk
                        .iter()
                        .map(u32::to_string)
                        .collect::<Vec<_>>()
                        .join(",");
                    let fetched = session
                        .run_command_and_read_response(format!("UID FETCH {set} (UID FLAGS)"))
                        .map_err(err)?;
                    let flags = remote_flags(&fetched)?
                        .into_iter()
                        .filter(|(uid, _, _)| chunk.contains(uid))
                        .map(|(uid, read, star)| (format!("{validity}:{uid}"), read, star))
                        .collect::<Vec<_>>();
                    cached_flags.extend(flags);
                }
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
                    let full = store.should_save_folder(&current, &folder)?;
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
                    let mut latest = store.account(&a.id)?;
                    if !latest.enabled || !latest.same_connection(a) {
                        return Err("账号已暂停或连接配置已修改，停止旧收取任务".into());
                    }
                    // Never archive headers as a complete message if retention was
                    // enabled while this request was in flight; fetch the body first.
                    if store.should_save_folder(&latest, &folder)? && !full {
                        continue;
                    }
                    // This payload's completeness is independent of the account
                    // default. ingest rechecks current folder retention before saving.
                    latest.save_locally = full;
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
                let flags = remote_flags(&fetched)?
                    .into_iter()
                    .find(|(v, _, _)| *v == uid);
                let star = flags.is_some_and(|(_, _, star)| star);
                let read = flags.map_or(read, |(_, read, _)| read);
                // Only this verified MIME/header identity is eligible. New mail
                // receives initial flags before rules; existing mail merges after
                // its source has been (re)published, still under the folder gate.
                let is_new = store
                    .ingest_with_flags(&latest, &folder, &remote, raw, read, star)
                    .map_err(|e| format!("UID {uid}：{e}"))?;
                if is_new {
                    count += 1;
                    updated();
                } else if flags.is_some()
                    && store.merge_remote_flags(
                        &latest,
                        &folder,
                        &[(remote.clone(), read, star)],
                    )? > 0
                {
                    updated();
                }
                if flags.is_some() {
                    cached_flags.push((remote.clone(), read, star));
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
            store.reconcile_folder(&a.id, &folder, &remote_ids)?;
            store.restore_folder_trust(a, &folder)?;
            for chunk in cached_flags.chunks(100) {
                if store.merge_remote_flags(a, &folder, chunk)? > 0 {
                    updated();
                }
            }
            Ok(())
        };
        let result = catch_unwind(AssertUnwindSafe(&mut sync_folder)).unwrap_or_else(|_| {
            Err(format!(
                "{stage}时，邮件协议库处理响应异常；已下载的本地存档已保留"
            ))
        });
        if let Err(reason) = &result {
            if unreliable_selection(reason) {
                store.isolate_folder(a, &folder, reason, &evidence)?;
                updated();
            }
        }
        if only.is_none() && result.as_ref().is_err_and(|e| unreliable_selection(e)) {
            // This tagged OK response was fully consumed. Opening the next
            // folder is safe; transport/parse failures still abandon the socket.
            let message = format!("文件夹「{folder}」{stage}失败：{}", result.unwrap_err());
            store.log(&message)?;
            selection_errors.push(message);
            continue;
        }
        result.map_err(|e| format!("文件夹「{folder}」{stage}失败：{e}"))?;
    }
    if !selection_errors.is_empty() {
        return Err(format!(
            "{}；其余文件夹已继续检查，本次新增 {count} 封邮件",
            selection_errors.join("；")
        ));
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
    store.confirm_smtp(&a, &c.id)?;
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
    store.confirm_smtp(&a, &c.id)?;
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

    fn flag_round(
        responses: &[u8],
        remote: &str,
        action: &str,
        value: bool,
    ) -> (std::result::Result<(), crate::operations::Failure>, String) {
        let commands = Arc::new(Mutex::new(Vec::new()));
        let stream = ImapTranscript {
            responses: Cursor::new(responses.to_vec()),
            commands: commands.clone(),
        };
        let mut session = imap::Client::new(stream)
            .login("fixture", "fixture-only")
            .unwrap();
        let op = crate::operations::Operation {
            id: "fixture".into(),
            account_id: "fixture".into(),
            account_email: "fixture@example.com".into(),
            mail_id: "fixture".into(),
            subject: "fixture".into(),
            folder: "INBOX".into(),
            remote_id: remote.into(),
            action: action.into(),
            value,
            identity: String::new(),
            revision: 1,
            status: "queued".into(),
            attempts: 0,
            error: String::new(),
            updated_at: 0,
        };
        let result = apply_flag_session(&mut session, &op);
        let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        (result, written)
    }
    const FLAG_SELECT: &str = "a1 OK Login\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\na2 OK [READ-WRITE] Selected\r\n";
    #[test]
    fn flag_store_is_uid_scoped_additive_and_confirmed_without_expunge() {
        for (action, name, value, initial, final_flags) in [
            ("read", "\\Seen", true, "\\Flagged", "\\Seen \\Flagged"),
            ("star", "\\Flagged", false, "\\Seen \\Flagged", "\\Seen"),
        ] {
            let text=format!("{FLAG_SELECT}* 1 FETCH (UID 12 FLAGS ({initial}))\r\na3 OK Fetch\r\na4 OK Stored\r\n* 1 FETCH (UID 12 FLAGS ({final_flags}))\r\na5 OK Confirmed\r\n");
            let (result, written) = flag_round(text.as_bytes(), "7:12", action, value);
            assert!(result.is_ok());
            assert!(written.contains("a2 SELECT \"INBOX\""));
            assert!(written.contains(&format!(
                "UID STORE 12 {}FLAGS.SILENT ({name})",
                if value { "+" } else { "-" }
            )));
            assert_eq!(written.matches("UID FETCH 12 (UID FLAGS)").count(), 2);
            assert!(!written.contains("CLOSE"));
            assert!(!written.contains("EXPUNGE"));
            assert!(!written.contains("STATUS"));
        }
    }
    #[test]
    fn flags_already_matching_are_safe_after_an_uncertain_write() {
        let text = format!("{FLAG_SELECT}* 1 FETCH (UID 12 FLAGS (\\Seen))\r\na3 OK Fetch\r\n");
        let (result, written) = flag_round(text.as_bytes(), "7:12", "read", true);
        assert!(result.is_ok());
        assert!(!written.contains("STORE"));
    }
    #[test]
    fn namespace_rollover_absent_namespace_and_missing_uid_never_write() {
        for text in [
            FLAG_SELECT.replace("UIDVALIDITY 7", "UIDVALIDITY 8"),
            FLAG_SELECT.replace("* OK [UIDVALIDITY 7] valid\r\n", ""),
            format!("{FLAG_SELECT}a3 OK No mail\r\n"),
        ] {
            let (result, written) = flag_round(text.as_bytes(), "7:12", "read", true);
            assert!(matches!(
                result,
                Err(crate::operations::Failure::Blocked(_))
            ));
            assert!(!written.contains("STORE"));
        }
    }
    #[test]
    fn denied_flags_ignored_store_and_dropped_response_do_not_report_success() {
        let before = format!("{FLAG_SELECT}* 1 FETCH (UID 12 FLAGS ())\r\na3 OK Fetch\r\n");
        for (tail, retry) in [
            ("a4 NO readonly\r\n", false),
            (
                "a4 OK Stored\r\n* 1 FETCH (UID 12 FLAGS ())\r\na5 OK Ignored\r\n",
                false,
            ),
            ("", true),
        ] {
            let (result, _) =
                flag_round(format!("{before}{tail}").as_bytes(), "7:12", "read", true);
            assert!(matches!(result, Err(crate::operations::Failure::Retry(_))) == retry);
            assert!(result.is_err());
        }
        let denied =
            FLAG_SELECT.replace("a2 OK", "* OK [PERMANENTFLAGS (\\Flagged)] flags\r\na2 OK");
        let (result, written) = flag_round(denied.as_bytes(), "7:12", "read", true);
        assert!(result.is_err());
        assert!(!written.contains("STORE"));
    }
    #[test]
    fn content_namespaces_verify_original_mime_before_modifying_flags() {
        let mime = b"Subject: fixture\r\n\r\nOriginal body";
        let hash = archive::digest(mime);
        let mut responses = FLAG_SELECT.as_bytes().to_vec();
        responses.extend_from_slice(
            format!("* 1 FETCH (UID 12 BODY[] {{{}}}\r\n", mime.len()).as_bytes(),
        );
        responses.extend_from_slice(mime);
        responses.extend_from_slice(b")\r\na3 OK Original\r\n* 1 FETCH (UID 12 FLAGS ())\r\na4 OK Fetch\r\na5 OK Stored\r\n* 1 FETCH (UID 12 FLAGS (\\Seen))\r\na6 OK Confirmed\r\n");
        let (result, written) = flag_round(&responses, &format!("content:12:{hash}"), "read", true);
        assert!(result.is_ok());
        assert!(written.find("BODY.PEEK[]").unwrap() < written.find("STORE").unwrap());
        let wrong_hash = archive::digest(b"other mail");
        let end = responses
            .windows(b"* 1 FETCH (UID 12 FLAGS".len())
            .position(|w| w == b"* 1 FETCH (UID 12 FLAGS")
            .unwrap();
        responses.truncate(end);
        responses
            .extend_from_slice(b"* 1 FETCH (UID 12 BODY[HEADER] {0}\r\n)\r\na4 OK Headers\r\n");
        let (result, written) = flag_round(
            &responses,
            &format!("content:12:{wrong_hash}"),
            "read",
            true,
        );
        assert!(matches!(
            result,
            Err(crate::operations::Failure::Blocked(_))
        ));
        assert!(!written.contains("STORE"));
    }

    #[test]
    fn online_content_identity_can_match_headers_without_matching_the_full_body() {
        let header = b"Subject: fixture\r\n\r\n";
        let raw = b"Subject: fixture\r\n\r\nOriginal body";
        let mut responses = FLAG_SELECT.as_bytes().to_vec();
        responses.extend_from_slice(
            format!("* 1 FETCH (UID 12 BODY[] {{{}}}\r\n", raw.len()).as_bytes(),
        );
        responses.extend_from_slice(raw);
        responses.extend_from_slice(
            format!(
                ")\r\na3 OK Original\r\n* 1 FETCH (UID 12 BODY[HEADER] {{{}}}\r\n",
                header.len()
            )
            .as_bytes(),
        );
        responses.extend_from_slice(header);
        responses.extend_from_slice(b")\r\na4 OK Headers\r\n* 1 FETCH (UID 12 FLAGS ())\r\na5 OK Fetch\r\na6 OK Stored\r\n* 1 FETCH (UID 12 FLAGS (\\Flagged))\r\na7 OK Confirmed\r\n");
        let (result, written) = flag_round(
            &responses,
            &format!("content:12:{}", archive::digest(header)),
            "star",
            true,
        );
        assert!(result.is_ok());
        assert!(written.contains("BODY.PEEK[HEADER]"));
        assert!(written.contains("+FLAGS.SILENT (\\Flagged)"));
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
    fn missing_selection_metadata_cannot_publish_stale_folder_sources() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "Parent", "7:12", &crate::tests::raw(), false)
            .unwrap();
        let commands = Arc::new(Mutex::new(Vec::new()));
        let stream=ImapTranscript {
            responses:Cursor::new(b"a1 OK Login\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST () \"/\" \"INBOX\"\r\n* LIST () \"/\" \"Parent\"\r\n* LIST () \"/\" \"Z-Archive\"\r\na3 OK Listed\r\n* 0 EXISTS\r\na4 OK [READ-ONLY] Opened\r\n* SEARCH\r\na5 OK Searched\r\na6 OK Opened\r\n* 0 EXISTS\r\na7 OK [READ-ONLY] Opened\r\n* SEARCH\r\na8 OK Searched\r\n".to_vec()), commands:commands.clone(),
        };
        let mut session = imap::Client::new(stream)
            .login("test", "fixture-only")
            .unwrap();
        assert!(sync_imap(&store, &account, &mut session)
            .unwrap_err()
            .contains("无法确认目录已打开"));
        assert!(store.has_source(&account.id, "Parent", "7:12").unwrap());
        assert_eq!(
            store.snapshot(&crate::tests::query()).unwrap().stats.saved,
            1
        );
        let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert_eq!(written.matches("UID SEARCH ALL").count(), 2);
        assert!(written.contains("EXAMINE \"Z-Archive\""));
        assert!(
            !written.contains("FETCH") && !written.contains("STORE") && !written.contains("CLOSE")
        );
    }

    #[test]
    fn zero_exists_with_uids_is_rejected_but_a_new_unsolicited_exists_is_accepted() {
        for arrived in [false, true] {
            let temp = tempfile::tempdir().unwrap();
            let store = Store::new(temp.path().into()).unwrap();
            let account = crate::tests::account();
            store.save_account(&account).unwrap();
            let commands = Arc::new(Mutex::new(Vec::new()));
            let mut responses=b"a1 OK Login\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST () \"/\" \"INBOX\"\r\na3 OK Listed\r\n* 0 EXISTS\r\n* OK [UIDVALIDITY 7] Valid\r\na4 OK [READ-ONLY] Opened\r\n".to_vec();
            if arrived {
                responses.extend_from_slice(b"* 1 EXISTS\r\n");
            }
            responses.extend_from_slice(b"* SEARCH 12\r\na5 OK Searched\r\n");
            let raw = crate::tests::raw();
            responses.extend(
                format!("* 1 FETCH (UID 12 FLAGS () BODY[] {{{}}}\r\n", raw.len()).as_bytes(),
            );
            responses.extend(&raw);
            responses.extend_from_slice(b")\r\na6 OK Fetched\r\n");
            let mut session = imap::Client::new(ImapTranscript {
                responses: Cursor::new(responses),
                commands: commands.clone(),
            })
            .login("test", "fixture-only")
            .unwrap();
            let result = sync_imap(&store, &account, &mut session);
            if arrived {
                assert_eq!(result.unwrap(), 1);
            } else {
                assert!(result.unwrap_err().contains("目录响应相互矛盾"));
            }
            let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
            assert_eq!(written.contains("UID FETCH"), arrived);
            assert_eq!(
                store.has_source(&account.id, "INBOX", "7:12").unwrap(),
                arrived
            );
        }
    }

    #[test]
    fn independent_selection_probe_reads_only_and_rejects_empty_search_leakage() {
        for (events, expected_reason, expected_count) in [
            ("* SEARCH 12 13\r\na3 OK Searched\r\n", true, 2),
            (
                "* 2 EXISTS\r\n* SEARCH 12 13\r\na3 OK Searched\r\n",
                false,
                2,
            ),
            ("* SEARCH\r\na3 OK Searched\r\n", false, 0),
        ] {
            let commands = Arc::new(Mutex::new(Vec::new()));
            let response =
                format!("a1 OK Login\r\n* 0 EXISTS\r\na2 OK [READ-ONLY] Opened\r\n{events}");
            let stream = ImapTranscript {
                responses: Cursor::new(response.into_bytes()),
                commands: commands.clone(),
            };
            let mut session = imap::Client::new(stream)
                .login("test", "fixture-only")
                .unwrap();
            let (evidence, ids, reason) = inspect_selection(&mut session, "Container").unwrap();
            assert_eq!(reason.is_some(), expected_reason);
            assert_eq!(ids.len(), expected_count);
            assert_eq!(evidence.uid_count, Some(expected_count));
            let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
            assert!(written.contains("EXAMINE \"Container\""));
            assert!(written.contains("UID SEARCH ALL"));
            for forbidden in [" FETCH ", " STORE ", "COPY", " MOVE ", "EXPUNGE", "CLOSE"] {
                assert!(!written.contains(forbidden));
            }
        }
    }

    #[test]
    fn fresh_selection_rejections_keep_quarantine_without_fetch_or_writes() {
        for response in [
            "a1 OK Login\r\n* 0 EXISTS\r\na2 OK [READ-ONLY] Opened\r\na3 NO Need to SELECT first!\r\n",
            "a1 OK Login\r\na2 NO Folder not exist!\r\n",
        ] {
            let commands=Arc::new(Mutex::new(Vec::new()));let stream=ImapTranscript{responses:Cursor::new(response.as_bytes().to_vec()),commands:commands.clone()};
            let mut session=imap::Client::new(stream).login("test","fixture-only").unwrap();let (evidence,ids,reason)=inspect_selection(&mut session,"Container").unwrap();
            assert!(ids.is_empty());assert!(evidence.uid_count.is_none());assert!(reason.unwrap().contains("本地存档保留"));
            let written=String::from_utf8(commands.lock().unwrap().clone()).unwrap();for forbidden in ["FETCH","STORE","COPY","MOVE","EXPUNGE"] {assert!(!written.contains(forbidden));}
        }
    }

    #[test]
    fn recovered_directory_refetches_identity_before_resuming_current_intents() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let a = crate::tests::account();
        store.save_account(&a).unwrap();
        let raw = crate::tests::raw();
        store.ingest(&a, "INBOX", "7:12", &raw, false).unwrap();
        let id = store.snapshot(&crate::tests::query()).unwrap().messages[0]
            .id
            .clone();
        store.change_mail(&id, "read", "true").unwrap();
        store.change_mail(&id, "star", "true").unwrap();
        store
            .isolate_folder(&a, "INBOX", "fixture quarantine", &Default::default())
            .unwrap();
        assert!(!store.source_available(&a, "INBOX", "7:12").unwrap());
        assert!(store.cached_flag_uids(&a, "INBOX", 7).unwrap().is_empty());
        let mut response=b"a1 OK Login\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST () \"/\" \"INBOX\"\r\na3 OK Listed\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] Valid\r\na4 OK [READ-ONLY] Opened\r\n* SEARCH 12\r\na5 OK Searched\r\n".to_vec();
        response.extend_from_slice(
            format!(
                "* 1 FETCH (UID 12 FLAGS () RFC822.SIZE {} BODY[] {{{}}}\r\n",
                raw.len(),
                raw.len()
            )
            .as_bytes(),
        );
        response.extend_from_slice(&raw);
        response.extend_from_slice(b")\r\na6 OK Fetched\r\n");
        let commands = Arc::new(Mutex::new(Vec::new()));
        let stream = ImapTranscript {
            responses: Cursor::new(response),
            commands: commands.clone(),
        };
        let mut session = imap::Client::new(stream)
            .login("test", "fixture-only")
            .unwrap();
        sync_imap(&store, &a, &mut session).unwrap();
        assert!(store.folder_health().unwrap().is_empty());
        let mail = store.mail(&id).unwrap();
        assert!(mail.is_read && mail.starred);
        assert_eq!(store.server_operations().unwrap().pending, 2);
        let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert!(written.contains("BODY.PEEK[]"));
        assert!(!written.contains(" STORE "));
    }

    #[test]
    fn an_unproven_empty_selection_cannot_erase_old_quarantined_locations() {
        for validity in [None, Some(7)] {
            let temp = tempfile::tempdir().unwrap();
            let store = Store::new(temp.path().into()).unwrap();
            let a = crate::tests::account();
            store.save_account(&a).unwrap();
            store
                .ingest(&a, "Container", "7:12", &crate::tests::raw(), false)
                .unwrap();
            store
                .isolate_folder(&a, "Container", "fixture quarantine", &Default::default())
                .unwrap();
            let prefix="a1 OK Login\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST () \"/\" \"Container\"\r\na3 OK Listed\r\n* 0 EXISTS\r\n";
            let namespace = validity
                .map(|v| format!("* OK [UIDVALIDITY {v}] Valid\r\n"))
                .unwrap_or_default();
            let stream=ImapTranscript{responses:Cursor::new(format!("{prefix}{namespace}a4 OK [READ-ONLY] Opened\r\n* SEARCH\r\na5 OK Searched\r\n").into_bytes()),commands:Arc::new(Mutex::new(Vec::new()))};
            let mut session = imap::Client::new(stream)
                .login("test", "fixture-only")
                .unwrap();
            let result = sync_imap(&store, &a, &mut session);
            assert_eq!(result.is_ok(), validity.is_some());
            assert_eq!(
                store.folder_health().unwrap().is_empty(),
                validity.is_some()
            );
            let active:bool=store.db().unwrap().query_row("SELECT active FROM sources WHERE account_id=?1 AND folder='Container' AND remote_id='7:12'",[&a.id],|r|r.get(0)).unwrap();
            assert_eq!(active, validity.is_none());
            assert_eq!(
                store.snapshot(&crate::tests::query()).unwrap().stats.saved,
                1
            );
        }
    }

    #[test]
    fn incoming_flags_require_uid_and_flags_and_reject_truncation() {
        let response = b"* 1 FETCH (UID 7 FLAGS (\\Seen \\Flagged custom))\r\n* 2 FETCH (UID 8 FLAGS ())\r\n* 3 FETCH (FLAGS (\\Seen))\r\n* 4 FETCH (UID 9 RFC822.SIZE 10)\r\n";
        assert_eq!(
            remote_flags(response).unwrap(),
            vec![(7, true, true), (8, false, false)]
        );
        assert!(remote_flags(b"* 1 FETCH (UID 7 FLAGS (\\Seen)\r\n").is_err());
    }

    #[test]
    fn cached_incoming_flags_change_without_body_download_or_write_back() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let account = crate::tests::account();
        store.save_account(&account).unwrap();
        store
            .ingest(&account, "INBOX", "7:12", &crate::tests::raw(), false)
            .unwrap();
        let commands = Arc::new(Mutex::new(Vec::new()));
        let stream = ImapTranscript {
            responses: Cursor::new(b"a1 OK Login\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST () \"/\" \"INBOX\"\r\na3 OK Listed\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] Valid\r\na4 OK [READ-ONLY] Opened\r\n* SEARCH 12\r\na5 OK Searched\r\n* 1 FETCH (UID 12 FLAGS (\\Seen \\Flagged))\r\n* 2 FETCH (UID 99 FLAGS ())\r\na6 OK Fetched\r\n".to_vec()),
            commands: commands.clone(),
        };
        let mut session = imap::Client::new(stream)
            .login("test", "fixture-only")
            .unwrap();
        let updated = std::cell::Cell::new(0);
        assert_eq!(
            sync_imap_with_updates(&store, &account, &mut session, &|| updated
                .set(updated.get() + 1))
            .unwrap(),
            0
        );
        assert_eq!(updated.get(), 1);
        let mail = &store.snapshot(&crate::tests::query()).unwrap().messages[0];
        assert!(mail.is_read && mail.starred);
        assert_eq!(store.server_operations().unwrap().pending, 0);
        let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
        assert!(written.contains("UID FETCH 12 (UID FLAGS)"));
        assert!(
            !written.contains("BODY") && !written.contains("STORE") && !written.contains("EXPUNGE")
        );
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
        let effective_validity = validity.filter(|v| *v != 0).or_else(|| {
            status_response
                .split("UIDVALIDITY ")
                .nth(1)?
                .split(')')
                .next()?
                .parse::<u32>()
                .ok()
                .filter(|v| *v != 0)
        });
        if let (Some(uid), Some(validity)) = (uid, effective_validity) {
            if store
                .cached_flag_uids(&crate::tests::account(), "INBOX", validity)
                .unwrap()
                .contains(&uid)
            {
                tag += 1;
                responses.extend_from_slice(
                    format!("* 1 FETCH (UID {uid} FLAGS ())\r\na{tag} OK FLAGS fetched\r\n")
                        .as_bytes(),
                );
            }
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
    fn explicit_full_scope_includes_junk_and_online_scope_uses_headers_only() {
        for junk in [true, false] {
            let temp = tempfile::tempdir().unwrap();
            let store = Store::new(temp.path().into()).unwrap();
            let a = crate::tests::account();
            store.save_account(&a).unwrap();
            let folder = if junk { "Junk" } else { "INBOX" };
            store
                .db()
                .unwrap()
                .execute(
                    "INSERT INTO folder_retention VALUES(?1,?2,?3)",
                    rusqlite::params![a.id, folder, junk],
                )
                .unwrap();
            let mut response = format!("a1 OK Login\r\n* CAPABILITY IMAP4rev1\r\na2 OK Capabilities\r\n* LIST ({}) \"/\" \"{folder}\"\r\na3 OK Listed\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY 7] Valid\r\na4 OK [READ-ONLY] Opened\r\n* SEARCH 12\r\na5 OK Searched\r\n", if junk {"\\Junk"} else {""}).into_bytes();
            let original = crate::tests::raw();
            let end = original.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
            let payload = if junk {
                original.as_slice()
            } else {
                &original[..end]
            };
            let section = if junk { "" } else { "HEADER" };
            response.extend_from_slice(
                format!(
                    "* 1 FETCH (UID 12 FLAGS () RFC822.SIZE {} BODY[{section}] {{{}}}\r\n",
                    original.len(),
                    payload.len()
                )
                .as_bytes(),
            );
            response.extend_from_slice(payload);
            response.extend_from_slice(b")\r\na6 OK Fetched\r\n");
            let commands = Arc::new(Mutex::new(Vec::new()));
            let mut session = imap::Client::new(ImapTranscript {
                responses: Cursor::new(response),
                commands: commands.clone(),
            })
            .login("test", "fixture-only")
            .unwrap();
            assert_eq!(sync_imap(&store, &a, &mut session).unwrap(), 1);
            let written = String::from_utf8(commands.lock().unwrap().clone()).unwrap();
            assert!(written.contains("EXAMINE"));
            assert!(store.has_source(&a.id, folder, "7:12").unwrap());
            assert_eq!(written.contains("BODY.PEEK[]"), junk);
            assert_eq!(written.contains("BODY.PEEK[HEADER]"), !junk);
            let mut q = crate::tests::query();
            q.view = "inbox".into();
            let mail = store.snapshot(&q).unwrap().messages.remove(0);
            assert_eq!(mail.saved_locally, junk);
            if junk {
                assert_eq!(store.message_raw(&mail).unwrap(), original);
            } else {
                assert!(mail.body.is_empty());
                assert_eq!(mail.size, original.len() as u64);
            }
        }
    }
    #[test]
    fn folder_full_retention_fetches_complete_mime_under_online_account_default() {
        let temp = tempfile::tempdir().unwrap();
        let store = Store::new(temp.path().into()).unwrap();
        let mut a = crate::tests::account();
        a.save_locally = false;
        store.save_account(&a).unwrap();
        store
            .db()
            .unwrap()
            .execute("INSERT INTO folder_retention VALUES(?1,'INBOX',1)", [&a.id])
            .unwrap();
        let raw = crate::tests::raw();
        let (result, commands) = imap_round(&store, Some(7), "", Some(12), Some(&raw));
        assert_eq!(result.unwrap(), 1);
        assert!(commands.contains("BODY.PEEK[]"));
        assert!(!commands.contains("BODY.PEEK[HEADER]"));
        let mail = store
            .snapshot(&crate::tests::query())
            .unwrap()
            .messages
            .remove(0);
        assert!(mail.saved_locally);
        assert_eq!(store.message_raw(&mail).unwrap(), raw);
        assert!(!store.account(&a.id).unwrap().save_locally);
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
        assert!(commands.contains("UID FETCH 7 (UID FLAGS)"));
        assert!(!commands.contains("BODY.PEEK"));
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
            detected_roles: None,
            name: "INBOX".into(),
            display_name: "收件箱".into(),
            delimiter: None,
            selectable: true,
            sync_error: None,
            roles: vec![FolderRole::Inbox],
        }]);
    }
    let mut session = imap_session(a, &auth::credentials(a)?)?;
    let folders = discover_remote_folders(&a.id, &mut session)?;
    session.logout().map_err(err)?;
    store.save_remote_folders(&a.id, &folders)?;
    store.remote_folders(Some(&a.id))
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
/// Inspect a cached directory in a fresh read-only connection. Comparing UID
/// sets with a second fresh INBOX connection diagnoses selection leakage, but
/// overlapping UIDs alone never prove identical messages or authorize removal.
fn inspect_selection<T: std::io::Read + Write>(
    session: &mut imap::Session<T>,
    folder: &str,
) -> Result<(
    crate::folder_health::SelectionEvidence,
    std::collections::HashSet<u32>,
    Option<String>,
)> {
    let mailbox = match examine_verified(session, folder) {
        Ok(m) => m,
        Err(e) if e == MISSING_SELECTION => {
            return Ok((Default::default(), Default::default(), Some(e)))
        }
        Err(e)
            if e.starts_with("No Response:")
                && (e.to_ascii_lowercase().contains("select")
                    || e.to_ascii_lowercase().contains("folder not exist")) =>
        {
            return Ok((
                Default::default(),
                Default::default(),
                Some("服务器拒绝打开此目录；旧来源暂停使用，本地存档保留".into()),
            ));
        }
        Err(e) => return Err(e),
    };
    let ids = match session.uid_search("ALL") {
        Ok(ids) => ids,
        Err(imap::error::Error::No(message))
            if message.to_ascii_lowercase().contains("select")
                || message.to_ascii_lowercase().contains("folder not exist") =>
        {
            return Ok((
                crate::folder_health::SelectionEvidence {
                    exists: Some(mailbox.exists),
                    uid_count: None,
                    inbox_uid_overlap: None,
                },
                Default::default(),
                Some(
                    "服务器未真正打开该目录，拒绝读取邮件编号；旧来源暂停使用，本地存档保留".into(),
                ),
            ));
        }
        Err(e) => return Err(err(e)),
    };
    let mut exists = mailbox.exists;
    for event in session.unsolicited_responses.try_iter() {
        if let imap::types::UnsolicitedResponse::Exists(n) = event {
            exists = n;
        }
    }
    let evidence = crate::folder_health::SelectionEvidence {
        exists: Some(exists),
        uid_count: Some(ids.len()),
        inbox_uid_overlap: None,
    };
    let reason = (exists == 0 && !ids.is_empty()).then(|| INCONSISTENT_SELECTION.to_string());
    Ok((evidence, ids, reason))
}
pub fn probe_folder(
    store: &Store,
    a: &Account,
    folder: &str,
) -> Result<crate::folder_health::SelectionEvidence> {
    if !a.enabled || a.protocol != "imap" {
        return Err("请启用 IMAP 账号后重新核查".into());
    }
    let known = store
        .remote_folders(Some(&a.id))?
        .into_iter()
        .any(|f| f.name == folder && f.selectable);
    if !known {
        return Err("文件夹已不存在或不能存放邮件，请刷新目录".into());
    }
    let gate = crate::sync_control::folder_gate(&store.root, &a.id, folder)?;
    let _guard = gate
        .try_lock()
        .map_err(|_| "此目录正在收取，请稍后重新核查")?;
    let secret = auth::credentials(a)?;
    let mut session = imap_session(a, &secret)?;
    let (mut evidence, ids, reason) = inspect_selection(&mut session, folder)?;
    let _ = session.logout();
    if !folder.eq_ignore_ascii_case("INBOX") && evidence.uid_count.is_some() {
        let inbox_gate = crate::sync_control::folder_gate(&store.root, &a.id, "INBOX")?;
        // Never block realtime delivery to run a diagnostic.
        if let Ok(_inbox_guard) = inbox_gate.try_lock() {
            if let Ok(mut inbox) = imap_session(a, &secret) {
                if let Ok((_, inbox_ids, reason)) = inspect_selection(&mut inbox, "INBOX") {
                    if reason.is_none() {
                        evidence.inbox_uid_overlap = Some(ids.intersection(&inbox_ids).count());
                    }
                    let _ = inbox.logout();
                }
            }
        };
    }
    let current = store.account(&a.id)?;
    if !current.enabled || !current.same_connection(a) {
        return Err("账号已暂停或连接配置已修改，核查结果已忽略".into());
    }
    if let Some(reason) = reason {
        store.isolate_folder(a, folder, &reason, &evidence)?;
    } else if store.folder_isolated_reason(&a.id, folder)?.is_some() {
        store.isolate_folder(
            a,
            folder,
            "只读核查已通过，等待完整收取核对旧来源；本地存档保留",
            &evidence,
        )?;
    }
    let summary = match (evidence.exists, evidence.uid_count) {
        (Some(count), Some(uids)) => format!(
            "服务器报告 {count} 封邮件，返回 {uids} 个邮件编号；{}",
            if count == 0 && uids > 0 {
                "目录响应矛盾，继续隔离"
            } else {
                "旧来源须经完整收取核对"
            }
        ),
        (Some(count), None) => format!("服务器报告 {count} 封邮件，但拒绝查询邮件编号；继续隔离"),
        _ => "服务器未提供可靠的目录信息；继续隔离".into(),
    };
    store.log(&format!("文件夹「{folder}」独立只读核查：{summary}"))?;
    Ok(evidence)
}
pub fn read_remote(store: &Store, a: &Account, mail: &Mail) -> Result<Vec<u8>> {
    let (folder, remote) = store.source(&mail.id)?;
    let secret = auth::credentials(a)?;
    let raw = if a.protocol == "imap" {
        let mut session = imap_session(a, &secret)?;
        let mailbox = examine_verified(&mut session, &folder)?;
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

pub(crate) fn apply_server_flag(
    a: &Account,
    op: &crate::operations::Operation,
) -> std::result::Result<(), crate::operations::Failure> {
    use crate::operations::Failure;
    let secret = auth::credentials(a).map_err(Failure::Retry)?;
    let mut session = imap_session(a, &secret).map_err(Failure::Retry)?;
    let result = apply_flag_session(&mut session, op);
    // Dropping the connection does not expunge. Never issue CLOSE/EXPUNGE.
    drop(session);
    result
}
fn flag_error(stage: &str, e: imap::error::Error) -> crate::operations::Failure {
    use crate::operations::Failure;
    match e {
        imap::error::Error::No(_) | imap::error::Error::Bad(_) => {
            if e.to_string()
                .to_ascii_lowercase()
                .contains("need to select first")
            {
                Failure::Blocked(format!(
                    "{stage}失败：服务器未保持该文件夹的选择状态，无法同步此目录。本地状态已保留"
                ))
            } else {
                Failure::Blocked(format!("{stage}失败，服务器拒绝状态同步：{e}"))
            }
        }
        _ => Failure::Retry(format!("{stage}连接失败，将自动重试：{e}")),
    }
}
fn apply_flag_session<T: std::io::Read + Write>(
    session: &mut imap::Session<T>,
    op: &crate::operations::Operation,
) -> std::result::Result<(), crate::operations::Failure> {
    use crate::operations::{remote_identity, Failure};
    use imap::types::Flag;
    let blocked = |s: &str| Failure::Blocked(s.into());
    let (validity, uid, content_hash) =
        remote_identity(&op.remote_id).ok_or_else(|| blocked("服务器邮件标识无效，请重新收取"))?;
    let flag = match op.action.as_str() {
        "read" => Flag::Seen,
        "star" => Flag::Flagged,
        _ => return Err(blocked("不支持的服务器动作")),
    };
    // SELECT is deliberately the last mailbox selection before STORE. STATUS
    // may deselect on Tencent servers, so don't use the read-only recovery helper.
    let mailbox = session
        .select(&op.folder)
        .map_err(|e| flag_error("打开文件夹", e))?;
    if let Some(expected) = validity {
        if mailbox.uid_validity != Some(expected) {
            return Err(blocked(
                "服务器文件夹的邮件标识已变化或无法确认，请重新收取后再操作",
            ));
        }
    }
    if !mailbox.permanent_flags.is_empty() && !mailbox.permanent_flags.contains(&flag) {
        return Err(blocked("该服务器文件夹不允许永久修改此状态"));
    }
    let uid = uid.to_string();
    if let Some(expected_hash) = content_hash {
        // For servers without UIDVALIDITY, content identities are checked in
        // this selected session. Support both archived MIME and online headers.
        let raw = session
            .uid_fetch(&uid, "(UID BODY.PEEK[])")
            .map_err(|e| flag_error("核对完整邮件", e))?;
        let message = raw
            .iter()
            .find(|m| m.uid.map(|u| u.to_string()) == Some(uid.clone()))
            .ok_or_else(|| blocked("原邮件已从服务器移除，本地存档保留"))?;
        let body = message
            .body()
            .ok_or_else(|| blocked("服务器未返回可验证的原邮件"))?;
        let full_matches = archive::digest(body) == expected_hash;
        drop(raw);
        if !full_matches {
            let headers = session
                .uid_fetch(&uid, "(UID BODY.PEEK[HEADER])")
                .map_err(|e| flag_error("核对邮件头", e))?;
            let message = headers
                .iter()
                .find(|m| m.uid.map(|u| u.to_string()) == Some(uid.clone()))
                .ok_or_else(|| blocked("原邮件已从服务器移除，本地存档保留"))?;
            if message
                .header()
                .is_none_or(|h| archive::digest(h) != expected_hash)
            {
                return Err(blocked(
                    "服务器邮件内容与本地来源不一致，请重新收取后再操作",
                ));
            }
        }
    }
    let before = session
        .uid_fetch(&uid, "(UID FLAGS)")
        .map_err(|e| flag_error("读取邮件状态", e))?;
    let message = before
        .iter()
        .find(|m| m.uid.map(|u| u.to_string()) == Some(uid.clone()))
        .ok_or_else(|| blocked("原邮件已从服务器移除，本地存档保留"))?;
    if message.flags().contains(&flag) == op.value {
        return Ok(());
    }
    drop(before);
    let name = if op.action == "read" {
        "\\Seen"
    } else {
        "\\Flagged"
    };
    let direction = if op.value { "+" } else { "-" };
    session
        .uid_store(&uid, format!("{direction}FLAGS.SILENT ({name})"))
        .map_err(|e| flag_error("提交邮件状态", e))?;
    let after = session
        .uid_fetch(&uid, "(UID FLAGS)")
        .map_err(|e| flag_error("确认邮件状态", e))?;
    let message = after
        .iter()
        .find(|m| m.uid.map(|u| u.to_string()) == Some(uid.clone()))
        .ok_or_else(|| blocked("同步期间原邮件已移除，本地存档保留"))?;
    if message.flags().contains(&flag) != op.value {
        return Err(blocked("服务器未保存状态修改，可能为只读文件夹"));
    }
    Ok(())
}

// imap 2.4 consumes the tagged completion (including COPYUID). Capture only
// this command's bounded response in memory; never record credentials or MIME.
#[derive(Default, Debug)]
struct CopyCapture {
    enabled: bool,
    input: Vec<u8>,
    output: Vec<u8>,
    overflow: bool,
}
#[derive(Debug)]
struct CopyStream<T> {
    inner: T,
    capture: Arc<Mutex<CopyCapture>>,
}
impl<T: std::io::Read> std::io::Read for CopyStream<T> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buffer)?;
        if let Ok(mut capture) = self.capture.lock() {
            if capture.enabled {
                if capture.input.len() + n <= 65536 {
                    capture.input.extend_from_slice(&buffer[..n]);
                } else {
                    capture.overflow = true;
                }
            }
        }
        Ok(n)
    }
}
impl<T: Write> Write for CopyStream<T> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(buffer)?;
        if let Ok(mut capture) = self.capture.lock() {
            if capture.enabled {
                if capture.output.len() + n <= 8192 {
                    capture.output.extend_from_slice(&buffer[..n]);
                } else {
                    capture.overflow = true;
                }
            }
        }
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}
fn copy_receipt(
    capture: &CopyCapture,
    uid: u32,
    target_validity: u32,
) -> Result<crate::directory_operations::CopyReceipt> {
    use imap_proto::{Response, Status};
    if capture.overflow {
        return Err("复制确认响应过大，结果未确认；请核对目标目录".into());
    }
    let command = std::str::from_utf8(&capture.output).map_err(err)?;
    let tag = command
        .split_whitespace()
        .next()
        .ok_or("复制命令标识缺失")?;
    let mut remaining = capture.input.as_slice();
    while !remaining.is_empty() {
        let (rest, response) =
            imap_proto::parse_response(remaining).map_err(|_| "复制确认响应无效或未完整传输")?;
        remaining = rest;
        if let Response::Done {
            tag: actual,
            status: Status::Ok,
            information: Some(info),
            ..
        } = response
        {
            if actual.as_bytes() != tag.as_bytes() {
                continue;
            }
            let code = info
                .strip_prefix('[')
                .and_then(|s| s.split_once(']').map(|(v, _)| v))
                .ok_or("服务器已接受复制，但未返回 COPYUID；请核对目标目录，不会自动重复复制")?;
            let fields: Vec<_> = code.split_whitespace().collect();
            let one_uid = |s: &str| -> Option<u32> {
                if let Some((a, b)) = s.split_once(':') {
                    if a != b {
                        return None;
                    }
                    return a.parse().ok().filter(|n| *n > 0);
                }
                s.parse().ok().filter(|n| *n > 0)
            };
            if fields.len() != 4
                || !fields[0].eq_ignore_ascii_case("COPYUID")
                || one_uid(fields[1]) != Some(target_validity)
                || one_uid(fields[2]) != Some(uid)
            {
                return Err("复制确认的来源或目标邮件标识不匹配；请核对目标目录".into());
            }
            return Ok(crate::directory_operations::CopyReceipt {
                validity: target_validity,
                uid: one_uid(fields[3]).ok_or("复制目标邮件编号无效")?,
            });
        }
    }
    Err("复制完成确认缺失；请核对目标目录，不会自动重复复制".into())
}
// RFC 6851 recommends untagged COPYUID before EXPUNGE. Sequence numbers
// cannot prove which UID disappeared; source absence is verified separately.
fn move_receipt(
    capture: &CopyCapture,
    uid: u32,
    target_validity: u32,
) -> Result<crate::directory_operations::CopyReceipt> {
    use imap_proto::{Response, Status};
    if capture.overflow {
        return Err("移动确认响应过大，请核对原目录和目标目录，不会自动重发".into());
    }
    let command = std::str::from_utf8(&capture.output).map_err(err)?;
    let tag = command
        .split_whitespace()
        .next()
        .ok_or("移动命令标识缺失")?;
    let mut remaining = capture.input.as_slice();
    let mut receipt: Option<crate::directory_operations::CopyReceipt> = None;
    let mut completed = false;
    while !remaining.is_empty() {
        let (rest, response) =
            imap_proto::parse_response(remaining).map_err(|_| "移动确认响应无效或未完整传输")?;
        remaining = rest;
        let info = match response {
            Response::Data {
                status: Status::Ok,
                information,
                ..
            } => information,
            Response::Done {
                tag: actual,
                status,
                information,
                ..
            } if actual.as_bytes() == tag.as_bytes() => {
                if !matches!(status, Status::Ok | Status::No | Status::Bad) {
                    return Err("移动响应状态无效".into());
                }
                completed = true;
                information
            }
            _ => None,
        };
        let Some(code) = info
            .and_then(|s| s.strip_prefix('['))
            .and_then(|s| s.split_once(']').map(|(v, _)| v))
        else {
            continue;
        };
        let fields: Vec<_> = code.split_whitespace().collect();
        if fields
            .first()
            .is_none_or(|s| !s.eq_ignore_ascii_case("COPYUID"))
        {
            continue;
        }
        let one = |s: &str| -> Option<u32> {
            let (a, b) = s.split_once(':').unwrap_or((s, s));
            if a != b {
                return None;
            }
            a.parse().ok().filter(|n| *n > 0)
        };
        if fields.len() != 4
            || one(fields[1]) != Some(target_validity)
            || one(fields[2]) != Some(uid)
        {
            return Err(format!("移动回执标识不匹配：预期目录 UIDVALIDITY={target_validity}、来源 UID={uid}；返回目录 UIDVALIDITY={:?}、来源 UID={:?}。请核对两个目录",fields.get(1).and_then(|s|one(s)),fields.get(2).and_then(|s|one(s))));
        }
        let next = crate::directory_operations::CopyReceipt {
            validity: target_validity,
            uid: one(fields[3]).ok_or("移动目标邮件编号无效")?,
        };
        if receipt.as_ref().is_some_and(|r| r.uid != next.uid) {
            return Err("移动返回了相互矛盾的目标编号，请核对两个目录".into());
        }
        receipt = Some(next);
    }
    if !completed {
        return Err("移动完成响应缺失，请核对两个目录，不会自动重发".into());
    }
    receipt.ok_or("移动未返回可靠的 COPYUID，请核对两个目录，不会自动重发".into())
}
pub(crate) fn apply_copy(
    store: &Store,
    op: &crate::directory_operations::DirectoryOperation,
) -> Result<()> {
    let account = store.validate_copy(op)?;
    let secret = auth::credentials(&account)?;
    let capture = Arc::new(Mutex::new(CopyCapture::default()));
    let mut session = imap_session_using(&account, &secret, None, |inner| CopyStream {
        inner,
        capture: capture.clone(),
    })?;
    // Native MOVE is preferred; compatibility uses journaled COPY then UID-only cleanup.
    // Neither path ever issues plain EXPUNGE or CLOSE.
    apply_copy_session(store, op, &mut session, &capture)
}
fn verify_directory_target<T: std::io::Read + Write>(
    op: &crate::directory_operations::DirectoryOperation,
    session: &mut imap::Session<T>,
) -> Result<()> {
    let receipt = op.receipt.as_ref().ok_or("文件夹操作确认缺失")?;
    let mailbox = examine_verified(session, &op.target)?;
    if mailbox.uid_validity != Some(receipt.validity) {
        return Err("目标目录的邮件标识已变化，保留确认记录，请重新收取核对".into());
    }
    let messages = session
        .uid_fetch(receipt.uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(err)?;
    let raw = messages
        .iter()
        .find(|m| m.uid == Some(receipt.uid))
        .and_then(|m| m.body())
        .ok_or("已保存回执，但尚未读取到目标邮件；稍后只读核对")?;
    if archive::digest(raw) != op.content_hash {
        return Err("目标内容与原邮件不一致；保留确认记录，请重新核对".into());
    }
    drop(messages);
    Ok(())
}
fn verify_copy_session<T: std::io::Read + Write>(
    store: &Store,
    op: &crate::directory_operations::DirectoryOperation,
    session: &mut imap::Session<T>,
) -> Result<()> {
    verify_directory_target(op, session)?;
    if op.kind == "move" {
        let (validity, uid, _) =
            crate::operations::remote_identity(&op.remote_id).ok_or("移动来源标识缺失")?;
        let source = examine_verified(session, &op.folder)?;
        if validity.is_none() || source.uid_validity != validity {
            return Err("移动后原目录的 UIDVALIDITY 已变化，无法确认原编号已移除；保留回执".into());
        }
        // UID FETCH may legally return no FETCH data when the UID is absent.
        // Verify only this UID; unrelated EXPUNGE sequence numbers are ignored.
        let remaining = session.uid_fetch(uid.to_string(), "(UID)").map_err(err)?;
        if !remaining.is_empty() {
            return Err(
                "目标全文已确认，但原邮件仍存在或原目录响应异常；稍后只读核对，不会重发移动".into(),
            );
        }
    }
    store.complete_copy(op)
}
/// RFC 4315: only the exact UID is marked/expunged after proving a durable target.
/// A crash after submit_move_cleanup switches to read-only recovery; it never
/// silently repeats COPY, STORE or EXPUNGE. Explicit continuation rechecks both copies.
fn cleanup_move_session<T: std::io::Read + Write>(
    store: &Store,
    op: &crate::directory_operations::DirectoryOperation,
    session: &mut imap::Session<T>,
) -> Result<()> {
    if op.kind != "move" || op.strategy.as_deref() != Some("copy-delete") || op.receipt.is_none() {
        return Err("兼容移动缺少已保存的目标确认".into());
    }
    let caps = session.capabilities().map_err(err)?;
    if !caps.has_str("UIDPLUS") && !caps.has_str("IMAP4rev2") {
        return Err("服务器不支持精确 UID EXPUNGE，目标副本保留，原邮件未移除".into());
    }
    drop(caps);
    verify_directory_target(op, session)?;
    let (validity, uid, _) =
        crate::operations::remote_identity(&op.remote_id).ok_or("来源编号无效")?;
    let source = session.select(&op.folder).map_err(err)?;
    if validity.is_none() || source.uid_validity != validity {
        return Err("原目录 UIDVALIDITY 已变化，目标副本保留，未移除原邮件".into());
    }
    let messages = session
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(err)?;
    if messages.is_empty() {
        // Another client may already have finished removal. No cleanup write is needed.
        return store.complete_copy(op);
    }
    let raw = messages
        .iter()
        .find(|m| m.uid == Some(uid))
        .and_then(|m| m.body())
        .ok_or("原目录响应异常，未移除原邮件")?;
    if archive::digest(raw) != op.content_hash {
        return Err("原邮件全文已变化，目标副本保留，未移除原邮件".into());
    }
    drop(messages);
    if !source.permanent_flags.is_empty()
        && !source.permanent_flags.contains(&imap::types::Flag::Deleted)
    {
        return Err("原目录不允许删除标记，两个副本保留".into());
    }
    // Last durable boundary before any source mutation; changes to credentials,
    // isolation, trusted sources or pending flag work are checked in the transaction.
    store.submit_move_cleanup(op)?;
    session
        .uid_store(uid.to_string(), "+FLAGS.SILENT (\\Deleted)")
        .map_err(|e| format!("原目录移除已提交：{e}；先只读核对，不会自动再次移除"))?;
    let flags = session
        .uid_fetch(uid.to_string(), "(UID FLAGS)")
        .map_err(err)?;
    if !flags
        .iter()
        .any(|m| m.uid == Some(uid) && m.flags().contains(&imap::types::Flag::Deleted))
    {
        return Err("未确认原邮件的删除标记，未执行 UID EXPUNGE；请只读核对".into());
    }
    drop(flags);
    session
        .run_command_and_read_response(format!("UID EXPUNGE {uid}"))
        .map_err(|e| format!("精确移除已提交：{e}；先只读核对，不会自动重复移除"))?;
    // Re-read the target as well: do not retire the local source solely on an OK.
    verify_copy_session(store, op, session)
}
fn apply_copy_session<T: std::io::Read + Write>(
    store: &Store,
    op: &crate::directory_operations::DirectoryOperation,
    session: &mut imap::Session<T>,
    capture: &Arc<Mutex<CopyCapture>>,
) -> Result<()> {
    if op.receipt.is_some() {
        if op.status == "cleanup_pending" {
            return cleanup_move_session(store, op, session);
        }
        return verify_copy_session(store, op, session);
    }
    let caps = session.capabilities().map_err(err)?;
    if !caps.has_str("UIDPLUS") && !caps.has_str("IMAP4rev2") {
        return Err("服务器未提供 UIDPLUS，无法可靠确认文件夹操作；尚未提交".into());
    }
    let compatibility = op.kind == "move" && !caps.has_str("MOVE") && !caps.has_str("IMAP4rev2");
    drop(caps);
    let target = examine_verified(session, &op.target)?;
    let target_validity = mailbox_uid_validity(session, &op.target, &target)?
        .filter(|n| *n > 0)
        .ok_or("目标目录没有可靠的 UIDVALIDITY；尚未提交")?;
    let (validity, uid, hash) =
        crate::operations::remote_identity(&op.remote_id).ok_or("来源邮件编号无效")?;
    // This is the last selection before COPY; no STATUS command intervenes.
    let source = session.select(&op.folder).map_err(err)?;
    if validity.is_some_and(|v| source.uid_validity != Some(v)) {
        return Err("来源目录的邮件标识已变化；尚未提交".into());
    }
    let messages = session
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(err)?;
    let raw = messages
        .iter()
        .find(|m| m.uid == Some(uid))
        .and_then(|m| m.body())
        .ok_or("原服务器邮件已不存在；尚未提交")?;
    let content_hash = archive::digest(raw);
    drop(messages);
    if let Some(expected) = hash {
        if expected != content_hash {
            let headers = session
                .uid_fetch(uid.to_string(), "(UID BODY.PEEK[HEADER])")
                .map_err(err)?;
            if headers
                .iter()
                .find(|m| m.uid == Some(uid))
                .and_then(|m| m.header())
                .is_none_or(|h| archive::digest(h) != expected)
            {
                return Err("来源邮件内容不一致；尚未提交".into());
            }
        }
    }
    store.submit_directory(op, &content_hash, compatibility)?;
    *capture.lock().map_err(err)? = CopyCapture {
        enabled: true,
        ..Default::default()
    };
    let target = op.target.replace('\\', "\\\\").replace('"', "\\\"");
    let verb = if op.kind == "move" && !compatibility {
        "MOVE"
    } else {
        "COPY"
    };
    let result = session.run_command_and_read_response(format!("UID {verb} {uid} \"{target}\""));
    capture.lock().map_err(err)?.enabled = false;
    if op.kind == "move" && !compatibility {
        // MOVE can partially succeed even with NO. A saved mapping permits
        // read-only verification, never automatic replay of the command.
        if result
            .as_ref()
            .is_err_and(|e| !matches!(e, imap::error::Error::No(_) | imap::error::Error::Bad(_)))
        {
            return Err("移动已提交但连接中断，请核对两个目录，不会自动重发".into());
        }
        let receipt = move_receipt(&*capture.lock().map_err(err)?, uid, target_validity)?;
        store.save_copy_receipt(op, &receipt)?;
        let current = store.directory_operation(&op.id)?;
        return verify_copy_session(store, &current, session);
    }
    match result {
        Err(e @ (imap::error::Error::No(_) | imap::error::Error::Bad(_))) => {
            let reason = format!("服务器明确拒绝复制：{e}；原邮件保留");
            store.fail_copy(&op.id, &reason, true)?;
            return Err(reason);
        }
        Err(_) => return Err("复制请求已提交，但连接中断；结果未确认，不会自动重复复制".into()),
        Ok(_) => {}
    }
    let receipt = copy_receipt(&*capture.lock().map_err(err)?, uid, target_validity)?;
    store.save_copy_receipt(op, &receipt)?;
    if compatibility {
        // Persisted cleanup_pending is picked up separately; COPY can never be
        // replayed by this stage, even across process restarts.
        return Ok(());
    }
    let current = store.directory_operation(&op.id)?;
    verify_copy_session(store, &current, session)
}

#[cfg(test)]
mod copy_tests {
    use super::*;
    use std::{
        collections::VecDeque,
        io::{Cursor, Read},
    };
    #[derive(Debug)]
    struct Script {
        replies: VecDeque<Vec<u8>>,
        current: Cursor<Vec<u8>>,
        pending: Vec<u8>,
        written: Arc<Mutex<Vec<u8>>>,
    }
    impl Read for Script {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.current.read(buffer)
        }
    }
    impl Write for Script {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.written.lock().unwrap().extend_from_slice(buffer);
            self.pending.extend_from_slice(buffer);
            if self.pending.ends_with(b"\r\n") {
                self.current = Cursor::new(self.replies.pop_front().unwrap_or_default());
                self.pending.clear();
            }
            Ok(buffer.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    fn session(
        replies: Vec<Vec<u8>>,
    ) -> (
        imap::Session<CopyStream<Script>>,
        Arc<Mutex<CopyCapture>>,
        Arc<Mutex<Vec<u8>>>,
    ) {
        let capture = Arc::new(Mutex::new(CopyCapture::default()));
        let written = Arc::new(Mutex::new(Vec::new()));
        let script = Script {
            replies: replies.into(),
            current: Cursor::new(Vec::new()),
            pending: Vec::new(),
            written: written.clone(),
        };
        let client = imap::Client::new(CopyStream {
            inner: script,
            capture: capture.clone(),
        });
        (
            client.login("fixture", "not-a-real-password").unwrap(),
            capture,
            written,
        )
    }
    fn fetch(tag: &str, uid: u32, raw: &[u8]) -> Vec<u8> {
        let mut bytes = format!("* 1 FETCH (UID {uid} BODY[] {{{}}}\r\n", raw.len()).into_bytes();
        bytes.extend(raw);
        bytes.extend(format!(")\r\n{tag} OK fetched\r\n").as_bytes());
        bytes
    }
    fn replies(copy: &str, target_raw: &[u8]) -> Vec<Vec<u8>> {
        vec![
            b"a1 OK login\r\n".to_vec(),
            b"* CAPABILITY IMAP4rev1 UIDPLUS MOVE\r\na2 OK caps\r\n".to_vec(),
            b"* 0 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na3 OK examined\r\n".to_vec(),
            b"* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\na4 OK selected\r\n".to_vec(),
            fetch("a5", 12, &crate::tests::raw()),
            copy.as_bytes().to_vec(),
            b"* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na7 OK examined\r\n".to_vec(),
            fetch("a8", 34, target_raw),
        ]
    }
    #[test]
    fn copyuid_is_bound_to_exact_tag_source_and_target_not_unilateral_messages() {
        for (input, valid) in [
            (
                "* OK [COPYUID 9 12 999] unrelated\r\na6 OK [COPYUID 9 12 34] copied\r\n",
                true,
            ),
            ("a6 OK [copyuid 9 12:12 34:34] copied\r\n", true),
            ("a6 OK [COPYUID 9 13 34] copied\r\n", false),
            ("a6 OK [COPYUID 10 12 34] copied\r\n", false),
            ("a6 OK [COPYUID 9 12 0] copied\r\n", false),
            ("a6 OK [COPYUID 9 12 34:35] copied\r\n", false),
            ("a6 OK copied without receipt\r\n", false),
            ("a6 OK [COPYUID 9 12 34] trunc", false),
        ] {
            let capture = CopyCapture {
                input: input.as_bytes().to_vec(),
                output: b"a6 UID COPY 12 \"Archive\"\r\n".to_vec(),
                ..Default::default()
            };
            assert_eq!(copy_receipt(&capture, 12, 9).is_ok(), valid, "{input}");
        }
    }
    #[test]
    fn copy_preserves_source_and_requires_receipt_and_matching_target_bytes() {
        let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        let (mut session, capture, written) = session(replies(
            "a6 OK [COPYUID 9 12 34] copied\r\n",
            &crate::tests::raw(),
        ));
        apply_copy_session(&store, &op, &mut session, &capture).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "completed");
        assert!(store.has_source(&a.id, "INBOX", "7:12").unwrap());
        assert!(store.has_source(&a.id, "Archive", "9:34").unwrap());
        let commands = String::from_utf8(written.lock().unwrap().clone()).unwrap();
        assert_eq!(commands.matches("UID COPY").count(), 1);
        assert!(commands.contains("UID COPY 12 \"Archive\""));
        assert!(
            !commands.contains("STORE")
                && !commands.contains("EXPUNGE")
                && !commands.contains("CLOSE")
                && !commands.contains("UID MOVE")
        );
        let capture = capture.lock().unwrap();
        assert!(!String::from_utf8_lossy(&capture.input).contains("Content-Type"));
    }
    #[test]
    fn submitted_disconnect_missing_or_wrong_receipt_never_requeues_copy() {
        for reply in [
            "",
            "a6 OK copied\r\n",
            "a6 OK [COPYUID 99 12 34] wrong\r\n",
            "a6 NO permission denied\r\n",
        ] {
            let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
            let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
            let op = store.directory_operation(&job).unwrap();
            store.claim_copy(&op).unwrap();
            let (mut session, capture, written) = session(replies(reply, &crate::tests::raw()));
            let error = apply_copy_session(&store, &op, &mut session, &capture).unwrap_err();
            store.fail_copy(&job, &error, false).unwrap();
            let status = store.directory_operation(&job).unwrap().status;
            assert_eq!(
                status,
                if reply.contains(" NO ") {
                    "blocked"
                } else {
                    "uncertain"
                }
            );
            assert!(store.due_copies(&a.id).unwrap().is_empty());
            let commands = String::from_utf8(written.lock().unwrap().clone()).unwrap();
            assert_eq!(commands.matches("UID COPY").count(), 1);
        }
    }
    #[test]
    fn saved_receipt_recovers_by_readonly_verification_without_a_second_copy() {
        let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
        let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        let (mut first, capture, _) = session(replies(
            "a6 OK [COPYUID 9 12 34] copied\r\n",
            b"wrong content",
        ));
        let error = apply_copy_session(&store, &op, &mut first, &capture).unwrap_err();
        store.fail_copy(&job, &error, false).unwrap();
        let confirmed = store.directory_operation(&job).unwrap();
        assert_eq!(confirmed.status, "confirmed");
        assert!(!store.has_source(&a.id, "Archive", "9:34").unwrap());
        store.claim_copy(&confirmed).unwrap();
        let (mut second, capture, written) = session(vec![
            b"a1 OK login\r\n".to_vec(),
            b"* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na2 OK examined\r\n".to_vec(),
            fetch("a3", 34, &crate::tests::raw()),
        ]);
        apply_copy_session(&store, &confirmed, &mut second, &capture).unwrap();
        assert_eq!(store.directory_operation(&job).unwrap().status, "completed");
        let commands = String::from_utf8(written.lock().unwrap().clone()).unwrap();
        assert!(
            !commands.contains("COPY")
                && !commands.contains("SELECT ")
                && !commands.contains("STORE")
        );
    }
    #[test]
    fn missing_uidplus_and_changed_source_validity_are_rejected_before_submission() {
        for no_capability in [true, false] {
            let (_temp, store, _a, id) = crate::directory_operations::tests::fixture();
            let job = store.queue_copy(&id, "INBOX", "Archive").unwrap();
            let op = store.directory_operation(&job).unwrap();
            store.claim_copy(&op).unwrap();
            let mut script = replies("a6 OK [COPYUID 9 12 34] copied\r\n", &crate::tests::raw());
            if no_capability {
                script[1] = b"* CAPABILITY IMAP4rev1\r\na2 OK caps\r\n".to_vec();
            } else {
                script[3] =
                    b"* 1 EXISTS\r\n* OK [UIDVALIDITY 8] changed\r\na4 OK selected\r\n".to_vec();
            }
            let (mut session, capture, written) = session(script);
            assert!(apply_copy_session(&store, &op, &mut session, &capture).is_err());
            assert_eq!(store.directory_operation(&job).unwrap().status, "preparing");
            assert!(!String::from_utf8_lossy(&written.lock().unwrap()).contains("UID COPY"));
        }
    }
    fn move_replies(reply: &str, source_remaining: bool) -> Vec<Vec<u8>> {
        let mut script = replies(reply, &crate::tests::raw());
        script.push(b"* 0 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\na9 OK examined\r\n".to_vec());
        script.push(if source_remaining {
            b"* 1 FETCH (UID 12)\r\na10 OK fetched\r\n".to_vec()
        } else {
            b"a10 OK fetched\r\n".to_vec()
        });
        script
    }
    #[test]
    fn move_untagged_receipt_and_expunge_require_exact_mapping_and_completion() {
        for (input, valid) in [
            (
                "* OK [COPYUID 9 12 34]\r\n* 77 EXPUNGE\r\na6 OK moved\r\n",
                true,
            ),
            ("a6 OK [COPYUID 9 12 34] moved\r\n", true),
            ("* OK [COPYUID 9 12 34]\r\na6 NO partially moved\r\n", true),
            ("* OK [COPYUID 9 12 34]\r\na7 OK unrelated\r\n", false),
            (
                "* OK [COPYUID 9 12 34]\r\na6 OK [COPYUID 9 12 35]\r\n",
                false,
            ),
            ("* OK [COPYUID 9 13 34]\r\na6 OK moved\r\n", false),
            ("* OK [COPYUID 10 12 34]\r\na6 OK moved\r\n", false),
            ("* OK [COPYUID 9 12 34:35]\r\na6 OK moved\r\n", false),
            ("* 1 EXPUNGE\r\na6 OK moved\r\n", false),
            ("* OK [COPYUID 9 12 34]\r\na6 OK trunc", false),
        ] {
            let capture = CopyCapture {
                input: input.as_bytes().to_vec(),
                output: b"a6 UID MOVE 12 \"Archive\"\r\n".to_vec(),
                ..Default::default()
            };
            assert_eq!(move_receipt(&capture, 12, 9).is_ok(), valid, "{input}");
        }
    }
    #[test]
    fn move_requires_full_target_and_source_absence_without_delete_fallback() {
        for remaining in [false, true] {
            let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
            let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
            let op = store.directory_operation(&job).unwrap();
            store.claim_copy(&op).unwrap();
            let (mut session, capture, written) = session(move_replies(
                "* OK [COPYUID 9 12 34]\r\n* 99 EXPUNGE\r\na6 OK moved\r\n",
                remaining,
            ));
            let result = apply_copy_session(&store, &op, &mut session, &capture);
            assert_eq!(result.is_ok(), !remaining);
            if let Err(error) = result {
                store.fail_copy(&job, &error, false).unwrap();
            }
            assert_eq!(
                store.directory_operation(&job).unwrap().status,
                if remaining { "confirmed" } else { "completed" }
            );
            let active:bool=store.db().unwrap().query_row("SELECT active FROM sources WHERE account_id=?1 AND folder='INBOX' AND remote_id='7:12'",[&a.id],|r|r.get(0)).unwrap();
            assert_eq!(active, remaining);
            let commands = String::from_utf8(written.lock().unwrap().clone()).unwrap();
            assert_eq!(commands.matches("UID MOVE").count(), 1);
            assert!(
                !commands.contains("UID COPY")
                    && !commands.contains("STORE")
                    && !commands.contains("EXPUNGE")
                    && !commands.contains("CLOSE")
            );
        }
    }
    #[test]
    fn move_no_or_disconnect_without_mapping_never_retries() {
        for response in ["a6 NO rejected\r\n", "", "a6 OK moved without mapping\r\n"] {
            let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
            let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
            let op = store.directory_operation(&job).unwrap();
            store.claim_copy(&op).unwrap();
            let (mut session, capture, _) = session(move_replies(response, false));
            let e = apply_copy_session(&store, &op, &mut session, &capture).unwrap_err();
            store.fail_copy(&job, &e, false).unwrap();
            assert_eq!(store.directory_operation(&job).unwrap().status, "uncertain");
            assert!(store.due_copies(&a.id).unwrap().is_empty());
        }
    }
    #[test]
    fn move_receipt_with_no_recovers_readonly_and_changed_source_namespace_stays_unconfirmed() {
        let (_temp, store, _a, id) = crate::directory_operations::tests::fixture();
        let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        let (mut first, capture, _) = session(move_replies(
            "* OK [COPYUID 9 12 34]\r\na6 NO partial\r\n",
            true,
        ));
        let error = apply_copy_session(&store, &op, &mut first, &capture).unwrap_err();
        store.fail_copy(&job, &error, false).unwrap();
        for validity in [8, 7] {
            let op = store.directory_operation(&job).unwrap();
            assert_eq!(op.status, "confirmed");
            store.claim_copy(&op).unwrap();
            let (mut second, capture, written) = session(vec![
                b"a1 OK login\r\n".to_vec(),
                b"* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na2 OK examined\r\n".to_vec(),
                fetch("a3", 34, &crate::tests::raw()),
                format!("* 0 EXISTS\r\n* OK [UIDVALIDITY {validity}] valid\r\na4 OK examined\r\n")
                    .into_bytes(),
                b"a5 OK fetched\r\n".to_vec(),
            ]);
            let result = apply_copy_session(&store, &op, &mut second, &capture);
            assert_eq!(result.is_ok(), validity == 7);
            if let Err(error) = result {
                store.fail_copy(&job, &error, false).unwrap();
            }
            let commands = String::from_utf8(written.lock().unwrap().clone()).unwrap();
            assert!(
                !commands.contains("MOVE")
                    && !commands.contains("COPY")
                    && !commands.contains("STORE")
                    && !commands.contains("SELECT ")
            );
        }
        assert_eq!(store.directory_operation(&job).unwrap().status, "completed");
    }
    #[test]
    fn lost_move_mapping_observation_verifies_content_and_absence_with_no_mutation() {
        let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
        let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        store
            .submit_copy(&op, &archive::digest(&crate::tests::raw()))
            .unwrap();
        store.fail_copy(&job, "bad receipt", false).unwrap();
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO sources VALUES(?1,'Archive','9:34',?2,1)",
                rusqlite::params![a.id, id],
            )
            .unwrap();
        store.directory_action(&job, "verify").unwrap();
        for raw in [b"wrong target".as_slice(), crate::tests::raw().as_slice()] {
            let op = store.directory_operation(&job).unwrap();
            store.claim_copy(&op).unwrap();
            let (mut session, capture, written) = session(vec![
                b"a1 OK login\r\n".to_vec(),
                b"* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na2 OK examined\r\n".to_vec(),
                fetch("a3", 34, raw),
                b"* 0 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\na4 OK examined\r\n".to_vec(),
                b"a5 OK fetched\r\n".to_vec(),
            ]);
            let result = apply_copy_session(&store, &op, &mut session, &capture);
            assert_eq!(result.is_ok(), raw == crate::tests::raw().as_slice());
            if let Err(error) = result {
                store.fail_copy(&job, &error, false).unwrap();
            }
            let commands = String::from_utf8(written.lock().unwrap().clone()).unwrap();
            assert!(
                !commands.contains("MOVE")
                    && !commands.contains("COPY")
                    && !commands.contains("STORE")
                    && !commands.contains("EXPUNGE")
                    && !commands.contains("CLOSE")
            );
        }
        assert_eq!(store.directory_operation(&job).unwrap().status, "completed");
    }

    fn compatibility_job(
        store: &Store,
        id: &str,
    ) -> crate::directory_operations::DirectoryOperation {
        let job = store.queue_move(id, "INBOX", "Archive").unwrap();
        let op = store.directory_operation(&job).unwrap();
        store.claim_copy(&op).unwrap();
        let mut script = replies("a6 OK [COPYUID 9 12 34] copied\r\n", &crate::tests::raw());
        script[1] = b"* CAPABILITY IMAP4rev1 UIDPLUS\r\na2 OK caps\r\n".to_vec();
        let (mut session, capture, written) = session(script);
        apply_copy_session(store, &op, &mut session, &capture).unwrap();
        let op = store.directory_operation(&job).unwrap();
        assert_eq!(op.status, "cleanup_pending");
        assert_eq!(op.strategy.as_deref(), Some("copy-delete"));
        let commands = String::from_utf8_lossy(&written.lock().unwrap()).into_owned();
        assert_eq!(commands.matches("UID COPY").count(), 1);
        assert!(
            !commands.contains("STORE")
                && !commands.contains("EXPUNGE")
                && !commands.contains("MOVE")
        );
        op
    }
    fn cleanup_replies() -> Vec<Vec<u8>> {
        vec![
            b"a1 OK login\r\n".to_vec(),
            b"* CAPABILITY IMAP4rev1 UIDPLUS\r\na2 OK caps\r\n".to_vec(),
            b"* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na3 OK examined\r\n".to_vec(),
            fetch("a4", 34, &crate::tests::raw()),
            b"* 2 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\na5 OK selected\r\n".to_vec(),
            fetch("a6", 12, &crate::tests::raw()),
            b"a7 OK marked\r\n".to_vec(),
            b"* 1 FETCH (UID 12 FLAGS (\\Deleted \\Seen custom))\r\na8 OK flags\r\n".to_vec(),
            b"* 1 EXPUNGE\r\na9 OK expunged\r\n".to_vec(),
            b"* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na10 OK examined\r\n".to_vec(),
            fetch("a11", 34, &crate::tests::raw()),
            b"* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\na12 OK examined\r\n".to_vec(),
            b"a13 OK fetched\r\n".to_vec(),
        ]
    }
    #[test]
    fn no_move_compatibility_persists_copy_then_only_expunges_exact_uid_after_full_verification() {
        let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO sources VALUES(?1,'INBOX','7:99',?2,1)",
                rusqlite::params![a.id, id],
            )
            .unwrap();
        let op = compatibility_job(&store, &id);
        store.claim_copy(&op).unwrap();
        let (mut session, capture, written) = session(cleanup_replies());
        apply_copy_session(&store, &op, &mut session, &capture).unwrap();
        assert_eq!(
            store.directory_operation(&op.id).unwrap().status,
            "completed"
        );
        assert!(store.has_source(&a.id, "Archive", "9:34").unwrap());
        let active: bool = store
            .db()
            .unwrap()
            .query_row(
                "SELECT active FROM sources WHERE folder='INBOX' AND remote_id='7:12'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!active);
        assert!(store.has_source(&a.id, "INBOX", "7:99").unwrap());
        assert_eq!(
            store.message_raw(&store.mail(&id).unwrap()).unwrap(),
            crate::tests::raw()
        );
        let commands = String::from_utf8_lossy(&written.lock().unwrap()).into_owned();
        assert!(commands.contains("UID STORE 12 +FLAGS.SILENT (\\Deleted)"));
        assert_eq!(commands.matches("UID EXPUNGE 12").count(), 1);
        assert!(
            !commands.contains("COPY")
                && !commands.contains("MOVE")
                && !commands.contains("CLOSE")
                && !commands.contains(" EXPUNGE\r\n")
        );
        assert!(
            commands.find("UID FETCH 34 (UID BODY.PEEK[])").unwrap()
                < commands.find("UID STORE").unwrap()
        );
    }
    #[test]
    fn compatibility_wrong_target_source_namespace_content_or_capability_never_mutates_source() {
        for variant in 0..5 {
            let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
            let op = compatibility_job(&store, &id);
            store.claim_copy(&op).unwrap();
            let mut script = cleanup_replies();
            match variant {
                0 => script[1] = b"* CAPABILITY IMAP4rev1\r\na2 OK caps\r\n".to_vec(),
                1 => {
                    script[2] = b"* 1 EXISTS\r\n* OK [UIDVALIDITY 10] changed\r\na3 OK examined\r\n"
                        .to_vec()
                }
                2 => script[3] = fetch("a4", 34, b"wrong target"),
                3 => {
                    script[4] =
                        b"* 1 EXISTS\r\n* OK [UIDVALIDITY 8] changed\r\na5 OK selected\r\n".to_vec()
                }
                _ => script[5] = fetch("a6", 12, b"wrong source"),
            }
            let (mut session, capture, written) = session(script);
            let e = apply_copy_session(&store, &op, &mut session, &capture).unwrap_err();
            store.fail_copy(&op.id, &e, false).unwrap();
            assert_eq!(
                store.directory_operation(&op.id).unwrap().status,
                "cleanup_blocked"
            );
            assert!(store.due_copies(&a.id).unwrap().is_empty());
            let commands = String::from_utf8_lossy(&written.lock().unwrap()).into_owned();
            assert!(
                !commands.contains("STORE")
                    && !commands.contains("EXPUNGE")
                    && !commands.contains("COPY")
            );
        }
    }
    #[test]
    fn interrupted_cleanup_is_readonly_until_explicit_continuation_and_never_recopies() {
        for boundary in [6, 7, 8] {
            let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
            let op = compatibility_job(&store, &id);
            store.claim_copy(&op).unwrap();
            let mut script = cleanup_replies();
            script[boundary] = vec![];
            let (mut first, capture, _) = session(script);
            let e = apply_copy_session(&store, &op, &mut first, &capture).unwrap_err();
            store.fail_copy(&op.id, &e, false).unwrap();
            assert_eq!(
                store.directory_operation(&op.id).unwrap().status,
                "cleanup_uncertain"
            );
            assert!(store.due_copies(&a.id).unwrap().is_empty());
            store.directory_action(&op.id, "verify").unwrap();
            let op = store.directory_operation(&op.id).unwrap();
            store.claim_copy(&op).unwrap();
            let (mut second, capture, written) = session(vec![
                b"a1 OK login\r\n".to_vec(),
                b"* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\na2 OK examined\r\n".to_vec(),
                fetch("a3", 34, &crate::tests::raw()),
                b"* 1 EXISTS\r\n* OK [UIDVALIDITY 7] valid\r\na4 OK examined\r\n".to_vec(),
                b"* 1 FETCH (UID 12)\r\na5 OK fetched\r\n".to_vec(),
            ]);
            let e = apply_copy_session(&store, &op, &mut second, &capture).unwrap_err();
            store.fail_copy(&op.id, &e, false).unwrap();
            let commands = String::from_utf8_lossy(&written.lock().unwrap()).into_owned();
            for forbidden in ["COPY", "MOVE", "STORE", "EXPUNGE", "SELECT "] {
                assert!(!commands.contains(forbidden));
            }
            store.directory_action(&op.id, "continue_move").unwrap();
            let op = store.directory_operation(&op.id).unwrap();
            store.claim_copy(&op).unwrap();
            let (mut third, capture, written) = session(cleanup_replies());
            apply_copy_session(&store, &op, &mut third, &capture).unwrap();
            assert_eq!(
                store.directory_operation(&op.id).unwrap().status,
                "completed"
            );
            assert!(!String::from_utf8_lossy(&written.lock().unwrap()).contains("COPY"));
        }
    }
    #[test]
    fn cleanup_checks_deleted_flag_and_rechecks_target_and_absence_after_expunge() {
        for variant in 0..3 {
            let (_temp, store, _a, id) = crate::directory_operations::tests::fixture();
            let op = compatibility_job(&store, &id);
            store.claim_copy(&op).unwrap();
            let mut script = cleanup_replies();
            match variant {
                0 => script[7] = b"* 1 FETCH (UID 12 FLAGS (\\Seen))\r\na8 OK flags\r\n".to_vec(),
                1 => script[10] = fetch("a11", 34, b"changed target"),
                _ => script[12] = b"* 1 FETCH (UID 12)\r\na13 OK still there\r\n".to_vec(),
            }
            let (mut session, capture, written) = session(script);
            let e = apply_copy_session(&store, &op, &mut session, &capture).unwrap_err();
            store.fail_copy(&op.id, &e, false).unwrap();
            assert_eq!(
                store.directory_operation(&op.id).unwrap().status,
                "cleanup_uncertain"
            );
            if variant == 0 {
                assert!(!String::from_utf8_lossy(&written.lock().unwrap()).contains("EXPUNGE"));
            }
        }
    }
    #[test]
    fn compatibility_copy_without_reliable_receipt_never_schedules_source_removal() {
        for response in ["", "a6 OK copied\r\n", "a6 OK [COPYUID 10 12 34] wrong\r\n"] {
            let (_temp, store, a, id) = crate::directory_operations::tests::fixture();
            let job = store.queue_move(&id, "INBOX", "Archive").unwrap();
            let op = store.directory_operation(&job).unwrap();
            store.claim_copy(&op).unwrap();
            let mut script = replies(response, &crate::tests::raw());
            script[1] = b"* CAPABILITY IMAP4rev1 UIDPLUS\r\na2 OK caps\r\n".to_vec();
            let (mut session, capture, written) = session(script);
            let e = apply_copy_session(&store, &op, &mut session, &capture).unwrap_err();
            store.fail_copy(&job, &e, false).unwrap();
            let current = store.directory_operation(&job).unwrap();
            assert_eq!(current.status, "uncertain");
            assert_eq!(current.strategy.as_deref(), Some("copy-delete"));
            assert!(current.receipt.is_none());
            assert!(store.due_copies(&a.id).unwrap().is_empty());
            assert!(store.directory_action(&job, "continue_move").is_err());
            let commands = String::from_utf8_lossy(&written.lock().unwrap()).into_owned();
            assert!(!commands.contains("STORE") && !commands.contains("EXPUNGE"));
        }
    }
    #[test]
    fn compatibility_source_already_absent_completes_without_any_cleanup_write() {
        let (_temp, store, _a, id) = crate::directory_operations::tests::fixture();
        let op = compatibility_job(&store, &id);
        store.claim_copy(&op).unwrap();
        let mut script = cleanup_replies();
        script[5] = b"a6 OK absent\r\n".to_vec();
        let (mut session, capture, written) = session(script);
        apply_copy_session(&store, &op, &mut session, &capture).unwrap();
        assert_eq!(
            store.directory_operation(&op.id).unwrap().status,
            "completed"
        );
        let commands = String::from_utf8_lossy(&written.lock().unwrap()).into_owned();
        assert!(
            !commands.contains("COPY")
                && !commands.contains("STORE")
                && !commands.contains("EXPUNGE")
        );
    }
    #[test]
    fn compatibility_cleanup_journal_failure_prevents_network_delete() {
        let (_temp, store, _a, id) = crate::directory_operations::tests::fixture();
        let op = compatibility_job(&store, &id);
        store.claim_copy(&op).unwrap();
        store.db().unwrap().execute_batch("CREATE TRIGGER fail_cleanup BEFORE UPDATE ON directory_operations WHEN NEW.status='cleanup_submitted' BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();
        let (mut session, capture, written) = session(cleanup_replies());
        assert!(apply_copy_session(&store, &op, &mut session, &capture).is_err());
        let commands = String::from_utf8_lossy(&written.lock().unwrap()).into_owned();
        assert!(!commands.contains("STORE") && !commands.contains("EXPUNGE"));
        assert_eq!(
            store.directory_operation(&op.id).unwrap().status,
            "cleanup_running"
        );
    }
}

// APPEND receipts must not capture outgoing credentials or MIME literals.
#[derive(Default, Debug)]
struct AppendCapture {
    enabled: bool,
    input: Vec<u8>,
    tag: Option<String>,
    overflow: bool,
}
#[derive(Debug)]
struct AppendStream<T> {
    inner: T,
    capture: Arc<Mutex<AppendCapture>>,
}
impl<T: std::io::Read> std::io::Read for AppendStream<T> {
    fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(b)?;
        if let Ok(mut c) = self.capture.lock() {
            if c.enabled {
                if c.input.len() + n <= 65536 {
                    c.input.extend_from_slice(&b[..n]);
                } else {
                    c.overflow = true;
                }
            }
        }
        Ok(n)
    }
}
impl<T: Write> Write for AppendStream<T> {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        let n = self.inner.write(b)?;
        if let Ok(mut c) = self.capture.lock() {
            if c.enabled && c.tag.is_none() {
                c.tag = std::str::from_utf8(&b[..n.min(128)])
                    .ok()
                    .and_then(|s| s.split_whitespace().next())
                    .map(str::to_string);
            }
        }
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}
fn append_uid(c: &AppendCapture, validity: u32) -> Result<Option<u32>> {
    use imap_proto::{Response, Status};
    if c.overflow {
        return Err("上传响应超出大小限制，只能核对结果".into());
    }
    let tag = c.tag.as_deref().ok_or("上传命令标识缺失")?;
    let mut bytes = c.input.as_slice();
    while !bytes.is_empty() {
        let (rest, response) = imap_proto::parse_response(bytes)
            .map_err(|_| "上传响应无效或未完整传输，只能核对结果")?;
        bytes = rest;
        if let Response::Done {
            tag: actual,
            status: Status::Ok,
            information,
            ..
        } = response
        {
            if actual.as_bytes() != tag.as_bytes() {
                continue;
            }
            let Some(info) = information else {
                return Ok(None);
            };
            let Some(code) = info
                .strip_prefix('[')
                .and_then(|s| s.split_once(']').map(|(code, _)| code))
            else {
                return Ok(None);
            };
            let fields: Vec<_> = code.split_whitespace().collect();
            if fields
                .first()
                .is_none_or(|v| !v.eq_ignore_ascii_case("APPENDUID"))
            {
                return Ok(None);
            }
            let one = |s: &str| s.parse::<u32>().ok().filter(|v| *v > 0);
            if fields.len() != 3 || one(fields[1]) != Some(validity) {
                return Err("上传回执的目录标识不匹配，只能核对结果".into());
            }
            return one(fields[2])
                .map(Some)
                .ok_or("上传回执 UID 无效，只能核对结果".into());
        }
    }
    Err("上传完成确认缺失，只能核对结果".into())
}
fn append_rejection(c: &AppendCapture) -> Option<String> {
    use imap_proto::{Response, Status};
    if c.overflow {
        return None;
    }
    let tag = c.tag.as_deref()?;
    let mut bytes = c.input.as_slice();
    while !bytes.is_empty() {
        let (rest, response) = imap_proto::parse_response(bytes).ok()?;
        bytes = rest;
        if let Response::Done {
            tag: actual,
            status: Status::No | Status::Bad,
            information,
            ..
        } = response
        {
            if actual.as_bytes() == tag.as_bytes() {
                return Some(
                    information
                        .unwrap_or("服务器拒绝 APPEND")
                        .chars()
                        .take(256)
                        .collect(),
                );
            }
        }
    }
    None
}
// Preserve all original headers and the complete MIME body/attachments.
// Relays may add trace/signature headers; those additions do not duplicate a send.
fn sent_headers_match(
    original: &[mailparse::MailHeader<'_>],
    server: &[mailparse::MailHeader<'_>],
    renamed: bool,
) -> bool {
    use mailparse::MailHeaderMap;
    for h in original {
        let name = h.get_key();
        if renamed && name.eq_ignore_ascii_case("Message-ID") {
            continue;
        }
        if original.get_all_values(&name) != server.get_all_values(&name) {
            return false;
        }
    }
    for name in [
        "From",
        "Sender",
        "Reply-To",
        "To",
        "Cc",
        "Bcc",
        "Date",
        "Subject",
        "Message-ID",
        "In-Reply-To",
        "References",
        "MIME-Version",
        "Content-Type",
        "Content-Transfer-Encoding",
        "Content-Disposition",
        "Content-ID",
    ] {
        if renamed && name == "Message-ID" {
            continue;
        }
        if original.get_all_values(name) != server.get_all_values(name) {
            return false;
        }
    }
    true
}
#[cfg(test)]
fn sent_content_matches(local: &[u8], remote: &[u8]) -> Result<bool> {
    sent_content_matches_id(local, remote, false)
}
fn sent_content_matches_id(local: &[u8], remote: &[u8], renamed: bool) -> Result<bool> {
    use mailparse::MailHeaderMap;
    let (original, start) = mailparse::parse_headers(local).map_err(err)?;
    let (server, server_start) = mailparse::parse_headers(remote).map_err(err)?;
    if !sent_headers_match(&original, &server, renamed) {
        return Ok(false);
    }
    let body = &local[start..];
    let server_body = &remote[server_start..];
    if body != server_body {
        // Compare a narrowly observed empty multipart epilogue; preserve raw MIME.
        let kind = mailparse::parse_content_type(
            &original.get_first_value("Content-Type").unwrap_or_default(),
        );
        let closing = kind.params.get("boundary").map(|v| format!("--{v}--\r\n"));
        if !kind.mimetype.starts_with("multipart/")
            || closing.is_none_or(|v| !body.ends_with(v.as_bytes()))
            || !matches!(
                server_body.strip_prefix(body),
                Some(b"\r\n") | Some(b"\r\n\r\n")
            )
        {
            return Ok(false);
        }
    }
    Ok(true)
}
fn sent_fetch_match<T: std::io::Read + Write>(
    session: &mut imap::Session<T>,
    uid: u32,
    raw: &[u8],
    renamed: bool,
) -> Result<String> {
    let result = session
        .uid_fetch(uid.to_string(), "(UID BODY.PEEK[])")
        .map_err(err)?;
    if result.len() != 1 || result[0].uid != Some(uid) {
        return Err("已发送副本不存在或返回编号不匹配，只能核对结果".into());
    }
    let body = result[0].body().ok_or("已发送副本未返回完整原件")?;
    if !sent_content_matches_id(raw, body, renamed)? {
        return Err("服务器副本的邮件头或 MIME 内容不同，请人工核对；不会再次上传".into());
    }
    let (headers, _) = mailparse::parse_headers(body).map_err(err)?;
    use mailparse::MailHeaderMap;
    let values = headers.get_all_values("Message-ID");
    if values.len() != 1
        || archive::message_ids(&values[0]) != values
        || values[0].len() > 998
        || !values[0].is_ascii()
    {
        return Err("服务器副本 Message-ID 无效".into());
    }
    Ok(values[0].clone())
}
fn sent_find<T: std::io::Read + Write>(
    session: &mut imap::Session<T>,
    u: &crate::sent_uploads::SentUpload,
    raw: &[u8],
    allow_renamed: bool,
) -> Result<Option<(u32, String)>> {
    use mailparse::MailHeaderMap;
    let mid = u.message_id.replace('\\', "\\\\").replace('"', "\\\"");
    let ids = session
        .uid_search(format!("HEADER Message-ID \"{mid}\""))
        .map_err(err)?;
    if ids.len() > 1 {
        return Err("已发送目录有多个匹配副本，请人工核对；不会再次上传".into());
    }
    if let Some(uid) = ids.into_iter().next() {
        return Ok(Some((uid, sent_fetch_match(session, uid, raw, false)?)));
    }
    if !allow_renamed {
        return Ok(None);
    }
    // QQ rewrites Message-ID in its automatic SMTP archive. A generated random
    // multipart boundary plus all immutable headers and the entire MIME payload
    // identify the outgoing instance. Equal subject/date alone is never enough.
    let (headers, _) = mailparse::parse_headers(raw).map_err(err)?;
    let kind =
        mailparse::parse_content_type(&headers.get_first_value("Content-Type").unwrap_or_default());
    if !kind.mimetype.starts_with("multipart/")
        || kind.params.get("boundary").is_none_or(|v| v.len() < 16)
    {
        return Ok(None);
    }
    let Some(date) = headers
        .get_first_value("Date")
        .and_then(|v| chrono::DateTime::parse_from_rfc2822(&v).ok())
    else {
        return Ok(None);
    };
    let from = archive::addresses(&headers.get_first_value("From").unwrap_or_default())?;
    if from.len() != 1 {
        return Ok(None);
    }
    let query = format!(
        "SENTSINCE {} SENTBEFORE {}",
        (date - chrono::Duration::days(1)).format("%d-%b-%Y"),
        (date + chrono::Duration::days(2)).format("%d-%b-%Y")
    );
    let ids = session.uid_search(query).map_err(err)?;
    // QQ can return a broad result despite date keys. Header batches remain
    // bounded; download full MIME only after every original header matches.
    if ids.len() > 1000 || ids.contains(&0) {
        return Err("已发送邮件头候选过多或编号无效，无法完整核对；不会上传".into());
    }
    let mut ids: Vec<u32> = ids.into_iter().collect();
    ids.sort_unstable();
    let mut candidates = Vec::new();
    for batch in ids.chunks(50) {
        let set = batch
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let fetched = session
            .uid_fetch(set, "(UID BODY.PEEK[HEADER])")
            .map_err(err)?;
        let returned: std::collections::HashSet<u32> =
            fetched.iter().filter_map(|v| v.uid).collect();
        if fetched.len() != batch.len()
            || returned.len() != batch.len()
            || batch.iter().any(|uid| !returned.contains(uid))
        {
            return Err("候选目录在核对中变化或返回编号无效，请刷新后只读核对".into());
        }
        for message in fetched.iter() {
            let header = message.header().ok_or("候选副本缺少邮件头")?;
            let (remote, _) = mailparse::parse_headers(header).map_err(err)?;
            if sent_headers_match(&headers, &remote, true) {
                candidates.push(message.uid.unwrap());
            }
        }
    }
    if candidates.len() > 20 {
        return Err("全文候选副本过多，无法唯一核对；不会上传".into());
    }
    let mut found = None;
    for uid in candidates {
        let server_id = sent_fetch_match(session, uid, raw, true)?;
        if found.is_some() {
            return Err("有多个全文一致的改写标识副本，不能猜测目录来源".into());
        }
        found = Some((uid, server_id));
    }
    Ok(found)
}
fn upload_sent_session<T: std::io::Read + Write>(
    store: &Store,
    job: &crate::sent_uploads::SentUpload,
    session: &mut imap::Session<T>,
    capture: &Arc<Mutex<AppendCapture>>,
) -> Result<()> {
    let mut u = store.sent_upload(&job.id)?.ok_or("上传任务不存在")?;
    let (account, raw) = store.upload_content(&u)?;
    let allow_renamed = account.provider == "qq";
    let target = store.upload_target(&u)?;
    let mailbox = examine_verified(session, &target)?;
    let validity = mailbox_uid_validity(session, &target, &mailbox)?
        .ok_or("已发送目录缺少可靠 UIDVALIDITY，未执行上传")?;
    let read_only = job.status != "queued";
    if read_only {
        if u.validity != validity || u.target != target {
            return Err("原上传目录的 UIDVALIDITY 已变化，不能确认旧上传结果".into());
        }
    } else {
        store.bind_upload(&u, &target, validity)?;
        u = store.sent_upload(&u.id)?.unwrap();
    }
    // Tencent may reject writes after EXAMINE. SELECT changes session access
    // only; it never marks/deletes mail and we never issue CLOSE/EXPUNGE.
    let selected = session.select(&u.target).map_err(err)?;
    if selected.uid_validity != Some(u.validity) {
        return Err("上传前目录 UIDVALIDITY 无法确认或已变化，尚未提交".into());
    }
    if let Some(uid) = u.uid {
        let server_id = sent_fetch_match(session, uid, &raw, allow_renamed)?;
        if !u.server_message_id.is_empty() && server_id != u.server_message_id {
            return Err("已确认的服务器 Message-ID 已变化，请人工核对".into());
        }
        store.set_upload_server_id(&u.id, &server_id)?;
        store.receipt_upload(&u, uid)?;
        return store.complete_upload(&store.sent_upload(&u.id)?.unwrap());
    }
    if let Some((uid, server_id)) = sent_find(session, &u, &raw, allow_renamed)? {
        store.set_upload_server_id(&u.id, &server_id)?;
        store.receipt_upload(&u, uid)?;
        return store.complete_upload(&store.sent_upload(&u.id)?.unwrap());
    }
    if read_only {
        return Err("暂未找到唯一且内容一致的已发送副本；不会重新上传，请稍后只读核对".into());
    }
    store.submit_upload(&u)?;
    *capture.lock().map_err(err)? = AppendCapture {
        enabled: true,
        ..Default::default()
    };
    // imap 2.4 does not escape the mailbox in its APPEND builder.
    let quoted = u.target.replace('\\', "\\\\").replace('"', "\\\"");
    let (headers, _) = mailparse::parse_headers(&raw).map_err(err)?;
    use mailparse::MailHeaderMap;
    let date = headers
        .get_first_value("Date")
        .and_then(|v| chrono::DateTime::parse_from_rfc2822(&v).ok());
    let result =
        session.append_with_flags_and_date(&quoted, &raw, &[imap::types::Flag::Seen], date);
    capture.lock().map_err(err)?.enabled = false;
    if matches!(&result, Err(imap::error::Error::Append)) {
        // imap 2.4 emits Error::Append exclusively before writing the literal.
        // A tagged NO/BAD therefore proves this attempt transmitted no MIME.
        if let Some(reason) = append_rejection(&*capture.lock().map_err(err)?) {
            let error = format!("服务器明确拒绝上传，原件尚未传输：{reason}");
            store.reject_upload_before_literal(&u.id, &error)?;
            return Err(error);
        }
    }
    result.map_err(|e| format!("上传已提交但确认未取得：{e}；不会自动重复上传"))?;
    let uid = append_uid(&*capture.lock().map_err(err)?, u.validity)?;
    if let Some(uid) = uid {
        store.receipt_upload(&u, uid)?;
    }
    // Reopen read-only after APPEND; never CLOSE/EXPUNGE or change other flags.
    let mailbox = examine_verified(session, &u.target)?;
    let current = mailbox_uid_validity(session, &u.target, &mailbox)?;
    if current != Some(u.validity) {
        return Err("上传后目标目录的 UIDVALIDITY 已变化，只能核对结果".into());
    }
    let uid = match uid {
        Some(uid) => {
            let server_id = sent_fetch_match(session, uid, &raw, allow_renamed)?;
            store.set_upload_server_id(&u.id, &server_id)?;
            uid
        }
        None => {
            let (uid, server_id) = sent_find(session, &u, &raw, allow_renamed)?
                .ok_or("上传成功响应已收到，但副本尚未核对到；不会再次上传")?;
            store.set_upload_server_id(&u.id, &server_id)?;
            uid
        }
    };
    if u.uid.is_none() && store.sent_upload(&u.id)?.unwrap().uid.is_none() {
        store.receipt_upload(&u, uid)?;
    }
    store.complete_upload(&store.sent_upload(&u.id)?.unwrap())
}
pub(crate) fn upload_sent(store: &Store, job: &crate::sent_uploads::SentUpload) -> Result<()> {
    let target = store.upload_target(job)?;
    let gate = crate::sync_control::folder_gate(&store.root, &job.account_id, &target)?;
    let _guard = gate.lock().map_err(err)?;
    let (a, _) = store.upload_content(job)?;
    let capture = Arc::new(Mutex::new(AppendCapture::default()));
    let shared = capture.clone();
    let mut session =
        imap_session_using(&a, &auth::credentials(&a)?, None, |inner| AppendStream {
            inner,
            capture: shared,
        })?;
    upload_sent_session(store, job, &mut session, &capture)
}

#[cfg(test)]
mod sent_tests {
    use super::*;
    use std::{
        collections::VecDeque,
        io::{Cursor, Read},
    };
    #[derive(Debug)]
    struct Wire {
        responses: VecDeque<Vec<u8>>,
        current: Cursor<Vec<u8>>,
        pending: bool,
        written: Arc<Mutex<Vec<u8>>>,
    }
    impl Read for Wire {
        fn read(&mut self, b: &mut [u8]) -> std::io::Result<usize> {
            self.current.read(b)
        }
    }
    impl Write for Wire {
        fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
            self.written.lock().unwrap().extend(b);
            self.pending = true;
            Ok(b.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            if self.pending {
                self.current = Cursor::new(self.responses.pop_front().unwrap_or_default());
                self.pending = false;
            }
            Ok(())
        }
    }
    fn session(
        replies: Vec<Vec<u8>>,
    ) -> (
        imap::Session<AppendStream<Wire>>,
        Arc<Mutex<AppendCapture>>,
        Arc<Mutex<Vec<u8>>>,
    ) {
        let written = Arc::new(Mutex::new(Vec::new()));
        let capture = Arc::new(Mutex::new(AppendCapture::default()));
        let wire = Wire {
            responses: replies.into(),
            current: Cursor::new(Vec::new()),
            pending: false,
            written: written.clone(),
        };
        let client = imap::Client::new(AppendStream {
            inner: wire,
            capture: capture.clone(),
        });
        (
            client.login("fixture", "not-real").unwrap(),
            capture,
            written,
        )
    }
    fn examine(tag: &str, v: u32) -> Vec<u8> {
        format!("* 1 EXISTS\r\n* OK [UIDVALIDITY {v}] stable\r\n{tag} OK [READ-ONLY] done\r\n")
            .into_bytes()
    }
    fn fetch(tag: &str, uid: u32, raw: &[u8]) -> Vec<u8> {
        let mut r = format!("* 1 FETCH (UID {uid} BODY[] {{{}}}\r\n", raw.len()).into_bytes();
        r.extend(raw);
        r.extend(format!(")\r\n{tag} OK done\r\n").as_bytes());
        r
    }
    fn claim(s: &Store, id: &str) -> crate::sent_uploads::SentUpload {
        let u = s.sent_upload(id).unwrap().unwrap();
        assert!(s.claim_upload(&u).unwrap());
        u
    }
    #[test]
    fn append_uid_receipt_content_verification_and_source_link() {
        let (_temp, s, a, id, raw) = crate::sent_uploads::tests::fixture();
        let u = claim(&s, &id);
        let (mut session, c, w) = session(vec![
            b"a1 OK login\r\n".to_vec(),
            examine("a2", 7),
            examine("a3", 7),
            b"* SEARCH\r\na4 OK searched\r\n".to_vec(),
            b"+ ready\r\n".to_vec(),
            b"a5 OK [APPENDUID 7 9] appended\r\n".to_vec(),
            examine("a6", 7),
            fetch("a7", 9, &raw),
        ]);
        upload_sent_session(&s, &u, &mut session, &c).unwrap();
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "completed");
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().origin, "appended");
        assert!(s.has_source(&a.id, "Sent Messages", "7:9").unwrap());
        assert_eq!(
            String::from_utf8_lossy(&w.lock().unwrap())
                .matches(" APPEND ")
                .count(),
            1
        );
        assert!(!c.lock().unwrap().input.windows(20).any(|v| v == &raw[..20]));
    }
    #[test]
    fn existing_relay_copy_and_missing_appenduid_never_create_extra_duplicates() {
        let (_temp, s, _, id, raw) = crate::sent_uploads::tests::fixture();
        let u = claim(&s, &id);
        let mut relayed = b"Received: relay-added-trace\r\n".to_vec();
        relayed.extend(&raw);
        let (mut session, c, w) = session(vec![
            b"a1 OK login\r\n".to_vec(),
            examine("a2", 7),
            examine("a3", 7),
            b"* SEARCH 9\r\na4 OK searched\r\n".to_vec(),
            fetch("a5", 9, &relayed),
        ]);
        upload_sent_session(&s, &u, &mut session, &c).unwrap();
        assert!(!String::from_utf8_lossy(&w.lock().unwrap()).contains("APPEND"));
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().origin, "existing");
        let (_temp, s, _, id, raw) = crate::sent_uploads::tests::fixture();
        let u = claim(&s, &id);
        let (mut session, c, _) = self::session(vec![
            b"a1 OK login\r\n".to_vec(),
            examine("a2", 7),
            examine("a3", 7),
            b"* SEARCH\r\na4 OK searched\r\n".to_vec(),
            b"+ ready\r\n".to_vec(),
            b"a5 OK appended\r\n".to_vec(),
            examine("a6", 7),
            b"* SEARCH 9\r\na7 OK searched\r\n".to_vec(),
            fetch("a8", 9, &raw),
        ]);
        upload_sent_session(&s, &u, &mut session, &c).unwrap();
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().uid, Some(9));
    }
    #[test]
    fn lost_confirmation_only_recovers_by_observation_and_never_reappends() {
        let (temp, s, _, id, raw) = crate::sent_uploads::tests::fixture();
        let u = claim(&s, &id);
        let (mut wire, c, _) = session(vec![
            b"a1 OK login\r\n".to_vec(),
            examine("a2", 7),
            examine("a3", 7),
            b"* SEARCH\r\na4 OK searched\r\n".to_vec(),
            b"+ ready\r\n".to_vec(),
            vec![],
        ]);
        assert!(upload_sent_session(&s, &u, &mut wire, &c).is_err());
        s.fail_upload(&id, "lost").unwrap();
        let s = Store::new(temp.path().into()).unwrap();
        assert!(s.due_uploads().unwrap().is_empty());
        assert!(s.sent_upload_action(&id, "retry").is_err());
        s.sent_upload_action(&id, "verify").unwrap();
        let u = claim(&s, &id);
        let (mut wire, c, w) = session(vec![
            b"a1 OK login\r\n".to_vec(),
            examine("a2", 7),
            examine("a3", 7),
            b"* SEARCH 9\r\na4 OK searched\r\n".to_vec(),
            fetch("a5", 9, &raw),
        ]);
        upload_sent_session(&s, &u, &mut wire, &c).unwrap();
        assert!(!String::from_utf8_lossy(&w.lock().unwrap()).contains("APPEND"));
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "completed");
    }
    #[test]
    fn ambiguous_copies_content_changes_and_receipt_mismatch_stop_upload() {
        for ids in ["9 10", "9"] {
            let (_temp, s, _, id, raw) = crate::sent_uploads::tests::fixture();
            let u = claim(&s, &id);
            let mut replies = vec![
                b"a1 OK login\r\n".to_vec(),
                examine("a2", 7),
                examine("a3", 7),
                format!("* SEARCH {ids}\r\na4 OK searched\r\n").into_bytes(),
            ];
            if ids == "9" {
                let mut changed = raw.clone();
                changed.extend(b"changed");
                replies.push(fetch("a5", 9, &changed));
            }
            let (mut wire, c, w) = session(replies);
            assert!(upload_sent_session(&s, &u, &mut wire, &c).is_err());
            assert!(!String::from_utf8_lossy(&w.lock().unwrap()).contains("APPEND"));
        }
        for receipt in [
            "a5 OK [APPENDUID 8 9] done\r\n",
            "a5 OK [APPENDUID 7 9:9] done\r\n",
        ] {
            let (_temp, s, _, id, _) = crate::sent_uploads::tests::fixture();
            let u = claim(&s, &id);
            let (mut wire, c, _) = session(vec![
                b"a1 OK login\r\n".to_vec(),
                examine("a2", 7),
                examine("a3", 7),
                b"* SEARCH\r\na4 OK searched\r\n".to_vec(),
                b"+ ready\r\n".to_vec(),
                receipt.as_bytes().to_vec(),
            ]);
            assert!(upload_sent_session(&s, &u, &mut wire, &c).is_err());
            s.fail_upload(&id, "bad receipt").unwrap();
            assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "uncertain");
        }
    }
    #[test]
    fn original_headers_mime_and_attachment_bytes_are_preserved() {
        let (_temp, _, _, _, raw) = crate::sent_uploads::tests::fixture();
        let mut traced = b"DKIM-Signature: relay\r\n".to_vec();
        traced.extend(&raw);
        assert!(sent_content_matches(&raw, &traced).unwrap());
        let mut changed = b"Reply-To: stranger@example.com\r\n".to_vec();
        changed.extend(&raw);
        assert!(!sent_content_matches(&raw, &changed).unwrap());
        for tail in [b"\r\n".as_slice(), b"\r\n\r\n".as_slice()] {
            let mut padded = raw.clone();
            padded.extend(tail);
            assert!(sent_content_matches(&raw, &padded).unwrap());
        }
        for tail in [b"extra epilogue".as_slice(), b"\r\n\r\n\r\n".as_slice()] {
            let mut changed = raw.clone();
            changed.extend(tail);
            assert!(!sent_content_matches(&raw, &changed).unwrap());
        }
        let plain = b"Message-ID: <plain@example.com>\r\nContent-Type: text/plain\r\n\r\nbody\r\n";
        let mut padded = plain.to_vec();
        padded.extend(b"\r\n");
        assert!(!sent_content_matches(plain, &padded).unwrap());
        let mut changed = raw.clone();
        changed.extend(b"modified body");
        assert!(!sent_content_matches(&raw, &changed).unwrap());
    }
    #[test]
    fn qq_rewritten_identifier_requires_unique_complete_payload_and_preserves_reply_links() {
        for duplicate in [false, true] {
            let (_temp, s, mut a, id, raw) = crate::sent_uploads::tests::fixture();
            a.provider = "qq".into();
            s.save_account(&a).unwrap();
            let u = claim(&s, &id);
            let remote = String::from_utf8(raw.clone())
                .unwrap()
                .replace(&u.message_id, "<rewritten@example.com>")
                .into_bytes();
            let (_, end) = mailparse::parse_headers(&remote).unwrap();
            let mut replies = vec![
                b"a1 OK login\r\n".to_vec(),
                examine("a2", 7),
                examine("a3", 7),
                b"* SEARCH\r\na4 OK searched\r\n".to_vec(),
                if duplicate {
                    b"* SEARCH 9 10\r\na5 OK searched\r\n".to_vec()
                } else {
                    b"* SEARCH 9\r\na5 OK searched\r\n".to_vec()
                },
            ];
            let mut header = Vec::new();
            for uid in if duplicate { vec![9, 10] } else { vec![9] } {
                header.extend(
                    format!("* 1 FETCH (UID {uid} BODY[HEADER] {{{}}}\r\n", end).as_bytes(),
                );
                header.extend(&remote[..end]);
                header.extend(b")\r\n");
            }
            header.extend(b"a6 OK done\r\n");
            replies.push(header);
            replies.push(fetch("a7", 9, &remote));
            if duplicate {
                replies.push(fetch("a8", 10, &remote));
            }
            let (mut wire, c, w) = session(replies);
            let result = upload_sent_session(&s, &u, &mut wire, &c);
            assert!(!String::from_utf8_lossy(&w.lock().unwrap()).contains("APPEND"));
            if duplicate {
                assert!(result.is_err());
                continue;
            }
            result.unwrap();
            let completed = s.sent_upload(&id).unwrap().unwrap();
            assert_eq!(completed.server_message_id, "<rewritten@example.com>");
            assert_eq!(completed.origin, "existing");
            let local = s.snapshot(&crate::tests::query()).unwrap().messages[0].clone();
            assert_eq!(s.message_raw(&s.mail(&local.id).unwrap()).unwrap(), raw);
            let reply=b"From: recipient@example.com\r\nTo: test@example.com\r\nMessage-ID: <reply@example.com>\r\nIn-Reply-To: <rewritten@example.com>\r\nSubject: reply\r\nDate: Wed, 07 Oct 2026 00:00:00 +0000\r\n\r\nreply";
            s.ingest(&a, "INBOX", "7:12", reply, true).unwrap();
            assert_eq!(s.conversation(&local.id).unwrap().len(), 2);
        }
    }
    #[test]
    fn broad_qq_date_search_prefilters_headers_and_fetches_only_one_complete_candidate() {
        let (_temp, s, mut a, id, raw) = crate::sent_uploads::tests::fixture();
        a.provider = "qq".into();
        s.save_account(&a).unwrap();
        let u = claim(&s, &id);
        let remote = String::from_utf8(raw.clone())
            .unwrap()
            .replace(&u.message_id, "<rewritten@example.com>")
            .into_bytes();
        let (_, end) = mailparse::parse_headers(&remote).unwrap();
        let list = (1..=30)
            .map(|n| n.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        let mut headers = Vec::new();
        for uid in 1..=30 {
            let mut header = remote[..end].to_vec();
            if uid != 30 {
                header = [b"Subject: unrelated\r\n".as_slice(), header.as_slice()].concat();
            }
            headers.extend(
                format!(
                    "* {uid} FETCH (UID {uid} BODY[HEADER] {{{}}}\r\n",
                    header.len()
                )
                .as_bytes(),
            );
            headers.extend(header);
            headers.extend(b")\r\n");
        }
        headers.extend(b"a6 OK done\r\n");
        let (mut wire, c, w) = session(vec![
            b"a1 OK login\r\n".to_vec(),
            examine("a2", 7),
            examine("a3", 7),
            b"* SEARCH\r\na4 OK done\r\n".to_vec(),
            format!("* SEARCH {list}\r\na5 OK done\r\n").into_bytes(),
            headers,
            fetch("a7", 30, &remote),
        ]);
        upload_sent_session(&s, &u, &mut wire, &c).unwrap();
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().uid, Some(30));
        let commands = String::from_utf8_lossy(&w.lock().unwrap()).into_owned();
        assert_eq!(commands.matches("BODY.PEEK[]").count(), 1);
        assert!(!commands.contains("APPEND"));
    }
    #[test]
    fn tagged_rejection_before_literal_is_retryable_without_resending_smtp() {
        let (_temp, s, _, id, raw) = crate::sent_uploads::tests::fixture();
        let u = claim(&s, &id);
        let (mut wire, c, w) = session(vec![
            b"a1 OK login\r\n".to_vec(),
            examine("a2", 7),
            examine("a3", 7),
            b"* SEARCH\r\na4 OK searched\r\n".to_vec(),
            b"a5 NO APPEND not permitted\r\n".to_vec(),
        ]);
        let error = upload_sent_session(&s, &u, &mut wire, &c).unwrap_err();
        assert!(error.contains("原件尚未传输"));
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "blocked");
        assert!(!w.lock().unwrap().windows(raw.len()).any(|b| b == raw));
        s.sent_upload_action(&id, "retry").unwrap();
        assert_eq!(s.outbox().unwrap()[0].status, "sent");
        assert_eq!(s.sent_upload(&id).unwrap().unwrap().status, "queued");
    }
}
