# 0.1.36 发布工作点

更新：2026-11-03（Asia/Shanghai）。用户已授权提交与正式发布。

## 当前状态：本地发布检查通过，准备推送固定源码

- 修复提交 `8abb6d7`；工作树 `/Users/zhangxiaojun/.codex/worktrees/release-0.1.36/mail`，分支 `codex/release-0.1.36`。
- 原工作区 `/Volumes/Others/mail` 的 `src/lib/mail-images.ts` 与 `src/lib/mail-images.test.ts` 既有 WIP 保留且不进入发行源码。
- 五处版本为 0.1.36；公开 latest 仍为 0.1.35，尚未创建标签、云端构建或正式发布。

## 修复范围与已有证据

macOS 不创建原生菜单栏 tooltip；Windows 保留随语言切换的静态提示；移除每 5 秒动态 tooltip 写入，同值标题不重复刷新，Dock 原定时刷新保留。本机旧正式 0.1.35 原生观察到独立“帮助标记”，修复版开发预览关闭主窗切到访达并跨至少 15 秒无提示残留。稳定项目签名与精确 DR 通过，既有账号及存档可读；这不是正式安装或升级验收。

## 本轮发布门槛

以下均在排除既有图片 WIP 的独立发行工作树执行：

- `npm ci` 成功；`npm run test:ci`：前端 67 文件 463 项（378 + App 85）通过。
- `CARGO_TARGET_DIR=/Volumes/Others/mail/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml`：Rust 433 通过、4 项既有忽略；原生源码与测试均编译通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 通过、2 项既有忽略。
- `npm run test:desktop`：37/37；`cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39/39。
- `npm run build`、`npm run build:preview`（含官网/演示原生桥隔离）、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check`、`git diff --check` 均通过；UI 与 i18n 1367 双语键通过，只有既有 Vite 分包/体积提示。
- 本轮日志在仓库外 `/tmp/anser-0.1.36-*.log`；发行资源审计目录 `/tmp/anser-release036-Dw6rHc`。

五处版本须在暂存对象与固定提交再次核对，随后推送新标签。

## 后续入口

1. 固定源码、推送 main 和 v0.1.36，等待 Checks / Pages / Release desktop。
2. 审计九资源长度/摘要、三个更新签名、Mac 双架构固定签名/DR/元数据/许可与 DMG 一致性、Windows 资源和清单/说明原文。
3. 重新核对草稿身份与标签后公开 latest；核对匿名下载与标准更新端点，等待 Homebrew 同步并更新最终记录。

## 验收边界

菜单栏实际点击恢复、未读数变化与语言切换、正式包安装/原位升级、Windows 与 Intel Mac 实机本轮未验证；其他协议及通知真实场景未扩充验收。未授权范围外发信、改写存档或更换凭据身份。
