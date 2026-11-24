# 0.1.44 真机走查与前后端全量优化工作点（2026-11-24）

- **目标**：基于本机已安装的 macOS 正式版 `/Applications/雁信.app`（v0.1.44）只读走查及前后端代码全量审计，修复已核实的 UI/UX 排版缺陷、交互状态 Bug 与 Rust 桌面端正确性/性能问题。
- **分支与基线**：本地 `main`（基线提交 `24b71b1`），改动留在工作区，尚未提交、推送或发布。
- **执行方式**：前后端按目录隔离拆分并委派 Codex `gpt-6.2-sol`（`reasoningEffort: high`）并行修复，主会话统一复核 diff、将后端测试通知正文迁入 `src/locales/`，并执行联合全量校验。

## 一、已核实并完成的修复范围

### 1. 前端 UI/UX、布局、国际化与交互状态（`src/`，40 个文件）
- **跳过项（按用户明确意见）**：侧栏「我的账号」邮箱在窄侧栏下的截断保持原状（侧栏支持拖动调宽），未改动 `.account-item` 样式与标记。
- **布局与视觉（含真机实测复现项）**：
  - 修复设置 → 阅读与写信 →「AI 智能助手」卡片在 `448px–699px`（含默认 `1380×900` 窗口）下左侧文案被挤窄并横向溢出的问题（`src/components/mail-translation-settings.tsx`、`src/index.css`）。
  - 在 `:root` 与 `.dark` 补齐未定义的 `--muted-foreground` 与 `--ring`，恢复列表未勾选复选框边框、任务勾选聚焦环、主题译文弱化色及发送详情/工作台空态文案等 15 处规则（`src/index.css`）。
  - 修复过滤规则页 `.info-strip` 中「对已有邮件执行」按钮被 `.info-strip span { flex: 1 }` 拉伸偏移的问题（`src/components/rules-panel.tsx`、`src/index.css`）。
  - 修复深色模式写信窗口收件人/主题栏透出无内边距灰底的问题（`src/index.css`）。
  - 修复通讯录搜索放大镜浮在输入框外侧的问题（`src/components/contacts-panel.tsx`、`src/index.css`）。
  - 修复 shadcn `SelectTrigger` / `SelectValue` 长文本硬裁切无省略号（真机「邮件签名」下拉复现，`src/components/ui/select.tsx`）。
  - 修复 `1000px` 最小窗宽下阅读器工具栏与工作台周视图工具栏右侧裁切、分组单列看板 50% 挤压、`.row-meta` 固定 `13px` 高度裁切，以及发送详情弹层打开定时面板或长错误时缺少纵向滚动的问题（`src/index.css`、`src/components/outbox-panel.tsx`）。
- **交互、规范合规与状态修复**：
  - 工作台编辑表单移除 25/60 项小时/分钟长下拉，改用抽离复用的 shadcn `InputGroup` 紧凑数字输入（`src/components/time-spinbox.tsx`、`src/components/schedule-picker.tsx`、`src/components/workbench.tsx`），符合 `AGENTS.md` 约定并保留全天与 `00:00` 支持。
  - 修复多步服务器过滤规则中 `serverCopy`/`serverMove` 不在第一步时保存按钮被误禁用，以及日期条件未校验非空的问题（`src/components/rules-panel.tsx`、`src/components/rule-server-folders.tsx`）。
  - 修复写信中切换深浅主题时富文本画布停留在旧主题的问题（`src/components/rich-editor.tsx`）。
  - 修复写信关闭在 `open_compose_session` 失败时卡死弹窗与卸载重复关闭会话的问题；修复 Windows 附件路径截断（`split(/[\\/]/)`）与字节数格式化（`src/components/compose-dialog.tsx`）。
  - 修复 `App.tsx` 中 `localChanges` 永不清理覆盖后续后端状态、切换邮件时旧 `detail` 串档与 `+N` 展开态泄漏、`ConversationReader` 每次 20s 轮询重建、侧栏标签/服务器文件夹双高亮、已移除账号 `color--1`、Windows 快捷键符号、星标按钮文案与重复原生 `title`、重命名回车校验及工作台写信优先启用账号（`src/App.tsx`、`src/components/conversation-reader.tsx`、`src/components/external-mail-window.tsx`）。
  - 设置页隐藏页签暂停 7 个后台轮询定时器并保留未保存表单，同时修复 `ArchiveTier` 轮询覆盖未保存保留期输入（`src/components/settings-layout.tsx` 等）。
  - `MailSummary` 与 `WorkReport` 统一接入 `copyText()` 回退；`MailSummary` 兼容 RFC 2822 无冒号时区偏移；`ExternalMailWindow` 补齐 `keydown` 依赖与弹层守卫；`AccountDialog` / `NetworkProxySettings` 改进端口清空编辑与首尾空格清理；`WorkReport` 限制自定义结束日期不早于开始日期并稳定月历 `DayButton` 身份。
  - 补齐多处硬编码中文文案/标点及 `SidebarTrigger` 无障碍标签，并将后端测试通知正文同步迁入 `src/locales/en.json` 与 `src/locales/zh-CN.json`（共 1,887 条双语文案）。

