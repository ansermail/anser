# 0.1.9 发布工作点

2026-10-10，main，基线 1191ce1。公开最新 0.1.8；本轮源码提交/云端构建待写回，未发布前不把新版称为 latest。

## 范围与本机门槛

QQ SMTP 自动已发送副本有限次新连接只读核对/旧精确回执恢复、IDLE 60 秒与 NOOP 45 秒绝对截止、跨时区排序与未读点固定宽度；包括已提交的 Microsoft 原生发布配置。Google/Microsoft Secret 与更新公钥沿用当前配置，本机标识/原件保持。

- npm test：209 项 / 37 文件。
- cargo test --manifest-path src-tauri/Cargo.toml：283 项。
- npm run test:desktop：19 项。
- cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml：39 项。
- npm run build（含 check:ui）、npm run build:preview（静态桥隔离）、npm run format:check、cargo fmt --check、npm run release:check、git diff --check：通过。
- 授权双邮箱 C/D 的 SMTP/收件/副本及原件散列核对通过，C 实时通知和在线正文通过；D 无独立实时延迟证据。见 SENT_IDLE_RELIABILITY_WORKING.md。真实 NOOP 静默补查与其他矩阵不扩充为通过。

## 云端/资源/正式发布

待阶段提交并推送组织 main，workflow_dispatch release.yml；记录固定源码 SHA 与同一运行，核对 check、两架构及 draft。然后核对七项资产大小/SHA256、两份更新签名、公钥、manifest 链接、版本/架构/标识/EML/完整 app 签名、许可资源、仅 backend 的 Google/Microsoft 编译配置、DMG 与更新包二进制一致性，再发布草稿。公开端点/标签与下载资源需在发布后复核。

## 未完成与接续

未执行本次正式安装/原位升级/默认 EML/冷启动、多 Mac；无 Developer ID/公证，旧个人仓库安装迁移仍待安排。新 Google 授权/刷新与微软实际邮箱 SMTP/刷新独立记录。正式发布完成后继续 SEARCH_SCALE_WORKING.md，同时保留 SYNC/SAVE 真实故障矩阵，不声明整体开发完成。
