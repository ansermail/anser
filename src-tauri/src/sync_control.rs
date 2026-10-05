//! Serialize reconciliation for the same folder, without letting historical
//! folders or another account block an inbox refresh.
use crate::models::{err, Result};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub fn folder_gate(root: &Path, account: &str, folder: &str) -> Result<Arc<Mutex<()>>> {
    type Key = (std::path::PathBuf, String, String);
    static GATES: OnceLock<Mutex<HashMap<Key, Weak<Mutex<()>>>>> = OnceLock::new();
    let mut gates = GATES.get_or_init(Default::default).lock().map_err(err)?;
    gates.retain(|_, gate| gate.strong_count() > 0);
    let folder = if folder.eq_ignore_ascii_case("INBOX") {
        "INBOX"
    } else {
        folder
    };
    let key = (root.into(), account.into(), folder.into());
    if let Some(gate) = gates.get(&key).and_then(Weak::upgrade) {
        return Ok(gate);
    }
    let gate = Arc::new(Mutex::new(()));
    gates.insert(key, Arc::downgrade(&gate));
    Ok(gate)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_and_other_accounts_do_not_block_inbox_but_same_folder_waits() {
        let root = tempfile::tempdir().unwrap();
        let history = folder_gate(root.path(), "a", "Archive").unwrap();
        let _history = history.lock().unwrap();
        let inbox = folder_gate(root.path(), "a", "INBOX").unwrap();
        let guard = inbox.lock().unwrap();
        let same = folder_gate(root.path(), "a", "inbox").unwrap();
        assert!(same.try_lock().is_err());
        let other = folder_gate(root.path(), "b", "INBOX").unwrap();
        assert!(other.try_lock().is_ok());
        let other_store = tempfile::tempdir().unwrap();
        assert!(folder_gate(other_store.path(), "a", "INBOX")
            .unwrap()
            .try_lock()
            .is_ok());
        let (tx, rx) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let _guard = same.lock().unwrap();
            tx.send(()).unwrap();
        });
        assert!(rx
            .recv_timeout(std::time::Duration::from_millis(20))
            .is_err());
        drop(guard);
        rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap();
        worker.join().unwrap();
    }
}
