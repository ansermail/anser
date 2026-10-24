//! Shared, bounded snapshots for external EML viewing and explicit importing.
use crate::models::*;
use mailparse::MailHeaderMap;
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::Path,
    time::{Duration, Instant},
};

pub const MAX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PARTS: usize = 2048;
const MAX_DEPTH: usize = 32;
const MAX_DECODED: usize = 256 * 1024 * 1024;
pub const TIME_LIMIT: Duration = Duration::from_secs(15);

/// Identity of the file contents for bounded snapshots.
///
/// ctime is deliberately excluded: macOS writes extended attributes such as
/// `com.apple.lastuseddate#PS` when LaunchServices opens a document, which
/// bumps ctime without changing any bytes. Reading a file while that happens
/// used to fail with a spurious `fileChanged` error.
pub fn fingerprint(m: &Metadata) -> String {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}:{}",
            m.dev(),
            m.ino(),
            m.len(),
            m.mtime(),
            m.mtime_nsec()
        )
    }
    #[cfg(not(unix))]
    {
        format!("{}:{:?}", m.len(), m.modified().ok())
    }
}
pub fn metadata(path: &Path) -> Result<Metadata> {
    if !crate::mail_formats::supported(path) {
        return Err("invalidFile".into());
    }
    let m = fs::symlink_metadata(path).map_err(|_| "unreadable".to_string())?;
    if !m.file_type().is_file() {
        return Err("invalidFile".into());
    }
    if m.len()
        > if crate::mail_formats::container(path) {
            crate::mail_formats::MAX_CONTAINER_BYTES
        } else {
            MAX_BYTES
        }
    {
        return Err("tooLarge".into());
    }
    Ok(m)
}
pub(crate) fn open(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    options.open(path).map_err(|_| "unreadable".into())
}
pub fn read(path: &Path, expected: Option<&str>) -> Result<Vec<u8>> {
    read_message(path, expected, 0, None)
}
pub fn read_message(
    path: &Path,
    expected: Option<&str>,
    offset: u64,
    length: Option<u64>,
) -> Result<Vec<u8>> {
    let before = metadata(path)?;
    let stamp = fingerprint(&before);
    if expected.is_some_and(|x| x != stamp) {
        return Err("fileChanged".into());
    }
    let length = length.unwrap_or(before.len());
    if length > MAX_BYTES {
        return Err("tooLarge".into());
    }
    if offset
        .checked_add(length)
        .filter(|end| *end <= before.len())
        .is_none()
    {
        return Err("fileChanged".into());
    }
    let mut file = open(path)?;
    let opened = file.metadata().map_err(|_| "unreadable")?;
    if !opened.is_file() || fingerprint(&opened) != stamp {
        return Err("fileChanged".into());
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|_| "unreadable")?;
    let started = Instant::now();
    let mut raw = Vec::with_capacity(length as usize);
    let mut buffer = [0u8; 64 * 1024];
    while raw.len() < (length as usize) {
        if started.elapsed() > TIME_LIMIT {
            return Err("budgetExceeded".into());
        }
        let limit = buffer.len().min(length as usize - raw.len());
        let n = file.read(&mut buffer[..limit]).map_err(|_| "unreadable")?;
        if n == 0 {
            return Err("fileChanged".into());
        }
        raw.extend_from_slice(&buffer[..n]);
    }
    if fingerprint(&file.metadata().map_err(|_| "unreadable")?) != stamp
        || fingerprint(&metadata(path)?) != stamp
    {
        return Err("fileChanged".into());
    }
    let projection = crate::mail_formats::mime(&raw)?;
    validate(&projection, started)?;
    Ok(raw)
}

