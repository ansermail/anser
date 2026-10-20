//! One IDLE connection per enabled IMAP account. The listener owns INBOX: the
//! catch-up, the push-triggered download and the periodic check all run on that
//! connection, matching how desktop clients keep a single inbox session. Inbox
//! jobs for other accounts, historical folders and manual checks stay separate.
use crate::{auth, idle::ConnectionControl, models::*, network, store::Store};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

fn watchers() -> &'static Mutex<HashSet<String>> {
    static WATCHERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    WATCHERS.get_or_init(Default::default)
}
fn watched(id: &str, on: bool) {
    if let Ok(mut watchers) = watchers().lock() {
        if on {
            watchers.insert(id.to_string());
        } else {
            watchers.remove(id);
        }
    }
}
/// A connected listener already checks INBOX on its own connection; directory
/// sweeps must leave that folder to it instead of opening a competing session.
pub fn inbox_watched(id: &str) -> bool {
    watchers()
        .lock()
        .is_ok_and(|watchers| watchers.contains(id))
}

#[derive(Default)]
pub struct RealtimeControl {
    revision: AtomicU64,
    accounts: Mutex<HashMap<String, u64>>,
}
impl RealtimeControl {
    pub fn restart(&self) {
        self.revision.fetch_add(1, Ordering::AcqRel);
    }
    /// Reconnect one account after a manual check used its own short-lived
    /// INBOX session, so notifications route back to the listener.
    pub fn restart_account(&self, id: &str) {
        if let Ok(mut accounts) = self.accounts.lock() {
            *accounts.entry(id.into()).or_insert(0) += 1;
        }
    }
    fn account_revision(&self, id: &str) -> u64 {
        self.accounts
            .lock()
            .map(|accounts| accounts.get(id).copied().unwrap_or(0))
            .unwrap_or(0)
    }
}
fn config(account: &Account) -> String {
    serde_json::to_string(&(
        &account.email,
        &account.provider,
        &account.protocol,
        &account.incoming_host,
        account.incoming_port,
        &account.incoming_tls,
        &account.username,
        &account.auth,
        &account.oauth_client_id,
    ))
    .unwrap_or_default()
}
fn backoff(failures: u32) -> Duration {
    Duration::from_secs((5u64 << failures.saturating_sub(1).min(6)).min(300))
}
fn poll_interval(store: &Store) -> Duration {
    Duration::from_secs(
        store
            .preferences()
            .unwrap_or_default()
            .sync_interval_minutes
            .max(1) as u64
            * 60,
    )
}
fn pause(control: &ConnectionControl, duration: Duration) {
    let deadline = Instant::now() + duration;
    while !control.stopped() && Instant::now() < deadline {
        thread::sleep(
            deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_millis(250)),
        );
    }
}
struct Worker {
    config: String,
    revision: u64,
    control: Arc<ConnectionControl>,
    thread: JoinHandle<()>,
}
fn spawn_worker(store: Store, app: tauri::AppHandle, account: Account, revision: u64) -> Worker {
    let key = config(&account);
    let worker_config = key.clone();
    let control = Arc::new(ConnectionControl::default());
    let stopped = control.clone();
    let id = account.id.clone();
    let email = account.email.clone();
    let handle = thread::spawn(move || {
        let mut failures = 0;
        while !stopped.stopped() {
            // auth::credentials serializes refreshes per account. A full sync
            // must not prevent another account from connecting its listener.
            let Ok(current) = store.account(&id) else {
                break;
            };
            if !current.enabled || current.protocol != "imap" || config(&current) != key {
                break;
            }
            let connected = std::cell::Cell::new(false);
            // Claim INBOX before dialing so a directory sweep that starts
            // during the connection attempt leaves the folder to this worker.
            watched(&id, true);
            let ready = || {
                connected.set(true);
                let _ = store.log(&format!("{email} 实时收取已连接（IMAP IDLE）"));
            };
            let result = auth::credentials(&current).and_then(|secret| {
                network::watch_imap(
                    &current,
                    &secret,
                    &stopped,
                    ready,
                    |signal, session| {
                        crate::sync_watch_inbox(&store, &app, &current, signal, session).map(|_| ())
                    },
                    || poll_interval(&store),
                )
            });
            watched(&id, false);
            if stopped.stopped() {
                break;
            }
            if connected.get() {
                failures = 0;
            }
            match result {
                Ok(network::WatchOutcome::Stopped) => break,
                Ok(network::WatchOutcome::Unsupported) => {
                    let _ = store.log(&format!("{email} 服务器不支持 IDLE，使用定时补查"));
                    pause(&stopped, Duration::from_secs(15 * 60));
                }
                Err(error) => {
                    failures += 1;
                    let _ = store.log(&format!(
                        "{email} 实时监听断开，自动重连并保留定时补查：{error}"
                    ));
                    pause(&stopped, backoff(failures));
                }
            }
        }
        watched(&id, false);
    });
    Worker {
        config: worker_config,
        revision,
        control,
        thread: handle,
    }
}

