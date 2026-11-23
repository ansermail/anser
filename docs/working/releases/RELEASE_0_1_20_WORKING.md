# 0.1.20 发布工作点

## 当前状态：正式发布与 Homebrew 已完成（2026-10-17）

- 0.1.20 Alpha 于 2026-10-17 13:57:05（Asia/Shanghai）正式发布为 latest，固定源码 `eb80fa4a26909ec5f86427f86a4e66af7c71fb54`。[Release macOS 39007442860](https://github.com/ansermail/anser/actions/runs/39007442860)、[Checks 39007442979](https://github.com/ansermail/anser/actions/runs/39007442979) 与 [Preview Pages 39007442854](https://github.com/ansermail/anser/actions/runs/39007442854) 全部成功，[0.1.20 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.20) 已公开。本版包含已发送邮件新建可编辑草稿、8 秒发送撤回、紧凑发送记录与草稿、顺序多动作规则、抄送/优先级/已接收天数等条件，以及统一的“全部邮件”未读、菜单栏和 Dock 角标。
- 七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及既有公钥、App 版本/架构/标识/中文配置/EML/许可/原生 OAuth 配置、固定证书与精确 DR、DMG 与更新归档逐文件一致性全部通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。
- [Tap 4db8165](https://github.com/ansermail/homebrew-tap/commit/4db8165d2a553080365b4f8cacb80c8912137c25) 已公开，配方、公开两架构 DMG 摘要及 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。
- 本次本地完整门槛：前端 381 通过（55 文件）、Rust 389 通过/3 项既有条件忽略、桌面脚本 28、IMAP 39，格式/UI/生产/版本/发布资源/diff 检查通过。
- 本版正式包实际安装、应用内原位升级、Intel 实机、系统通知横幅与服务器规则动作端到端执行未验证，不沿用此前版本结果。自签名不等于 Apple Developer ID、公证或 Gatekeeper 认可；不修改用户系统信任或 quarantine。
- 审计记录位于仓库外 `/tmp/anser-release020-audit`，包含独立更新验签、App/DMG/固定 DR、原生 OAuth 函数精确引用/重建字节比较；不输出配置值或反汇编，前端资源不含本机私有配置。

### 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.20_aarch64.app.tar.gz` | 12374921 | `e57f73bfb19d49d17176c48a4c8aa88d7a45b3eecaed43dde38d5381eca73dfc` |
| `Anser_0.1.20_aarch64.app.tar.gz.sig` | 424 | `fb056eef9e78d3b9e32d5ca1763b9a1b2b07a894eb7fcef6307376fa48744c3a` |
| `Anser_0.1.20_aarch64.dmg` | 12932415 | `a261a9f63ddc2e9db911fef010fb64b60529802a054dcd7d25f37a313b081d98` |
| `Anser_0.1.20_x86_64.app.tar.gz` | 12985270 | `0d4128fc420281eb2b6ac458fb2baf40b88202e05a2684f0c9b434229dcbea12` |
| `Anser_0.1.20_x86_64.app.tar.gz.sig` | 424 | `e2f4eeb4f21020eaa0c9a4a6623f4b1094b166951eedca43eaa907d24c757016` |
| `Anser_0.1.20_x86_64.dmg` | 13647181 | `b2ffcde117e960ed5bb5147a7fa310501c377a1adc6f0043cf1ecd584e81def4` |
| `latest.json` | 3401 | `6a41c0e631198487c2089ac6958ce924d8866fcc818aed995c2aa9e3374b9c39` |

## 发布范围

- 已发送邮件新建可编辑草稿、8 秒发送撤回、立即发送、紧凑发送记录与草稿卡片。
- 顺序多动作规则、抄送/优先级/已接收天数等条件、在线邮件完整核对和解析版本 5 头部迁移。
- “全部邮件”统一未读范围、已发送/草稿排除未读、目录徽标、托盘菜单、菜单栏与 Dock 未读数字。

## 发布门槛

- [x] 本地格式、UI、前端、桌面脚本、生产构建、Rust、IMAP vendor 与版本/发布资源检查通过。
- [x] 发布提交和唯一标签 `v0.1.20` 推送组织仓库。
- [x] Release macOS 流水线完成 check、Apple Silicon / Intel 构建和草稿上传。
- [x] 七份资源身份、大小、摘要、更新签名、App/DMG 一致性及原生配置审计通过。
- [x] 正式发布为 latest，公开端点与 Homebrew 配方同步核验。
- [x] 回填源码提交、Actions、Release、资源摘要与剩余人工验收边界。

## 边界

- 系统通知横幅的系统级绘制、暂停通知在真实托盘菜单中的切换，以及服务器规则动作端到端执行仍按人工验收记录。
- 正式包的实际安装、应用内原位升级与 Intel 实机运行不沿用 0.1.19 结果。
