use crate::{
    models::{err, Result},
    store::Store,
    AppState,
};
use chrono::{NaiveDate, NaiveTime};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkItem {
    id: String,
    revision: u64,
    title: String,
    status: String,
    priority: String,
    project: String,
    date: String,
    time: String,
    #[serde(default)]
    end_date: String,
    #[serde(default)]
    important: bool,
    #[serde(default)]
    urgent: bool,
    estimated_minutes: u32,
    actual_minutes: u32,
    checklist: Vec<Check>,
    mail_id: String,
    notes: String,
}

#[derive(Deserialize, Serialize)]
struct Check {
    text: String,
    done: bool,
}

fn validate(item: &WorkItem) -> Result<()> {
    if uuid::Uuid::parse_str(&item.id).is_err()
        || item.title.trim().is_empty()
        || item.title.len() > 800
        || item.project.len() > 320
        || item.notes.len() > 16_000
        || item.mail_id.len() > 256
        || item.checklist.len() > 50
        || item
            .checklist
            .iter()
            .any(|check| check.text.trim().is_empty() || check.text.len() > 800)
        || !matches!(item.status.as_str(), "todo" | "doing" | "waiting" | "done")
        || !matches!(item.priority.as_str(), "low" | "normal" | "high")
        || item.estimated_minutes > 100_000
        || item.actual_minutes > 100_000
        || !NaiveDate::parse_from_str(&item.date, "%Y-%m-%d")
            .is_ok_and(|d| d.to_string() == item.date)
        || (!item.end_date.is_empty()
            && (item.end_date < item.date
                || !NaiveDate::parse_from_str(&item.end_date, "%Y-%m-%d")
                    .is_ok_and(|d| d.to_string() == item.end_date)))
        || (!item.time.is_empty()
            && !NaiveTime::parse_from_str(&item.time, "%H:%M")
                .is_ok_and(|t| t.format("%H:%M").to_string() == item.time))
    {
        return Err("工作事项字段无效".into());
    }
    Ok(())
}

#[tauri::command]
pub fn list_work_items(state: tauri::State<AppState>) -> Result<Vec<WorkItem>> {
    list(&state.store)
}

fn list(store: &Store) -> Result<Vec<WorkItem>> {
    let db = store.db()?;
    let mut statement = db
        .prepare("SELECT data FROM work_items ORDER BY work_date,id")
        .map_err(err)?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(err)?;
    rows.map(|row| serde_json::from_str(&row.map_err(err)?).map_err(err))
        .collect()
}

#[tauri::command]
pub fn save_work_item(state: tauri::State<AppState>, item: WorkItem) -> Result<WorkItem> {
    save(&state.store, item)
}

fn save(store: &Store, mut item: WorkItem) -> Result<WorkItem> {
    validate(&item)?;
    let mut db = store.db()?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let existing: Option<u64> = tx
        .query_row(
            "SELECT revision FROM work_items WHERE id=?1",
            [&item.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?;
    if existing.unwrap_or(0) != item.revision {
        return Err("事项已改动，请重新加载".into());
    }
    if existing.is_none() {
        let count: u32 = tx
            .query_row("SELECT COUNT(*) FROM work_items", [], |row| row.get(0))
            .map_err(err)?;
        if count >= 5000 {
            return Err("工作事项已达到本机数量上限".into());
        }
    }
    item.revision += 1;
    let data = serde_json::to_string(&item).map_err(err)?;
    tx.execute("INSERT INTO work_items (id,revision,work_date,data) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,work_date=excluded.work_date,data=excluded.data", params![item.id, item.revision, item.date, data]).map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(item)
}

#[tauri::command]
pub fn delete_work_item(state: tauri::State<AppState>, id: String, revision: u64) -> Result<()> {
    if state
        .store
        .db()?
        .execute(
            "DELETE FROM work_items WHERE id=?1 AND revision=?2",
            params![id, revision],
        )
        .map_err(err)?
        != 1
    {
        return Err("事项已改动，请重新加载".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_across_reopen_and_rejects_stale_updates() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::new(tmp.path().to_owned()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let item = serde_json::json!({
            "id": id, "revision": 0, "title": "Review", "status": "todo", "priority": "normal",
            "project": "Anser", "date": "2026-11-14", "time": "09:30", "estimatedMinutes": 30,
            "actualMinutes": 0, "checklist": [], "mailId": "", "notes": ""
        });
        assert_eq!(
            save(&store, serde_json::from_value(item.clone()).unwrap())
                .unwrap()
                .revision,
            1
        );
        assert!(save(&store, serde_json::from_value(item).unwrap()).is_err());
        drop(store);
        let store = Store::new(tmp.path().to_owned()).unwrap();
        let mut found = list(&store).unwrap();
        assert_eq!(found.len(), 1);
        let mut item = found.pop().unwrap();
        assert_eq!(item.id, id);
        assert_eq!(item.time, "09:30");
        assert!(!item.important && !item.urgent && item.end_date.is_empty());
        item.end_date = "2026-11-13".into();
        assert!(validate(&item).is_err());
        item.end_date = "2026-11-16".into();
        item.urgent = true;
        assert!(save(&store, item).unwrap().urgent);
        let mut item = list(&store).unwrap().pop().unwrap();
        item.date = "2026-02-30".into();
        assert!(save(&store, item).is_err());
    }
}