pub fn start(store: Store, app: tauri::AppHandle, control: Arc<RealtimeControl>) {
    thread::spawn(move || {
        let mut workers = HashMap::<String, Worker>::new();
        let mut retired = Vec::<JoinHandle<()>>::new();
        let mut revision = control.revision.load(Ordering::Acquire);
        loop {
            let restarted = control.revision.load(Ordering::Acquire);
            let full = restarted != revision;
            revision = restarted;
            if let Ok(accounts) = store.accounts() {
                let accounts: HashMap<_, _> = accounts
                    .into_iter()
                    .filter(|a| a.enabled && a.protocol == "imap")
                    .map(|a| (a.id.clone(), a))
                    .collect();
                let remove: Vec<_> = workers
                    .iter()
                    .filter(|(id, w)| {
                        full || w.thread.is_finished()
                            || control.account_revision(id) != w.revision
                            || accounts.get(*id).is_none_or(|a| config(a) != w.config)
                    })
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in remove {
                    if let Some(worker) = workers.remove(&id) {
                        worker.control.stop();
                        retired.push(worker.thread);
                    }
                }
                for (id, account) in accounts {
                    workers.entry(id.clone()).or_insert_with(|| {
                        let revision = control.account_revision(&id);
                        spawn_worker(store.clone(), app.clone(), account, revision)
                    });
                }
            }
            retired.retain(|thread| !thread.is_finished());
            thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_changes_restart_watchers_but_sync_metadata_does_not() {
        let account = crate::tests::account();
        let mut changed = account.clone();
        changed.last_sync = Some("today".into());
        changed.error = Some("offline".into());
        changed.name = "New name".into();
        assert_eq!(config(&account), config(&changed));
        changed.incoming_host = "new.example.com".into();
        assert_ne!(config(&account), config(&changed));
        assert_eq!(backoff(1), Duration::from_secs(5));
        assert_eq!(backoff(99), Duration::from_secs(300));
    }
    #[test]
    fn account_restarts_are_tracked_independently_from_the_global_revision() {
        let control = RealtimeControl::default();
        assert_eq!(control.account_revision("a"), 0);
        control.restart_account("a");
        assert_eq!(control.account_revision("a"), 1);
        assert_eq!(control.account_revision("b"), 0);
        assert_eq!(control.revision.load(Ordering::Acquire), 0);
        control.restart();
        assert_eq!(control.revision.load(Ordering::Acquire), 1);
        assert_eq!(control.account_revision("a"), 1);
        assert_eq!(control.account_revision("b"), 0);
    }
    #[test]
    fn watched_accounts_are_reported_and_released() {
        watched("watched-account", true);
        assert!(inbox_watched("watched-account"));
        assert!(!inbox_watched("other-account"));
        watched("watched-account", false);
        assert!(!inbox_watched("watched-account"));
    }
}
