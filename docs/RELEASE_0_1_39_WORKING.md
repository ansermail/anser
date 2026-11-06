# 0.1.39 发布工作点

更新：2026-11-06（Asia/Shanghai）。用户授权提交并正式发布；交付后恢复本地开发预览，正式安装更新由用户自行完成。

## 当前状态：发布准备

- `main` 工作树，版本已同步为 0.1.39；发布前公开 latest 仍为 0.1.38。
- 本版包含阅读头部即时显示、独立可过期在线阅读缓存、阅读缓存设置卡片及跨偏好卡片保存保护。
- 官网自动部署在推送前暂停，避免安装器公开前提前切换下载区；Release 公开后再恢复并部署。
- 不替换 `/Applications/雁信.app`，不在本轮执行本机正式安装或原位升级。

## 本轮本地门槛

环境：本机 macOS / Apple Silicon，Rust 1.91.1；日志保存在仓库外 `/tmp/anser-release-0.1.39-*.log`。

- `npm run test:ci`：非 App 68 文件 391 项 + App 86 项，共 477 项通过。
- `npm run test:rust`：Rust 库 454 项通过、5 项条件忽略；二进制与文档测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 项通过、2 项既有忽略。
- `npm run test:desktop`：37 项通过。
- `cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`、`npm run build:preview`、`npm run release:check`、UI 铁律、i18n 1439 条双语键、Prettier、Rust fmt 与 diff 检查通过；仅有既有 Vite 分包/体积提示。
- 五处版本核对为 0.1.39：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。

## 原生开发验收

- 退出后台正式版后启动开发预览，确认 Tauri 输出 `Running` 且开发 App 为新进程。
- 打开 Gmail 与 QQ 在线阅读邮件时，发件人、收件人、主题、时间与操作栏先显示，正文区域单独显示骨架，随后正文加载完成。
- 两封在线邮件生成 `reading_cache` 记录与 `read-cache/*.eml` 文件（0600）；切走再返回第一封时正文直接显示，`last_used_at` 从 22:08:35 更新到 22:08:53。
- 设置页显示“2 封 · 68 KB”、30 天保留、1 GB 容量和清除入口；验收后停止开发预览并重新启动正式 0.1.38。
- 未发送邮件、未删除真实邮件、未执行清除缓存或完整保存，未替换正式安装包。

## 尚未验证

- 原生缓存过期/关闭后重新拉取、完整保存后缓存移除、设置保存及清除确认仍需真实操作补验。
- 断网、磁盘不足、大附件、跨服务商长正文、Intel Mac、Windows 实机与正式包原位升级未在本轮验证。

## 下一步

1. 提交源码与发布准备文档，推送 `main` 与标签 `v0.1.39`。
2. 等待 Checks、Windows validation、Release desktop 完成并审计九资源与三个更新签名。
3. 发布草稿为 latest，核对匿名下载、标准更新端点、官网与 Homebrew。
4. 更新发布记录后恢复本地开发预览；正式安装由用户自行升级。
