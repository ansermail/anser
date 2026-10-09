//! One IDLE connection per enabled IMAP account. Notifications queue work;
//! Inbox jobs are independent of historical folders and other accounts.
use crate::{auth, idle::ConnectionControl, models::*, network, store::Store};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct RealtimeControl {
    revision: AtomicU64,
}
impl RealtimeControl {
    pub fn restart(&self) {
        self.revision.fetch_add(1, Ordering::AcqRel);
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
    control: Arc<ConnectionControl>,
    thread: JoinHandle<()>,
    fallback: crate::productivity::SyncSchedule,
}
enum EventKind {
    Changed(Trigger),
    Status(String),
}
#[derive(Clone, Debug)]
struct Trigger {
    source: &'static str,
    push: bool,
    at: Instant,
    time: chrono::DateTime<chrono::Utc>,
}
impl Trigger {
    fn new(source: &'static str) -> Self {
        Self {
            source,
            push: false,
            at: Instant::now(),
            time: chrono::Utc::now(),
        }
    }
    fn poll() -> Self {
        Self::new("定时补查")
    }
    fn signal(signal: network::WatchSignal) -> Self {
        let mut trigger = Self::new(match signal {
            network::WatchSignal::CatchUp => "监听连接后补查",
            network::WatchSignal::MailboxChanged => "服务器实时通知",
        });
        trigger.push = signal == network::WatchSignal::MailboxChanged;
        trigger
    }
}
struct Event {
    id: String,
    control: Arc<ConnectionControl>,
    kind: EventKind,
}
fn spawn_worker(store: Store, account: Account, tx: mpsc::Sender<Event>) -> Worker {
    let key = config(&account);
    let control = Arc::new(ConnectionControl::default());
    let stopped = control.clone();
    let handle = thread::spawn(move || {
        let mut failures = 0;
        let mut last_status = String::new();
        let status = |message: String, last: &mut String| {
            if *last != message {
                *last = message.clone();
                let _ = tx.send(Event {
                    id: account.id.clone(),
                    control: stopped.clone(),
                    kind: EventKind::Status(message),
                });
            }
        };
        while !stopped.stopped() {
            // auth::credentials serializes refreshes per account. A full sync
            // must not prevent another account from connecting its listener.
            let secret = match store.account(&account.id) {
                Ok(current)
                    if current.enabled
                        && current.protocol == "imap"
                        && config(&current) == config(&account) =>
                {
                    auth::credentials(&current)
                }
                _ => break,
            };
            let mut connected = false;
            let changed_tx = tx.clone();
            let changed_control = stopped.clone();
            let changed_id = account.id.clone();
            let result = secret.and_then(|secret| {
                network::watch_imap(
                    &account,
                    &secret,
                    &stopped,
                    || {
                        connected = true;
                        let _ = tx.send(Event {
                            id: account.id.clone(),
                            control: stopped.clone(),
                            kind: EventKind::Status("实时收取已连接（IMAP IDLE）".into()),
                        });
                    },
                    move |signal| {
                        let _ = changed_tx.send(Event {
                            id: changed_id.clone(),
                            control: changed_control.clone(),
                            kind: EventKind::Changed(Trigger::signal(signal)),
                        });
                    },
                )
            });
            if stopped.stopped() {
                break;
            }
            if connected {
                failures = 0;
                last_status.clear();
            }
            match result {
                Ok(network::WatchOutcome::Stopped) => break,
                Ok(network::WatchOutcome::Unsupported) => {
                    status("服务器不支持 IDLE，使用定时补查".into(), &mut last_status);
                    pause(&stopped, Duration::from_secs(15 * 60));
                }
                Err(error) => {
                    failures += 1;
                    status(
                        format!("实时监听断开，自动重连并保留定时补查：{error}"),
                        &mut last_status,
                    );
                    pause(&stopped, backoff(failures));
                }
            }
        }
        stopped.clear();
    });
    Worker {
        config: key,
        control,
        thread: handle,
        fallback: crate::productivity::SyncSchedule::default(),
    }
}

struct Pending {
    control: Arc<ConnectionControl>,
    serial: u64,
    retry_at: Instant,
    failures: u32,
    trigger: Trigger,
}
fn enqueue(
    pending: &mut HashMap<String, Pending>,
    id: String,
    control: Arc<ConnectionControl>,
    trigger: Trigger,
) {
    if control.stopped() {
        return;
    }
    let queued = pending.entry(id).or_insert(Pending {
        control: control.clone(),
        serial: 0,
        retry_at: Instant::now(),
        failures: 0,
        trigger: trigger.clone(),
    });
    // A new listener generation must not inherit an old listener's backoff.
    if !Arc::ptr_eq(&queued.control, &control) {
        *queued = Pending {
            control,
            serial: 0,
            retry_at: Instant::now(),
            failures: 0,
            trigger: trigger.clone(),
        };
    }
    queued.serial += 1;
    queued.trigger = trigger;
}
#[derive(Debug, PartialEq, Eq)]
enum SyncOutcome {
    Finished(bool),
    Stale,
}
struct SyncJob {
    id: String,
    control: Arc<ConnectionControl>,
    serial: u64,
    thread: JoinHandle<SyncOutcome>,
}
fn finish_pending(pending: &mut Pending, serial: u64, outcome: SyncOutcome, now: Instant) -> bool {
    match outcome {
        SyncOutcome::Finished(true) => {
            pending.failures = 0;
            pending.retry_at = now;
            pending.serial == serial
        }
        SyncOutcome::Finished(false) => {
            pending.failures += 1;
            pending.retry_at = now + backoff(pending.failures);
            false
        }
        SyncOutcome::Stale => true,
    }
}

pub fn start(store: Store, app: tauri::AppHandle, control: Arc<RealtimeControl>) {
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel::<Event>();
        let mut workers = HashMap::<String, Worker>::new();
        let mut retired = Vec::<JoinHandle<()>>::new();
        let mut pending = HashMap::<String, Pending>::new();
        let mut jobs = HashMap::<String, SyncJob>::new();
        let mut revision = control.revision.load(Ordering::Acquire);
        let mut last_tick = chrono::Utc::now().timestamp();
        loop {
            let now = chrono::Utc::now().timestamp();
            let changed_revision = control.revision.load(Ordering::Acquire);
            let restart = changed_revision != revision || now - last_tick > 45 || now < last_tick;
            last_tick = now;
            revision = changed_revision;
            if let Ok(accounts) = store.accounts() {
                let accounts: HashMap<_, _> = accounts
                    .into_iter()
                    .filter(|a| a.enabled && a.protocol == "imap")
                    .map(|a| (a.id.clone(), a))
                    .collect();
                let remove: Vec<_> = workers
                    .iter()
                    .filter(|(id, w)| {
                        restart
                            || w.thread.is_finished()
                            || accounts.get(*id).is_none_or(|a| config(a) != w.config)
                    })
                    .map(|(id, _)| id.clone())
                    .collect();
                for id in remove {
                    if let Some(worker) = workers.remove(&id) {
                        worker.control.stop();
                        retired.push(worker.thread);
                    }
                    pending.remove(&id);
                }
                for (id, account) in accounts {
                    workers
                        .entry(id)
                        .or_insert_with(|| spawn_worker(store.clone(), account, tx.clone()));
                }
            }
            retired.retain(|thread| !thread.is_finished());
            // Historical sweeps can take much longer than the configured poll
            // interval. Poll each inbox here, independently of the sweep gate
            // and of whether the server actually delivers IDLE notifications.
            let interval = store
                .preferences()
                .unwrap_or_default()
                .sync_interval_minutes as i64
                * 60;
            for (id, worker) in &mut workers {
                if worker.fallback.due(now, interval) {
                    enqueue(
                        &mut pending,
                        id.clone(),
                        worker.control.clone(),
                        Trigger::poll(),
                    );
                    worker.fallback.completed(now);
                }
            }
            let finished_ids = jobs
                .iter()
                .filter(|(_, job)| job.thread.is_finished())
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in finished_ids {
                let finished = jobs.remove(&id).unwrap();
                let outcome = finished
                    .thread
                    .join()
                    .unwrap_or(SyncOutcome::Finished(false));
                if let Some(queued) = pending.get_mut(&finished.id) {
                    if Arc::ptr_eq(&queued.control, &finished.control)
                        && finish_pending(queued, finished.serial, outcome, Instant::now())
                    {
                        pending.remove(&finished.id);
                    }
                }
            }
            if let Ok(first) = rx.recv_timeout(Duration::from_secs(1)) {
                for event in std::iter::once(first).chain(rx.try_iter()) {
                    if event.control.stopped()
                        || !workers
                            .get(&event.id)
                            .is_some_and(|w| Arc::ptr_eq(&w.control, &event.control))
                    {
                        continue;
                    }
                    match event.kind {
                        EventKind::Changed(trigger) => {
                            if trigger.push {
                                if let Ok(gate) = crate::sync_control::folder_gate(
                                    &store.root,
                                    &event.id,
                                    "INBOX",
                                ) {
                                    // Signal without waiting for the held folder lock.
                                    gate.notify();
                                }
                            }
                            enqueue(&mut pending, event.id, event.control, trigger);
                        }
                        EventKind::Status(message) => {
                            if let Ok(account) = store.account(&event.id) {
                                let _ = store.log(&format!("{} {message}", account.email));
                            }
                        }
                    }
                }
            }
            let ready = pending
                .iter()
                .filter(|(id, p)| {
                    !jobs.contains_key(*id) && p.retry_at <= Instant::now() && !p.control.stopped()
                })
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            for id in ready {
                if let Some(queued) = pending.get(&id) {
                    let id = id.clone();
                    let worker_control = queued.control.clone();
                    let serial = queued.serial;
                    let job_store = store.clone();
                    let job_app = app.clone();
                    let cancelled = worker_control.clone();
                    let account_id = id.clone();
                    let trigger = queued.trigger.clone();
                    let expected = workers
                        .get(&id)
                        .map(|w| w.config.clone())
                        .unwrap_or_default();
                    jobs.insert(
                        id.clone(),
                        SyncJob {
                            id,
                            control: worker_control,
                            serial,
                            thread: thread::spawn(move || {
                                if cancelled.stopped() {
                                    return SyncOutcome::Stale;
                                }
                                let Ok(account) = job_store.account(&account_id) else {
                                    return SyncOutcome::Stale;
                                };
                                if !account.enabled
                                    || account.protocol != "imap"
                                    || config(&account) != expected
                                {
                                    return SyncOutcome::Stale;
                                }
                                let started = Instant::now();
                                let email = account.email.clone();
                                let _ = job_store.log(&format!(
                                    "{} 收件诊断：{} {}；排队 {} 毫秒，开始收件箱收取",
                                    email,
                                    trigger.source,
                                    trigger
                                        .time
                                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                                    trigger.at.elapsed().as_millis(),
                                ));
                                let result = crate::sync_inbox(&job_store, &job_app, account);
                                let _ = job_store.log(&format!(
                                    "{} 收件诊断：{} {}；本轮 {} 毫秒，从触发到结束 {} 毫秒；{}",
                                    email,
                                    trigger.source,
                                    trigger
                                        .time
                                        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                                    started.elapsed().as_millis(),
                                    trigger.at.elapsed().as_millis(),
                                    if result.is_ok() { "成功" } else { "失败" },
                                ));
                                SyncOutcome::Finished(result.is_ok())
                            }),
                        },
                    );
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn polling_and_push_coalesce_without_losing_retries_or_crossing_accounts() {
        let mut pending = HashMap::new();
        let a = Arc::new(ConnectionControl::default());
        let b = Arc::new(ConnectionControl::default());
        enqueue(&mut pending, "a".into(), a.clone(), Trigger::poll());
        let retry = Instant::now() + Duration::from_secs(30);
        let job = pending.get_mut("a").unwrap();
        job.retry_at = retry;
        job.failures = 3;
        enqueue(&mut pending, "a".into(), a.clone(), Trigger::poll());
        enqueue(&mut pending, "b".into(), b, Trigger::poll());
        assert_eq!(pending.len(), 2);
        assert_eq!(pending["a"].serial, 2);
        assert_eq!(pending["a"].retry_at, retry);
        assert_eq!(pending["a"].failures, 3);
        assert!(!finish_pending(
            pending.get_mut("a").unwrap(),
            1,
            SyncOutcome::Finished(true),
            Instant::now()
        ));
        a.stop();
        enqueue(&mut pending, "a".into(), a, Trigger::poll());
        assert_eq!(pending["a"].serial, 2);
        let replacement = Arc::new(ConnectionControl::default());
        enqueue(
            &mut pending,
            "a".into(),
            replacement.clone(),
            Trigger::poll(),
        );
        assert!(Arc::ptr_eq(&pending["a"].control, &replacement));
        assert_eq!(pending["a"].serial, 1);
        assert_eq!(pending["a"].failures, 0);
    }
    #[test]
    fn pending_notification_survives_failure_and_notifications_during_sync() {
        let now = Instant::now();
        let mut pending = Pending {
            control: Arc::new(ConnectionControl::default()),
            serial: 1,
            retry_at: now,
            failures: 0,
            trigger: Trigger::poll(),
        };
        assert!(!finish_pending(
            &mut pending,
            1,
            SyncOutcome::Finished(false),
            now
        ));
        assert_eq!(pending.failures, 1);
        assert!(pending.retry_at > now);
        pending.serial += 1;
        assert!(!finish_pending(
            &mut pending,
            1,
            SyncOutcome::Finished(true),
            now
        ));
        assert!(finish_pending(
            &mut pending,
            2,
            SyncOutcome::Finished(true),
            now
        ));
    }
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
}
