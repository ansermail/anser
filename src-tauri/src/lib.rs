mod archive;
mod auth;
mod models;
mod network;
mod productivity;
mod rules;
mod store;
use models::*;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use store::Store;
use tauri::{Emitter, Manager};
struct AppState {
    store: Store,
    gate: Arc<Mutex<()>>,
}
#[tauri::command]
fn snapshot(state: tauri::State<AppState>, query: Query) -> Result<Snapshot> {
    state.store.snapshot(&query)
}
#[tauri::command]
async fn mail_detail(state: tauri::State<'_, AppState>, id: String) -> Result<Detail> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.detail(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
fn update_mail(
    state: tauri::State<AppState>,
    id: String,
    action: String,
    value: String,
) -> Result<()> {
    let mut m = state.store.mail(&id)?;
    match action.as_str() {
        "read" => m.is_read = value == "true",
        "star" => m.starred = value == "true",
        "trash" => m.trashed = value == "true",
        "folder" => {
            if value.trim().is_empty() {
                return Err("文件夹名称不能为空".into());
            }
            m.local_folder = value;
        }
        _ => return Err("无效动作".into()),
    };
    state.store.update_mail(&m)
}
#[tauri::command]
fn save_rules(state: tauri::State<AppState>, rules: Vec<Rule>) -> Result<()> {
    state.store.save_rules(&rules)
}
#[tauri::command]
fn preview_rule(state: tauri::State<AppState>, rule: Rule) -> Result<Vec<String>> {
    state.store.preview_rule(&rule)
}
#[tauri::command]
async fn run_rules(state: tauri::State<'_, AppState>) -> Result<u32> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        store.run_rules()
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn connect_account(
    state: tauri::State<'_, AppState>,
    mut account: Account,
    password: String,
    smtp_password: String,
) -> Result<()> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        account.validate()?;
        let secret = if account.auth == "oauth" {
            auth::authorize(&account)?
        } else {
            if password.is_empty() {
                return Err("请输入密码或客户端授权码".into());
            }
            auth::Secret {
                password,
                smtp_password,
                ..Default::default()
            }
        };
        network::test(&account, &secret)?;
        auth::save(&account.id, &secret)?;
        account.error = None;
        store.save_account(&account)?;
        store.log(&format!("账号 {} 已通过收发连接测试", account.email))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn edit_account(
    state: tauri::State<'_, AppState>,
    account: Account,
    password: String,
    smtp_password: String,
    reauthorize: bool,
    smtp_use_incoming: bool,
) -> Result<()> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        let old = store.account(&account.id)?;
        account.validate()?;
        if old.email != account.email {
            return Err("修改邮箱地址请添加新账号".into());
        }
        let secret = if account.auth == "oauth" {
            if reauthorize
                || old.auth != account.auth
                || auth::client_id(&old) != auth::client_id(&account)
            {
                auth::authorize(&account)?
            } else {
                auth::credentials(&old)?
            }
        } else {
            let mut secret = if old.auth == "password" {
                auth::load(&old.id).or_else(|e| {
                    if password.is_empty() {
                        Err(e)
                    } else {
                        Ok(auth::Secret::default())
                    }
                })?
            } else {
                auth::Secret::default()
            };
            if !password.is_empty() {
                secret.password = password;
            }
            if !smtp_password.is_empty() {
                secret.smtp_password = smtp_password;
            }
            if smtp_use_incoming {
                secret.smtp_password.clear();
            }
            if secret.password.is_empty() {
                return Err("请输入密码或客户端授权码".into());
            }
            secret
        };
        network::test(&account, &secret)?;
        auth::save(&account.id, &secret)?;
        store.edit_account(&account)?;
        store.log(&format!("账号 {} 配置已更新，收发验证通过", account.email))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn list_contacts(state: tauri::State<AppState>) -> Result<Vec<Contact>> {
    state.store.contacts()
}
#[tauri::command]
fn save_contact(state: tauri::State<AppState>, contact: Contact) -> Result<()> {
    state.store.save_contact(&contact)
}
#[tauri::command]
fn delete_contact(state: tauri::State<AppState>, id: String) -> Result<()> {
    state
        .store
        .db()?
        .execute("DELETE FROM contacts WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}
#[tauri::command]
async fn contact_suggestions(state: tauri::State<'_, AppState>) -> Result<Vec<Address>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.contact_suggestions())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn list_outbox(state: tauri::State<'_, AppState>) -> Result<Vec<OutboxRecord>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.outbox())
        .await
        .map_err(err)?
}
#[tauri::command]
fn retry_outbox(
    state: tauri::State<AppState>,
    id: String,
    confirm_duplicate: bool,
) -> Result<Compose> {
    state.store.outbox_draft(&id, confirm_duplicate)
}
#[tauri::command]
async fn archive_outbox(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        store.archive_outbox(&id)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn get_preferences(state: tauri::State<AppState>) -> Result<Preferences> {
    state.store.preferences()
}
#[tauri::command]
fn save_preferences(state: tauri::State<AppState>, preferences: Preferences) -> Result<()> {
    state.store.save_preferences(&preferences)
}
#[tauri::command]
async fn archive_health(state: tauri::State<'_, AppState>) -> Result<ArchiveHealth> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_health())
        .await
        .map_err(err)?
}
#[tauri::command]
fn account_action(state: tauri::State<AppState>, id: String, remove: bool) -> Result<()> {
    let _guard = state
        .gate
        .try_lock()
        .map_err(|_| "正在处理邮件，请稍后重试")?;
    if remove {
        state.store.remove_account(&id)?;
        auth::remove(&id);
    } else {
        let mut a = state.store.account(&id)?;
        a.enabled = !a.enabled;
        state.store.save_account(&a)?;
    }
    Ok(())
}
fn sync_all(store: &Store, app: &tauri::AppHandle) -> Result<u32> {
    let mut count = 0;
    let mut errors = Vec::new();
    for mut a in store.accounts()?.into_iter().filter(|a| a.enabled) {
        let _ = app.emit("sync-progress", format!("正在收取 {}", a.email));
        match network::sync(store, &a) {
            Ok(n) => {
                count += n;
                a.last_sync = Some(chrono::Utc::now().to_rfc3339());
                a.error = None;
                let _ = store.log(&format!("{} 收取完成，新增 {} 封本地存档", a.email, n));
            }
            Err(e) => {
                a.error = Some(e.clone());
                errors.push(format!("{}：{}", a.email, e));
                let _ = store.log(&format!("{} 收取失败：{}", a.email, e));
            }
        }
        store.save_account(&a)?;
    }
    let _ = app.emit("mail-updated", ());
    if errors.is_empty() {
        Ok(count)
    } else {
        Err(format!("已保存 {count} 封；{}", errors.join("；")))
    }
}
#[tauri::command]
async fn sync_mail(state: tauri::State<'_, AppState>, app: tauri::AppHandle) -> Result<u32> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .try_lock()
            .map_err(|_| "已有任务正在执行，请稍后重试")?;
        sync_all(&store, &app)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn save_draft(state: tauri::State<AppState>, draft: Compose) -> Result<()> {
    state.store.save_draft(&draft)
}
#[tauri::command]
fn list_drafts(state: tauri::State<AppState>) -> Result<Vec<Compose>> {
    state.store.drafts()
}
#[tauri::command]
fn delete_draft(state: tauri::State<AppState>, id: String) -> Result<()> {
    state
        .store
        .db()?
        .execute("DELETE FROM drafts WHERE id=?1", [id])
        .map_err(err)?;
    Ok(())
}
#[tauri::command]
async fn send_mail(state: tauri::State<'_, AppState>, draft: Compose) -> Result<String> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate
            .try_lock()
            .map_err(|_| "正在处理邮件，请稍后重试，草稿已保留")?;
        network::send(&store, &draft)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn export_mail(state: tauri::State<AppState>, id: String, path: String) -> Result<()> {
    let m = state.store.mail(&id)?;
    archive::atomic_write(
        Path::new(&path),
        &archive::read_raw(&state.store.root, &m.hash)?,
    )
}
#[tauri::command]
fn save_attachment(
    state: tauri::State<AppState>,
    id: String,
    index: usize,
    path: String,
) -> Result<()> {
    let m = state.store.mail(&id)?;
    archive::atomic_write(
        Path::new(&path),
        &archive::attachment(&archive::read_raw(&state.store.root, &m.hash)?, index)?,
    )
}
#[tauri::command]
async fn backup_archive(state: tauri::State<'_, AppState>, path: String) -> Result<String> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        store.backup(Path::new(&path))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn restore_archive(state: tauri::State<'_, AppState>, path: String) -> Result<usize> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        store.restore(Path::new(&path))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn open_data_folder(state: tauri::State<AppState>) -> Result<()> {
    open::that(&state.store.root).map_err(err)
}
fn web_link(url: &str) -> Result<url::Url> {
    let parsed = url::Url::parse(url).map_err(err)?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() {
        return Err("仅支持打开 http 或 https 网页链接".into());
    }
    Ok(parsed)
}
#[tauri::command]
fn open_mail_link(url: String) -> Result<()> {
    open::that(web_link(&url)?.as_str()).map_err(err)
}
fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.show();
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let store = Store::new(app.path().app_data_dir()?).map_err(std::io::Error::other)?;
            let gate = Arc::new(Mutex::new(()));
            app.manage(AppState {
                store: store.clone(),
                gate: gate.clone(),
            });
            let menu = tauri::menu::Menu::default(app.handle())?;
            app.set_menu(menu)?;
            tauri::tray::TrayIconBuilder::new()
                .tooltip("雁信 · 点击打开")
                .icon(app.default_window_icon().unwrap().clone())
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut schedule = productivity::SyncSchedule::default();
                loop {
                    let now = chrono::Utc::now().timestamp();
                    let interval = store
                        .preferences()
                        .unwrap_or_default()
                        .sync_interval_minutes as i64
                        * 60;
                    // A clock gap during sleep triggers an immediate catch-up round.
                    if schedule.due(now, interval) {
                        if let Ok(_guard) = gate.try_lock() {
                            let _ = sync_all(&store, &handle);
                            schedule.completed(chrono::Utc::now().timestamp());
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_secs(10));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            mail_detail,
            update_mail,
            save_rules,
            preview_rule,
            run_rules,
            connect_account,
            edit_account,
            list_contacts,
            save_contact,
            delete_contact,
            contact_suggestions,
            list_outbox,
            retry_outbox,
            archive_outbox,
            get_preferences,
            save_preferences,
            archive_health,
            account_action,
            sync_mail,
            save_draft,
            list_drafts,
            delete_draft,
            send_mail,
            export_mail,
            save_attachment,
            backup_archive,
            restore_archive,
            open_data_folder,
            open_mail_link
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Yanxin")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
#[cfg(test)]
mod tests;
