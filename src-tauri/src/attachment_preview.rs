use crate::{archive, models::*};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::ImageFormat;
use std::{
    collections::VecDeque,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime},
};

const MAX_THUMBNAIL_SOURCE_BYTES: usize = 20 * 1024 * 1024;
const MAX_THUMBNAIL_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_IMAGE_EDGE: u32 = 8192;
const MAX_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;
const THUMBNAIL_EDGE: u32 = 112;

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
            | "psm1"
            | "psd1"
            | "vbs"
            | "vbe"
            | "jse"
            | "wsf"
            | "wsh"
            | "hta"
            | "lnk"
            | "url"
            | "website"
            | "pif"
            | "scr"
            | "cpl"
            | "msc"
            | "reg"
            | "inf"
            | "msi"
            | "msp"
            | "mst"
            | "msix"
            | "msixbundle"
            | "appx"
            | "appxbundle"
            | "application"
            | "appref-ms"
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

#[cfg(test)]
mod tests {
    #[test]
    fn windows_shell_programs_are_not_opened_as_document_previews() {
        for extension in [
            "vbs",
            "VBE",
            "jse",
            "wsf",
            "wsh",
            "hta",
            "lnk",
            "url",
            "website",
            "pif",
            "scr",
            "cpl",
            "msc",
            "reg",
            "inf",
            "psm1",
            "psd1",
            "msp",
            "mst",
            "msix",
            "msixbundle",
            "appx",
            "appxbundle",
            "application",
            "appref-ms",
        ] {
            assert!(
                !super::can_open(
                    &format!("attachment.{extension}"),
                    "application/octet-stream",
                    b"plain script or shell data"
                ),
                "{extension}"
            );
        }
        assert!(super::can_open(
            "document.pdf",
            "application/pdf",
            b"%PDF-1.7"
        ));
        assert!(super::can_open(
            "notes.txt",
            "text/plain",
            b"ordinary notes"
        ));
    }
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

pub fn prepare(cache: &Path, raw: &[u8], index: usize) -> Result<PathBuf> {
    let (name, mime, bytes) = archive::preview_attachment(raw, index)?;
    let name = filename(&name, &mime);
    if !can_open(&name, &mime, &bytes) {
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

fn thumbnail_format(mime: &str) -> Option<ImageFormat> {
    match mime {
        "image/png" => Some(ImageFormat::Png),
        "image/jpeg" => Some(ImageFormat::Jpeg),
        "image/gif" => Some(ImageFormat::Gif),
        "image/webp" => Some(ImageFormat::WebP),
        _ => None,
    }
}

fn thumbnail_data_url(mime: &str, bytes: &[u8]) -> Result<String> {
    let format = thumbnail_format(mime).ok_or("该附件类型不支持生成缩略图")?;
    if bytes.len() > MAX_THUMBNAIL_SOURCE_BYTES {
        return Err("图片过大，未生成缩略图".into());
    }
    let (width, height) = image::ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| "图片内容损坏，未生成缩略图")?;
    if width == 0
        || height == 0
        || width > MAX_IMAGE_EDGE
        || height > MAX_IMAGE_EDGE
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err("图片尺寸过大，未生成缩略图".into());
    }
    let image = image::load_from_memory_with_format(bytes, format)
        .map_err(|_| "图片内容损坏，未生成缩略图")?;
    let thumbnail = image.thumbnail(THUMBNAIL_EDGE, THUMBNAIL_EDGE);
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|_| "无法生成图片缩略图")?;
    let encoded = output.into_inner();
    if encoded.len() > MAX_THUMBNAIL_OUTPUT_BYTES {
        return Err("图片缩略图过大，已保留原文件".into());
    }
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(encoded)
    ))
}

type ThumbnailCache = VecDeque<((String, usize), String)>;

pub fn thumbnail(raw: &[u8], index: usize) -> Result<String> {
    const MAX_THUMBNAILS: usize = 32;
    static THUMBNAILS: OnceLock<Mutex<ThumbnailCache>> = OnceLock::new();
    let cache = THUMBNAILS.get_or_init(Default::default);
    let key = (archive::digest(raw), index);
    if let Some(value) = cache
        .lock()
        .map_err(err)?
        .iter()
        .find(|(stored, _)| stored == &key)
        .map(|(_, value)| value.clone())
    {
        return Ok(value);
    }
    let (_, mime, bytes) = archive::preview_attachment(raw, index)?;
    let thumbnail = thumbnail_data_url(&mime, &bytes)?;
    let mut cache = cache.lock().map_err(err)?;
    if !cache.iter().any(|(stored, _)| stored == &key) {
        if cache.len() == MAX_THUMBNAILS {
            cache.pop_front();
        }
        cache.push_back((key, thumbnail.clone()));
    }
    Ok(thumbnail)
}
