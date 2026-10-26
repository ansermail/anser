# 0.1.31 发布工作点

更新：2026-10-26。用户要求提交并发布凭据库改动。

## 当前状态：已正式发布

- 基线：`main` / `09d2383`，上一正式版为 `v0.1.30` / `4c79b89`。
- 凭据库功能提交 `669a1be`：AES-256-GCM 加密的 `credentials.vault`、钥匙串密钥条目 `anser-credentials-key-v2` 仅由 `/usr/bin/security` 读写、旧库一次性迁移、锁定时失败关闭、损坏不覆盖；`lib.rs` 启动时初始化凭据库位置。
- 五处版本同步为 0.1.31；应用标识 `dev.maildesk.desktop`、数据存储和更新公钥不变。完整说明见 [v0.1.31](releases/v0.1.31.md)。
- 开发预览已验证：14:29 首次启动完成一次旧库授权，14:30 生成 0600 凭据库与密钥条目；14:31 重启后无钥匙串弹窗，QQ 与腾讯企业邮从凭据库完成 IMAP IDLE 连接与收取。Gmail 同期为 OAuth 令牌端点网络失败，与凭据读取无关。

## 验证与交付

- [x] 本地完整门槛：前端 64 文件 434/434、Rust 429 通过/4 既有忽略、桌面脚本 36/36、IMAP 39/39、Prettier、rustfmt、`release:check`、UI、1,348 条双语键、生产构建、Pages 构建与 diff 检查通过。
- [x] 发布提交 `96528ae` 已推送 `main`，注释标签 `v0.1.31` 指向同一提交。
- [x] [Checks 40283009916](https://github.com/ansermail/anser/actions/runs/40283009916) 与 [Preview Pages 40283009865](https://github.com/ansermail/anser/actions/runs/40283009865) 成功。[Release macOS 40283017684](https://github.com/ansermail/anser/actions/runs/40283017684) 首次运行的 check 作业在前端大列表两条 205 封跨页导航用例上超时（17.1s/16.3s 超过 15s 上限，断言全部通过；同一提交的 Checks 运行中为 13.3s/12.9s 并通过），核对日志确认非业务回归后重跑失败作业成功，双架构构建与草稿创建完成。
- [x] 七资源大小与 SHA-256 和 GitHub 元信息一致；两架构更新签名经既有公钥验证，`latest.json` 版本、URL 与签名匹配，说明原文一致；两份 DMG 可校验并只读挂载，包内应用与更新归档逐文件一致；arm64/x86_64 架构、0.1.31 版本、`dev.maildesk.desktop` 标识、最低 macOS 12、简体中文/英文声明、EML/EMLX/MSG 关联、许可资源、固定证书指纹与精确 designated requirement 通过。
- [x] 正式发布为 latest，Release ID `424013002`，2026-10-26 16:45:34（Asia/Shanghai）。发布后七个资源经匿名 REST 接口重新下载，大小与 SHA-256 逐项一致；本机直连 github.com 多次超时，标准 `latest/download/latest.json` 端点未能在本轮完成逐字节复核，公开端点仍以 GitHub 重定向为准。
- [x] [Homebrew 40294505784](https://github.com/ansermail/anser/actions/runs/40294505784) 成功，生成仅修改 `Casks/anser.rb` 的提交 [c28a444](https://github.com/ansermail/anser/commit/c28a4440cc0e9255ec7c1938849b272d82e61287)；重复运行 [40295031165](https://github.com/ansermail/anser/actions/runs/40295031165) 返回 `Cask is already current; no commit needed.`。
- [x] 用正式 0.1.31 DMG 替换 `/Applications/雁信.app`（旧 0.1.30 移入废纸篓 `Anser-old-apps-20261026`），包内签名与固定身份一致；启动与重启均无 SecurityAgent 授权弹窗，凭据库保持 0600 且未被改写，腾讯企业邮与 QQ 邮箱从凭据库完成 IMAP IDLE 连接并收取（QQ 新增 3 封）。Gmail 同期为 OAuth 令牌端点网络失败。
- [x] 本机 `/Applications/雁信.app` 与开发预览共用同一数据目录，正式安装后的默认打开/冷启动与应用内原位升级仍未单独验收。

## 验收边界

自动测试、云端构建和静态产物审计不证明正式安装、应用内原位升级或 Intel 实机运行。项目自签名与更新归档签名不等同于 Apple Developer ID 签名或公证。
