# 0.1.20 发布工作点

## 目标与当前状态

- 2026-10-17 用户要求合并 Issue #1 的 PR，并提交本地代码触发新版本发布。
- [PR #2](https://github.com/ansermail/anser/pull/2) 已以 squash 方式合入组织 `main`，合并提交为 `3d48afc4410d01f544c05f8323c53086d9baad78`；Issue #1 已回复并关闭。
- 候选版本为 `0.1.20`，npm、lockfile、Cargo、Cargo lock 与 Tauri 版本统一。发布说明见 [v0.1.20](releases/v0.1.20.md)。
- 本次发布只生成新的桌面版本，不重写 0.1.19 标签、Release 或资源。

## 发布范围

- 已发送邮件新建可编辑草稿、持久撤回窗口、立即发送、紧凑发送记录与草稿卡片。
- 顺序多动作规则、抄送/优先级/已接收天数等条件、在线邮件完整核对和解析版本 5 头部迁移。
- “全部邮件”统一未读范围、已发送/草稿排除未读、目录徽标、托盘菜单、菜单栏与 Dock 未读数字。

## 发布门槛

- [x] 本地格式、UI、前端、桌面脚本、生产构建、Rust、IMAP vendor 与版本/发布资源检查通过。
- [ ] 发布提交和唯一标签 `v0.1.20` 推送组织仓库。
- [ ] Release macOS 流水线完成 check、Apple Silicon / Intel 构建和草稿上传。
- [ ] 七份资源身份、大小、摘要、更新签名、App/DMG 一致性及原生配置审计通过。
- [ ] 正式发布为 latest，公开端点与 Homebrew 配方同步核验。
- [ ] 回填源码提交、Actions、Release、资源摘要与剩余人工验收边界。

本地门槛结果（2026-10-17）：前端 381 通过（55 文件）；Rust 389 通过、3 项既有条件忽略；桌面脚本 28 通过；IMAP vendor 39 通过。`npm run check:ui`、`npm run format:check`、Rust 格式、`npm run build`、`node scripts/release-assets.mjs verify` 与 `git diff --check` 通过。生产构建仅保留既有 Vite 动态导入与大 chunk 提示。

## 边界

- 系统通知横幅的系统级绘制、暂停通知在真实托盘菜单中的切换，以及服务器规则动作端到端执行仍按人工验收记录。
- 正式包的实际安装、应用内原位升级与 Intel 实机运行不沿用 0.1.19 结果。
