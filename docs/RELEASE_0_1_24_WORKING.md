# 0.1.24 发布工作点

更新：2026-10-20。用户已授权提交、构建与正式发布，并要求发布说明写清具体修复项。

## 当前状态：发布准备（本地门槛通过，云端待运行）

- 五处版本同步 0.1.24：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 发布说明见 [v0.1.24](releases/v0.1.24.md)，包含 6 项修复与富文本字体颜色新增。
- 本版范围：单条 IDLE 监听连接独占收件箱、Gmail 后台钥匙串非交互写入容错、界面文案键迁移为英文源文案及原生托盘/通知本地化、写信输入行 416px 与“抄送/密送”靠右、空正文单行、Tiptap 表格粘贴、字体颜色与 rgb→十六进制。
- 基线 main `9398046`；待提交后打 `v0.1.24` 标签推送触发 `release.yml`。

## 本轮实际检查

- `npm test -- --maxWorkers=2`：58 文件、395 项通过。
- `npm run test:desktop`：35 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：393 通过、3 项既有条件忽略。
- IMAP vendor：39 项通过。
- `npm run build`、`npm run check:ui`、`npm run check:i18n`（1218 键）、`npm run format:check`、`cargo fmt -- --check`、`git diff --check` 通过；保留既有大 chunk 提示。
- 首次 Rust 全量曾因本地化测试仍用中文键失败 1 项（`interface_language_is_independent_of_other_preferences_and_survives_reopening`），已修正 `interface_language.rs`、`notifications.rs`、`lib.rs` 初始托盘与 `tests.rs` 后重跑通过；`notifications.rs` 的回执键补齐 JSON 键末尾空格。
- 版本与发布资源一致性：`node scripts/release-assets.mjs verify` 待提交后执行。

## 待完成

- 提交并推送 main 与 `v0.1.24` 标签，核对 Release/Checks/Pages 运行与七资源（长度、SHA-256、签名、双架构 App/DMG、latest 端点）。
- 正式发布后更新 README、`docs/UPDATES.md`、`docs/DEVELOPMENT_STATUS.md` 与本文，记录 Actions 链接和资源摘要。
- Homebrew 需显式 dispatch `homebrew.yml`，并在发布后核对配方提交与两架构 DMG 摘要。
- 未验证：正式包安装/原位升级、系统通知横幅、托盘实际点击、Intel 实机、Gmail 交互重写、外部代理与其他服务商、睡眠/弱网。
