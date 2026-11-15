# 0.1.42 发布工作点

更新：2026-11-15（Asia/Shanghai）。

## 当前状态：本地门槛通过，准备提交

- 远程最新正式版为 0.1.41。目标版本为 0.1.42，发布说明见 [v0.1.42](releases/v0.1.42.md)。
- 本版包含已提交的 AI 工具、日历与多维工作台、邮件标签与数据表格改动，以及当前工作台交互修正。
- 本地版本来源、格式、前端、Rust、桌面脚本、IMAP、生产与 Pages 构建检查已通过：前端 74 文件 562 项，Rust 472 项通过/5 项条件忽略，桌面脚本 37 项，IMAP 39 项，钥匙串迁移示例 16 项通过/2 项条件忽略；生产与 Pages 构建、UI 铁律、1794 条双语键、Prettier、Rust 格式、发布资源检查及 diff 检查通过。
- 标签推送后等待 Release desktop 的 macOS 双架构、Windows x64 和草稿汇总。安装器公开前不推送本版 `main`，避免官网提前显示不可下载的新版本。
- 草稿九资源公开前需核对资源身份、大小、SHA-256、更新签名、macOS 固定签名与 designated requirement、DMG/更新归档一致性、Windows EXE 和 `latest.json`。
- 正式公开后推送 `main`，并分别核对 Checks、Windows validation、Preview Pages 与 Homebrew。

## 待填写

- 固定源码与注释标签。
- 本地门槛结果。
- Release desktop 运行地址。
- Release ID、公开时间与 latest 状态。
- 九资源大小与 SHA-256。
- 官网与 Homebrew 结果。
- 真实场景验收边界。
