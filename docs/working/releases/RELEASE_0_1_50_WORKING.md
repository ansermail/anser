# 雁信 0.1.50 发布工作点（2026-11-28）

- **代码完成**。包括 Windows 安装包图标与覆盖升级、AI 功能开关、过滤规则添加标签、阅读与界面修正。四处版本号同步，Windows 安装包和 AI 功能开关条目末尾署名 `@xbcmzaa`。详见 [版本说明](../../releases/v0.1.50.md)。
- **自动测试通过**。本地 `pnpm test:ci` 85 文件 / 663 项，Rust 505 项通过、5 项忽略，vendored `imap-proto` 39 项、桌面脚本 42 项通过。生产和 Pages 预览构建、UI、2,105 条双语文案、Prettier、Rust 格式、发布预检、差异与应用更新说明署名渲染检查通过。
- **真实场景验收**。已有 Apple Silicon macOS 开发版浅色截图与演示规则测试记录。Windows 内网离线覆盖升级、升级后凭据与存档读取、正式包更新弹窗未验证。
- **云端构建通过**。注释标签 `v0.1.50` 指向 [`c7b96df`](https://github.com/ansermail/anser/commit/c7b96df1e2159a1acc1bc88b6592b2041b0df1d8)。[Release desktop](https://github.com/ansermail/anser/actions/runs/46138791359) 的 check、Apple Silicon、Intel Mac、Windows 原生回归与 draft 五项任务全部成功。独立草稿审计（Release ID `461519524`）核对九份资源大小/SHA-256、八份产物与 Actions 原件逐字节一致、三份 Minisign 签名、双架构固定证书/标识/版本/架构与 DMG/更新归档一致性，以及 `latest.json` 中的完整版本说明。
- **正式发布通过**。2026-11-28 19:53:52（Asia/Shanghai）将审计过的草稿公开为 [v0.1.50 Alpha](https://github.com/ansermail/anser/releases/tag/v0.1.50) latest。三份安装器均匿名 HTTP 200；标准更新端点返回 `0.1.50`、三平台和两处逐条 `@xbcmzaa` 署名。[Homebrew 流水线](https://github.com/ansermail/anser/actions/runs/46142023879) 已成功。正式包内更新弹窗未点验；Pages 和 Homebrew 匿名分发验证在发布记录提交及 Pages 部署后单独执行。
