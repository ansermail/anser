use crate::{
    models::{err, Result},
    store::Store,
    AppState,
};
use chrono::{NaiveDate, NaiveTime};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
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
    checklist: Vec<Check>,
    mail_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    mail_subject: String,
    notes: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct Check {
    text: String,
    done: bool,
}

pub(crate) fn initialize(db: &rusqlite::Connection) -> Result<()> {
    // Work item properties live in JSON. Remove only the retired effort keys,
    // preserving revisions and any unrelated properties from older records.
    db.execute(
        "UPDATE work_items SET data=json_remove(data,'$.estimatedMinutes','$.actualMinutes')
         WHERE json_valid(data) AND
         (json_type(data,'$.estimatedMinutes') IS NOT NULL OR
          json_type(data,'$.actualMinutes') IS NOT NULL)",
        [],
    )
    .map_err(err)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS work_projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, name TEXT NOT NULL UNIQUE)").map_err(err)?;
    let names: Vec<String> = db.prepare("SELECT DISTINCT json_extract(data,'$.project') FROM work_items WHERE json_valid(data) AND COALESCE(json_extract(data,'$.project'),'') != ''")
        .map_err(err)?.query_map([], |row| row.get(0)).map_err(err)?.collect::<std::result::Result<_, _>>().map_err(err)?;
    for name in names {
        db.execute(
            "INSERT OR IGNORE INTO work_projects(id,revision,name) VALUES (?1,1,?2)",
            params![uuid::Uuid::new_v4().to_string(), name],
        )
        .map_err(err)?;
    }
    Ok(())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkProject {
    id: String,
    revision: u64,
    name: String,
}

#[derive(Serialize)]
pub struct WorkbenchData {
    projects: Vec<WorkProject>,
    items: Vec<WorkItem>,
}

fn projects(db: &rusqlite::Connection) -> Result<Vec<WorkProject>> {
    let mut statement = db
        .prepare("SELECT id,revision,name FROM work_projects ORDER BY name,id")
        .map_err(err)?;
    let rows = statement
        .query_map([], |row| {
            Ok(WorkProject {
                id: row.get(0)?,
                revision: row.get(1)?,
                name: row.get(2)?,
            })
        })
        .map_err(err)?;
    rows.collect::<std::result::Result<_, _>>().map_err(err)
}

fn items(db: &rusqlite::Connection) -> Result<Vec<WorkItem>> {
    let mut statement = db
        .prepare(
            "SELECT w.data,COALESCE(json_extract(m.data,'$.subject'),'')
             FROM work_items w
             LEFT JOIN messages m ON m.id=json_extract(w.data,'$.mailId')
             ORDER BY w.work_date DESC,
                      COALESCE(json_extract(w.data,'$.time'),'') DESC,
                      w.id",
        )
        .map_err(err)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(err)?;
    rows.map(|row| {
        let (data, subject) = row.map_err(err)?;
        let mut item: WorkItem = serde_json::from_str(&data).map_err(err)?;
        item.mail_subject = subject;
        Ok(item)
    })
    .collect()
}

