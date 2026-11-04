# 0.1.38 发布工作点

更新：2026-11-04（Asia/Shanghai）。用户授权提交并正式发布，本机安装更新由用户自行完成。

## 当前状态：版本准备与完整门槛

- 基线 `main` / `1a99af8`；包含 `1105598` 性能、`55b6560` 附加存档/双级校验与 `46b1928` 翻译及排版修复。
- 五处版本同步为 0.1.38。0.1.37 已有固定旧源码标签与九资源草稿，保持未发布、不移动标签；本轮使用新标签。
- 本轮完整本地门槛通过，云端构建、草稿资源审计与正式发布尚未完成。公开 latest 仍为 0.1.36。
- 官网发布时序：推送前暂停自动部署，安装器公开后再恢复并部署 0.1.38；随后核对三平台公开链接和 Homebrew 配方。

## 本轮完整本地门槛

环境：本机 macOS / Apple Silicon，Rust 1.91.1；日志保存在仓库外 `/tmp/anser-release-0.1.38/`。

- `npm run test:ci`：前端 67 文件 389 项，加 App 85 项，共 474 项通过。
- `npm run test:rust`：Rust 库 451 项通过、5 项条件忽略；其余二进制/文档测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 项通过、2 项既有忽略。
- `npm run test:desktop`：37 项通过；`cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`、`npm run build:preview`、UI、i18n 1422 条双语键、`npm run format:check`、Rust fmt、`npm run release:check` 与 diff 检查通过；仅有既有 Vite 分包/体积提示。
- Pages 标签部署被既有 github-pages 分支保护拒绝，改为重跑原 main 的 [41566362433](https://github.com/ansermail/anser/actions/runs/41566362433) 已成功恢复 0.1.36；自动部署现已暂时禁用，待安装器公开后恢复。
- 推送前已在三份开发文档和未推送提交中脱敏两条真实邮件主题；原本地提交保留在不推送的 `local-backup/pre-release-0.1.38` 分支。

## 验证范围与限制

此前开发验收：前端 474、Rust 库 451/5 忽略、桌面脚本 37，通过；副本 5,499 封归档/取回与快速校验通过，深度校验 5,497/5,499，另 2 封为已有 MIME Base64 异常。原生设置页已核对配置、确认及断盘状态，未用有数据副本走完整进度/取消/取回。

本轮发布门槛需重新记录，不能沿用以上结果冒充。6.4 万封真实规模、Windows/Intel 实机、磁盘满/热插拔与强制退出恢复、正式安装和原位升级仍未验证；不替换 `/Applications/雁信.app`。

## 下一步

完成本地门槛；核对暂存五处版本后提交，再从固定提交核对并创建新标签；推送后等待 Checks、Windows validation 与 Release desktop 成功；独立审计九资源及三签名、Mac 固定身份/DR/元数据/DMG；公开并核对匿名下载和标准更新端点，最后恢复官网与 Homebrew。
