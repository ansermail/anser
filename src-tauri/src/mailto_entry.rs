use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager};

const MAX_PENDING: usize = 8;
const MAX_LENGTH: usize = 64 * 1024;

#[derive(Clone, Default)]
pub struct MailtoLinks(Arc<Mutex<VecDeque<String>>>);

fn candidate(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() > MAX_LENGTH
        || !value
            .get(..7)
            .is_some_and(|scheme| scheme.eq_ignore_ascii_case("mailto:"))
    {
        return None;
    }
    Some(value.to_string())
}

impl MailtoLinks {
    pub fn queue(&self, value: &str) -> bool {
        let Some(value) = candidate(value) else {
            return false;
        };
        let Ok(mut pending) = self.0.lock() else {
            return false;
        };
        if pending.len() >= MAX_PENDING {
            return false;
        }
        pending.push_back(value);
        true
    }

    pub fn queue_arguments(&self, args: impl IntoIterator<Item = String>) -> bool {
        let mut accepted = false;
        for value in args {
            accepted |= self.queue(&value);
        }
        accepted
    }

    pub fn take_pending(&self) -> Result<Vec<String>, String> {
        Ok(self
            .0
            .lock()
            .map_err(|error| error.to_string())?
            .drain(..)
            .collect())
    }
}

pub fn queue_arguments(app: &tauri::AppHandle, args: &[String]) -> bool {
    let queued = app
        .try_state::<MailtoLinks>()
        .is_some_and(|links| links.queue_arguments(args.iter().cloned()));
    if queued {
        let _ = app.emit("mailto-open", ());
    }
    queued
}

pub fn queue_value(app: &tauri::AppHandle, value: &str) -> bool {
    let queued = app
        .try_state::<MailtoLinks>()
        .is_some_and(|links| links.queue(value));
    if queued {
        let _ = app.emit("mailto-open", ());
    }
    queued
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queues_only_bounded_mailto_values() {
        let links = MailtoLinks::default();
        assert!(links.queue("mailto:team@example.com?subject=Hello"));
        assert!(links.queue("MAILTO:copy@example.com"));
        assert!(!links.queue("https://example.com"));
        assert!(!links.queue(&format!("mailto:{}", "x".repeat(MAX_LENGTH))));
        assert_eq!(
            links.take_pending().unwrap(),
            [
                "mailto:team@example.com?subject=Hello",
                "MAILTO:copy@example.com"
            ]
        );
    }

    #[test]
    fn bounds_the_pending_queue() {
        let links = MailtoLinks::default();
        for index in 0..MAX_PENDING {
            assert!(links.queue(&format!("mailto:{index}@example.com")));
        }
        assert!(!links.queue("mailto:overflow@example.com"));
        assert_eq!(links.take_pending().unwrap().len(), MAX_PENDING);
    }
}