// Check the recursive structure BEFORE mailparse::parse_mail, whose parser
// otherwise has no nesting limit. Match its line-prefix boundary semantics.
pub fn validate(raw: &[u8], started: Instant) -> Result<()> {
    let mut pending = vec![(raw, 0usize)];
    let mut count = 0;
    while let Some((part, depth)) = pending.pop() {
        count += 1;
        if count > MAX_PARTS || depth > MAX_DEPTH || started.elapsed() > TIME_LIMIT {
            return Err("budgetExceeded".into());
        }
        let header_end = part
            .windows(2)
            .position(|w| w == b"\n\n")
            .into_iter()
            .chain(part.windows(4).position(|w| w == b"\r\n\r\n"))
            .min()
            .unwrap_or(part.len());
        if header_end > 256 * 1024 {
            return Err("budgetExceeded".into());
        }
        let (headers, body) =
            mailparse::parse_headers(part).map_err(|_| "invalidMessage".to_string())?;
        if headers.len() > 2048 {
            return Err("budgetExceeded".into());
        }
        if depth == 0
            && !headers.iter().any(|h| {
                [
                    "from",
                    "to",
                    "subject",
                    "date",
                    "message-id",
                    "mime-version",
                    "content-type",
                ]
                .contains(&h.get_key().to_ascii_lowercase().as_str())
            })
        {
            return Err("invalidMessage".into());
        }
        let ct = mailparse::parse_content_type(
            &headers.get_first_value("Content-Type").unwrap_or_default(),
        );
        if ct.mimetype.starts_with("multipart/") {
            if let Some(boundary) = ct.params.get("boundary") {
                if boundary.len() > 1024 {
                    return Err("budgetExceeded".into());
                }
                let marker = format!("--{boundary}");
                let mut offset = body;
                let mut start = None;
                let mut seen_first = false;
                for line in part[body..].split_inclusive(|b| *b == b'\n') {
                    if line.starts_with(marker.as_bytes()) {
                        if let Some(begin) = start.take() {
                            let mut end = offset;
                            if end > begin && part[end - 1] == b'\n' {
                                end -= 1;
                                if end > begin && part[end - 1] == b'\r' {
                                    end -= 1;
                                }
                            }
                            pending.push((&part[begin..end], depth + 1));
                        }
                        if seen_first && line[marker.len()..].starts_with(b"--") {
                            break;
                        }
                        seen_first = true;
                        if line.ends_with(b"\n") {
                            start = Some(offset + line.len());
                        }
                        if pending.len() + count > MAX_PARTS {
                            return Err("budgetExceeded".into());
                        }
                    }
                    offset += line.len();
                }
                if let Some(begin) = start {
                    pending.push((&part[begin..], depth + 1));
                }
            }
        }
    }
    let parsed = mailparse::parse_mail(raw).map_err(|_| "invalidMessage".to_string())?;
    let mut pending = vec![&parsed];
    let mut decoded = 0usize;
    while let Some(part) = pending.pop() {
        if started.elapsed() > TIME_LIMIT {
            return Err("budgetExceeded".into());
        }
        if part.subparts.is_empty() {
            // Broken encodings remain warnings in the archive parser.
            if let Ok(bytes) = part.get_body_raw() {
                decoded = decoded.saturating_add(bytes.len());
                if decoded > MAX_DECODED {
                    return Err("budgetExceeded".into());
                }
            }
        } else {
            pending.extend(&part.subparts);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extended_attribute_metadata_changes_do_not_invalidate_a_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("attribute.eml");
        fs::write(&path, b"Subject: attributes\r\n\r\nBody").unwrap();
        let stamp = fingerprint(&metadata(&path).unwrap());
        #[cfg(target_os = "macos")]
        {
            use std::ffi::CString;
            let file = CString::new(path.as_os_str().as_encoded_bytes()).unwrap();
            let name = CString::new("com.apple.lastuseddate#PS").unwrap();
            let value = [0u8; 8];
            let result = unsafe {
                libc::setxattr(
                    file.as_ptr(),
                    name.as_ptr(),
                    value.as_ptr().cast(),
                    value.len(),
                    0,
                    0,
                )
            };
            assert_eq!(result, 0);
        }
        // macOS updated ctime above; the content identity must remain stable.
        assert_eq!(fingerprint(&metadata(&path).unwrap()), stamp);
        assert_eq!(
            read(&path, Some(&stamp)).unwrap(),
            b"Subject: attributes\r\n\r\nBody"
        );
        // A same-size rewrite must still be rejected.
        let original_len = fs::metadata(&path).unwrap().len();
        std::thread::sleep(Duration::from_millis(2));
        fs::write(&path, b"Subject: attributes\r\n\r\nNext").unwrap();
        assert_eq!(metadata(&path).unwrap().len(), original_len);
        assert_eq!(read(&path, Some(&stamp)).unwrap_err(), "fileChanged");
    }
    #[test]
    fn eml_input_limits_nesting_parts_headers_and_elapsed_time_before_recursive_parse() {
        let mut nested = "Subject: leaf\r\n\r\nLeaf".to_string();
        for i in 0..40 {
            nested=format!("Content-Type: multipart/mixed; boundary=b{i}\r\n\r\n--b{i}\r\n{nested}\r\n--b{i}--\r\n");
        }
        assert_eq!(
            validate(nested.as_bytes(), Instant::now()).unwrap_err(),
            "budgetExceeded"
        );
        let mut many = "Content-Type: multipart/mixed; boundary=x\r\n\r\n".to_string();
        for _ in 0..2050 {
            many.push_str("--x\r\nContent-Type: text/plain\r\n\r\nPart\r\n");
        }
        many.push_str("--x--\r\n");
        assert_eq!(
            validate(many.as_bytes(), Instant::now()).unwrap_err(),
            "budgetExceeded"
        );
        let header = format!("Subject: {}\r\n\r\nBody", "x".repeat(300 * 1024));
        assert_eq!(
            validate(header.as_bytes(), Instant::now()).unwrap_err(),
            "budgetExceeded"
        );
        assert_eq!(
            validate(
                b"Subject: okay\r\n\r\nBody",
                Instant::now() - Duration::from_secs(16)
            )
            .unwrap_err(),
            "budgetExceeded"
        );
    }
    #[test]
    fn eml_input_accepts_missing_date_plain_html_cid_and_preserves_decode_warnings() {
        for raw in [
            b"Subject: no date\n\nText".as_slice(),
            b"Content-Type: text/html\r\nSubject: HTML\r\n\r\n<p>HTML</p>",
            b"Subject: damaged\r\nContent-Transfer-Encoding: base64\r\n\r\n!broken",
        ] {
            validate(raw, Instant::now()).unwrap();
        }
        let cid=b"Subject: cid\r\nContent-Type: multipart/related; boundary=c\r\n\r\n--c\r\nContent-Type: text/html\r\n\r\n<img src=\"cid:image\">\r\n--c\r\nContent-Type: image/png\r\nContent-ID: <image>\r\nContent-Transfer-Encoding: base64\r\n\r\nAAH/gA==\r\n--c--\r\n";
        validate(cid, Instant::now()).unwrap();
    }
}
