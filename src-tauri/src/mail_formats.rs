//! Original file bytes remain the archive identity. Format projections are derived
//! RFC 5322/MIME views used by all readers; they never replace the original blob.
use crate::models::*;
use std::{borrow::Cow, path::Path};

pub const MAX_CONTAINER_BYTES: u64 = 1024 * 1024 * 1024;
pub fn extension(path: &Path) -> String {
    path.extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase()
}
pub fn supported(path: &Path) -> bool {
    matches!(
        extension(path).as_str(),
        "eml" | "emlx" | "msg" | "mbox" | "mbx"
    )
}
pub fn single(path: &Path) -> bool {
    matches!(extension(path).as_str(), "eml" | "emlx" | "msg")
}
pub fn container(path: &Path) -> bool {
    matches!(extension(path).as_str(), "mbox" | "mbx")
}
pub fn original_extension(raw: &[u8]) -> &'static str {
    if raw.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") {
        "msg"
    } else if raw.starts_with(b"From ") {
        "mbox"
    } else if raw.split(|x| *x == b'\n').next().is_some_and(|line| {
        let line = line.strip_suffix(b"\r").unwrap_or(line);
        !line.is_empty() && line.len() <= 20 && line.iter().all(u8::is_ascii_digit)
    }) {
        "emlx"
    } else {
        "eml"
    }
}
pub fn mime(raw: &[u8]) -> Result<Cow<'_, [u8]>> {
    match original_extension(raw) {
        "msg" => crate::msg_format::mime(raw).map(Cow::Owned),
        "emlx" => {
            let start = raw
                .iter()
                .position(|x| *x == b'\n')
                .ok_or("invalidMessage")?
                + 1;
            let n = std::str::from_utf8(&raw[..start - 1])
                .map_err(|_| "invalidMessage")?
                .trim_end_matches('\r')
                .parse::<usize>()
                .map_err(|_| "invalidMessage")?;
            let end = start
                .checked_add(n)
                .filter(|end| *end <= raw.len())
                .ok_or("invalidMessage")?;
            if n == 0 {
                return Err("invalidMessage".into());
            }
            Ok(Cow::Borrowed(&raw[start..end]))
        }
        "mbox" => {
            let start = raw
                .iter()
                .position(|x| *x == b'\n')
                .ok_or("invalidMessage")?
                + 1;
            let message = &raw[start..];
            let (_, body) = mailparse::parse_headers(message).map_err(|_| "invalidMessage")?;
            // mboxrd removes exactly one quoting '>' from body lines matching
            // >+From. Keep the envelope and quoted original bytes in the archive.
            let mut out = message[..body].to_vec();
            for line in message[body..].split_inclusive(|x| *x == b'\n') {
                let n = line.iter().take_while(|x| **x == b'>').count();
                out.extend_from_slice(if n > 0 && line[n..].starts_with(b"From ") {
                    &line[1..]
                } else {
                    line
                });
            }
            Ok(Cow::Owned(out))
        }
        _ => Ok(Cow::Borrowed(raw)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn format_projection_keeps_emlx_length_and_mbox_quoting_separate_from_original() {
        let source = b"Subject: UTF-8\r\n\r\nHello";
        let mut emlx = format!("{}\n", source.len()).into_bytes();
        emlx.extend_from_slice(source);
        emlx.extend_from_slice(b"\n<plist>ignored flags</plist>");
        assert_eq!(mime(&emlx).unwrap().as_ref(), source);
        assert_eq!(original_extension(&emlx), "emlx");
        assert!(mime(b"900\nSubject: truncated\n\nBody").is_err());
        let mbox = b"From sample@example.test Fri Oct 23 08:00:00 2026\nSubject: mbox\n\n>From first\n>>From literal\nText\n";
        assert_eq!(
            mime(mbox).unwrap().as_ref(),
            b"Subject: mbox\n\nFrom first\n>From literal\nText\n"
        );
        assert!(single(Path::new("MAIL.MSG")) && container(Path::new("export.mbox")));
    }
}

// Index containers with fixed-size buffers before creating a task. A range is
// one original record INCLUDING its envelope and quoting, never decoded MIME.
pub fn ranges(path: &Path, expected: &str) -> Result<Vec<(u64, u64)>> {
    use std::{io::Read, time::Instant};
    let before = crate::eml_input::metadata(path)?;
    if crate::eml_input::fingerprint(&before) != expected {
        return Err("fileChanged".into());
    }
    if !container(path) {
        return Ok(vec![(0, before.len())]);
    }
    let mut file = crate::eml_input::open(path)?;
    if crate::eml_input::fingerprint(&file.metadata().map_err(|_| "unreadable")?) != expected {
        return Err("fileChanged".into());
    }
    let started = Instant::now();
    let mut buffer = [0u8; 64 * 1024];
    let mut prefix = Vec::with_capacity(1024);
    let mut starts = Vec::new();
    let mut position = 0u64;
    let mut line_start = 0u64;
    let mut line_length = 0u64;
    let mut headers = false;
    loop {
        if started.elapsed() > crate::eml_input::TIME_LIMIT {
            return Err("budgetExceeded".into());
        }
        let count = file.read(&mut buffer).map_err(|_| "unreadable")?;
        if count == 0 {
            break;
        }
        for bytes in buffer[..count].split_inclusive(|b| *b == b'\n') {
            let copy = bytes.len().min(1024 - prefix.len());
            prefix.extend_from_slice(&bytes[..copy]);
            position += bytes.len() as u64;
            line_length += bytes.len() as u64;
            if bytes.ends_with(b"\n") {
                let envelope = line_length <= 1024
                    && prefix.starts_with(b"From ")
                    && prefix.contains(&b':')
                    && prefix.iter().filter(|b| **b == b' ').count() >= 4;
                if line_start == 0 && !envelope {
                    return Err("invalidMessage".into());
                }
                if envelope {
                    starts.push(line_start);
                    headers = true;
                    if starts.len() > 1000 {
                        return Err("batchLimit".into());
                    }
                } else if headers {
                    if let Some(colon) = prefix.iter().position(|b| *b == b':') {
                        // Content-Length mboxcl/cl2 has different quoting rules.
                        // Reject it explicitly rather than guessing a delimiter
                        // inside its message body and silently splitting content.
                        if prefix[..colon].eq_ignore_ascii_case(b"Content-Length") {
                            return Err("unsupportedMboxVariant".into());
                        }
                    }
                    if prefix == b"\n" || prefix == b"\r\n" {
                        headers = false;
                    }
                }
                line_start = position;
                line_length = 0;
                prefix.clear();
            }
        }
    }
    if position != before.len()
        || crate::eml_input::fingerprint(&file.metadata().map_err(|_| "unreadable")?) != expected
        || crate::eml_input::fingerprint(&crate::eml_input::metadata(path)?) != expected
    {
        return Err("fileChanged".into());
    }
    if starts.is_empty() {
        return Err("invalidMessage".into());
    }
    let mut result = Vec::with_capacity(starts.len());
    for (i, start) in starts.iter().enumerate() {
        result.push((
            *start,
            starts.get(i + 1).copied().unwrap_or(position) - start,
        ));
    }
    Ok(result)
}
