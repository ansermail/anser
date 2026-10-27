//! File data is flushed before publication on every platform. Directory fsync
//! is a Unix durability primitive; opening a directory as a file fails on Windows.
use std::{io, path::Path};

pub fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(path)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn publishing_and_replacing_unicode_files_preserves_complete_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("邮件.eml");
        for data in [
            b"first message".as_slice(),
            b"replacement message".as_slice(),
        ] {
            crate::archive::atomic_write(&file, data).unwrap();
            assert_eq!(std::fs::read(&file).unwrap(), data);
            assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        }
    }
}
