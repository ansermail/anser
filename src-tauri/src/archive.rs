use crate::models::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use mailparse::{MailHeaderMap, ParsedMail};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};
pub fn digest(raw: &[u8]) -> String {
    format!("{:x}", Sha256::digest(raw))
}
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or("无效路径")?;
    fs::create_dir_all(parent).map_err(err)?;
    let temp = parent.join(format!(".{}.tmp", uuid::Uuid::new_v4()));
    let write = || -> Result<()> {
        let mut f = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(err)?;
        f.write_all(data).map_err(err)?;
        f.sync_all().map_err(err)?;
        fs::rename(&temp, path).map_err(err)?;
        File::open(parent).and_then(|f| f.sync_all()).map_err(err)?;
        Ok(())
    };
    let result = write();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn store_raw(root: &Path, raw: &[u8]) -> Result<String> {
    let hash = digest(raw);
    let path = root.join("archive").join(format!("{hash}.eml"));
    if path.exists() {
        if digest(&fs::read(&path).map_err(err)?) != hash {
            return Err("已存档文件校验失败，请从备份恢复".into());
        }
    } else {
        atomic_write(&path, raw)?;
    }
    Ok(hash)
}
pub fn read_raw(root: &Path, hash: &str) -> Result<Vec<u8>> {
    if hash.len() != 64 || !hash.bytes().all(|x| x.is_ascii_hexdigit()) {
        return Err("无效存档标识".into());
    }
    let raw = fs::read(root.join("archive").join(format!("{hash}.eml"))).map_err(err)?;
    if digest(&raw) != hash {
        return Err("存档内容校验失败".into());
    }
    Ok(raw)
}
pub fn leaves<'a>(part: &'a ParsedMail<'a>, out: &mut Vec<&'a ParsedMail<'a>>) {
    if part.subparts.is_empty() {
        out.push(part)
    } else {
        for child in &part.subparts {
            leaves(child, out)
        }
    }
}
fn filename(p: &ParsedMail) -> Option<String> {
    p.get_content_disposition()
        .params
        .get("filename")
        .cloned()
        .or_else(|| p.ctype.params.get("name").cloned())
}
fn is_attachment(p: &ParsedMail) -> bool {
    filename(p).is_some()
        || p.get_content_disposition().disposition == mailparse::DispositionType::Attachment
}
// Repair only well-defined Base64 variants; never discard arbitrary symbols
// from damaged attachments, since that could silently change their bytes.
pub fn decoded_bytes(p: &ParsedMail<'_>) -> Result<Vec<u8>> {
    p.get_body_raw().map_err(err).or_else(|original| {
        let mailparse::body::Body::Base64(body) = p.get_body_encoded() else {
            return Err(original);
        };
        let compact: Vec<u8> = body
            .get_raw()
            .iter()
            .copied()
            .filter(|b| !b.is_ascii_whitespace())
            .collect();
        let normalized: Vec<u8> = compact
            .iter()
            .map(|b| match b {
                b'-' => b'+',
                b'_' => b'/',
                other => *other,
            })
            .collect();
        let engine = base64::engine::general_purpose::GeneralPurpose::new(
            &base64::alphabet::STANDARD,
            base64::engine::general_purpose::GeneralPurposeConfig::new()
                .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent),
        );
        engine.decode(normalized).map_err(|_| original)
    })
}
fn decoded_text(p: &ParsedMail<'_>) -> Result<String> {
    if let Ok(text) = p.get_body() {
        return Ok(text);
    }
    let bytes = decoded_bytes(p)?;
    let encoding =
        encoding_rs::Encoding::for_label(p.ctype.charset.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    Ok(encoding.decode(&bytes).0.into_owned())
}
// Some older servers send raw 8-bit header names using the body's charset.
// UTF-8 and RFC 2047 encoded words keep their normal mailparse decoding.
fn header(parsed: &ParsedMail, parts: &[&ParsedMail], name: &str) -> Option<String> {
    let h = parsed.headers.get_first_header(name)?;
    let raw = h.get_value_raw();
    if std::str::from_utf8(raw).is_ok() {
        return Some(h.get_value());
    }
    for part in std::iter::once(parsed).chain(parts.iter().copied()) {
        if is_attachment(part) {
            continue;
        }
        let Some(label) = part.ctype.params.get("charset") else {
            continue;
        };
        let Some(encoding) = encoding_rs::Encoding::for_label(label.as_bytes()) else {
            continue;
        };
        if let Some(decoded) = encoding.decode_without_bom_handling_and_without_replacement(raw) {
            let line = format!("{name}: {decoded}");
            if let Ok((decoded_header, _)) = mailparse::parse_header(line.as_bytes()) {
                return Some(decoded_header.get_value());
            }
        }
    }
    Some(h.get_value())
}
pub fn addresses(value: &str) -> Result<Vec<Address>> {
    let parsed = mailparse::addrparse(value).map_err(err)?;
    let mut out = Vec::new();
    let mut push = |item: &mailparse::SingleInfo| {
        out.push(Address {
            name: item.display_name.clone().unwrap_or_default(),
            email: item.addr.clone(),
        });
    };
    for item in parsed.iter() {
        match item {
            mailparse::MailAddr::Single(item) => push(item),
            mailparse::MailAddr::Group(group) => {
                for item in &group.addrs {
                    push(item);
                }
            }
        }
    }
    Ok(out)
}
pub fn reply_addresses(raw: &[u8]) -> Result<(Vec<Address>, Vec<Address>, Vec<Address>)> {
    let parsed = mailparse::parse_mail(raw).map_err(err)?;
    let mut parts = Vec::new();
    leaves(&parsed, &mut parts);
    let get =
        |name| addresses(&header(&parsed, &parts, name).unwrap_or_default()).unwrap_or_default();
    let mut reply = get("Reply-To");
    if reply.is_empty() {
        reply = get("From");
    }
    Ok((reply, get("To"), get("Cc")))
}

// Use only bracketed, printable IDs; never turn malformed header text into
// an outgoing header or a subject-based conversation key.
pub fn message_ids(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    for segment in value.split('<').skip(1) {
        let Some((id, _)) = segment.split_once('>') else {
            continue;
        };
        if !id.is_empty()
            && id.len() <= 900
            && id.contains('@')
            && id
                .bytes()
                .all(|c| c.is_ascii_graphic() && c != b'<' && c != b'>')
        {
            let id = format!("<{id}>");
            if !out.contains(&id) {
                out.push(id);
            }
        }
    }
    out
}

fn html_text(html: &str) -> String {
    let doc = scraper::Html::parse_document(html);
    doc.root_element()
        .descendants()
        .filter_map(|node| {
            let text = node.value().as_text()?;
            if node.ancestors().any(|parent| {
                parent.value().as_element().is_some_and(|el| {
                    matches!(
                        el.name(),
                        "head" | "style" | "script" | "noscript" | "template"
                    )
                })
            }) {
                return None;
            }
            let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
            (!text.is_empty()).then_some(text)
        })
        .collect::<Vec<_>>()
        .join("\n")
}
pub fn parse(
    raw: &[u8],
    account: &Account,
    folder: &str,
) -> Result<(Mail, String, Vec<AttachmentInfo>)> {
    let parsed = mailparse::parse_mail(raw).map_err(err)?;
    let mut parts = Vec::new();
    leaves(&parsed, &mut parts);
    let mut text = String::new();
    let mut html = String::new();
    let mut attachments = Vec::new();
    let mut warnings = Vec::new();
    for (i, p) in parts.iter().enumerate() {
        if is_attachment(p) {
            let name = filename(p).unwrap_or_else(|| format!("附件-{}", i + 1));
            let (size, error) = match decoded_bytes(p) {
                Ok(bytes) => (bytes.len(), String::new()),
                Err(error) => {
                    warnings.push(format!("附件「{name}」无法解码：{error}"));
                    (0, format!("附件编码损坏，原始邮件已保留：{error}"))
                }
            };
            attachments.push(AttachmentInfo {
                index: i,
                name,
                size,
                mime: p.ctype.mimetype.clone(),
                error,
            });
        } else if matches!(p.ctype.mimetype.as_str(), "text/plain" | "text/html") {
            match decoded_text(p) {
                Ok(body) if p.ctype.mimetype == "text/html" => html.push_str(&body),
                Ok(body) => {
                    text.push_str(&body);
                    text.push('\n');
                }
                Err(error) => {
                    warnings.push(format!("{} 正文片段无法解码：{error}", p.ctype.mimetype))
                }
            }
        }
    }
    for p in &parts {
        if ["image/png", "image/jpeg", "image/gif", "image/webp"]
            .contains(&p.ctype.mimetype.as_str())
        {
            if let Some(cid) = p.headers.get_first_value("Content-ID") {
                let cid = cid.trim_matches(['<', '>']);
                if !cid.is_empty() {
                    match decoded_bytes(p) {
                        Ok(bytes) => {
                            html = html.replace(
                                &format!("cid:{cid}"),
                                &format!(
                                    "data:{};base64,{}",
                                    p.ctype.mimetype,
                                    STANDARD.encode(bytes)
                                ),
                            )
                        }
                        Err(error) => warnings.push(format!("内嵌图片无法解码：{error}")),
                    }
                }
            }
        }
    }
    if text.trim().is_empty() {
        // Parse HTML entities and ignore stylesheet/script text in search/replies.
        text = html_text(&html);
    }
    let now = chrono::Utc::now().to_rfc3339();
    let date = message_date(&parsed).unwrap_or_default();
    let mail = Mail {
        parse_warnings: warnings,
        id: uuid::Uuid::new_v4().to_string(),
        account_id: account.id.clone(),
        account_email: account.email.clone(),
        sender: header(&parsed, &parts, "From").unwrap_or_default(),
        recipients: header(&parsed, &parts, "To").unwrap_or_default(),
        subject: header(&parsed, &parts, "Subject").unwrap_or_else(|| "（无主题）".into()),
        preview: text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(140)
            .collect(),
        body: text.trim().to_string(),
        date,
        is_read: false,
        starred: false,
        local_read_override: None,
        local_star_override: None,
        local_folder: "全部存档".into(),
        trashed: false,
        has_attachments: !attachments.is_empty(),
        hash: digest(raw),
        size: raw.len() as u64,
        saved_at: now,
        saved_locally: true,
        server_date: String::new(),
        source_folder: folder.into(),
        message_id: message_ids(
            &parsed
                .headers
                .get_first_value("Message-ID")
                .unwrap_or_default(),
        )
        .into_iter()
        .next()
        .unwrap_or_default(),
        in_reply_to: message_ids(
            &parsed
                .headers
                .get_first_value("In-Reply-To")
                .unwrap_or_default(),
        ),
        references: message_ids(
            &parsed
                .headers
                .get_first_value("References")
                .unwrap_or_default(),
        ),
        conversation_id: String::new(),
        conversation_count: 0,
    };
    Ok((mail, html, attachments))
}
pub fn attachment(raw: &[u8], index: usize) -> Result<Vec<u8>> {
    let p = mailparse::parse_mail(raw).map_err(err)?;
    let mut parts = Vec::new();
    leaves(&p, &mut parts);
    decoded_bytes(parts.get(index).ok_or("附件不存在")?)
        .map_err(|e| format!("附件编码损坏，无法导出有效文件：{e}"))
}

// Download time is never an email timestamp. Missing Date can use a delivery
// trace or IMAP INTERNALDATE, otherwise the UI explicitly shows unknown time.
pub fn parse_date(value: &str) -> Option<String> {
    let value = value.trim();
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(value) {
        return Some(date.to_rfc3339());
    }
    if let Ok(date) = chrono::DateTime::parse_from_rfc2822(value) {
        return Some(date.to_rfc3339());
    }
    // mailparse tolerates legacy date syntax, but also accepts incomplete junk
    // as an epoch date. Require an actual month and time before that fallback.
    if !value.contains(':')
        || !value
            .to_ascii_lowercase()
            .split_ascii_whitespace()
            .any(|w| {
                [
                    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov",
                    "dec",
                ]
                .contains(&w)
            })
    {
        return None;
    }
    mailparse::dateparse(value)
        .ok()
        .and_then(|s| chrono::DateTime::from_timestamp(s, 0))
        .map(|d| d.to_rfc3339())
}
fn message_date(mail: &ParsedMail<'_>) -> Option<String> {
    mail.headers
        .get_first_value("Date")
        .and_then(|s| parse_date(&s))
        .or_else(|| {
            mail.headers
                .get_all_values("Received")
                .iter()
                .filter_map(|value| {
                    value
                        .rsplit_once(';')
                        .and_then(|(_, date)| parse_date(date))
                })
                .next()
        })
}
