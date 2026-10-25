# 发布与应用内更新

## 当前版本：0.1.29（2026-10-25）

0.1.29 Alpha 于 2026-10-25 09:48:35（Asia/Shanghai）正式发布为 latest，固定源码 `6057866ae69c9ef0ea4949342227b1d824c1c205`。[Checks 40150985392](https://github.com/ansermail/anser/actions/runs/40150985392)、[Preview Pages 40150985389](https://github.com/ansermail/anser/actions/runs/40150985389) 与 [Release macOS 40150990500](https://github.com/ansermail/anser/actions/runs/40150990500) 全部成功，[正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.29) 已公开。

本版新增代发发件人展示：当邮件的 RFC 5322 `Sender` 与 `From` 表示不同邮箱时，阅读页、对话、外部邮件窗口和打印页显示“由 xxx 代发”；相同或缺失 `Sender` 时不显示。已保存原件的归档邮件在启动迁移时只读取邮件头回填，不重新解码正文与附件。

本地与云端门槛通过：前端 64 文件 433 项、Rust 423 通过/3 项既有条件忽略、桌面脚本 36 项、IMAP 39 项；UI、1,348 条双语键、生产构建与 Pages 构建通过。七资源大小/SHA-256、双架构更新签名、固定代码签名及精确 DR、包内版本/架构/标识/语言/格式关联/许可、DMG 与更新归档应用一致性、说明原文及匿名公开 latest 端点均通过。[Homebrew 40152064882](https://github.com/ansermail/anser/actions/runs/40152064882) 成功，[95b963c](https://github.com/ansermail/anser/commit/95b963c5a302f511ff1473c4a15355fe6d70210d) 仅更新主仓库配方；重复运行 [40152099354](https://github.com/ansermail/anser/actions/runs/40152099354) 返回 `Cask is already current; no commit needed.`。

本版沿用既有应用标识、数据存储和更新公钥。正式安装后的默认打开/冷启动、应用内原位升级、系统剪贴板和 Intel 实机仍未在本轮验收。完整说明见 [v0.1.29](releases/v0.1.29.md)，证据见 [发布工作点](RELEASE_0_1_29_WORKING.md)。

## 前一正式版本：0.1.28（2026-10-24）

0.1.28 Alpha 于 2026-10-24 14:14:49（Asia/Shanghai）正式发布为 latest，固定源码 `dd2fe9be5357942a82794f2acc543d901f075d1c`。[Checks 40068379904](https://github.com/ansermail/anser/actions/runs/40068379904)、[Pages 40068379953](https://github.com/ansermail/anser/actions/runs/40068379953) 与 [Release macOS 40068386396](https://github.com/ansermail/anser/actions/runs/40068386396) 全部成功，[正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.28) 已公开。

本版修复 macOS 打开外部邮件时扩展属性变动引发的 `fileChanged` 误判；收件人、抄送、原始 Bcc 分行对齐，地址支持右键写信/复制/添加本地联系人，通讯录改为紧凑自适应网格。保留新版官网、宣传片与独立虚构数据 Web 演示。

本地与云端全量门槛通过：前端 64 文件 432 项、Rust 422 通过/3 既有条件忽略、桌面脚本 36 项、IMAP 39 项。七资源大小/SHA-256、双架构更新签名、固定代码签名及精确 DR、包内版本/架构/标识/语言/格式关联/许可、DMG 与更新归档应用一致性、说明原文及匿名公开 latest 端点均通过。[Homebrew 40069438215](https://github.com/ansermail/anser/actions/runs/40069438215) 成功，[78bf04c](https://github.com/ansermail/anser/commit/78bf04c3515966adb99359704ee6077e3ead9a0f) 仅更新主仓库配方，两架构摘要与公开 DMG 一致；重复运行 [40069519888](https://github.com/ansermail/anser/actions/runs/40069519888) 成功且无多余提交。

正式安装后的默认打开/冷启动、应用内原位升级、系统剪贴板和 Intel 实机仍未在本轮验收；不将 CI 和资源审计视为真实场景验收。完整说明见 [v0.1.28](releases/v0.1.28.md)，证据见 [发布工作点](RELEASE_0_1_28_WORKING.md)。

## 前一正式版本：0.1.27（2026-10-24）

0.1.27 新增 EML、EMLX、Outlook MSG 与 MBOX 本地导入，完整保留原始字节并支持账号/文件夹归档、后台任务、去重、补全、取消与中断记录；本地导入文件夹支持右键重命名和永久删除，删除会连同其中邮件、分类与不再共享的本地原件移除，不发送服务器删除命令。设置新增 EML、EMLX、MSG 的系统格式关联，外部单封邮件使用带 macOS 原生窗口按钮的独立阅读窗口，并提供打印、回复、全部回复、转发与附件操作。

本版增加浅色、深色、跟随系统三态主题，图标分别使用太阳、月亮、显示器表示当前模式，系统外观变化时跟随模式即时更新；邮件正文和写信源码预览同步适配明暗主题，深色正文使用与邮件信息栏一致的应用背景，同时保留作者品牌色、背景图与正文图片。

0.1.27 Alpha 于 2026-10-24 10:36:00（Asia/Shanghai）正式发布为 latest，固定源码 `f176bfe4fab0a64380fc1b54ea94c9670e4277b6`。[Release macOS 40053508877](https://github.com/ansermail/anser/actions/runs/40053508877)、[Checks 40053489470](https://github.com/ansermail/anser/actions/runs/40053489470) 与 [Preview Pages 40053489611](https://github.com/ansermail/anser/actions/runs/40053489611) 全部成功，[0.1.27 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.27) 已公开。

七资源大小/SHA-256、既有更新公钥与双架构更新签名、固定代码签名及精确 DR、App 版本/架构/标识/最低系统版本/语言/邮件格式关联/许可、DMG 与更新归档内容、匿名公开下载及标准 latest 更新端点均核验通过。[Homebrew 40054843111](https://github.com/ansermail/anser/actions/runs/40054843111) 成功，[配方提交 4590879](https://github.com/ansermail/anser/commit/4590879646fbde33fa87db931263a311b49d2b81) 仅更新 `Casks/anser.rb`；两架构摘要与公开 DMG 一致，重复运行 [40054930237](https://github.com/ansermail/anser/actions/runs/40054930237) 返回 `Cask is already current; no commit needed.`。

本轮本地完整门槛为前端 63 文件 425 项、Rust 421 通过/3 项既有条件忽略、桌面脚本 36 项、IMAP 39 项，TypeScript、UI、1,338 条双语键、Prettier、Rust fmt、生产构建、Pages 构建、发布资源检查及 diff 检查均通过。正式安装后的默认双击/冷启动、应用内原位升级与 Intel 实机运行仍未验证，不以构建和产物审计代替。完整说明见 [0.1.27](releases/v0.1.27.md)，证据见 [发布工作点](RELEASE_0_1_27_WORKING.md)。

## 前一正式版本：0.1.26（2026-10-23）

0.1.26 Alpha 于 2026-10-23 17:44:15（Asia/Shanghai）正式发布为 latest，固定源码 `f48904ce35eb3c29cb56a9111c14ac0f6542bbef`。[Release macOS 39921639505](https://github.com/ansermail/anser/actions/runs/39921639505)、[Checks 39921639584](https://github.com/ansermail/anser/actions/runs/39921639584) 与 [Preview Pages 39921639544](https://github.com/ansermail/anser/actions/runs/39921639544) 全部成功，[0.1.26 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.26) 已公开。

本版优化设置页整体左对齐网格并扩充为六类导航（新增「阅读与写信」承载邮件签名与大模型翻译），将「应用偏好」改为单列整行卡片，「邮件签名」改为顶部工具栏 + 中部 1:1 等宽等高一致圆角编辑/实时预览 + 底部保存按钮与状态 Badge；在搜索栏旁「邮件筛选」中新增默认勾选的「过滤已发送邮件」；修复左侧导航与按钮右键点击出现黑底字符选中的问题，并在开发预览复验腾讯企业邮箱与 QQ 邮箱双向 IMAP IDLE 实时推送收取（SMTP 确认后 2.95s 与 4.67s 触发「服务器实时通知」）。

七资源长度/SHA-256、既有更新公钥和双架构更新签名、固定代码签名及精确 DR、App 版本/架构/标识/语言/EML/许可/原生 OAuth 编译配置、DMG 与更新归档内容、匿名公开下载与标准 latest 更新端点均核验通过。[Homebrew 39934030738](https://github.com/ansermail/anser/actions/runs/39934030738) 已成功，[配方提交 ec205ab](https://github.com/ansermail/anser/commit/ec205ab89a1cdc36fecb78b740df02312e9f1398) 仅修改主仓库 `Casks/anser.rb`；两架构摘要与公开资源一致，重复运行 [39935459365](https://github.com/ansermail/anser/actions/runs/39935459365) 核验幂等。

本轮本地完整门槛为前端 399（59 文件）、桌面脚本 35、Rust 394 通过/3 项既有忽略、IMAP 39，格式/版本/1226 双语键/生产构建/Pages 隔离均通过。系统通知真实横幅点击、正式安装/原位升级、Intel 实机仍未复验，不以构建和静态产物代替。完整说明见 [0.1.26](releases/v0.1.26.md)，证据见 [发布工作点](RELEASE_0_1_26_WORKING.md)。

## 前一正式版本：0.1.25（2026-10-22）

0.1.25 Alpha 于 2026-10-22 11:29:39（Asia/Shanghai）正式发布为 latest，固定源码 `6d965c3e1f37a83e130969e726c503572fb6fdc5`。[Release macOS 39715043732](https://github.com/ansermail/anser/actions/runs/39715043732)、[Checks 39715044036](https://github.com/ansermail/anser/actions/runs/39715044036) 与 [Pages 39715044018](https://github.com/ansermail/anser/actions/runs/39715044018) 全部成功，[0.1.25 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.25) 已公开。

修复通知重复点击时保留旧阅读位置、长对话打开后的邮件错位及 WebKit 异步布局滚动误判；所选单封从开头显示，用户开始浏览后不抢回位置。顶部邮件信息与底部简短回复固定，正文提供常驻可拖动滑块；列表对话数量改为清晰的 Badge。

七资源长度/SHA-256、既有更新公钥和双架构更新签名、固定代码签名及精确 DR、App 版本/架构/标识/语言/EML/许可/原生 OAuth 编译配置、DMG 与更新归档内容、匿名公开下载与标准 latest 更新端点均核验通过。[Homebrew 39717132990](https://github.com/ansermail/anser/actions/runs/39717132990) 已成功，[配方提交 132613c](https://github.com/ansermail/anser/commit/132613c27ff44c637669f5f98b02fc8250c5c96a) 仅修改主仓库 Casks/anser.rb；两架构摘要与公开资源一致，本机 style/audit/Apple Silicon fetch 通过，重复运行 [39717314552](https://github.com/ansermail/anser/actions/runs/39717314552) 成功且无多余提交。

本轮本地完整门槛为前端 397、桌面脚本 35、Rust 393 通过/3 项既有忽略、IMAP 39，格式/版本/生产构建/Pages 隔离均通过。真实 41 封对话阅读在开发预览核对；系统通知真实横幅点击、正式安装/原位升级、Intel 实机仍未复验，不以构建和静态产物代替。完整说明见 [0.1.25](releases/v0.1.25.md)，证据见 [发布工作点](RELEASE_0_1_25_WORKING.md)。

## 前一正式版本：0.1.24（2026-10-20）

0.1.24 Alpha 于 2026-10-20 19:11:12（Asia/Shanghai）正式发布为 latest，固定源码 `04391876cd605fe81b3df834e086c0bd81f0ec93`。[Release macOS 39411133657](https://github.com/ansermail/anser/actions/runs/39411133657)、[Verify macOS signing 39411123348](https://github.com/ansermail/anser/actions/runs/39411123348)、[Checks 39411123293](https://github.com/ansermail/anser/actions/runs/39411123293) 与 [Preview Pages 39411123273](https://github.com/ansermail/anser/actions/runs/39411123273) 均成功，[0.1.24 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.24) 已公开。本版修复收件箱实时推送漏检（单条 IDLE 连接独占 INBOX，QQ 与腾讯企业邮主动推送复验）、Gmail 等 OAuth 账号后台非交互钥匙串写入被拒导致整次收取判失败、写信空正文光标落在第二行、收件人/抄送/密送输入行过宽、富文本粘贴表格被摊平，以及英文界面原生托盘/通知回退中文；新增富文本字体颜色与十六进制样式输出。

七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及既有公钥、App 版本/架构/标识/中文配置/EML/许可/原生 OAuth 配置、固定证书与精确 DR、DMG 与更新归档逐文件一致性全部通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。[Homebrew 运行 39413158105](https://github.com/ansermail/anser/actions/runs/39413158105) 成功，主仓库 [配方提交 e0f05a3](https://github.com/ansermail/anser/commit/e0f05a337669d80b64d7b9c6927b5072830323df) 仅更新 Casks/anser.rb；重复核验 [39413252399](https://github.com/ansermail/anser/actions/runs/39413252399) 成功并返回 `Cask is already current; no commit needed.`。配方与两架构公开 DMG 摘要一致。

本次本地门槛：前端 395 通过（58 文件）、Rust 393 通过/3 项既有条件忽略、桌面脚本 35、IMAP 39，格式/UI/1218 文案键/生产构建/发布资源/diff 检查通过。本版正式包实际安装、应用内原位升级、Intel 实机、系统通知横幅、托盘实际点击、Gmail 交互重写与外部代理/睡眠弱网未验证，不沿用此前版本结果。自签名不等于 Apple Developer ID、公证或 Gatekeeper 认可。完整说明见 [0.1.24](releases/v0.1.24.md)，证据见 [发布工作点](RELEASE_0_1_24_WORKING.md)。

## 前一正式版本：0.1.23（2026-10-20）

0.1.23 Alpha 于 2026-10-20 11:19:48（Asia/Shanghai）正式发布为 latest，固定源码 `6fb7d55c3cfb2167a860efbf5cc65de4e41ea1ef`。[Release macOS 39362486985](https://github.com/ansermail/anser/actions/runs/39362486985)、[Checks 39362479797](https://github.com/ansermail/anser/actions/runs/39362479797) 与 [Pages 39362479801](https://github.com/ansermail/anser/actions/runs/39362479801) 均成功，[0.1.23 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.23) 已公开。

支持简体中文/English 切换，1196 条界面文案与语言选项由 JSON 配置维护；语言独立持久化，切换保留未保存输入，日期/日历和菜单/通知固定提示同步。语言标签和 160px 下拉框同行显示。邮件原文、账号/自建目录名称、历史诊断和发布说明保持原文。

双架构七资源、更新签名/固定代码签名身份、App/DMG、语言声明/EML/许可与原生 OAuth 编译配置、匿名公开资源及标准 latest 更新端点均已核验。[Homebrew 运行 39363711322](https://github.com/ansermail/anser/actions/runs/39363711322) 成功，主仓库 [配方提交 43b96d6](https://github.com/ansermail/anser/commit/43b96d67dd1578401e9065674fec116b23c6e93d) 仅更新 Casks/anser.rb；重复核验 [39363835908](https://github.com/ansermail/anser/actions/runs/39363835908) 成功并返回 `Cask is already current; no commit needed.`。配方与两架构公开 DMG 摘要一致，本机 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。

原生托盘实际点击、系统通知横幅、系统文件/打印面板、正式包安装与应用内原位升级、Intel 实机未验证。自签名和更新归档签名不等同于 Apple Developer ID、公证或 Gatekeeper 认可。 详细验证与源码记录见 [发布工作点](RELEASE_0_1_23_WORKING.md)，完整版本说明见 [0.1.23](releases/v0.1.23.md)。

## 前一正式版本：0.1.21（2026-10-18）

0.1.21 Alpha 于 2026-10-18 11:14:23（Asia/Shanghai）正式发布为 latest，固定源码 `1229985020909b8eccbd4d5343c4cbd0a2913a8b`。[Release macOS 39090575840](https://github.com/ansermail/anser/actions/runs/39090575840)、[Checks 39090571461](https://github.com/ansermail/anser/actions/runs/39090571461) 与 [Preview Pages 39090571453](https://github.com/ansermail/anser/actions/runs/39090571453) 全部成功，[0.1.21 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.21) 已公开。本版将设置整理为五类导航并适配窗口宽度，分类切换保留未保存输入；后台任务支持点击标题或说明展开，手动刷新提供旋转、忙碌文字、防重复点击和失败恢复。

七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及既有公钥、App 版本/架构/标识/中文配置/EML/许可/原生 OAuth 配置、固定证书与精确 DR、DMG 与更新归档逐文件一致性全部通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。主仓库 [配方提交 1c85297](https://github.com/ansermail/anser/commit/1c852970a9c1686a72b0daca8caf1fb30f4c5f6a) 由 Homebrew 流水线生成，公开两架构 DMG 摘要、brew style/audit/fetch 与重复运行幂等均通过；未覆盖安装本机应用。

本次本地完整门槛：前端 388 通过（56 文件）、Rust 389 通过/3 项既有条件忽略、桌面脚本 35、IMAP 39，格式/UI/生产/Pages 隔离/版本/发布资源/diff 检查通过。本版正式包实际安装、应用内原位升级、Intel 实机、原生窄窗口/深色完整矩阵、系统通知横幅与真实服务器规则执行未验证，不沿用此前版本结果。自签名不等于 Apple Developer ID、公证或 Gatekeeper 认可。完整说明见 [0.1.21](releases/v0.1.21.md)，证据见 [发布工作点](RELEASE_0_1_21_WORKING.md)。

## Homebrew 配方随主仓库维护（2026-10-17）

配方位于 `Casks/anser.rb`，正式 Release 公开为 latest 后由 `homebrew.yml` 下载并核验双架构 DMG，运行 Homebrew 校验后仅更新主仓库配方。继续使用 `ansermail/tap/anser` 名称，首次添加需指定主仓库 URL，旧 Tap 切换步骤见 [Homebrew 维护](HOMEBREW.md)。不需要跨仓库凭据；工作流手动补同步不重建或改写已发布桌面资源。`GITHUB_TOKEN` 发布不会触发后续 release 事件，须显式 dispatch。迁移与实际验证进展见 [工作点](HOMEBREW_WORKING.md)。

## 前一正式版本：0.1.20（2026-10-17）

0.1.20 Alpha 于 2026-10-17 13:57:05（Asia/Shanghai）正式发布为 latest，固定源码 `eb80fa4a26909ec5f86427f86a4e66af7c71fb54`。[Release macOS 39007442860](https://github.com/ansermail/anser/actions/runs/39007442860)、[Checks 39007442979](https://github.com/ansermail/anser/actions/runs/39007442979) 与 [Preview Pages 39007442854](https://github.com/ansermail/anser/actions/runs/39007442854) 全部成功，[0.1.20 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.20) 已公开。本版包含已发送邮件新建可编辑草稿、8 秒发送撤回、紧凑发送记录与草稿、顺序多动作规则、抄送/优先级/已接收天数等条件，以及统一的“全部邮件”未读、菜单栏和 Dock 角标。

七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及既有公钥、App 版本/架构/标识/中文配置/EML/许可/原生 OAuth 配置、固定证书与精确 DR、DMG 与更新归档逐文件一致性全部通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。 [Tap 4db8165](https://github.com/ansermail/homebrew-tap/commit/4db8165d2a553080365b4f8cacb80c8912137c25) 已公开，配方、公开两架构 DMG 摘要及 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。

本次本地完整门槛：前端 381 通过（55 文件）、Rust 389 通过/3 项既有条件忽略、桌面脚本 28、IMAP 39，格式/UI/生产/版本/发布资源/diff 检查通过。 本版正式包实际安装、应用内原位升级、Intel 实机、系统通知横幅与服务器规则动作端到端执行未验证，不沿用此前版本结果。自签名不等于 Apple Developer ID、公证或 Gatekeeper 认可；不修改用户系统信任或 quarantine。 完整说明见 [0.1.20](releases/v0.1.20.md)，证据见 [发布工作点](RELEASE_0_1_20_WORKING.md)。

## 前一正式版本：0.1.19（2026-10-16）

0.1.19 Alpha 于 2026-10-16 15:55:41（Asia/Shanghai）正式发布为 latest，固定源码 `037d7aaaa8a2104236af3bd1675e8dd830afb5ee`。[Release macOS 38869273847](https://github.com/ansermail/anser/actions/runs/38869273847)、[Checks 38869273770](https://github.com/ansermail/anser/actions/runs/38869273770)、[Pages 38869273892](https://github.com/ansermail/anser/actions/runs/38869273892) 全部成功，[0.1.19 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.19) 已公开。包含正文图片通用状态修复、跨版本完整更新说明、统一钥匙串与本地/云端一致的固定免费项目签名。

七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及既有公钥、App 版本/架构/标识/中文配置/EML/许可/原生 OAuth 配置、固定证书与精确 DR、DMG 与更新归档逐文件一致性全部通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。 [Tap 18a6820](https://github.com/ansermail/homebrew-tap/commit/18a6820f2385e340ce094b202b172ddf1e5fa7f0) 已公开，配方/公开两架构 DMG 摘要及 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。

本次本地完整门槛：前端 363、Rust 368 通过/3 忽略、桌面脚本 28、IMAP 39，格式/UI/生产/Pages 隔离/版本/diff/隐私通过。本机 Rust 1.91.1，与 CI 一致。 本版正式包实际安装/应用内原位升级、Intel 实机及系统拒绝/锁定矩阵未执行，不沿用此前版本结果。自签名不等于 Apple Developer ID、公证或 Gatekeeper 认可；不修改用户系统信任或 quarantine。 完整说明见 [0.1.19](releases/v0.1.19.md)，证据见 [发布工作点](RELEASE_0_1_19_WORKING.md)。

## 前一正式版本：0.1.18（2026-10-16）

0.1.18 Alpha 于 10:16:28（Asia/Shanghai）正式发布为 latest，固定源码 `71224095b21aefea3f59d2cc89c23a87a85fb86d`；[Release macOS 38838641843](https://github.com/ansermail/anser/actions/runs/38838641843) 的完整检查、Apple Silicon / Intel 构建与草稿任务全部成功，[Checks 38838641804](https://github.com/ansermail/anser/actions/runs/38838641804) 和同源 Pages 也成功。[正式下载](https://github.com/ansermail/anser/releases/tag/v0.1.18)。

七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及原公钥、App 版本/架构/稳定标识/中文配置/EML/许可/codesign/原生 OAuth 配置、DMG 与更新归档逐文件一致性均核验通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。

Homebrew Tap 提交 [870f4b4](https://github.com/ansermail/homebrew-tap/commit/870f4b43a48e9fc9cbd31ec9da51ed15a2147406) 已公开，配方/审计/Apple Silicon fetch 与两架构实际摘要通过；细节见 [Homebrew 维护](HOMEBREW.md)。开发预览的原邮件两批真实模型请求共 102 个片段成功；0.1.18 正式包实际安装/原位升级及 Intel 实机运行未执行，不沿用此前版本验收。保持 ad hoc 应用代码签名与项目更新签名，按用户决定不办理 Developer ID/公证。 完整记录见 [发布工作点](RELEASE_0_1_18_WORKING.md)。

## 前一正式版本：0.1.17（2026-10-15）

0.1.17 Alpha 已于 15:05:12（Asia/Shanghai）正式发布为 latest，固定源码 `7312e5c01f7e7cc4f08e8b40e14e4a2a853724c1`。[Release macOS 38695017325](https://github.com/ansermail/anser/actions/runs/38695017325) 的完整检查、Apple Silicon / Intel 构建与草稿任务全部成功；[v0.1.17 下载页](https://github.com/ansermail/anser/releases/tag/v0.1.17)。包含逐段双语翻译、兼容模型配置/切换/连接与最近活动、原按钮内双语、正文图片/CSS/字体全局代理、透明占位图误报修复与中文打印面板。

七资源大小/摘要、说明与清单完整原文、既有更新公钥及两架构更新签名、App 版本/架构/标识/中文配置/EML/许可/代码签名/原生 OAuth 配置、DMG 与更新归档逐文件一致性均已核验。发布前后资源身份与标签不变，七份公开下载逐字节匹配，标准 latest 更新端点也逐字节匹配。公开包使用既有 ad hoc 应用签名与项目更新签名；按用户决定不办理 Developer ID/公证。0.1.17 实际安装/原位升级与 Intel 实机运行未执行，不沿用此前版本验收。

独立 Checks 首次运行有两项既有 205 封分页集成测试超过默认 5 秒；统一整组有界 15 秒期限后，测试修复 `bc383b4026ea39334e3d68fc0755ab8c30ff52ab` 的 [新 Checks 38695703813](https://github.com/ansermail/anser/actions/runs/38695703813) 与 [Pages 38695703836](https://github.com/ansermail/anser/actions/runs/38695703836) 全部成功。测试修复不改变正式包业务代码，不移动发布标签。完整证据与 Homebrew 同步结果见 [发布工作点](RELEASE_0_1_17_WORKING.md)。

## Homebrew 首次分发记录（2026-10-15）

项目自有 [ansermail/homebrew-tap](https://github.com/ansermail/homebrew-tap) 已公开，可运行 `brew install --cask ansermail/tap/anser`。首次配方复用已发布的 0.1.16 双架构 DMG，没有修改已发布标签、资源或更新清单。后续正式版本发布并核验后，需要同步 Tap 的版本与两架构 SHA-256；具体步骤及验证范围见 [Homebrew 分发说明](HOMEBREW.md)。首次增加渠道时未新增桌面版本或改写原发布说明；0.1.17 配方曾在正式发布后同步，结果见上方工作点及 Homebrew 文档。

## 前一正式版本：0.1.16（2026-10-14）

0.1.16 Alpha 已于 18:16:42（Asia/Shanghai）正式发布为 latest。固定源码 `8a13673a5bdd0cc8f13f976956f84e035e64ec61` 经 [Release macOS 38547036796](https://github.com/ansermail/anser/actions/runs/38547036796) 完整检查、Apple Silicon / Intel 构建和草稿任务成功；[v0.1.16 下载页](https://github.com/ansermail/anser/releases/tag/v0.1.16)。七资源大小/摘要、两架构更新签名与公钥、App 版本/架构/标识/codesign/许可/EML/OAuth 原生配置及 DMG 与归档逐文件一致性已核验；发布前后草稿说明与资源身份不变，标签指向固定源码，七份按版本公开下载资源逐字节匹配。标准 latest 端点经短暂 CDN 缓存后也已逐字节匹配审计清单，见 [发布工作点](RELEASE_0_1_16_WORKING.md)。2026-10-14 用户反馈真实代理收发及正式包原位升级已验证通过；OAuth 刷新仍待单独验收。用户决定不办理付费 Developer ID/公证，沿用项目自有更新签名；当前公开应用包采用 ad hoc 代码签名，自签固定应用身份尚未接入或验收。

## 0.1.16 修复准备记录（历史）

0.1.15 发布后发现邮件正文外链在桌面版被 CSP `frame-src` 拦截。0.1.16 使用新的 Anser 内部路由并修复用户点击的原生导航，五处版本及说明见 [v0.1.16](releases/v0.1.16.md)。本地/云端门槛、草稿审计及正式发布进展见 [0.1.16 发布工作点](RELEASE_0_1_16_WORKING.md)；准备时公开 latest 为 0.1.15，正式结果见上方。

## 前一正式版本：0.1.15（2026-10-14）

0.1.15 Alpha 已于 12:35:05（Asia/Shanghai）正式发布为 latest。固定源码 `63fb6c25e62506a790b61532127199251f701f5d`，[Release macOS 38510852394](https://github.com/ansermail/anser/actions/runs/38510852394) 的检查、双架构与草稿任务全部成功；[下载页](https://github.com/ansermail/anser/releases/tag/v0.1.15)。七资源元数据/摘要、更新签名、公钥、App 版本/架构/标识/codesign/许可/EML/OAuth 原生配置、两份 DMG 与归档一致性及公开 latest 清单已核验。真实代理收发/OAuth 刷新和正式原位升级未验收；本版邮件正文链接存在 CSP 拦截，见上方修复准备及 [发布工作点](RELEASE_015_WORKING.md)。Apple Developer ID 签名与公证未完成。

## 0.1.15 发布准备记录（历史）

用户已要求提交全局网络代理改动并启动组织仓库远程发版。候选 0.1.15 同步五处版本，说明见 [v0.1.15](releases/v0.1.15.md)；本地门槛、固定源码、双架构构建、资源审计及正式发布按 [0.1.15 发布工作点](RELEASE_015_WORKING.md) 分别记录。当时公开 latest 为 0.1.14；后续正式结果见上方。真实代理收发与 OAuth 刷新、正式原位升级和 Apple Developer ID/公证尚未验收。

## 前一正式版本：0.1.14（2026-10-13）

0.1.14 Alpha已于2026-10-13 20:14:21（Asia/Shanghai）正式发布为latest。固定源码`f1921c2cb9704b6641bb255be86c579b8b4ed542`，[Release macOS 38391912165](https://github.com/ansermail/anser/actions/runs/38391912165)的check、Apple Silicon、Intel与draft全部成功；[v0.1.14下载页](https://github.com/ansermail/anser/releases/tag/v0.1.14)。本机/云端290前端、321Rust通过（1独立性能项忽略）、30脚本、39IMAP与格式/UI/生产检查通过。七资源摘要/大小、更新签名、公钥、App版本/架构/标识/codesign/许可/EML及原生OAuth配置、DMG与归档全部8文件一致性核验通过；草稿发布前后说明和资源不变，标签指向固定源码，匿名标准更新清单逐字节等于审计清单，两架构四份安装/更新文件公开下载字节一致。正式包实际安装/原位升级与Developer ID/公证仍独立未完成，详情见[发布工作点](RELEASE_014_WORKING.md)。

## 0.1.14 发布准备记录（2026-10-13，历史）

用户已要求提交本地修复并远程发版，五处版本同步0.1.14。范围为邮件打印权限、账号侧栏背景/间距/稳定宽度、服务商目录分组与加载、草稿清空、macOS通知定位、正文图片超时及隐藏统计像素误提示、正文原生调试。说明见[v0.1.14](releases/v0.1.14.md)，全量门槛/固定源码/双架构构建/资源审计/正式发布分开记录于[发布工作点](RELEASE_014_WORKING.md)。当前公开latest仍0.1.13，Developer ID/公证及原位升级未完成。

## 前一正式版本：0.1.13（2026-10-13）

0.1.13 Alpha 已于 2026-10-13 10:02:13（Asia/Shanghai）正式发布为 latest。固定源码 `887e297859938b640fd51104690f8be8c66a53f0`，组织 [Release macOS 流水线](https://github.com/ansermail/anser/actions/runs/38334231416) 的 check、Apple Silicon、Intel 和 draft 全部成功；[v0.1.13 下载页](https://github.com/ansermail/anser/releases/tag/v0.1.13)。本机 262 前端、310 Rust（1 独立性能项忽略）、28 桌面脚本、39 IMAP 及 UI/格式/生产/Pages 构建通过；云端全量检查通过。七资源大小/SHA-256、两架构更新签名、公钥、App 版本/架构/标识/完整 codesign/许可/EML 与原生 OAuth 配置均已核验；两份 DMG 的全部 8 个 App 文件逐个匹配更新归档。草稿发布前后说明原文及七资源 ID/大小/摘要不变，标签指向固定源码；匿名公开标准更新端点逐字节匹配已审计清单，四份公开安装/更新资源与审计资源逐字节一致。实际安装、原位升级、真实邮箱目录批量已读和 macOS 系统打印仍待用户下载验收；Apple Developer ID 签名/公证未完成。详情见 [0.1.13 发布工作点](RELEASE_013_WORKING.md)。

## 0.1.13 候选准备记录（2026-10-13）

用户要求将本地目录修复与新增的单封邮件打印经组织仓库远程双架构流水线发布 0.1.13。五处版本已同步，说明见 [v0.1.13](releases/v0.1.13.md)。当时公开 latest 仍为 0.1.12；本机全量门槛、远程构建、资源审计和正式发布分别按 [0.1.13 发布工作点](RELEASE_013_WORKING.md) 记录，后续结果见上方正式发布。

初版源码 `4c52035` 推送后曾触发 [Release macOS 38333548322](https://github.com/ansermail/anser/actions/runs/38333548322)，用户随即补充所有账号文件夹右键标记已读要求；该运行已在检查阶段取消，未生成草稿。补充功能随后从新固定源码重新运行，旧候选没有发布。

## 前一正式版本：0.1.12（2026-10-12）

0.1.12 Alpha 已于 2026-10-12 15:38:33（Asia/Shanghai）正式发布为 latest。源码 `996738d82f5e55af5f0dddb13ddba9a5248a9d05`，组织 [Release macOS 流水线](https://github.com/ansermail/anser/actions/runs/38217856007) 的 check、Apple Silicon、Intel 和 draft 全部成功；[v0.1.12 下载页](https://github.com/ansermail/anser/releases/tag/v0.1.12)。本机255前端、307Rust（1独立性能项忽略）、28桌面脚本、39 IMAP及 UI/格式/生产/Pages构建通过；远程检查与双架构完成。七资源大小/SHA-256、两架构更新签名、App版本/架构/稳定标识/完整codesign/许可/EML、原生OAuth编译配置及DMG与归档逐文件一致均已核验。标签指向固定源码，发布前后草稿说明及资源ID/摘要未变；匿名标准更新端点已逐字节匹配新清单，两架构安装包和更新归档公开下载字节一致。实际安装、原位升级及完整富文本真实互发尚待用户下载后验收；Apple Developer ID 签名/公证仍未完成。详情见 [0.1.12 发布工作点](RELEASE_012_WORKING.md)。

## 0.1.12 候选准备记录（2026-10-12）

用户已授权提交当前富文本/正文图片及更新说明修复并通过组织仓库远程流水线发布 0.1.12，供下载测试。五处版本已同步，说明见 [v0.1.12](releases/v0.1.12.md)。本机 255 项前端、307 项 Rust（1独立性能项忽略）、28 项桌面脚本、39 项 IMAP 解析器、UI/格式/生产与 Pages 构建通过；远程双架构、资源审计和正式发布分开记录在 [工作点](RELEASE_012_WORKING.md)。真实富文本互发/草稿重开与正式原位升级仍待独立验收。

## 更早正式版本：0.1.11（2026-10-12）

0.1.11 Alpha 已于 2026-10-12 08:55:48（Asia/Shanghai）正式发布为 latest。源码 `652fad54779f330767b251b7acc23914ecdd29f4` 已合入组织 main；[Release38189306087](https://github.com/ansermail/anser/actions/runs/38189306087) 全量检查/双架构/draft 成功，[下载版本](https://github.com/ansermail/anser/releases/tag/v0.1.11)。本次云端 241 前端、305 Rust（1独立性能项忽略）、28桌面脚本、39 IMAP 及格式/UI/生产构建通过。七资源尺寸/摘要、完整说明/清单、更新签名、公钥、App 版本/架构/稳定标识/EML/许可/codesign/原生OAuth、DMG全部8文件与归档一致性已重新核验。发布前后资源未替换，标签指向固定源码，匿名标准更新端点逐字节等于本次清单，两架构更新包匿名下载字节一致、DMG HTTP200。首次公开查询短暂缓存0.1.10，随后标准端点已确认0.1.11；实际安装/原位升级未验证，Apple Developer ID/公证未完成。

## 前一发布准备（2026-10-12）

用户授权正式发布 0.1.11，完成开发阶段合入 main，固定新源由组织 GitHub 流水线重新构建。七资源与公开更新端点核验完成后再记录正式发布；当前公开仍为 0.1.10。接续 RELEASE_011_WORKING.md，安装/原位升级独立待验收。

## 前一候选构建（2026-10-11）

0.1.11最新候选为fdc1049 / [Release38150754149](https://github.com/ansermail/anser/actions/runs/38150754149)，check/双架构/draft与新源七资源、更新/App签名、DMG、版本/标识/EML/许可/原生OAuth配置核验完成；草稿目标与说明、资源及匿名公开latest核对后不变，正式仍0.1.10。包含附件/快捷操作、筛选日期/层级、Status表头和草稿源码/说明保护；五项原生组合、标记恢复、计划取消与双向收件附件字节通过，用户确认系统拖入。复杂焦点/拖拽边界及大附件故障、安装/原位升级仍独立待验收；尚未正式合入main或发布，详情 RELEASE_011_WORKING.md。

## 用户流程

正式应用启动后自动检查更新，之后每 6 小时再检查。只有检测到新版本才在“本地优先”前显示更新图标。设置与账号中的“关于与更新”始终提供手动检查。

点击更新图标 → 查看版本与发布说明 → 下载更新（显示进度）→ 校验签名 → 安装并重启。Tauri 更新器替换当前应用所在位置，后续无需把应用重新拖入 Applications。写信窗口打开时禁止安装；重启前等待正在进行的收取/发送完成并保存窗口状态。

更新中心将发布说明的 Markdown 渲染为标题、列表、代码、表格和链接；渲染前净化 HTML，只允许安全的外部链接和 HTTPS 图片。桌面版点击链接通过系统默认浏览器打开，失败时显示反馈。该界面改动已随 0.1.12 发布；已发布 0.1.11 的更新清单及产物未改。

开发预览允许检查，禁止下载安装覆盖开发实例。首次安装仍需使用 DMG；旧版本如果没有更新器，需要先安装含更新器的版本。当前未有 Apple Developer ID 证书，未做签名公证；Tauri 更新签名用于校验来源，不等同于 Apple 的签名公证。更换应用代码签名身份时，钥匙串可能要求重新授权。

## 已配置的流水线

- `.github/workflows/ci.yml`：main 推送和 PR 执行前端/脚本/Rust 回归及 UI 检查和生产构建。
- `.github/workflows/release.yml`：推送 `v*` tag，或 Actions 手动运行；验证版本、发布说明和测试后，分别构建 Apple Silicon 与 Intel Mac 的 DMG、app.tar.gz 与签名。
- 构建任务只产出架构独立的 artifacts；汇总任务检查两个架构文件齐全，统一生成 latest.json 并创建草稿 Release，避免并行写清单丢失架构。
- 发布后的同版本不可覆盖。`scripts/release-draft.mjs` 对缺失/未发布/已发布状态进行明确查询；查询失败停止，不能按“缺失版本”处理。未发布草稿重建先同步完整提交 SHA 与当前说明，上传前后核对身份、版本、两架构清单/签名及精确七资源；已有轻量或附注标签必须指向该提交，否则要求新版本，不移动标签。所有发布运行串行；外部人工操作仍可能与 GitHub 请求之间竞争，构建期间不要手动发布或替换资源，正式发布前独立审计。`releases/latest/download/latest.json` 只有正式发布后才可用，客户端不读取草稿。
- 仓库是公开的 `ansermail/anser`；客户端不包含 GitHub token。端点仅 HTTPS，签名必须有效；失败时保留当前安装，不执行重启。

## Google OAuth 发布配置

组织仓库 `ansermail/anser` 使用仓库级 GitHub Secrets `MAIL_GOOGLE_CLIENT_ID` 和 `MAIL_GOOGLE_CLIENT_SECRET`。macOS 发布流水线在 Apple Silicon / Intel 构建前检查两项是否存在，并仅注入原生构建步骤；不使用公开 Repository Variables 或 `VITE_` 变量，不给 Pages / PR 检查提供凭据。

更换客户端时同步更新两项 Secrets 和被 Git 忽略的本机 `.env.local`（权限 0600），然后重新启动开发应用或构建新版本。现有安装包的编译配置不会随 Secrets 修改而变化；已发布版本不可覆盖。Google 桌面客户端的 secret 会参与原生令牌交换，无法像服务端秘密一样保密；原始 JSON、本机配置及令牌不作为独立发布文件上传。

2026-10-10 已按用户提供的新桌面客户端文件更新本机配置及上述两项仓库 Secrets。发布流水线接线已完成；新客户端的浏览器授权、令牌刷新和包含新配置的双架构发布验收需另行记录，不能沿用此前客户端的验收结果。

## Microsoft OAuth 发布配置

组织仓库 Secret `MAIL_MICROSOFT_CLIENT_ID` 保存产品自有公共桌面客户端的 ID。Apple Silicon / Intel Release 原生构建先检查配置存在，再注入 Rust 编译环境；不进入 Pages/PR 环境或 `VITE_` 变量，不使用微软客户端密钥。修改 Secret 不会更新已经发布的安装包，需要在后续新版本云端构建中纳入，不能覆盖已发布资源。

2026-10-10 已完成应用注册、移动和桌面平台回调及 IMAP/POP/SMTP/离线访问委托权限声明；本机忽略配置与仓库 Secret 已同步。开发版授权和 IMAP 连接验证通过，个人账号误用企业发件配置时 SMTP 返回 535，尚需实际 Outlook 地址重测；真实收发/刷新、企业管理员批准和发布者验证未完成。含微软配置的双架构包构建与正式发布另行记录。

## 签名密钥

本机更新密钥在 `~/.config/yanxin-release/updater.key`，权限 0600，公钥已写入 Tauri 配置。私钥已上传仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`，没有提交到 Git 或写进日志。密钥没有密码，流水线明确使用空密码；应保管仓库外的密钥备份，后续版本复用同一密钥，不能重新生成替换已部署应用的公钥。

换开发机时恢复原密钥和 `.pub` 文件，然后运行 `npm run release:secrets`。脚本先验证公钥匹配和 GitHub 登录，只通过 stdin 上传密钥。

## 下次发布

1. 同步修改 package.json、package-lock.json（npm install --package-lock-only）、src-tauri/Cargo.toml、Cargo.lock 和 tauri.conf.json 的版本。
2. 写 `docs/releases/v版本.md`，运行 `npm run release:check` 和回归，提交并推送。
3. 推送对应 `v版本` tag，或者运行 `gh workflow run release.yml --ref main`。
4. 等待两架构构建和草稿生成，核验 DMG、app.tar.gz、sig、latest.json 和版本说明；再发布草稿。当前仍属于 Alpha，不代表开发计划全部完成。
5. 用含更新器的旧正式版检查新版本、下载安装并重启，确认账号、本地存档、窗口及新版本号。

## 验收记录

本地 120 项前端、170 项 Rust、13 项脚本回归及 UI/TypeScript/生产构建通过。前端覆盖无更新隐藏、有更新展示、下载先于安装、签名失败不安装、重复检查保护、重启失败只重启不重复安装、写信中阻止安装和开发预览保护。真实 GitHub Actions 构建和正式安装升级的结果以开发检查点记录为准，不能把模拟交互测试计为真实升级验收。

## 0.1.1 修复

0.1.0 首次 CI 包缺完整应用签名，虽更新归档签名有效，仍未通过 codesign 验证，已撤出稳定 latest。0.1.1 使用官方支持的 ad-hoc 完整应用签名并在 CI 强制验证 CodeResources/codesign；仍不是 Apple Developer ID 公证。

同版本已发布时，流水线提前跳过构建，不再把 tag push 的重复触发计为发布失败。升级版本同步更新 npm/Tauri/Cargo，页面从实际运行的 native 应用获取版本，不读取更新服务器版本来冒充已安装版本。格式检查已加入 CI，Rust 1.91.1 与本机验证一致；解析器兼容修改保留独立回归。

## 0.1.2 启动恢复

正常启动和更新重启完成时，在 Ready 事件主动显示主窗口，避免新进程启动但窗口不可见。--autostart 保持后台启动。最近活动记录启动版本和实际窗口可见状态；完整原位升级验收结果以 DEVELOPMENT_STATUS.md 为准。

## 0.1.2 验收结果

双架构流水线、发布文件/清单及签名验证通过，0.1.2 已作为 latest 发布。从实际 GitHub 0.1.1 包完成应用内下载、原位替换和新进程启动；新二进制与 GitHub 包逐字节一致，启动日志记录主窗口已显示，账号与存档保留。自动重启后工具不能读取窗口；另行正常打开同一更新后的包确认 0.1.2/Alpha，具体限制和待办保留在开发检查点。不能把正常重新打开视为自动重启时的视觉验收。

## 0.1.3 发布范围

0.1.3 包含已验收的收取优化、补存、保存引导和此前阅读/服务器操作功能，仍为 Alpha。正在开发的异步规则扩展另存分支，没有进入这个版本；本机 Google OAuth 测试配置也不进入公开包。发布说明见 docs/releases/v0.1.3.md，发布与原位升级的实际验收状态见 DEVELOPMENT_STATUS.md。

## Anser 与组织仓库迁移

项目英文名为 Anser，中文名为雁信。后续代码和发布使用 ansermail/anser，安装包以 Anser_版本_架构命名。0.1.5 发布的更新器与发布页使用组织仓库。

存储/钥匙串标识 dev.maildesk.desktop、已有布局/草稿格式标记和更新公钥继续保留。发布密钥仍沿用 ~/.config/yanxin-release/updater.key，避免生成另一把密钥导致旧客户端不能验证更新；开发签名优先读取 ANSER_DEV_SIGNING_IDENTITY，也兼容此前变量名。

个人仓库中已构建的 0.1.3 草稿没有发布。旧安装包仍请求旧仓库的更新端点；代码克隆不会产生 GitHub 转移重定向。需要一次迁移更新或安装组织版后，客户端才改用新端点。删除个人仓库前先完成这一步。

## 组织版 0.1.5 发布结果

v0.1.5 已在 ansermail/anser 正式发布为 latest。Checks 与 Release macOS 全部通过，Apple Silicon 与 Intel 的 DMG、更新归档、签名和统一清单均核验。公开 latest 端点已可读取；应用标识与更新公钥沿用原值。详细运行、签名和存档证据见 DEVELOPMENT_STATUS.md。

旧个人仓库地址不会因克隆自动重定向；旧安装包迁移和新正式包原位更新矩阵仍待验收，不以开发实例显示新版本代替。

## 独立界面预览

公开地址为 https://ansermail.github.io/anser/ 。组织仓库 Pages 使用 GitHub Actions 发布源，`.github/workflows/preview.yml` 在 main 的前端相关变更后构建并部署，也支持手动启动。`npm run build:preview` 生成 `dist-preview`，仅包含虚构示例与展示组件，不包含真实账号连接、桌面命令或发信接口。

本地检查可运行 `npx vite preview --mode preview --host 127.0.0.1 --port 4174`，访问 `http://127.0.0.1:4174/anser/`。Pages 发布与桌面 Release 独立；网页部署成功不表示新版桌面包已发布。

## 0.1.6 云端发布结果

0.1.6 使用组织仓库 GitHub Actions 双架构流水线，包含邮件签名、存档保存位置、设置/写信体验与 EML 文件查看；版本同步五处，发布说明见 [v0.1.6](releases/v0.1.6.md)。本机只执行门槛检查，不提供本地桌面构建作为本次交付。源码 e8e049d，[双架构流水线](https://github.com/ansermail/anser/actions/runs/37940050741) 全部成功。2026-10-09 22:13:59（Asia/Shanghai）[v0.1.6](https://github.com/ansermail/anser/releases/tag/v0.1.6) 已发布为 latest；七个资源 SHA-256、架构/版本/EML 声明、完整 codesign、DMG/更新包二进制及更新签名已核验，公开 latest.json 与验证清单相同。实际正式安装、默认 EML/冷启动与原位升级未在本轮执行，详见 [发布记录](RELEASE_016_WORKING.md)。

## 0.1.7 构建准备

首个持续开发节点包含 RULES-03 完整保存/在线正文核对、EML 入口简化和保存范围数量/磁盘预算。五处版本同步 0.1.7，门槛与原生只读预算检查通过；按用户要求使用组织仓库 workflow_dispatch 构建，草稿/资源/正式发布结果分别在 [工作点](RELEASE_017_WORKING.md) 记录。该准备阶段公开 latest 为 0.1.6；随后 0.1.7 已发布，见下节，开发版本不作为发布证明。

## 0.1.7 云端发布结果

[source1de47d7的Release macOS 38017514986](https://github.com/ansermail/anser/actions/runs/38017514986)双架构与草稿全部成功，核验七资源、签名、公钥、版本/架构/EML、codesign、DMG及对应二进制后，2026-10-10 10:59:30（Asia/Shanghai）[0.1.7](https://github.com/ansermail/anser/releases/tag/v0.1.7)发布为latest。匿名canonical清单逐字节匹配核验文件，更新链接两平台均HTTP200；详见[工作点](RELEASE_017_WORKING.md)。该包包含RULES-03和保存预算，不包含之后e2f7cf6的SYNC下载边界改动。正式安装与原位升级仍未执行，没有Apple Developer ID/公证。

## 0.1.8 已发布（2026-10-10）

在途收件箱只读 FETCH 可因实时通知停止；中断不保存部分原件、不清理旧来源或复用连接。纳入 e2f7cf6 的下载边界让出、项目许可资源与新 Google OAuth 编译配置；双架构构建从仓库 Secrets 注入，不改原更新密钥/标识。已从 f118cf3 完成远程 Release macOS 38033190031；15:22:16（Asia/Shanghai）发布为 latest。七项资源、更新签名、完整 codesign、许可资源、DMG/归档一致性、新 Google 编译配置及公开更新端点核验通过，详见 RELEASE_018_WORKING.md。真实繁忙/睡眠/其他服务商与正式原位升级仍待验收；本轮 QQ→企业邮只由定时补查观察到收件，QQ 自动已发送副本核对也有待处理项。0.1.7 产物保持不变。

## 0.1.9 构建准备（2026-10-10）

本机关键节点包含 QQ 自动副本只读核对、IDLE/NOOP 截止、跨时区排序/未读显示和 Microsoft 默认发布配置。209 前端/283 Rust/19 脚本/39 IMAP 与 UI/格式/生产/Pages 检查通过；固定源码、双架构 Actions、资源核验与正式发布持续记录 RELEASE_019_WORKING.md。当前仍以 0.1.8 为公开 latest，源码完成不等于新版已发布；真实 OAuth/升级等未执行项目继续保留。

## 0.1.9 发布结果（2026-10-10）

已从 220f4cc 远程构建并于 20:22:33（Asia/Shanghai）发布 latest：[Release macOS 38051136526](https://github.com/ansermail/anser/actions/runs/38051136526)、[Release 0.1.9](https://github.com/ansermail/anser/releases/tag/v0.1.9)。七资源/更新签名/版本架构/EML/完整 app 签名/许可/OAuth backend 编译配置、DMG 与更新包一致性、公开清单字节/固定标签/更新 URL HTTP200 全部通过。发布含 Microsoft 默认 Client ID；实际新授权/SMTP/刷新与本次原位更新仍独立待验收，不以配置装包冒充完成。详见 RELEASE_019_WORKING.md。

## 0.1.10 发布准备（2026-10-11）

搜索候选索引、两模式固定页/锚点阅读、日期/覆盖说明、无变化刷新尾页保持及统计优化完成开发分支验收，五文件版本同步。关键节点先完成全量门槛合入main，远程双架构构建后核验并发布草稿；固定源/运行/资源结果持续写RELEASE_010_WORKING.md。当前公开latest仍0.1.9，不能把开发预览或Pages成功当新版已发布。

## 0.1.10 正式发布（2026-10-11）

fa6bb6e / [Release38104135660](https://github.com/ansermail/anser/actions/runs/38104135660)双架构成功，10:16:43（Asia/Shanghai）发布[0.1.10](https://github.com/ansermail/anser/releases/tag/v0.1.10)为latest；七资源及更新/应用签名、版本架构/标识/EML/许可/OAuth默认配置、DMG与归档一致性、公开清单/固定tag/两架构URL通过。存储标识、公钥、原件未更换。开发代码/资源核验完成不代表实际原位升级，正式安装/多Mac等继续独立待验收，见RELEASE_010_WORKING.md。
