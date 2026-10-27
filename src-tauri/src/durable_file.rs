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
