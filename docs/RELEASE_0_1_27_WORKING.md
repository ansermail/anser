# 0.1.27 发布工作点

更新：2026-10-24。用户明确要求提交代码、触发远程流水线构建新应用，并在完成后回复关闭 Issue #3，授权同步版本、提交推送、远程双架构构建、审计资源、正式发布、同步 Homebrew 和回复关闭 Issue。

## 当前状态：已正式发布

- 固定源码：`f176bfe4fab0a64380fc1b54ea94c9670e4277b6`；注释标签 `v0.1.27` 解引用后指向同一提交，正式发布后未移动标签或重建资源。
- 0.1.27 Alpha 于 2026-10-24 10:36:00（Asia/Shanghai）发布为 latest 和正式版（非预发布）。[正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.27) 的 Release ID 为 `422469128`。
- 应用标识仍为 `dev.maildesk.desktop`，更新端点和既有更新公钥保持不变。
- 版本源、发布说明、README、使用说明、更新记录与开发检查点已切换到 0.1.27；功能 WIP 位于独立工作树，不包含主工作区未提交的用户内容。

## 本版范围

- EML、EMLX、Outlook MSG、MBOX 本地导入；完整原件、hash 去重/补全、后台任务、取消/中断记录和原件导出。
- 导入文件夹右键重命名与永久删除；删除包含其中本地邮件、分类、来源关系及非共享原件，不删除服务器副本。
- 设置内 EML/EMLX/MSG 系统格式关联；外部单封邮件使用带 macOS 原生窗口按钮的独立阅读窗口。
- 外部邮件打印、回复、全部回复、转发、附件预览/另存及转发附件受管副本。
- 浅色、深色、跟随系统三态主题及同步适配的邮件正文和写信源码预览。
- IMAP 服务器导入已由用户取消，不属于本版范围或后续阶段。

## 发布证据

- [x] 最终本地发布门：前端 63 文件 425/425；Rust 421 通过/3 项既有条件忽略；桌面脚本 36/36；IMAP 39/39；TypeScript、UI、1,338 条双语键、Prettier、Rust fmt、生产构建、Pages 构建、`release:check` 与 diff 检查通过；敏感信息和真实邮件文件扫描无命中。
- [x] 安全范围提交为 `f176bfe` 并推送 `main`；远端 `main` 与标签源码一致。
- [x] [Checks 40053489470](https://github.com/ansermail/anser/actions/runs/40053489470)、[Preview Pages 40053489611](https://github.com/ansermail/anser/actions/runs/40053489611) 与 [Release macOS 40053508877](https://github.com/ansermail/anser/actions/runs/40053508877) 全部成功；Release 的 check、Apple Silicon、Intel 和 draft 任务均完成。
- [x] 七资源长度与 SHA-256 和 GitHub 元信息一致；两架构更新签名经既有公钥验证，`latest.json` 版本、URL 与签名匹配，说明原文一致。
- [x] 两份 DMG 通过校验并可只读挂载，App 与对应更新归档逐文件一致；arm64/x86_64 架构、`0.1.27` 版本、`dev.maildesk.desktop` 标识、最低 macOS 12、简体中文/英文声明、EML/EMLX/MSG 关联及许可资源通过；固定证书指纹与精确 designated requirement 通过。
- [x] 正式发布后七个资源经匿名端点重新下载，大小与 SHA-256 逐项一致；[标准 latest 更新端点](https://github.com/ansermail/anser/releases/latest/download/latest.json) 返回 `0.1.27` 及双架构正式资源。
- [x] [Homebrew 40054843111](https://github.com/ansermail/anser/actions/runs/40054843111) 通过公开 DMG 摘要、`brew style`、`brew audit` 与 `brew fetch`，生成仅修改 `Casks/anser.rb` 的提交 [4590879](https://github.com/ansermail/anser/commit/4590879646fbde33fa87db931263a311b49d2b81)；重复运行 [40054930237](https://github.com/ansermail/anser/actions/runs/40054930237) 返回 `Cask is already current; no commit needed.`。
- [x] Issue [#3](https://github.com/ansermail/anser/issues/3) 已回复支持范围、限制和正式下载，并以 completed 关闭。

## 验收边界

正式安装后的默认双击/冷启动、应用内原位升级与 Intel 实机运行仍未验证。项目自签名和更新归档签名不等同于 Apple Developer ID、公证或 Gatekeeper 认可。IMAP 服务器导入已取消；PST、含 Content-Length 的 mboxcl/cl2，以及嵌入邮件、OLE 附件、仅含 RTF 等特殊 MSG 变体不在已支持范围。