### 2. Rust / Tauri 桌面后端正确性、稳定性与性能（`src-tauri/`，21 个文件）
- **保留既有约定**：保持 SQLite 默认持久化级别；保留 `docs/USAGE.md` 约定的 macOS 菜单栏图标左键直接显示主窗口行为（`.show_menu_on_left_click(false)`）；所有 18 个异步化 `#[tauri::command]` 保持命令名、IPC 参数与返回结构不变。
- **数据库与分页**：
  - `reconcile_folder`（`src-tauri/src/store.rs`）与 `save_remote_folders`（`src-tauri/src/remote.rs`）改为差异更新，空同步不再无条件递增 `query_revision` / `conversation_revision` 或破坏分页游标。
  - `Store::new()` 仅在 `message_listing` 行数缺失时回填，避免每次冷启动全表扫描重写 `messages`。
  - 为 `messageId`/`serverMessageId` 建立索引并改由无正文 `message_listing` 解析匹配 ID；`mark_folder_read` 改为单一 `BEGIN IMMEDIATE` 事务批量更新；`work_items::items()` 改为连接 `message_listing`（`src-tauri/src/conversation.rs`、`mail_tags.rs`、`archive_deletion.rs`、`work_items.rs`）。
  - 优化 `Store::mail_page` 复用结果集计算总数、校验游标并提取当前页（`src-tauri/src/paging.rs`）。
- **后台任务、网络与桌面集成**：
  - `realtime.rs` 改用按工作线程签发唯一令牌的 `WatchClaim` RAII 守卫，消除监听重启时旧线程误清 `INBOX` 归属的竞态。
  - 为 `read_remote_source`、`probe_folder`、`folder_list` 及相关后台路径补齐 `catch_unwind`，避免畸形 IMAP 响应毒化 `FolderGate` 或终止工作线程（`network.rs`）。
  - 定时发送轮询新增 `(status, scheduled_at)` 索引并在申请 `BEGIN IMMEDIATE` 前先做轻量只读检查（`scheduling.rs`、`store.rs`）。
  - `Store::outbox()` 复用单连接、读取 `raw_hash` 并以归档文件存在/可读性判断状态，避免每次打开拉取 100 封完整 MIME BLOB 与打开 200 次连接（`productivity.rs`、`sent_uploads.rs`、`archive.rs`、`archive_tier.rs`）。
  - 18 个重型/写库同步 `#[tauri::command]` 迁移至 `spawn_blocking`，并优化 `preview_rule` 复用单事务与短路非匹配项（`lib.rs`、`store.rs`、`work_items.rs`）。
  - 邮件远端图片/CSS/字体复用按代理配置与密码摘要缓存的 `reqwest::Client`（`mail_images.rs`）；附件缩略图改为单次 MIME 解析并增加 32 项有界缓存（`attachment_preview.rs`）。
  - 托盘/Dock 未读轮询按 `query_revision` 跳过空扫描且仅在变化时更新 macOS `set_badge_count`；托盘退出先等待 `send_gate` 并保存窗口状态；重复打开同一外部 `.eml` 复用已有窗口并取消最小化；`test_notification` 接入 `interface_language::text`（`lib.rs`、`eml_files.rs`、`interface_language.rs`）。

## 二、本轮实际验证结果（macOS arm64）

- **联合自动检查（最后一次代码修改后完整重跑）**：
  - `npm run check:i18n`：通过（1,887 条双语文案，键与占位符完全一致）
  - `npm run check:ui`：通过
  - `npm run format:check`：通过
  - `npm run build`：通过（`tsc -b && vite build`）
  - `npm run build:preview`：通过
  - `npm test`：77 个测试文件、616 项全部通过
  - `cd src-tauri && cargo fmt --check`：通过
  - `cd src-tauri && cargo check`：通过
  - `cd src-tauri && cargo test --lib`：482 通过，0 失败，5 项既有条件忽略
  - `git diff --check`：通过
- **macOS 原生开发预览实机复核（`dev.maildesk.preview0144` 隔离包）**：
  - 使用独立标识 `dev.maildesk.preview0144` 构建本地隔离开发预览包 `src-tauri/target/debug/bundle/macos/雁信预览.app`（连接本地 Vite `127.0.0.1:1428`，完全隔离真实账号与 `/Applications/雁信.app`）。
  - 在原生 macOS WKWebView 中实机截图并标注核对 7 组核心视觉修复：
    1. `1380×900` 设置 → 阅读与写信：「邮件签名」`SelectTrigger` 显示 `工作邮箱 · alex@example.c...` 省略号；「AI 智能助手」卡片双列对齐无横向溢出。
    2. `1380×900` 深色模式「写邮件」：收件人/主题输入框透明融入面板（无灰底条），深色富文本画布同步。
    3. `1380×900` 过滤规则：「对已有邮件执行」按钮紧贴提示条最右端。
    4. `1380×900` 通讯录：放大镜图标内嵌在搜索输入框内部左侧。
    5. `1380×900` 工作台 → 添加工作记录（浅色与深色）：「日期」与「具体时间」共用等高标题行，正向开关置于「具体时间」右侧；全天态显示 36px 等高「🕒 全天」按钮，开启后原地切换为 36px 单行 `[ 09 ⌃⌄ ] : [ 00 ⌃⌄ ]`，零折行、零跳动，「结束日期」保持纯日期。
    6. `1000×760` 工作台 → 周视图：工具栏优雅折行，日期范围与 `年 / 月 / 周 / 日` 切换器完整可见。
    7. `1000×760` 邮件视图：补齐 `--muted-foreground` 后列表未勾选复选框边框清晰可见，阅读器顶栏 10 项按钮（含最右展开按钮 `⤢`）无裁切。
- **未验证项（待后续验收）**：
  - 短窗发送详情定时改期、托盘退出等待 `send_gate`、Dock 角标刷新、中英文测试通知、重复打开外部 `.eml` 窗口复用。
  - Windows 10/11、Intel Mac、云端 CI 及正式发布构建。
