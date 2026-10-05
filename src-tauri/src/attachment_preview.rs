use crate::{archive, models::*};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

// Keep previews separate from the durable MIME archive and user downloads.
fn filename(name: &str, mime: &str) -> String {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "\\/:*?\"<>|".contains(c) || ('\u{202a}'..='\u{202e}').contains(&c)
            {
                '-'
            } else {
                c
            }
        })
        .collect();
    let safe = safe.trim().trim_matches('.');
    let (stem, extension) = safe
        .rsplit_once('.')
        .filter(|(_, ext)| !ext.is_empty() && ext.len() <= 20)
        .unwrap_or((safe, ""));
    let stem: String = stem.chars().take(100).collect();
    let stem = if stem.is_empty() { "附件" } else { &stem };
    let extension = if extension.is_empty() {
        match mime {
            "application/pdf" => "pdf",
            "image/png" => "png",
            "image/jpeg" => "jpg",
            "image/gif" => "gif",
            "text/plain" => "txt",
            "text/html" => "html",
            _ => "",
        }
    } else {
        extension
    };
    if extension.is_empty() {
        stem.into()
    } else {
        format!("{stem}.{extension}")
    }
}

fn can_open(name: &str, mime: &str, bytes: &[u8]) -> bool {
    let extension = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    !matches!(
        extension.as_str(),
        "app"
            | "command"
            | "sh"
            | "bash"
            | "zsh"
            | "py"
            | "js"
            | "scpt"
            | "applescript"
            | "exe"
            | "com"
            | "bat"
            | "cmd"
            | "ps1"
            | "msi"
            | "pkg"
            | "dmg"
            | "workflow"
            | "jar"
    ) && !mime.contains("executable")
        && !mime.contains("shellscript")
        && !bytes.starts_with(b"#!")
        && !bytes.starts_with(b"MZ")
        && ![
            b"\xfe\xed\xfa\xce",
            b"\xce\xfa\xed\xfe",
            b"\xfe\xed\xfa\xcf",
            b"\xcf\xfa\xed\xfe",
            b"\xca\xfe\xba\xbe",
            b"\x7fELF",
        ]
        .iter()
        .any(|magic| bytes.starts_with(*magic))
}

fn private_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(err)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(err)?;
    }
    Ok(())
}

pub fn prune(cache: &Path, now: SystemTime) {
    let Ok(entries) = fs::read_dir(cache) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Only delete our own hashed directories, never follow symlinks.
        if name.len() != 64 || !name.bytes().all(|b| b.is_ascii_hexdigit()) {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        let opened = fs::metadata(entry.path().join(".last-opened")).unwrap_or(meta.clone());
        if meta.is_dir()
            && opened
                .modified()
                .ok()
                .and_then(|m| now.duration_since(m).ok())
                .is_some_and(|age| age > Duration::from_secs(7 * 24 * 60 * 60))
        {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

pub fn prepare(cache: &Path, raw: &[u8], account: &Account, index: usize) -> Result<PathBuf> {
    let (_, _, attachments) = archive::parse(raw, account, "")?;
    let attachment = attachments
        .iter()
        .find(|a| a.index == index)
        .ok_or("附件不存在")?;
    if !attachment.error.is_empty() {
        return Err(attachment.error.clone());
    }
    let bytes = archive::attachment(raw, index)?;
    let name = filename(&attachment.name, &attachment.mime);
    if !can_open(&name, &attachment.mime, &bytes) {
        return Err("该附件是程序或脚本，不支持直接预览；可使用下载按钮另存".into());
    }
    private_dir(cache)?;
    prune(cache, SystemTime::now());
    let identity = archive::digest(format!("{}:{index}", archive::digest(raw)).as_bytes());
    let folder = cache.join(identity);
    private_dir(&folder)?;
    let path = folder.join(name);
    // Reuse exact bytes, but replace any edited preview with the original.
    if fs::read(&path).ok().as_deref() != Some(bytes.as_slice()) {
        archive::atomic_write(&path, &bytes)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(err)?;
    }
    // Refresh the directory age on every open, including a reused preview.
    fs::write(folder.join(".last-opened"), []).map_err(err)?;
    Ok(path)
}
