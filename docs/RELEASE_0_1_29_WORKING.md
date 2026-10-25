# 0.1.29 发布工作点

更新：2026-10-25。用户要求将 `main` 上尚未随正式包发布的最新修改发版，授权同步版本、提交推送、双架构构建、资源审计、正式发布与 Homebrew 同步。

## 当前状态：已正式发布，Homebrew 同步与重复检查完成

- 基线：`main` / `856d7ec`，上一正式版为 `v0.1.28` / `dd2fe9b`。
- 本版唯一功能变更：`8e8fffa` 解析 RFC 5322 `Sender`，仅在与 `From` 不同时展示代发发件人。
- 阅读页、对话、外部邮件窗口和打印页展示“由 xxx 代发”；解析版本升至 6，已保存原件的归档邮件启动迁移时只读邮件头回填，不重新解码正文与附件。
- 五处版本同步为 0.1.29；应用标识 `dev.maildesk.desktop`、数据存储和更新公钥不变。完整说明见 [v0.1.29](releases/v0.1.29.md)。
- 固定源码 `6057866ae69c9ef0ea4949342227b1d824c1c205`；注释标签 `v0.1.29` 指向同一提交，正式发布后未移动标签或重建资源。
- 0.1.29 Alpha 于 2026-10-25 09:48:35（Asia/Shanghai）发布为 latest 和正式版（非预发布），[正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.29) Release ID 为 `423090154`。

## 验证与交付

- [x] 本地完整门槛：前端 64 文件 433/433；Rust 423 通过/3 项既有条件忽略；桌面脚本 36/36；IMAP 39/39；Prettier、Rust fmt、TypeScript、UI、1,348 条双语键、生产构建、Pages 构建、`release:check` 与 diff 检查通过。
- [x] 暂存对象五处版本核对通过；安全范围提交 `6057866` 已推送 `main`，注释标签 `v0.1.29` 指向同一提交。
- [x] [Checks 40150985392](https://github.com/ansermail/anser/actions/runs/40150985392)、[Preview Pages 40150985389](https://github.com/ansermail/anser/actions/runs/40150985389) 与 [Release macOS 40150990500](https://github.com/ansermail/anser/actions/runs/40150990500) 全部成功；Release 的 check、Apple Silicon、Intel 和 draft 任务均完成。
- [x] 七资源长度与 SHA-256 和 GitHub 元信息一致；两架构更新签名经既有公钥验证，`latest.json` 版本、URL 与签名匹配，说明原文一致。
- [x] 两份 DMG 通过校验并可只读挂载，App 与对应更新归档逐文件一致；arm64/x86_64 架构、`0.1.29` 版本、`dev.maildesk.desktop` 标识、最低 macOS 12、简体中文/英文声明、EML/EMLX/MSG 关联及许可资源通过；固定证书指纹与精确 designated requirement 通过。
- [x] 正式发布后七个资源经匿名端点重新下载，大小与 SHA-256 逐项一致；标准 latest 更新端点与审核清单逐字节相同，资源身份未变。
- [x] [Homebrew 40152064882](https://github.com/ansermail/anser/actions/runs/40152064882) 成功，生成仅修改 `Casks/anser.rb` 的提交 [95b963c](https://github.com/ansermail/anser/commit/95b963c5a302f511ff1473c4a15355fe6d70210d)，两架构摘要与独立审计一致；重复运行 [40152099354](https://github.com/ansermail/anser/actions/runs/40152099354) 返回 `Cask is already current; no commit needed.`。

## 验收边界

自动测试、云端构建和静态产物审计不证明正式安装、应用内原位升级或 Intel 实机运行。项目自签名与更新归档签名不等同于 Apple Developer ID 签名或公证。

## 七资源审计

| 资源 | 字节 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.29_aarch64.app.tar.gz` | 12870393 | `ed93f7f26b73561cd92413c26e20f09cf3965c1a6316dc5ec1037ebc19028ecf` |
| `Anser_0.1.29_aarch64.app.tar.gz.sig` | 424 | `4171f9a13691cad54553ff54b78c120f852540e54e99cb1c5b7f9907ffa6d2a9` |
| `Anser_0.1.29_aarch64.dmg` | 13428436 | `8c0b95782a430783cfccec011347f359d2bf9539e50e1c4c16c7b586826a78fa` |
| `Anser_0.1.29_x86_64.app.tar.gz` | 13483968 | `11eabcb40897879ac820c3a6349061733522fd8e8da61cc622992528e87d479a` |
| `Anser_0.1.29_x86_64.app.tar.gz.sig` | 424 | `530ae5630eb68d5615796b8a2eb34174d64c5500f2eefadf253c87a091ded00f` |
| `Anser_0.1.29_x86_64.dmg` | 14124825 | `f3bec13779b3e7245a5afbc5ee0b038863cb5dd7b4425e9e5b9c8e72f236603b` |
| `latest.json` | 2494 | `8597ba240493ae92b044662c6bf75ef5a716b1ac5deb25c56a370b172543706b` |

本机审计脚本和日志位于桌面 `mail_video/release-0.1.29`；这些结果验证发布产物，不包含真实邮箱数据或发布私钥。