fn mail_subject(db: &rusqlite::Connection, mail_id: &str) -> Result<String> {
    if mail_id.is_empty() {
        return Ok(String::new());
    }
    Ok(db
        .query_row(
            "SELECT COALESCE(json_extract(data,'$.subject'),'') FROM messages WHERE id=?1",
            [mail_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(err)?
        .unwrap_or_default())
}

#[tauri::command]
pub fn list_work_projects(state: tauri::State<AppState>) -> Result<Vec<WorkProject>> {
    projects(&state.store.db()?)
}

fn change_project(store: &Store, mut project: WorkProject, delete: bool) -> Result<WorkbenchData> {
    project.name = project.name.trim().to_owned();
    if uuid::Uuid::parse_str(&project.id).is_err()
        || (!delete && (project.name.is_empty() || project.name.chars().count() > 80))
    {
        return Err("项目名称无效".into());
    }
    let mut db = store.db()?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let existing: Option<(u64, String)> = tx
        .query_row(
            "SELECT revision,name FROM work_projects WHERE id=?1",
            [&project.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(err)?;
    if existing.as_ref().map_or(0, |p| p.0) != project.revision || (delete && existing.is_none()) {
        return Err("项目已改动，请重新加载".into());
    }
    if !delete
        && projects(&tx)?
            .iter()
            .any(|p| p.id != project.id && p.name.to_lowercase() == project.name.to_lowercase())
    {
        return Err("已存在同名项目".into());
    }
    if let Some((_, previous)) = existing {
        if delete || previous != project.name {
            // Update only the project property and revision, preserving unknown JSON fields.
            tx.execute("UPDATE work_items SET revision=revision+1, data=json_set(data,'$.project',?1,'$.revision',revision+1) WHERE json_extract(data,'$.project')=?2", params![if delete { "" } else { &project.name }, previous]).map_err(err)?;
        }
    }
    if delete {
        tx.execute("DELETE FROM work_projects WHERE id=?1", [&project.id])
            .map_err(err)?;
    } else {
        tx.execute("INSERT INTO work_projects(id,revision,name) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,name=excluded.name", params![project.id, project.revision + 1, project.name]).map_err(err)?;
    }
    let data = WorkbenchData {
        projects: projects(&tx)?,
        items: items(&tx)?,
    };
    tx.commit().map_err(err)?;
    Ok(data)
}

#[tauri::command]
pub fn save_work_project(
    state: tauri::State<AppState>,
    project: WorkProject,
) -> Result<WorkbenchData> {
    change_project(&state.store, project, false)
}

#[tauri::command]
pub fn delete_work_project(
    state: tauri::State<AppState>,
    id: String,
    revision: u64,
) -> Result<WorkbenchData> {
    change_project(
        &state.store,
        WorkProject {
            id,
            revision,
            name: String::new(),
        },
        true,
    )
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
    items(&db)
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
    if !item.project.is_empty() {
        tx.execute(
            "INSERT OR IGNORE INTO work_projects(id,revision,name) VALUES (?1,1,?2)",
            params![uuid::Uuid::new_v4().to_string(), item.project],
        )
        .map_err(err)?;
    }
    item.revision += 1;
    item.mail_subject.clear();
    let data = serde_json::to_string(&item).map_err(err)?;
    tx.execute("INSERT INTO work_items (id,revision,work_date,data) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,work_date=excluded.work_date,data=excluded.data", params![item.id, item.revision, item.date, data]).map_err(err)?;
    item.mail_subject = mail_subject(&tx, &item.mail_id)?;
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
    fn removes_legacy_effort_fields_without_changing_work_records() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::new(tmp.path().to_owned()).unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let legacy = serde_json::json!({
            "id": id, "revision": 7, "title": "Delivery review", "status": "doing",
            "priority": "high", "project": "Anser", "date": "2026-11-16", "time": "09:30",
            "estimatedMinutes": 120, "actualMinutes": 45,
            "checklist": [{"text": "Confirm scope", "done": true}],
            "mailId": "source-mail", "notes": "Keep the original decision", "futureField": "keep"
        });
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO work_items VALUES (?1,7,'2026-11-16',?2)",
                params![id, legacy.to_string()],
            )
            .unwrap();
        drop(store);

        let mut expected = legacy;
        expected.as_object_mut().unwrap().remove("estimatedMinutes");
        expected.as_object_mut().unwrap().remove("actualMinutes");
        for _ in 0..2 {
            let store = Store::new(tmp.path().to_owned()).unwrap();
            let (revision, date, data): (u64, String, String) = store
                .db()
                .unwrap()
                .query_row(
                    "SELECT revision,work_date,data FROM work_items WHERE id=?1",
                    [&id],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
                )
                .unwrap();
            assert_eq!(revision, 7);
            assert_eq!(date, "2026-11-16");
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&data).unwrap(),
                expected
            );
        }
        let store = Store::new(tmp.path().to_owned()).unwrap();
        let mut item = list(&store).unwrap().pop().unwrap();
        assert_eq!(item.revision, 7);
        item.notes = "Updated without effort fields".into();
        let saved = serde_json::to_value(save(&store, item).unwrap()).unwrap();
        assert!(saved.get("estimatedMinutes").is_none());
        assert!(saved.get("actualMinutes").is_none());
    }

    #[test]
    fn project_changes_are_atomic_persistent_and_reject_stale_edits() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::new(tmp.path().to_owned()).unwrap();
        let item: WorkItem = serde_json::from_value(serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(), "revision": 0, "title": "Review", "status": "todo", "priority": "normal",
            "project": "Legacy project", "date": "2026-11-15", "time": "00:00", "endDate": "2026-11-17",
            "checklist": [{"text":"Keep subtask","done":true}], "mailId": "source", "notes": "Keep notes"
        })).unwrap();
        let saved = save(&store, item).unwrap();
        let project = projects(&store.db().unwrap()).unwrap().pop().unwrap();
        assert_eq!(project.name, "Legacy project");
        let mut renamed = project.clone();
        renamed.name = "Renamed project".into();
        let data = change_project(&store, renamed.clone(), false).unwrap();
        assert_eq!(data.items[0].project, "Renamed project");
        assert_eq!(data.items[0].revision, saved.revision + 1);
        assert_eq!(data.items[0].time, "00:00");
        assert_eq!(data.items[0].end_date, "2026-11-17");
        assert!(data.items[0].checklist[0].done);
        assert_eq!(data.items[0].mail_id, "source");
        assert!(save(&store, saved).is_err());
        assert!(change_project(&store, renamed, false).is_err());
        assert!(change_project(
            &store,
            WorkProject {
                id: uuid::Uuid::new_v4().to_string(),
                revision: 0,
                name: "RENAMED PROJECT".into()
            },
            false
        )
        .is_err());
        let stale = data.items[0].clone();
        let data = change_project(&store, data.projects[0].clone(), true).unwrap();
        assert!(data.projects.is_empty());
        assert_eq!(data.items.len(), 1);
        assert_eq!(data.items[0].project, "");
        assert_eq!(data.items[0].revision, stale.revision + 1);
        assert!(save(&store, stale).is_err());
        drop(store);
        let store = Store::new(tmp.path().to_owned()).unwrap();
        assert!(projects(&store.db().unwrap()).unwrap().is_empty());
        assert_eq!(list(&store).unwrap()[0].notes, "Keep notes");
        let empty = WorkProject {
            id: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            name: "Empty project".into(),
        };
        change_project(&store, empty, false).unwrap();
        drop(store);
        let store = Store::new(tmp.path().to_owned()).unwrap();
        assert_eq!(
            projects(&store.db().unwrap()).unwrap()[0].name,
            "Empty project"
        );
    }

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

    #[test]
    fn lists_newest_first_and_resolves_mail_subjects_without_persisting_them() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::new(tmp.path().to_owned()).unwrap();
        let mail_id = "linked-mail";
        store
            .db()
            .unwrap()
            .execute(
                "INSERT INTO messages(id,account_id,hash,data) VALUES (?1,?2,?3,?4)",
                params![
                    mail_id,
                    "account",
                    "linked-hash",
                    serde_json::json!({ "subject": "Project materials" }).to_string()
                ],
            )
            .unwrap();
        for (title, date, time, linked_mail) in [
            ("Earlier", "2026-11-17", "09:00", ""),
            ("Later", "2026-11-17", "14:00", mail_id),
            ("Previous day", "2026-11-16", "17:00", ""),
        ] {
            let item = serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "revision": 0,
                "title": title,
                "status": "todo",
                "priority": "normal",
                "project": "",
                "date": date,
                "time": time,
                "checklist": [],
                "mailId": linked_mail,
                "notes": ""
            });
            save(&store, serde_json::from_value(item).unwrap()).unwrap();
        }

        let listed = list(&store).unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|item| item.title.as_str())
                .collect::<Vec<_>>(),
            ["Later", "Earlier", "Previous day"]
        );
        assert_eq!(listed[0].mail_subject, "Project materials");

        let mut linked = listed[0].clone();
        linked.notes = "Keep the subject visible".into();
        let saved = save(&store, linked).unwrap();
        assert_eq!(saved.mail_subject, "Project materials");
        let persisted: String = store
            .db()
            .unwrap()
            .query_row(
                "SELECT data FROM work_items WHERE id=?1",
                [&saved.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!persisted.contains("mailSubject"));
    }
}
