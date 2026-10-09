# 0.1.6 Alpha 发布工作点

更新：2026-10-09（Asia/Shanghai）。分支 main；功能基线 1bb384391582ef76ea849cdb8cd979a850ad938d。

## 范围与保护

- 发布已完成的签名、存档路径选择、设置/写信/附件图标调整及 EML 只读查看；Pages 共用界面及隔离也包含在源码。
- codex/rules03-in-progress 不合入。应用/钥匙串标识与更新公钥不变；本机 OAuth 测试配置不进入 CI 或公开包。
- 使用新 v0.1.6 标签，不覆盖旧版。双架构 DMG、app.tar.gz、sig 和 latest.json 全部核验后发布。

用户明确要求 GitHub Actions 云端构建并发布；本机仅运行门槛检查，不构建或安装桌面发布包。

## 进度

- [x] 同步 npm/lock、Cargo/lock 与 Tauri 版本为 0.1.6，准备发布说明。
- [x] 本轮发布门槛通过：195 前端、242 Rust、19 桌面脚本、39 vendor IMAP；release:check、格式/UI、diff/fmt、生产与预览构建通过。
- [ ] 提交/推送源码及标签，记录源码提交与 Actions。
- [ ] 双架构构建、完整 codesign 与更新签名/清单核验。
- [ ] 正式发布及公开最新端点/资源核对。
- [ ] 正式安装、默认 EML 关联及冷启动、0.1.5→0.1.6 应用内原位更新验收。

## 继续命令

`npm run release:check`、`npm test`、`npm run test:desktop`、`npm run build`、`npm run build:preview`、`npm run format:check`；Rust 与 vendor 命令见 ci.yml。

推送 v0.1.6 后用 `gh run list --repo ansermail/anser --workflow release.yml` 找到运行；草稿生成后下载到仓库外，核验版本/架构/文件关联/codesign 和更新签名，核验通过才 `gh release edit v0.1.6 --draft=false --latest`。

无 Apple Developer ID 证书与公证；更新签名不等于 Apple 公证。旧个人仓库客户端不会自动改用组织端点。真实升级/默认打开方式不能以模拟测试、开发应用或归档检查冒充完成。
