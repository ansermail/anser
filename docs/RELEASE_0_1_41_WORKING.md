# 0.1.41 发布工作点

更新：2026-11-11（Asia/Shanghai）。

## 当前状态：本地门槛通过，等待云端构建

- 主线业务改动为 `49388dc94a4bc9de21e461a1d5afcfc29e843aff`。阅读区四周统一为 10px，HTML 正文区域使用 12px 圆角。该提交已通过 Checks、Windows validation 和用户的开发预览验收。
- 版本更新同步五处版本号；发布说明见 [v0.1.41](releases/v0.1.41.md)。
- 本机 Apple Silicon 通过 `npm run test:ci`（70 文件 / 485 项）、`npm run test:rust`（454 通过 / 5 条件忽略）、`npm run test:desktop`（37 项）、vendored IMAP 回归（39 项）、`npm run build`、`npm run build:preview`、`npm run format:check`、Rust fmt 与 `npm run release:check`。当前公开 latest 为 0.1.40。
- 下一步为提交版本元数据、推送标签、检查 Release desktop 与草稿九资源，审计后公开。安装包公开后推送主线版本提交触发 Pages，随后核验官网和 Homebrew。
