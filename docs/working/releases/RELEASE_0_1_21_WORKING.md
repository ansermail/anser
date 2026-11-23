# 0.1.21 发布工作点

更新：2026-10-18。用户已授权提交、触发远程流水线与正式发布。

## 当前状态：正式发布与 Homebrew 已完成（2026-10-18）

- 开发分支 `codex/settings-layout`，起点与组织 main 均为 `0c300cb0cd1b17c5dfa027fa140f1f36cbcd32c1`；本轮工作树修改均属设置布局与交互。
- 发布源码 `1229985020909b8eccbd4d5343c4cbd0a2913a8b` 已快进合入并推送组织 main，唯一新标签 `v0.1.21` 指向同一源码。
- [Release macOS 39090575840](https://github.com/ansermail/anser/actions/runs/39090575840)（10:44:37 成功，check、aarch64、x86_64、draft 四任务均成功）、[Checks 39090571461](https://github.com/ansermail/anser/actions/runs/39090571461)（10:39:08 成功）、[Preview Pages 39090571453](https://github.com/ansermail/anser/actions/runs/39090571453)（10:35:18 成功），均核对 headSha。
- 0.1.21 Alpha 于 2026-10-18 11:14:23（Asia/Shanghai）正式发布为 latest，[0.1.21 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.21) 已公开，目标源码与标签保持 `1229985020909b8eccbd4d5343c4cbd0a2913a8b`。
- 五处版本已同步 0.1.21，发布说明见 `docs/releases/v0.1.21.md`。
- 本机完整前端 388 项（56 文件）、Rust 389 通过/3 既有条件忽略、桌面脚本 35、IMAP 39 通过；格式/UI/生产构建/Pages 隔离/版本/diff 检查通过。实际命令为 `npm test`、`npm run test:rust`、`npm run test:desktop`、`cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`、`npm run build`、`npm run build:preview`、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check` 和 `git diff --check`。
- 已核对 23 个本轮提交文件，无凭据、数据库、原件或截图文件。
- [Homebrew 流水线 39092910712](https://github.com/ansermail/anser/actions/runs/39092910712) 已由 `release.published` 触发并成功，主仓库提交 [1c85297](https://github.com/ansermail/anser/commit/1c852970a9c1686a72b0daca8caf1fb30f4c5f6a) 仅更新 `Casks/anser.rb`；手动复核 [39092992802](https://github.com/ansermail/anser/actions/runs/39092992802) 返回 `Cask is already current; no commit needed.`，重复运行幂等。

### 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.21_aarch64.app.tar.gz` | 12372345 | `54b298bd4bdf6f1f2813399bc1f2765a8702d2e8ba4412d0c1e0c3aaba323f00` |
| `Anser_0.1.21_aarch64.app.tar.gz.sig` | 424 | `60de8fcbbc544d2e6671abde943a49f044fa85ac1785144689c707ce83c663fb` |
| `Anser_0.1.21_aarch64.dmg` | 12931608 | `2f00c8c0fe241e316404ac210a525700d5a18f5b823b800802c9d155bbfc0c32` |
| `Anser_0.1.21_x86_64.app.tar.gz` | 12981218 | `90812189cb004bcef6cd12d86db180f790e3eb36dfa5d84cfc2ce400ebe16972` |
| `Anser_0.1.21_x86_64.app.tar.gz.sig` | 424 | `6b426f963a9cf8512772919fb52a20e4b9ac3df24b012a0edfec0b281444df1d` |
| `Anser_0.1.21_x86_64.dmg` | 13643912 | `fff13d868e465d10b11f06a8234c871e571553416f344827934cc77c4dbac471` |
| `latest.json` | 2543 | `bdb08ccef62b9e9b95421722bc93ec37720bfb13bb8f5d7b8d313889a72fa541` |

### 独立审计结果

- 七份公开资源按版本匿名下载后与审计副本逐字节一致；不带查询参数的标准 latest 更新端点与已审计 `latest.json` 逐字节一致。
- 两份更新归档使用固定公钥与 minisign 独立验签，签名及 trusted comment 均通过；清单版本、完整说明（含末尾换行）、两架构 URL 与签名和草稿原文一致。
- 两包均为 0.1.21、arm64/x86_64、标识 `dev.maildesk.desktop`、简体中文区域、EML `Viewer` 声明、最低 macOS 12.0；完整 codesign/CodeResources 通过，精确 DR 为 `identifier "dev.maildesk.desktop" and certificate root = H"9bdb640cfd84667d5ea3edeb379c59c316abb4109"`。
- LICENSE、NOTICE、LICENSING.md 与 shadcn 原许可和固定源逐字节匹配。Google 密钥与 Microsoft Client ID 在原生 `auth::exchange` / `auth::client_id` 中确认；x86_64 优化后以函数内立即数分段重建，未用连续字节搜索误判；前端 `dist` 未检出对应配置。
- 两份 DMG 的 `hdiutil verify` 校验有效；逐架构只读挂载后，包内全部 8 个 app 文件的 SHA-256 与更新归档一致，核验后已卸载，未安装或启动正式包。
- Homebrew 配方版本与两架构公开 DMG 摘要一致；本机 `brew style --cask`、`brew audit --cask`、`brew fetch --cask` 通过。未覆盖安装本机应用。
- 审计记录位于仓库外 `/tmp/anser-release021-audit-20261018111137`；不输出配置值、真实邮件或凭据。

## 本版范围

设置五类导航、容器宽度适配、卡片层级与间距、分类切换输入保留；后台任务标题/说明点击展开，独立刷新旋转、忙碌文字、防重复点击和失败恢复。详细开发证据见 `SETTINGS_LAYOUT_WORKING.md`。

## 发布检查点

- [x] 本地完整前端、Rust、脚本与 IMAP 测试，格式/UI/生产/Pages 隔离/版本检查。
- [x] 聚焦提交，合入组织 main，固定唯一新标签 v0.1.21。
- [x] Release macOS、Checks 与 Pages 分别核对结果。
- [x] 七资源、说明/清单原文、两架构版本/签名/标识/中文配置/EML/许可、原生 OAuth 配置及 DMG/更新归档一致性独立核验。
- [x] 正式发布，核对匿名公开资源和标准 latest 更新端点。
- [x] 主仓库 Homebrew 流水线更新，配方、公开两架构摘要与 Homebrew 验证。
- [x] 回填固定源码、Actions、Release、资源摘要及验收边界。

## 边界

开发原生浅色账号、存档、应用偏好、后台任务已核对；1000px/1440px 虚构浏览器布局通过。本次正式包实际安装、应用内原位升级、Intel 实机、原生窄窗口/深色完整矩阵、系统通知横幅与真实服务器规则执行未验证，不沿用旧版验收。安装包与 Homebrew 下载审计不替代这些验收；自签名不等于 Apple Developer ID、公证或 Gatekeeper 认可。
