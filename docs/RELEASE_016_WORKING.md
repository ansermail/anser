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
- [x] 源码 e8e049d219f529d32be1714e828ed7fa9e1d098b 已推送组织 main，v0.1.6 新标签已推送；[Release macOS 37940050741](https://github.com/ansermail/anser/actions/runs/37940050741) 正在执行。
- [x] 双架构构建与草稿成功；七个资源 SHA-256/大小、版本/架构/EML 声明、完整 codesign、DMG 校验、更新归档公钥签名与清单核验通过，两个架构的 DMG/更新包二进制分别一致。
- [x] 2026-10-09 22:13:59（Asia/Shanghai）[正式发布](https://github.com/ansermail/anser/releases/tag/v0.1.6) 为 latest；匿名公开更新端点逐字节匹配验证清单，两个架构资源链接正确。
- [ ] 正式安装、默认 EML 关联及冷启动、0.1.5→0.1.6 应用内原位更新验收。

GitHub Release 全部作业与 main Checks 已通过；两种架构已完成云端构建和正式发布。main Preview Pages 37940041962 也成功。资源核验计划：核对七个资源、latest.json 双架构 URL/签名，使用与 Tauri 更新器相同的 minisign-verify 校验既有公钥；下载的 app 及只读挂载 DMG 检查版本/架构/EML 声明/codesign，比较包内二进制一致性。不安装或覆盖本机应用。

## 发布命令与已完成核验

`npm run release:check`、`npm test`、`npm run test:desktop`、`npm run build`、`npm run build:preview`、`npm run format:check`；Rust 与 vendor 命令见 ci.yml。

本轮推送 v0.1.6 后用 `gh run list --repo ansermail/anser --workflow release.yml` 找到运行；草稿生成后下载到仓库外，核验版本/架构/文件关联/codesign 和更新签名，核验通过才 `gh release edit v0.1.6 --draft=false --latest`。

无 Apple Developer ID 证书与公证；更新签名不等于 Apple 公证。旧个人仓库客户端不会自动改用组织端点。真实升级/默认打开方式不能以模拟测试、开发应用或归档检查冒充完成。


## 后续入口

发布任务完成；真实正式包默认打开/冷启动和原位升级待专门验收。主线回 SETTINGS_NEXT_WORKING.md / codex/rules03-in-progress，先合入最新 main，不改写 v0.1.6 标签或资源。
