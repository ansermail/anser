mod archive;
mod archive_deletion;
mod archive_jobs;
mod archive_location;
mod attachment_preview;
mod auth;
mod conversation;
mod directory_operations;
mod eml_files;
mod folder_health;
mod idle;
mod models;
mod network;
mod notifications;
mod operations;
mod productivity;
mod realtime;
mod remote;
mod retention;
mod retention_budget;
mod rule_operations;
mod rule_runs;
mod rules;
mod scheduling;
mod search;
mod sent_uploads;
mod signatures;
mod store;
mod sync_control;
use models::*;
use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use store::Store;
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
struct AppState {
    store: Store,
    gate: Arc<Mutex<()>>,
    send_gate: Arc<Mutex<()>>,
    realtime: Arc<realtime::RealtimeControl>,
}
#[tauri::command]
async fn restart_for_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    let gate = state.gate.clone();
    let send_gate = state.send_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Wait for an active SMTP operation to persist its result before restarting.
        let _sync = gate.lock().map_err(err)?;
        let _sending = send_gate.lock().map_err(err)?;
        use tauri_plugin_window_state::AppHandleExt;
        app.save_window_state(window_state_flags()).map_err(err)?;
        app.restart();
        #[allow(unreachable_code)]
        Ok(())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn mail_signature(
    state: tauri::State<AppState>,
    account_id: String,
) -> Result<signatures::MailSignature> {
    state.store.mail_signature(&account_id)
}
#[tauri::command]
fn save_mail_signature(
    state: tauri::State<AppState>,
    account_id: String,
    signature: signatures::MailSignature,
) -> Result<()> {
    state.store.save_mail_signature(&account_id, &signature)
}
#[tauri::command]
async fn snapshot(state: tauri::State<'_, AppState>, query: Query) -> Result<Snapshot> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.snapshot(&query))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_metadata(state: tauri::State<'_, AppState>, id: String) -> Result<Mail> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.mail_metadata(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_detail(state: tauri::State<'_, AppState>, id: String) -> Result<Detail> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.detail(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn mail_conversation(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<Mail>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.conversation(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn update_mail(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
    value: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.change_mail(&id, &action, &value))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn folder_health(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<folder_health::FolderHealth>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.folder_health())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn copy_sources(state: tauri::State<'_, AppState>, id: String) -> Result<Vec<String>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.copy_sources(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn queue_server_copy(
    state: tauri::State<'_, AppState>,
    id: String,
    source: String,
    target: String,
) -> Result<String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.queue_copy(&id, &source, &target))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn queue_server_move(
    state: tauri::State<'_, AppState>,
    id: String,
    source: String,
    target: String,
) -> Result<String> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.queue_move(&id, &source, &target))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn directory_operations(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<directory_operations::DirectoryOperation>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.directory_operations())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn directory_operation_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.directory_action(&id, &action))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn probe_remote_folder(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    account_id: String,
    folder: String,
) -> Result<folder_health::SelectionEvidence> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = network::probe_folder(&store, &store.account(&account_id)?, &folder);
        if let Err(e) = &result {
            let _ = store.log(&format!("文件夹「{folder}」独立只读核查失败：{e}"));
        }
        let _ = app.emit("server-operations-updated", ());
        let _ = app.emit("mail-updated", ());
        result
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn server_operations(
    state: tauri::State<'_, AppState>,
) -> Result<operations::OperationSnapshot> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.server_operations())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn retry_server_operation(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.retry_server_operation(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn rule_executions(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<rule_operations::RuleExecution>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.rule_executions())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn rule_runs(state: tauri::State<'_, AppState>) -> Result<Vec<rule_runs::RuleRunView>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.rule_runs())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn rule_run_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.rule_run_action(&id, &action))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn retry_rule_execution(state: tauri::State<'_, AppState>, id: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.retry_rule_execution(&id))
        .await
        .map_err(err)?
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
fn cancel_authorization(id: String) -> Result<()> {
    auth::cancel_authorization(&id)
}
#[tauri::command]
async fn connect_account(
    state: tauri::State<'_, AppState>,
    mut account: Account,
    password: String,
    smtp_password: String,
    on_progress: tauri::ipc::Channel<String>,
) -> Result<()> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    let send_gate = state.send_gate.clone();
    let realtime = state.realtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = |stage: &str| {
            let _ = on_progress.send(stage.to_string());
        };
        account.validate()?;
        let secret = if account.auth == "oauth" {
            auth::authorize(&account, &progress)?
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
        let _guard = gate.try_lock().map_err(|_| "正在处理邮件，请稍后重试")?;
        let _sending = send_gate
            .try_lock()
            .map_err(|_| "正在发送邮件，请稍后修改账号")?;
        network::test_with_progress(&account, &secret, &progress)?;
        progress("saving");
        auth::save(&account.id, &secret)?;
        account.error = None;
        store.save_account(&account)?;
        realtime.restart();
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
    on_progress: tauri::ipc::Channel<String>,
) -> Result<String> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    let send_gate = state.send_gate.clone();
    let realtime = state.realtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let progress = |stage: &str| {
            let _ = on_progress.send(stage.to_string());
        };
        let old = store.account(&account.id)?;
        if password.is_empty()
            && smtp_password.is_empty()
            && !reauthorize
            && !smtp_use_incoming
            && old.same_connection(&account)
        {
            store.edit_account_preferences(&account)?;
            store.log(&format!("账号 {} 本地留存与名称设置已保存", account.email))?;
            return Ok("账号设置已保存".into());
        }
        account.validate()?;
        if old.email != account.email {
            return Err("修改邮箱地址请添加新账号".into());
        }
        let secret = if account.auth == "oauth" {
            if reauthorize
                || old.auth != account.auth
                || auth::client_id(&old) != auth::client_id(&account)
            {
                auth::authorize(&account, &progress)?
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
        let _guard = gate
            .try_lock()
            .map_err(|_| "正在收取邮件，暂时不能更改服务器连接配置")?;
        let inbox_gate = sync_control::folder_gate(&store.root, &account.id, "INBOX")?;
        let _inbox = inbox_gate
            .try_lock()
            .map_err(|_| "正在收取邮件，暂时不能更改服务器连接配置")?;
        let _sending = send_gate
            .try_lock()
            .map_err(|_| "正在发送邮件，请稍后修改账号")?;
        if !store.account(&account.id)?.same_connection(&old) {
            return Err("等待授权期间账号连接配置已变化，请重新打开设置".into());
        }
        network::test_with_progress(&account, &secret, &progress)?;
        progress("saving");
        auth::save(&account.id, &secret)?;
        store.edit_account(&account)?;
        realtime.restart();
        store.log(&format!("账号 {} 配置已更新，收发验证通过", account.email))?;
        Ok("账号配置已更新，收发服务器验证通过".into())
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
async fn sent_upload_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if action == "queue" {
            store.queue_sent_upload(&id)
        } else {
            store.sent_upload_action(&id, &action)
        }
    })
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
    tauri::async_runtime::spawn_blocking(move || store.archive_outbox(&id))
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
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    auto_start: bool,
    auto_start_available: bool,
}
#[tauri::command]
fn desktop_settings(app: tauri::AppHandle) -> Result<DesktopSettings> {
    Ok(DesktopSettings {
        auto_start: app.autolaunch().is_enabled().map_err(err)?,
        auto_start_available: !tauri::is_dev(),
    })
}
#[tauri::command]
fn set_auto_start(app: tauri::AppHandle, enabled: bool) -> Result<()> {
    if enabled && tauri::is_dev() {
        return Err("开发预览依赖前端服务，请在正式应用中开启开机自启".into());
    }
    if enabled {
        app.autolaunch().enable().map_err(err)
    } else {
        app.autolaunch().disable().map_err(err)
    }
}
#[tauri::command]
fn test_notification(app: tauri::AppHandle) -> Result<()> {
    notifications::show(
        &app,
        "雁信 · 通知测试",
        "系统通知已接入。收到新邮件和发送结果会在这里提示。",
    )
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
    let inbox_gate = sync_control::folder_gate(&state.store.root, &id, "INBOX")?;
    let _inbox = inbox_gate
        .try_lock()
        .map_err(|_| "正在收取该账号邮件，请稍后修改账号")?;
    let _sending = state
        .send_gate
        .try_lock()
        .map_err(|_| "正在发送邮件，请稍后修改账号")?;
    if remove {
        state.store.remove_account(&id)?;
        auth::remove(&id);
    } else {
        let mut a = state.store.account(&id)?;
        a.enabled = !a.enabled;
        state.store.save_account(&a)?;
    }
    state.realtime.restart();
    Ok(())
}
fn sync_one(store: &Store, app: &tauri::AppHandle, account: Account) -> Result<u32> {
    sync_one_scope(store, app, account, false)
}
fn sync_inbox(store: &Store, app: &tauri::AppHandle, account: Account) -> Result<u32> {
    sync_one_scope(store, app, account, true)
}
fn sync_one_scope(
    store: &Store,
    app: &tauri::AppHandle,
    mut account: Account,
    inbox_only: bool,
) -> Result<u32> {
    let _ = app.emit("sync-progress", format!("正在收取 {}", account.email));
    let checkpoint = std::cell::Cell::new(notifications::checkpoint(store));
    let prior = account.clone();
    let last_update = std::cell::Cell::new(None);
    let updated = || {
        let now = std::time::Instant::now();
        if last_update
            .get()
            .is_none_or(|last: std::time::Instant| now.duration_since(last).as_millis() >= 1000)
        {
            last_update.set(Some(now));
            notifications::received(store, app, &prior, checkpoint.get());
            checkpoint.set(notifications::checkpoint(store));
            let _ = app.emit("mail-updated", ());
        }
    };
    let result = if inbox_only {
        network::sync_folder_with_updates(store, &account, "INBOX", updated)
    } else {
        network::sync_with_updates(store, &account, updated)
    };
    let scope = if inbox_only {
        "收件箱收取"
    } else {
        "全部文件夹收取"
    };
    match &result {
        Ok(count) => {
            account.last_sync = Some(chrono::Utc::now().to_rfc3339());
            account.error = None;
            let _ = store.log(&format!(
                "{} {}本轮结束，新增 {} 封邮件",
                account.email, scope, count
            ));
        }
        Err(error) => {
            account.error = Some(error.clone());
            let _ = store.log(&format!("{} {}失败：{}", account.email, scope, error));
        }
    }
    store.save_sync_status(&account)?;
    notifications::received(store, app, &prior, checkpoint.get());
    let _ = app.emit("mail-updated", ());
    result
}
fn sync_all(store: &Store, app: &tauri::AppHandle) -> Result<u32> {
    let mut count = 0;
    let mut errors = Vec::new();
    for a in store.accounts()?.into_iter().filter(|a| a.enabled) {
        match sync_one(store, app, a.clone()) {
            Ok(n) => {
                count += n;
            }
            Err(e) => {
                errors.push(format!("{}：{}", a.email, e));
            }
        }
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
    tauri::async_runtime::spawn_blocking(move || {
        // Explicit refresh checks inboxes first. Historical folders continue
        // through the background sweep and their individual refresh action.
        let accounts = store
            .accounts()?
            .into_iter()
            .filter(|a| a.enabled)
            .collect::<Vec<_>>();
        std::thread::scope(|scope| {
            let jobs = accounts
                .into_iter()
                .map(|account| {
                    let store = &store;
                    let app = &app;
                    scope.spawn(move || {
                        let email = account.email.clone();
                        sync_inbox(store, app, account).map_err(|e| format!("{email}：{e}"))
                    })
                })
                .collect::<Vec<_>>();
            let mut count = 0;
            let mut errors = Vec::new();
            for job in jobs {
                match job
                    .join()
                    .unwrap_or_else(|_| Err("收取任务异常结束".into()))
                {
                    Ok(n) => count += n,
                    Err(e) => errors.push(e),
                }
            }
            if errors.is_empty() {
                Ok(count)
            } else {
                Err(format!("已保存 {count} 封；{}", errors.join("；")))
            }
        })
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
// SMTP work has its own guard. Long IMAP downloads must never occupy it.
fn with_send_gate<T>(gate: &Mutex<()>, send: impl FnOnce() -> Result<T>) -> Result<T> {
    let _guard = gate
        .try_lock()
        .map_err(|_| "已有邮件正在发送，请稍后重试，草稿已保留")?;
    send()
}
#[tauri::command]
async fn send_mail(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    draft: Compose,
) -> Result<String> {
    let store = state.store.clone();
    let send_gate = state.send_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = with_send_gate(&send_gate, || network::send(&store, &draft));
        notifications::sent(&store, &app, &draft, &result, false);
        let _ = app.emit("mail-updated", ());
        result
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn schedule_mail(
    state: tauri::State<'_, AppState>,
    draft: Compose,
    scheduled_at: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || network::schedule(&store, &draft, &scheduled_at))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn cancel_schedule(state: tauri::State<'_, AppState>, id: String) -> Result<Compose> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.cancel_schedule(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn reschedule_mail(
    state: tauri::State<'_, AppState>,
    id: String,
    scheduled_at: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.reschedule_mail(&id, &scheduled_at, chrono::Utc::now())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn account_folders(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<Vec<RemoteFolder>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let a = store.account(&id)?;
        network::folder_list(&store, &a)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn folder_settings(state: tauri::State<'_, AppState>, id: String) -> Result<FolderSettings> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.folder_settings(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn retention_settings(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<retention::RetentionSettings> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.retention_settings(&id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn inspect_retention_budget(
    state: tauri::State<'_, AppState>,
    account: Account,
    overrides: Vec<retention::FolderRetention>,
    request_id: String,
) -> Result<retention_budget::RetentionBudget> {
    let store = state.store.clone();
    let lease = retention_budget::begin(&store, &request_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        retention_budget::inspect(&store, &account, &overrides, &lease)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn cancel_retention_inspection(
    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<()> {
    retention_budget::cancel(&state.store, &request_id)
}
#[tauri::command]
async fn save_retention(
    state: tauri::State<'_, AppState>,
    account: Account,
    overrides: Vec<retention::FolderRetention>,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        store.save_retention_preferences(&account, &overrides)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn queue_archives(
    state: tauri::State<'_, AppState>,
    ids: Vec<String>,
    conversations: bool,
) -> Result<archive_jobs::ArchiveQueueResult> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.queue_archives(&ids, conversations))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn archive_jobs(state: tauri::State<'_, AppState>) -> Result<Vec<archive_jobs::ArchiveJob>> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_jobs())
        .await
        .map_err(err)?
}
#[tauri::command]
async fn archive_job_action(
    state: tauri::State<'_, AppState>,
    id: String,
    action: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_job_action(&id, &action))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn save_folder_mappings(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    mappings: Vec<FolderMapping>,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.save_folder_mappings(&id, &mappings))
        .await
        .map_err(err)??;
    let _ = app.emit("mail-updated", ());
    Ok(())
}
#[tauri::command]
async fn sync_remote_folder(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    folder: String,
) -> Result<u32> {
    let store = state.store.clone();
    let gate = state.gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Keep account connection changes/removal mutually exclusive with
        // historical folder work. INBOX uses its independent folder guard.
        let _history = if folder.eq_ignore_ascii_case("INBOX") {
            None
        } else {
            Some(gate.lock().map_err(err)?)
        };
        let a = store.account(&id)?;
        if !a.enabled {
            return Err("账号已暂停，请先启用".into());
        }
        let checkpoint = notifications::checkpoint(&store);
        let result = network::sync_folder(&store, &a, &folder);
        notifications::received(&store, &app, &a, checkpoint);
        let _ = app.emit("mail-updated", ());
        result
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn export_mail(state: tauri::State<'_, AppState>, id: String, path: String) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        archive::atomic_write(Path::new(&path), &store.message_raw(&store.mail(&id)?)?)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn save_attachment(
    state: tauri::State<'_, AppState>,
    id: String,
    index: usize,
    path: String,
) -> Result<()> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        archive::atomic_write(
            Path::new(&path),
            &archive::attachment(&store.message_raw(&store.mail(&id)?)?, index)?,
        )
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn preview_attachment(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    id: String,
    index: usize,
) -> Result<()> {
    let store = state.store.clone();
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join("attachment-previews");
    tauri::async_runtime::spawn_blocking(move || {
        let mail = store.mail(&id)?;
        let raw = store.message_raw(&mail)?;
        let path =
            attachment_preview::prepare(&cache, &raw, &store.account_for_mail(&mail), index)?;
        open::that(path).map_err(|e| format!("无法打开附件，请确认已安装对应应用：{e}"))
    })
    .await
    .map_err(err)?
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
async fn archive_deletion_preview(
    state: tauri::State<'_, AppState>,
    account_id: String,
) -> Result<archive_deletion::DeletionPreview> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.archive_deletion_preview(&account_id))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn delete_local_archives(
    state: tauri::State<'_, AppState>,
    app: tauri::AppHandle,
    account_id: String,
    stop_saving: bool,
    expected_count: usize,
    expected_token: String,
) -> Result<archive_deletion::DeletionResult> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = store.delete_local_archives(
            &account_id,
            stop_saving,
            expected_count,
            &expected_token,
        )?;
        let _ = app.emit("mail-updated", ());
        Ok(result)
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
fn archive_location(state: tauri::State<AppState>) -> archive_location::LocationStatus {
    state.store.archive_location()
}
#[tauri::command]
async fn move_archive_location(
    state: tauri::State<'_, AppState>,
    parent: String,
) -> Result<archive_location::LocationStatus> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.move_archive_location(&parent))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn cleanup_archive_migration(
    state: tauri::State<'_, AppState>,
) -> Result<archive_location::LocationStatus> {
    let store = state.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.cleanup_archive_migration())
        .await
        .map_err(err)?
}
#[tauri::command]
fn open_data_folder(state: tauri::State<AppState>) -> Result<()> {
    open::that(archive_location::physical_root(&state.store.root)?).map_err(err)
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
fn mail_navigation_target(url: &url::Url) -> Option<String> {
    if url.scheme() != "https"
        || url.host_str() != Some("yanxin-mail-link.invalid")
        || url.path() != "/open"
    {
        return None;
    }
    let target = url.query_pairs().find(|(key, _)| key == "url")?.1;
    let parsed = url::Url::parse(&target).ok()?;
    match parsed.scheme() {
        "http" | "https" if parsed.host_str().is_some() => Some(parsed.to_string()),
        "mailto" => Some(parsed.to_string()),
        _ => None,
    }
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
fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    // Hidden/minimized state must not prevent Dock reopen or normal launch.
    // Fullscreen is a separate macOS Space; preserve zoom/maximized only.
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}
#[tauri::command]
fn take_eml_paths(state: tauri::State<eml_files::EmlFiles>) -> Result<Vec<String>> {
    state.take_pending()
}
#[tauri::command]
async fn open_eml_file(
    state: tauri::State<'_, eml_files::EmlFiles>,
    path: String,
) -> Result<eml_files::EmlDocument> {
    let docs = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || docs.open(Path::new(&path)))
        .await
        .map_err(err)?
}
#[tauri::command]
fn close_eml_file(state: tauri::State<eml_files::EmlFiles>, token: String) -> Result<()> {
    state.close(&token)
}
#[tauri::command]
async fn preview_eml_attachment(
    state: tauri::State<'_, eml_files::EmlFiles>,
    app: tauri::AppHandle,
    token: String,
    index: usize,
) -> Result<()> {
    let raw = state.raw(&token)?;
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(err)?
        .join("attachment-previews");
    tauri::async_runtime::spawn_blocking(move || {
        let path = attachment_preview::prepare(&cache, &raw, &eml_files::account(), index)?;
        open::that(path).map_err(|e| format!("无法打开附件，请确认已安装对应应用：{e}"))
    })
    .await
    .map_err(err)?
}
#[tauri::command]
async fn save_eml_attachment(
    state: tauri::State<'_, eml_files::EmlFiles>,
    token: String,
    index: usize,
    path: String,
) -> Result<()> {
    let docs = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        docs.save_attachment(&token, index, Path::new(&path))
    })
    .await
    .map_err(err)?
}

fn queue_eml_arguments(app: &tauri::AppHandle, args: Vec<String>, cwd: &Path) {
    if let Some(docs) = app.try_state::<eml_files::EmlFiles>() {
        docs.queue_args(args, cwd);
        let _ = app.emit("eml-files-available", ());
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(eml_files::EmlFiles::default())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("mail-links")
                .on_navigation(|webview, url| {
                    if url.host_str() == Some("yanxin-mail-link.invalid") {
                        if let Some(target) = mail_navigation_target(url) {
                            let _ = webview.emit("mail-link-open", target);
                        }
                        return false;
                    }
                    true
                })
                .build(),
        )
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            queue_eml_arguments(app, args, Path::new(&cwd));
            show_main_window(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .with_filter(|label| label == "main")
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("雁信")
                .args(["--autostart"])
                .build(),
        )
        .setup(|app| {
            queue_eml_arguments(
                app.handle(),
                std::env::args().skip(1).collect(),
                &std::env::current_dir()?,
            );
            // The standard plugin uses Terminal in dev mode. This preview already
            // runs inside a real .app bundle, so retain Anser's own identity.
            #[cfg(target_os = "macos")]
            let _ = notify_rust::set_application(&app.config().identifier);
            if std::env::args().any(|arg| arg == "--autostart") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            let store = Store::new(app.path().app_data_dir()?).map_err(std::io::Error::other)?;
            let gate = Arc::new(Mutex::new(()));
            let send_gate = Arc::new(Mutex::new(()));
            let realtime = Arc::new(realtime::RealtimeControl::default());
            app.manage(AppState {
                store: store.clone(),
                gate: gate.clone(),
                send_gate: send_gate.clone(),
                realtime: realtime.clone(),
            });
            realtime::start(store.clone(), app.handle().clone(), realtime);
            operations::start(store.clone(), app.handle().clone());
            directory_operations::start(store.clone(), app.handle().clone());
            sent_uploads::start(store.clone(), app.handle().clone());
            archive_jobs::start(store.clone(), app.handle().clone());
            rule_runs::start(store.clone(), app.handle().clone());
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
            let scheduled_store = store.clone();
            let scheduled_gate = send_gate.clone();
            let scheduled_handle = handle.clone();
            std::thread::spawn(move || loop {
                if let Ok(_guard) = scheduled_gate.try_lock() {
                    match scheduled_store.claim_scheduled(chrono::Utc::now()) {
                        Ok(Some(mail)) => {
                            let draft = mail.draft.clone();
                            let result = network::send_scheduled(&scheduled_store, mail);
                            notifications::sent(
                                &scheduled_store,
                                &scheduled_handle,
                                &draft,
                                &result,
                                true,
                            );
                            let _ = scheduled_store
                                .log(&format!("定时发送：{}", result.unwrap_or_else(|e| e)));
                            let _ = scheduled_handle.emit("mail-updated", ());
                        }
                        Ok(None) => {}
                        Err(e) => {
                            let _ = scheduled_store.log(&format!("定时发送检查失败：{e}"));
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            });
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
                    use tauri_plugin_window_state::AppHandleExt;
                    let _ = window.app_handle().save_window_state(window_state_flags());
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            restart_for_update,
            take_eml_paths,
            open_eml_file,
            close_eml_file,
            preview_eml_attachment,
            save_eml_attachment,
            snapshot,
            mail_signature,
            save_mail_signature,
            account_folders,
            folder_settings,
            retention_settings,
            inspect_retention_budget,
            cancel_retention_inspection,
            save_retention,
            queue_archives,
            archive_jobs,
            archive_job_action,
            save_folder_mappings,
            sync_remote_folder,
            mail_detail,
            mail_metadata,
            mail_conversation,
            update_mail,
            folder_health,
            copy_sources,
            queue_server_copy,
            queue_server_move,
            directory_operations,
            directory_operation_action,
            probe_remote_folder,
            server_operations,
            retry_server_operation,
            save_rules,
            rule_executions,
            rule_runs,
            rule_run_action,
            retry_rule_execution,
            preview_rule,
            run_rules,
            connect_account,
            cancel_authorization,
            edit_account,
            list_contacts,
            save_contact,
            delete_contact,
            contact_suggestions,
            list_outbox,
            sent_upload_action,
            retry_outbox,
            archive_outbox,
            get_preferences,
            save_preferences,
            desktop_settings,
            set_auto_start,
            test_notification,
            archive_health,
            account_action,
            sync_mail,
            save_draft,
            list_drafts,
            delete_draft,
            send_mail,
            schedule_mail,
            cancel_schedule,
            reschedule_mail,
            export_mail,
            save_attachment,
            preview_attachment,
            backup_archive,
            archive_deletion_preview,
            delete_local_archives,
            restore_archive,
            open_data_folder,
            archive_location,
            move_archive_location,
            cleanup_archive_migration,
            open_mail_link
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Anser")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Ready)
                && !std::env::args().any(|arg| arg == "--autostart")
            {
                show_main_window(app);
                if let Some(state) = app.try_state::<AppState>() {
                    let visible = app
                        .get_webview_window("main")
                        .and_then(|window| window.is_visible().ok())
                        .unwrap_or(false);
                    let _ = state.store.log(&format!(
                        "雁信 {} 启动完成，主窗口{}",
                        app.package_info().version,
                        if visible { "已显示" } else { "尚未显示" }
                    ));
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { ref urls } = event {
                if let Some(docs) = app.try_state::<eml_files::EmlFiles>() {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            docs.queue(path);
                        }
                    }
                    let _ = app.emit("eml-files-available", ());
                    show_main_window(app);
                }
            }
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
