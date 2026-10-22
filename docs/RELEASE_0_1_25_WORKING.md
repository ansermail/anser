# 0.1.25 发布工作点

更新：2026-10-22。用户明确要求“提交发版”，授权完成版本、提交、云端构建、资源核验、正式发布与 Homebrew 同步。

## 当前状态：正式发布与 Homebrew 完成

- 0.1.25 Alpha 于 2026-10-22 11:29:39（Asia/Shanghai）正式发布为 latest，[公开版本](https://github.com/ansermail/anser/releases/tag/v0.1.25)。Release ID `420275414`。
- 固定源码 `6d965c3e1f37a83e130969e726c503572fb6fdc5` 已进入 main；唯一注释标签 `v0.1.25` 解引用为同一源码，发布前后未变。五处版本一致，更新公钥和应用标识保持不变。
- [Release macOS 39715043732](https://github.com/ansermail/anser/actions/runs/39715043732)、[Checks 39715044036](https://github.com/ansermail/anser/actions/runs/39715044036)、[Preview Pages 39715044018](https://github.com/ansermail/anser/actions/runs/39715044018) 全部成功。
- 本版包含通知重复点击重新定位、长对话选中邮件开头锚定、WebKit 布局滚动误判修正、固定阅读头尾、shadcn 常驻正文滚动条及数量 Badge。用户说明见 [v0.1.25](releases/v0.1.25.md)。
- [Homebrew 39717132990](https://github.com/ansermail/anser/actions/runs/39717132990) 成功，主仓库 [配方提交 132613c](https://github.com/ansermail/anser/commit/132613c27ff44c637669f5f98b02fc8250c5c96a) 仅更新 Casks/anser.rb。两架构 DMG 摘要与公开资源及独立审计一致；本机 brew style/audit/Apple Silicon fetch 通过。重复核验 [39717314552](https://github.com/ansermail/anser/actions/runs/39717314552) 成功，返回 `Cask is already current; no commit needed.`，远端 main 未产生多余提交。

## 本轮实际检查

- `npm test -- --maxWorkers=2`：59 文件、397 项通过。
- `npm run test:desktop`：35 项通过。
- `npm run test:rust`：393 通过、3 项既有条件忽略；二进制与 doc-tests 也通过。
- `cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`、`npm run build:preview`（Pages 隔离）、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check`、`git diff --check` 均通过；双语配置 1219 键，保留既有大 chunk 提示。
- 云端 Checks 与 Release check 均独立通过同样的前端/桌面/Rust/IMAP、格式及生产构建；两架构 build 和 draft job 全部成功。
- 七资源长度/SHA-256 与 GitHub 元信息一致；说明原文（含末尾换行）、固定源码、Release body、latest.json 一致，两架构 URL 与签名文件一致。minisign 用既有公钥独立核验两份更新归档通过。
- 两包版本 0.1.25、arm64/x86_64、标识 `dev.maildesk.desktop`、最低 macOS 12、zh-Hans/en 声明、EML 关联与许可资源通过。固定代码签名与精确 DR 核验通过：`identifier "dev.maildesk.desktop" and certificate root = H"9bdb640cfd84667d5ea3edeb37859c316abb4109"`。
- 原生 OAuth 编译参数以本地既有配置在内存核对，不打印值；Intel 优化会将部分常量拆为指令/数据片段，已按完整值或覆盖全部字节的片段核验。首次审计的“必须连续出现”假设导致假阴性，修正核验方式后通过；没有重建或替换草稿资产。不将静态核验当作真实 OAuth 运行验收。
- 两架构 DMG 校验有效，只读挂载后的 App 全部文件和符号链接与对应更新归档一致，核验后卸载。
- 正式发布后七资源匿名公开下载与审计副本逐字节一致；标准 `/releases/latest/download/latest.json`（无查询参数）完全匹配。发布前后 asset ID/长度/摘要和标签源码均未变。
- 仓库外日志、草稿/公开下载与审计文件：`/tmp/anser-release025-PkVYqk`，结果在 `audit-summary.json`、`public-verification.json`；不提交真实邮件、凭据、数据库或截图。

## 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.25_aarch64.app.tar.gz` | 12491663 | `aaa0d969df5f6527f2fd1ef6015ede5a95a875a39576642ef203bb58b6598a88` |
| `Anser_0.1.25_aarch64.app.tar.gz.sig` | 424 | `efd3d897603233074610bba089c07697da08d461e680885ae672397dbce54088` |
| `Anser_0.1.25_aarch64.dmg` | 13060453 | `b91df94ba2b612b054b168ce51d9ef0d7e7bfed4f205d858ad704609e98a972e` |
| `Anser_0.1.25_x86_64.app.tar.gz` | 13115647 | `371488ee3a6ff99961e842c6bb99074efc2b7227b730d891ac1db0a56693bd0e` |
| `Anser_0.1.25_x86_64.app.tar.gz.sig` | 424 | `3946f9fd706b85687deb23fd8d76baf2c299af4bb897cc0cd527d172f3a64677` |
| `Anser_0.1.25_x86_64.dmg` | 13758554 | `cb9cf366cd035cfe2bb140e5b6adaabc70a0f5e98a9f9c939c6f76c9bc7d64f9` |
| `latest.json` | 3311 | `a6c61b1b17c136dde0248882dc5e4556b270c179028db7a492ad4f89e3c6453a` |

## 验收边界与后续

系统通知真实横幅点击仍未复验：开发阶段调用现有 `test_notification` 后，CUA 访问 Notification Center 返回 -10005 timeoutReached。85 项开发相关回归与真实 41 封对话阅读检查通过，详情见 [阅读工作点](READING_LAYOUT_WORKING.md)，不等同横幅点击通过。正式包安装、应用内升级与 Intel 实机未验证；项目自签名不等同 Developer ID、公证或 Gatekeeper 认可。不覆盖本机安装包，不发送真实测试邮件，不改变系统信任或代理配置。

本版代码、完整自动检查、双架构云端构建、独立产物审计、公开发布与 Homebrew 同步/幂等分别完成。后续由用户核对正式包安装/升级及系统通知真实横幅点击；发布记录提交后的 Checks 属于独立运行，不把已发布源码的通过结果移作该提交的结果。
