//! A cancellable, bounded transport for the IMAP library's IDLE extension.
use crate::models::{err, Result};
use imap::extensions::idle::SetReadTimeout;
use native_tls::TlsStream;
use std::{
    io::{Read, Write},
    net::{Shutdown, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Default)]
pub struct ConnectionControl {
    stopped: AtomicBool,
    socket: Mutex<Option<TcpStream>>,
}
impl ConnectionControl {
    pub fn stopped(&self) -> bool {
        self.stopped.load(Ordering::Acquire)
    }
    pub fn attach(&self, socket: &TcpStream) -> Result<()> {
        let mut current = self.socket.lock().map_err(err)?;
        if self.stopped() {
            return Err("实时监听已停止".into());
        }
        *current = Some(socket.try_clone().map_err(err)?);
        Ok(())
    }
    pub fn clear(&self) {
        if let Ok(mut current) = self.socket.lock() {
            current.take();
        }
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        if let Ok(mut current) = self.socket.lock() {
            if let Some(socket) = current.take() {
                let _ = socket.shutdown(Shutdown::Both);
            }
        }
    }
}

#[derive(Default)]
pub struct MailboxActivity {
    count: Option<u32>,
    uid_next: Option<u32>,
    uid_validity: Option<u32>,
    changed: bool,
    line: Vec<u8>,
    probe_deadline: Option<Instant>,
}
/// Bound an entire NOOP response, including a stream of keepalives. Removing
/// the deadline on every exit avoids applying it to the next IDLE command.
pub struct ProbeDeadline(Arc<Mutex<MailboxActivity>>);
impl ProbeDeadline {
    pub fn register(activity: &Arc<Mutex<MailboxActivity>>, timeout: Duration) -> Result<Self> {
        let mut state = activity.lock().map_err(err)?;
        if state.probe_deadline.is_some() {
            return Err("实时补查已有截止时间".into());
        }
        state.probe_deadline = Some(Instant::now() + timeout);
        Ok(Self(activity.clone()))
    }
}
impl Drop for ProbeDeadline {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.lock() {
            state.probe_deadline = None;
        }
    }
}
impl MailboxActivity {
    fn observe(&mut self, bytes: &[u8]) {
        for byte in bytes {
            // IDLE only sends short unsolicited status lines; bound malformed input.
            if self.line.len() >= 64 * 1024 {
                self.line.clear();
            }
            self.line.push(*byte);
            if *byte != b'\n' {
                continue;
            }
            use imap_proto::{MailboxDatum, Response, ResponseCode, Status};
            match imap_proto::parse_response(&self.line) {
                Ok(([], Response::MailboxData(MailboxDatum::Exists(number)))) => {
                    self.changed |= self.count.is_some_and(|old| old != number);
                    self.count = Some(number);
                }
                Ok(([], Response::Expunge(_))) => {
                    self.changed = true;
                    self.count = self.count.map(|old| old.saturating_sub(1));
                }
                Ok((
                    [],
                    Response::Data {
                        status: Status::Ok,
                        code: Some(code),
                        ..
                    },
                )) => {
                    let (slot, number) = match code {
                        ResponseCode::UidNext(number) => (&mut self.uid_next, number),
                        ResponseCode::UidValidity(number) => (&mut self.uid_validity, number),
                        _ => {
                            self.line.clear();
                            continue;
                        }
                    };
                    self.changed |= slot.is_some_and(|old| old != number);
                    *slot = Some(number);
                }
                _ => {}
            }
            self.line.clear();
        }
    }
    pub fn take_changed(&mut self) -> bool {
        std::mem::take(&mut self.changed)
    }
}

