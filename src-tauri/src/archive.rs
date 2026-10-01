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
    for (i, p) in parts.iter().enumerate() {
        if is_attachment(p) {
            let bytes = p.get_body_raw().map_err(err)?;
            attachments.push(AttachmentInfo {
                index: i,
                name: filename(p).unwrap_or_else(|| format!("附件-{}", i + 1)),
                size: bytes.len(),
                mime: p.ctype.mimetype.clone(),
            });
        } else if p.ctype.mimetype == "text/plain" {
            text.push_str(&p.get_body().map_err(err)?);
            text.push('\n');
        } else if p.ctype.mimetype == "text/html" {
            html.push_str(&p.get_body().map_err(err)?);
        }
    }
    for p in &parts {
        if ["image/png", "image/jpeg", "image/gif", "image/webp"]
            .contains(&p.ctype.mimetype.as_str())
        {
            if let Some(cid) = p.headers.get_first_value("Content-ID") {
                let cid = cid.trim_matches(['<', '>']);
                if !cid.is_empty() {
                    html = html.replace(
                        &format!("cid:{cid}"),
                        &format!(
                            "data:{};base64,{}",
                            p.ctype.mimetype,
                            STANDARD.encode(p.get_body_raw().map_err(err)?)
                        ),
                    );
                }
            }
        }
    }
    if text.trim().is_empty() {
        // Parse HTML entities and ignore stylesheet/script text in search/replies.
        text = html_text(&html);
    }
    let now = chrono::Utc::now().to_rfc3339();
    let date = parsed
        .headers
        .get_first_value("Date")
        .and_then(|s| mailparse::dateparse(&s).ok())
        .and_then(|s| chrono::DateTime::from_timestamp(s, 0))
        .map(|d| d.to_rfc3339())
        .unwrap_or_else(|| now.clone());
    let mail = Mail {
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
        local_folder: "全部存档".into(),
        trashed: false,
        has_attachments: !attachments.is_empty(),
        hash: digest(raw),
        size: raw.len() as u64,
        saved_at: now,
        source_folder: folder.into(),
    };
    Ok((mail, html, attachments))
}
pub fn attachment(raw: &[u8], index: usize) -> Result<Vec<u8>> {
    let p = mailparse::parse_mail(raw).map_err(err)?;
    let mut parts = Vec::new();
    leaves(&p, &mut parts);
    parts
        .get(index)
        .ok_or("附件不存在")?
        .get_body_raw()
        .map_err(err)
}
