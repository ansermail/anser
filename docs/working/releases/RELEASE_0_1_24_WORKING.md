# 0.1.24 发布工作点

更新：2026-10-20。用户已授权提交、构建与正式发布，并要求发布说明写清具体修复项。

## 当前状态：正式发布与 Homebrew 完成

- 0.1.24 Alpha 于 2026-10-20 19:11:12（Asia/Shanghai）正式发布为 latest，固定源码 `04391876cd605fe81b3df834e086c0bd81f0ec93`。[Release macOS 39411133657](https://github.com/ansermail/anser/actions/runs/39411133657)、[Verify macOS signing 39411123348](https://github.com/ansermail/anser/actions/runs/39411123348)、[Checks 39411123293](https://github.com/ansermail/anser/actions/runs/39411123293) 与 [Preview Pages 39411123273](https://github.com/ansermail/anser/actions/runs/39411123273) 均成功，[0.1.24 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.24) 已公开。
- 提交 `0439187` 已进入组织 main，标签 `v0.1.24` 指向同一固定源码；五处版本 0.1.24 一致。
- 本版包含：单条 IDLE 监听连接独占收件箱、Gmail 后台钥匙串非交互写入容错、界面文案键迁移为英文源文案及原生托盘/通知本地化、写信输入行 416px 与“抄送/密送”靠右、空正文单行、Tiptap 表格粘贴、字体颜色与 rgb→十六进制。
- [Homebrew 运行 39413158105](https://github.com/ansermail/anser/actions/runs/39413158105) 成功，主仓库 [配方提交 e0f05a3](https://github.com/ansermail/anser/commit/e0f05a337669d80b64d7b9c6927b5072830323df) 仅更新 Casks/anser.rb；重复核验 [39413252399](https://github.com/ansermail/anser/actions/runs/39413252399) 成功并返回 `Cask is already current; no commit needed.`。配方与两架构公开 DMG 摘要一致。

## 本轮实际检查

- `npm test -- --maxWorkers=2`：58 文件、395 项通过。
- `npm run test:desktop`：35 项通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：393 通过、3 项既有条件忽略。
- IMAP vendor：39 项通过。
- `npm run build`、`npm run check:ui`、`npm run check:i18n`（1218 键）、`npm run format:check`、`cargo fmt -- --check`、`git diff --check` 通过；保留既有大 chunk 提示。
- 首次 Rust 全量曾因本地化测试仍用中文键失败 1 项（`interface_language_is_independent_of_other_preferences_and_survives_reopening`），已修正 `interface_language.rs`、`notifications.rs`、`lib.rs` 初始托盘与 `tests.rs` 后重跑通过；`notifications.rs` 的回执键补齐 JSON 键末尾空格。
- 七资源的长度/摘要与 GitHub 元信息一致；说明原文（含末尾换行）与固定源码/Release body/latest.json 一致，两架构 URL 与签名文件一致；minisign 使用既有公钥独立验证通过（key ID `CDE6DD181B0CE63D`）。
- 两包版本 0.1.24、arm64/x86_64、稳定标识 `dev.maildesk.desktop`、最低 macOS 12、zh-Hans/en 声明与许可资源通过。代码签名和精确 DR 为 `identifier "dev.maildesk.desktop" and certificate root = H"9bdb640cfd84667d5ea3edeb37859c316abb4109"`。
- 两架构 DMG 校验有效，只读挂载后的全部 App 文件与对应更新归档逐字节一致；核验后卸载。
- 正式发布后七资源匿名公开下载与审计副本完全一致；标准 `/releases/latest/download/latest.json` 不带查询参数，逐字节匹配。发布前后 asset ID/长度/摘要与标签固定源码不变。
- 审计文件与日志存于仓库外 `/tmp/anser-release024-8lKYDz`。

## 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.24_aarch64.app.tar.gz` | 12493196 | `ab24f379352c716517e827d8fb42abb5fd0ca498835f488a9572cd4dfb40f12f` |
| `Anser_0.1.24_aarch64.app.tar.gz.sig` | 424 | `8b608d97de2886eaed85ef8cff6ee43760c7bd8c92619a59073eb7ded9fcdcb5` |
| `Anser_0.1.24_aarch64.dmg` | 13061250 | `cac8f6124eb200be31a1771e0a23696b7b828c3e6d80c83bec7019afa983430c` |
| `Anser_0.1.24_x86_64.app.tar.gz` | 13107245 | `260f048b37f2cfaae38148cea4559c8c26fd7f0689fdddaeb6ee25dc473ce966` |
| `Anser_0.1.24_x86_64.app.tar.gz.sig` | 424 | `edbc7599cab317a43f2e219b23f3e23e910a7baf1cce0f62e1975fe758245c6e` |
| `Anser_0.1.24_x86_64.dmg` | 13750527 | `f20fe4b03b44aad99f5a2ae54529d0ea7d069e1744ceb2b46bb87e71187de6b1` |
| `latest.json` | 4644 | `376a9754b7ac6ae7c8fc9149bf9ddb5d708a05915b54c5825be43cb0eff0ca7f` |

## 验收边界

正式包安装、应用内原位升级、Intel 实机、系统通知横幅、托盘菜单实际点击、Gmail 交互重写与外部代理/睡眠弱网未验证。实时推送在真实 QQ 邮箱与腾讯企业邮复验；Gmail 持续收取在开发预览通过，但交互重写仍待用户显式检查/连接/保存设置时触发。自签名和更新归档签名不等同于 Apple Developer ID、公证或 Gatekeeper 认可。

## 后续入口

本版代码、云端构建、产物审计、公开发布与 Homebrew 同步分别完成。后续由用户验证正式包安装/升级与原生交互；本轮文档提交后的 Checks 以对应 GitHub 运行结果单独核对，不沿用为桌面实机验收。