pub trait TimedStream: Read + Write {
    fn read_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()>;
}
impl TimedStream for TlsStream<TcpStream> {
    fn read_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        self.get_ref().set_read_timeout(timeout)
    }
}
impl TimedStream for TcpStream {
    fn read_timeout(&self, timeout: Option<Duration>) -> std::io::Result<()> {
        self.set_read_timeout(timeout)
    }
}
pub struct ObservedStream<T> {
    stream: T,
    pub activity: Arc<Mutex<MailboxActivity>>,
    deadline: Option<Instant>,
}
impl<T> ObservedStream<T> {
    pub fn new(stream: T, activity: Arc<Mutex<MailboxActivity>>) -> Self {
        Self {
            stream,
            activity,
            deadline: None,
        }
    }
}
impl<T: TimedStream> Read for ObservedStream<T> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let probe = self
            .activity
            .lock()
            .ok()
            .and_then(|state| state.probe_deadline);
        if let Some(deadline) = self.deadline.into_iter().chain(probe).min() {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(std::io::ErrorKind::TimedOut.into());
            }
            self.stream.read_timeout(Some(remaining))?;
        }
        let size = self.stream.read(buffer)?;
        if let Ok(mut activity) = self.activity.lock() {
            activity.observe(&buffer[..size]);
        }
        Ok(size)
    }
}
impl<T: Write> Write for ObservedStream<T> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        self.stream.write(buffer)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.stream.flush()
    }
}
impl<T: TimedStream> SetReadTimeout for ObservedStream<T> {
    fn set_read_timeout(&mut self, timeout: Option<Duration>) -> imap::error::Result<()> {
        self.deadline = timeout.map(|timeout| Instant::now() + timeout);
        // imap 2.x resets to None before sending DONE on drop. Keep that command
        // bounded even when a server drops the connection without answering.
        self.stream
            .read_timeout(Some(timeout.unwrap_or(Duration::from_secs(45))))
            .map_err(imap::error::Error::Io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn probe_deadline_bounds_continuous_keepalives_and_cleans_up_on_unwind() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let socket = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut peer, _) = listener.accept().unwrap();
        let server = std::thread::spawn(move || {
            for _ in 0..200 {
                if peer.write_all(b"* OK keepalive\r\n").is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        let activity = Arc::new(Mutex::new(MailboxActivity::default()));
        let mut stream = ObservedStream::new(socket, activity.clone());
        let deadline = ProbeDeadline::register(&activity, Duration::from_millis(30)).unwrap();
        let started = Instant::now();
        let error = loop {
            let mut b = [0; 128];
            if let Err(e) = stream.read(&mut b) {
                break e;
            }
        };
        assert!(matches!(
            error.kind(),
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
        ));
        assert!(started.elapsed() < Duration::from_secs(3));
        drop(deadline);
        assert!(activity.lock().unwrap().probe_deadline.is_none());
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _deadline = ProbeDeadline::register(&activity, Duration::from_secs(1)).unwrap();
            panic!("fixture unwind");
        }));
        assert!(activity.lock().unwrap().probe_deadline.is_none());
        drop(stream);
        server.join().unwrap();
    }
    #[test]
    fn tracks_fragmented_notifications_without_syncing_on_keepalive_or_repeated_counts() {
        let mut activity = MailboxActivity::default();
        activity.observe(b"* 3 EXI");
        activity.observe(b"STS\r\n");
        assert!(!activity.take_changed());
        activity.observe(b"* OK Still here\r\n* 3 EXISTS\r\n* 0 RECENT\r\n");
        assert!(!activity.take_changed());
        activity.observe(b"* 4 EXISTS\r\n");
        assert!(activity.take_changed());
        activity.observe(b"* 2 EXPUNGE\r\n* 4 EXISTS\r\n");
        assert!(activity.take_changed());
        assert!(!activity.take_changed());
    }
    #[test]
    fn uid_changes_are_observed_even_when_message_count_stays_equal() {
        let mut activity = MailboxActivity::default();
        let original = b"* 3 EXISTS\r\n* OK [UIDNEXT 7] Next\r\n* OK [UIDVALIDITY 9] Valid\r\n";
        activity.observe(original);
        assert!(!activity.take_changed());
        activity.observe(original);
        assert!(!activity.take_changed());
        activity.observe(b"* 3 EXISTS\r\n* OK [UIDNEXT 8] Next\r\n");
        assert!(activity.take_changed());
        activity.observe(b"* OK [UIDVALIDITY 10] Valid\r\n");
        assert!(activity.take_changed());
        activity.observe(b"* NO [UIDNEXT 99] Rejected\r\n* OK [UIDNEXT invalid] Bad\r\n");
        assert!(!activity.take_changed());
        activity.observe(b"* OK [UIDNEXT 8] Same\r\n");
        assert!(!activity.take_changed());
    }
    #[test]
    fn stopping_interrupts_socket_reads_and_prevents_reusing_a_cancelled_worker() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_peer, _) = listener.accept().unwrap();
        let control = Arc::new(ConnectionControl::default());
        control.attach(&stream).unwrap();
        let reader = std::thread::spawn(move || {
            let mut stream = stream;
            let mut byte = [0];
            stream.read(&mut byte)
        });
        control.stop();
        assert!(matches!(reader.join().unwrap(), Ok(0) | Err(_)));
        assert!(control.stopped());
        let stream = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        assert!(control.attach(&stream).is_err());
    }
}
