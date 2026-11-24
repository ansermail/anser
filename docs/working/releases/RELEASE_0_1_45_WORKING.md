# 0.1.45 发布工作点

更新于 2026-11-24，时区 Asia/Shanghai。

## 发布候选

- 版本已在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 同步为 `0.1.45`。
- 候选范围包含 0.1.44 真机走查与前后端全量审计修复（详情见 [0.1.44 真机走查与前后端优化工作点](../features/UI_UX_AND_BACKEND_AUDIT_0_1_44_WORKING.md)），含工作台「日期 + 具体时间」等高单行正向开关优化。
- 发布说明为 [v0.1.45](../../releases/v0.1.45.md)。正式安装器公开前，README、Homebrew 配方和官网继续保留 0.1.44。
- 已停止并清理本地临时开发预览包（`雁信预览.app`、`dev.maildesk.preview0144` 及本地 Vite 1428 服务）。

## 待完成发布步骤

- [ ] 本地全量发布门槛（`release:check`、格式、`test:ci`、`test:desktop`、`build`、`build:preview`、`test:rust`、IMAP、`git diff --check`）
- [ ] 提交并推送 `main` 与注释标签 `v0.1.45`，并在安装器公开前主动取消首次自动触发的 `Preview Pages`
- [ ] 监控云端 `Checks`、`Windows validation` 与 `Release desktop` 全部通过
- [ ] 核验草稿 Release 九份资源与 `latest.json`，公开 `v0.1.45` 为 `latest` 并校验匿名 HTTP 200
- [ ] 触发 `Homebrew` 与 `Preview Pages`，核验配方更新与官网线上下载链接，同步回写 `UPDATES.md`、`README.md` 与 `DEVELOPMENT_STATUS.md`
