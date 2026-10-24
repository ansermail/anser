//! Bounded MSG projection. The archive retains the original compound file.
use crate::models::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use mailparse::MailHeaderMap;
use std::{
    io::{Cursor, Read, Write},
    time::Instant,
};

fn integer(container: &mut cfb::CompoundFile<Cursor<&[u8]>>, id: u16) -> Option<u32> {
    let mut bytes = Vec::new();
    container
        .open_stream("/__properties_version1.0")
        .ok()?
        .read_to_end(&mut bytes)
        .ok()?;
    for p in bytes.get(32..)?.chunks_exact(16) {
        if u16::from_le_bytes([p[0], p[1]]) == 3 && u16::from_le_bytes([p[2], p[3]]) == id {
            return Some(u32::from_le_bytes(p[8..12].try_into().ok()?));
        }
    }
    None
}
fn codepage(value: u32) -> Result<&'static encoding_rs::Encoding> {
    let label = match value {
        65001 => "utf-8".to_string(),
        1200 => "utf-16le".to_string(),
        936 => "gbk".to_string(),
        950 => "big5".to_string(),
        932 => "shift_jis".to_string(),
        949 => "euc-kr".to_string(),
        20127 => "us-ascii".to_string(),
        28591 => "windows-1252".to_string(),
        _ => format!("windows-{value}"),
    };
    encoding_rs::Encoding::for_label(label.as_bytes()).ok_or_else(|| "unsupportedMessage".into())
}
fn normalized(raw: &[u8]) -> Result<Vec<u8>> {
    if raw.len() > crate::eml_input::MAX_BYTES as usize {
        return Err("tooLarge".into());
    }
    let started = Instant::now();
    let mut input =
        cfb::CompoundFile::open_strict(Cursor::new(raw)).map_err(|_| "invalidMessage")?;
    let entries = input.walk().take(2049).collect::<Vec<_>>();
    if entries.len() > 2048 {
        return Err("budgetExceeded".into());
    }
    let mut total = 0u64;
    for e in &entries {
        if e.path().components().count() > 32 {
            return Err("budgetExceeded".into());
        }
        if e.is_stream() {
            total = total.checked_add(e.len()).ok_or("budgetExceeded")?;
        }
        if total > crate::eml_input::MAX_BYTES {
            return Err("budgetExceeded".into());
        }
    }
    let page = integer(&mut input, 0x3FFD)
        .or_else(|| integer(&mut input, 0x3FDE))
        .unwrap_or(1252);
    // Parse only a fresh, library-generated CFB allocation table. This prevents
    // malformed sector chains and huge declared stream lengths reaching the
    // more permissive MSG property parser. No canonical bytes are archived.
    let mut output =
        cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new()))
            .map_err(err)?;
    for entry in entries {
        if started.elapsed() > crate::eml_input::TIME_LIMIT {
            return Err("budgetExceeded".into());
        }
        if entry.path() == std::path::Path::new("/") {
            continue;
        }
        if entry.is_storage() {
            // Embedded-message storages need their own reconstructed MSG. Do not
            // silently count an empty attachment as successfully imported.
            if entry.name() == "__substg1.0_3701000D" {
                return Err("unsupportedMessage".into());
            }
            output
                .create_storage_all(entry.path())
                .map_err(|_| "invalidMessage")?;
        } else if entry.is_stream() {
            let mut bytes = Vec::new();
            input
                .open_stream(entry.path())
                .map_err(|_| "invalidMessage")?
                .take(entry.len() + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "invalidMessage")?;
            if bytes.len() as u64 != entry.len() {
                return Err("invalidMessage".into());
            }
            if entry.name() == "__substg1.0_10090102" {
                if bytes.len() < 16 {
                    return Err("invalidMessage".into());
                }
                let size = u32::from_le_bytes(bytes[4..8].try_into().map_err(|_| "invalidMessage")?)
                    as usize;
                if size > 16 * 1024 * 1024 {
                    return Err("budgetExceeded".into());
                }
            }
            if let Some(parent) = entry.path().parent() {
                output
                    .create_storage_all(parent)
                    .map_err(|_| "invalidMessage")?;
            }
            let mut path = entry.path().to_path_buf();
            // The dependency treats PT_STRING8 as UTF-8. Decode MAPI ANSI using
            // its declared code page and give the parser a Unicode projection.
            if let Some(stem) = entry.name().strip_suffix("001E") {
                let unicode = path.with_file_name(format!("{stem}001F"));
                if input.is_stream(&unicode) {
                    continue;
                }
                let encoding = codepage(page)?;
                let (text, _, malformed) = encoding.decode(&bytes);
                if malformed {
                    return Err("invalidMessage".into());
                }
                bytes = text.encode_utf16().flat_map(u16::to_le_bytes).collect();
                path = unicode;
            }
            output
                .create_stream(&path)
                .map_err(|_| "invalidMessage")?
                .write_all(&bytes)
                .map_err(err)?;
        }
    }
    Ok(output.into_inner().into_inner())
}
fn clean(value: &str) -> String {
    value.chars().filter(|c| !c.is_control()).collect()
}
fn word(value: &str) -> String {
    format!("=?UTF-8?B?{}?=", STANDARD.encode(clean(value)))
}
fn encoded_name(value: &str) -> String {
    value
        .as_bytes()
        .iter()
        .map(|b| format!("%{b:02X}"))
        .collect()
}
fn part(out: &mut String, boundary: &str, mime: &str, value: &[u8]) {
    out.push_str(&format!(
        "--{boundary}\r\nContent-Type: {mime}\r\nContent-Transfer-Encoding: base64\r\n\r\n"
    ));
    for chunk in STANDARD.encode(value).as_bytes().chunks(76) {
        out.push_str(std::str::from_utf8(chunk).unwrap_or_default());
        out.push_str("\r\n");
    }
}
pub fn mime(raw: &[u8]) -> Result<Vec<u8>> {
    if raw.len() > crate::eml_input::MAX_BYTES as usize {
        return Err("tooLarge".into());
    }
    let bytes = normalized(raw)?;
    let mut original =
        cfb::CompoundFile::open_strict(Cursor::new(raw)).map_err(|_| "invalidMessage")?;
    let html_page = integer(&mut original, 0x3FDE).or_else(|| integer(&mut original, 0x3FFD));
    drop(original);
    let mut message = std::panic::catch_unwind(|| msg_parser::Outlook::from_slice(&bytes))
        .map_err(|_| "invalidMessage")?
        .map_err(|_| "invalidMessage")?;
    for value in [
        &mut message.body,
        &mut message.html,
        &mut message.subject,
        &mut message.message_class,
        &mut message.headers.raw,
    ] {
        while value.ends_with('\0') {
            value.pop();
        }
    }
    if !message.message_class.is_empty() && !message.message_class.starts_with("IPM.Note") {
        return Err("unsupportedMessage".into());
    }
    let mut canonical =
        cfb::CompoundFile::open(Cursor::new(&bytes)).map_err(|_| "invalidMessage")?;
    // PidTagBodyHtml is commonly binary. The MSG crate exposes binary properties
    // as hexadecimal strings; decode the actual stream, never display that hex.
    let html = if canonical.is_stream("/__substg1.0_10130102") {
        let mut value = Vec::new();
        canonical
            .open_stream("/__substg1.0_10130102")
            .map_err(|_| "invalidMessage")?
            .read_to_end(&mut value)
            .map_err(err)?;
        let content_type = mailparse::parse_content_type(&message.headers.content_type);
        let encoding = content_type
            .params
            .get("charset")
            .and_then(|s| encoding_rs::Encoding::for_label(s.as_bytes()))
            .or_else(|| html_page.and_then(|p| codepage(p).ok()))
            .unwrap_or(encoding_rs::UTF_8);
        let (decoded, _, malformed) = encoding.decode(&value);
        if malformed {
            return Err("unsupportedMessage".into());
        }
        decoded.trim_end_matches('\0').to_string()
    } else if message.html.is_empty() {
        message.html_from_rtf().unwrap_or_default()
    } else {
        message.html.clone()
    };
    if message.body.is_empty() && html.is_empty() && !message.rtf_compressed.is_empty() {
        return Err("unsupportedMessage".into());
    }
    let (headers, _) =
        mailparse::parse_headers(message.headers.raw.as_bytes()).map_err(|_| "invalidMessage")?;
    let mut out = String::new();
    for name in [
        "From",
        "To",
        "Cc",
        "Bcc",
        "Reply-To",
        "Date",
        "Message-ID",
        "In-Reply-To",
        "References",
        "Importance",
        "X-Priority",
    ] {
        let mut value = headers.get_first_value(name).unwrap_or_default();
        if value.is_empty() && message.headers.raw.is_empty() {
            value = match name {
                "From" => message.sender.to_string(),
                "To" => message
                    .to
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", "),
                "Cc" => message
                    .cc
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", "),
                "Bcc" => message
                    .bcc
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", "),
                _ => String::new(),
            };
        }
        if name == "Date" && value.is_empty() {
            value = chrono::DateTime::parse_from_rfc3339(&message.message_delivery_time)
                .or_else(|_| chrono::DateTime::parse_from_rfc3339(&message.client_submit_time))
                .map(|d| d.to_rfc2822())
                .unwrap_or_default();
        }
        if !value.is_empty() {
            out.push_str(&format!("{name}: {}\r\n", clean(&value)));
        }
    }
    let subject = if message.subject.is_empty() {
        headers.get_first_value("Subject").unwrap_or_default()
    } else {
        message.subject
    };
    out.push_str(&format!(
        "Subject: {}\r\nMIME-Version: 1.0\r\n",
        word(&subject)
    ));
    let token = &crate::archive::digest(raw)[..24];
    let outer = format!("anser-msg-{token}");
    let inner = format!("anser-body-{token}");
    out.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{outer}\"\r\n\r\n--{outer}\r\nContent-Type: multipart/alternative; boundary=\"{inner}\"\r\n\r\n"));
    part(
        &mut out,
        &inner,
        "text/plain; charset=utf-8",
        message.body.as_bytes(),
    );
    if !html.is_empty() {
        part(
            &mut out,
            &inner,
            "text/html; charset=utf-8",
            html.as_bytes(),
        );
    }
    out.push_str(&format!("--{inner}--\r\n"));
    for (i, attachment) in message.attachments.iter().enumerate() {
        if ![0, 1].contains(&attachment.attach_method) {
            return Err("unsupportedMessage".into());
        }
        let name = [
            &attachment.long_file_name,
            &attachment.file_name,
            &attachment.display_name,
        ]
        .into_iter()
        .find(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| format!("attachment-{}", i + 1));
        let mime = clean(&attachment.mime_tag);
        let mime = if mime.is_empty() {
            "application/octet-stream"
        } else {
            &mime
        };
        if mime.contains([';', '\"']) || !mime.contains('/') {
            return Err("invalidMessage".into());
        }
        out.push_str(&format!("--{outer}\r\nContent-Type: {mime}\r\nContent-Disposition: {}; filename*=utf-8''{}\r\nContent-Transfer-Encoding: base64\r\n",if attachment.content_id.is_empty(){"attachment"}else{"inline"},encoded_name(&clean(&name))));
        if !attachment.content_id.is_empty() {
            out.push_str(&format!(
                "Content-ID: <{}>\r\n",
                clean(&attachment.content_id).trim_matches(['<', '>'])
            ));
        }
        out.push_str("\r\n");
        for line in STANDARD
            .encode(&attachment.payload_bytes)
            .as_bytes()
            .chunks(76)
        {
            out.push_str(std::str::from_utf8(line).unwrap_or_default());
            out.push_str("\r\n");
        }
    }
    out.push_str(&format!("--{outer}--\r\n"));
    if out.len() > 256 * 1024 * 1024 {
        return Err("budgetExceeded".into());
    }
    Ok(out.into_bytes())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub(crate) fn sample() -> Vec<u8> {
        let mut c =
            cfb::CompoundFile::create_with_version(cfb::Version::V3, Cursor::new(Vec::new()))
                .unwrap();
        fn put(c: &mut cfb::CompoundFile<Cursor<Vec<u8>>>, path: &str, bytes: &[u8]) {
            c.create_storage_all(std::path::Path::new(path).parent().unwrap())
                .unwrap();
            c.create_stream(path).unwrap().write_all(bytes).unwrap();
        }
        fn text(c: &mut cfb::CompoundFile<Cursor<Vec<u8>>>, key: &str, s: &str) {
            let b = s
                .encode_utf16()
                .chain(std::iter::once(0))
                .flat_map(u16::to_le_bytes)
                .collect::<Vec<_>>();
            put(c, key, &b);
        }
        put(&mut c, "/__properties_version1.0", &[0; 32]);
        text(&mut c, "/__substg1.0_0037001F", "MSG 中文标题");
        text(&mut c, "/__substg1.0_1000001F", "MSG 纯文本正文");
        text(&mut c, "/__substg1.0_001A001F", "IPM.Note");
        text(&mut c,"/__substg1.0_007D001F","From: Sender <sender@example.test>\r\nTo: reader@example.test\r\nDate: Fri, 23 Oct 2026 08:00:00 +0800\r\nMessage-ID: <msg-qa@example.test>\r\nContent-Type: text/html; charset=utf-8\r\n");
        put(
            &mut c,
            "/__substg1.0_10130102",
            "<p>中文 HTML</p><img src=\"cid:qa\">".as_bytes(),
        );
        let a = "/__attach_version1.0_#00000000";
        put(&mut c, &format!("{a}/__properties_version1.0"), &[0; 8]);
        text(&mut c, &format!("{a}/__substg1.0_3707001F"), "测试附件.bin");
        text(
            &mut c,
            &format!("{a}/__substg1.0_370E001F"),
            "application/octet-stream",
        );
        text(&mut c, &format!("{a}/__substg1.0_3712001F"), "qa");
        put(
            &mut c,
            &format!("{a}/__substg1.0_37010102"),
            b"\0\xff\x10QA\r\n",
        );
        c.into_inner().into_inner()
    }
    #[test]
    fn msg_ansi_codepage_and_processing_boundaries_are_explicit() {
        let mut c = cfb::CompoundFile::open(Cursor::new(sample())).unwrap();
        c.remove_stream("/__substg1.0_0037001F").unwrap();
        let encoded = encoding_rs::GBK.encode("中文旧格式").0.into_owned();
        c.create_stream("/__substg1.0_0037001E")
            .unwrap()
            .write_all(&encoded)
            .unwrap();
        let mut props = vec![0; 48];
        props[32..36].copy_from_slice(&[3, 0, 0xFD, 0x3F]);
        props[40..44].copy_from_slice(&936u32.to_le_bytes());
        c.create_stream("/__properties_version1.0")
            .unwrap()
            .write_all(&props)
            .unwrap();
        // Binary HTML has its own declared internet charset (UTF-8 in transport).
        let raw = c.into_inner().into_inner();
        let projected = mime(&raw).unwrap();
        assert_eq!(
            mailparse::parse_mail(&projected)
                .unwrap()
                .headers
                .get_first_value("Subject")
                .unwrap(),
            "中文旧格式"
        );
        let mut c = cfb::CompoundFile::open(Cursor::new(raw)).unwrap();
        c.create_storage_all("/__attach_version1.0_#00000001/__substg1.0_3701000D")
            .unwrap();
        assert_eq!(
            mime(&c.into_inner().into_inner()).unwrap_err(),
            "unsupportedMessage"
        );
        let mut c = cfb::CompoundFile::open(Cursor::new(sample())).unwrap();
        let mut rtf = vec![0; 16];
        rtf[4..8].copy_from_slice(&(17 * 1024 * 1024u32).to_le_bytes());
        c.create_stream("/__substg1.0_10090102")
            .unwrap()
            .write_all(&rtf)
            .unwrap();
        assert_eq!(
            mime(&c.into_inner().into_inner()).unwrap_err(),
            "budgetExceeded"
        );
        assert!(mime(b"not a compound file").is_err());
    }
    #[test]
    fn msg_projection_preserves_unicode_headers_binary_html_and_attachment_bytes() {
        let raw = sample();
        let projected = mime(&raw).unwrap();
        crate::eml_input::validate(&projected, Instant::now()).unwrap();
        let p = mailparse::parse_mail(&projected).unwrap();
        assert_eq!(
            p.headers.get_first_value("Subject").unwrap(),
            "MSG 中文标题"
        );
        assert_eq!(
            p.headers.get_first_value("Message-ID").unwrap(),
            "<msg-qa@example.test>"
        );
        let mut parts = Vec::new();
        crate::archive::leaves(&p, &mut parts);
        assert!(parts.iter().any(
            |p| p.ctype.mimetype == "text/html" && p.get_body().unwrap().contains("中文 HTML")
        ));
        let attachment = parts
            .iter()
            .find(|p| p.ctype.mimetype == "application/octet-stream")
            .unwrap();
        assert_eq!(attachment.get_body_raw().unwrap(), b"\0\xff\x10QA\r\n");
        assert_eq!(
            attachment
                .get_content_disposition()
                .params
                .get("filename")
                .unwrap(),
            "测试附件.bin"
        );
    }
}
