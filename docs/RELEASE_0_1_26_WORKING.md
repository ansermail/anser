# 0.1.26 发布工作点

更新：2026-10-23。用户明确要求“提交代码 触发流水线 发版”，授权同步版本、提交推送、触发组织仓库远程双架构流水线、核验发布资源并正式发布。

## 当前状态：正式发布与 Homebrew 同步完成

- 0.1.26 Alpha 于 2026-10-23 17:44:15（Asia/Shanghai）正式发布为 latest，[公开版本](https://github.com/ansermail/anser/releases/tag/v0.1.26)。Release ID `421594574`（`RE_kwDOVB755M4ZIQXO`）。
- 固定源码 `f48904ce35eb3c29cb56a9111c14ac0f6542bbef` 已进入 `main`；唯一注释标签 `v0.1.26` 解引用为同一源码，发布前后未变。五处版本一致，更新公钥和应用标识保持不变。
- [Release macOS 39921639505](https://github.com/ansermail/anser/actions/runs/39921639505)、[Checks 39921639584](https://github.com/ansermail/anser/actions/runs/39921639584)、[Preview Pages 39921639544](https://github.com/ansermail/anser/actions/runs/39921639544) 全部成功。
- [Homebrew 39934030738](https://github.com/ansermail/anser/actions/runs/39934030738) 已成功，主仓库 [配方提交 ec205ab](https://github.com/ansermail/anser/commit/ec205ab89a1cdc36fecb78b740df02312e9f1398) 仅更新 `Casks/anser.rb`。两架构 DMG 摘要与公开资源及独立审计一致；重复核验 [39935459365](https://github.com/ansermail/anser/actions/runs/39935459365) 成功并返回 `Cask is already current; no commit needed.`，远端 `main` 未产生多余提交。

## 本版包含内容

- 设置页取消宽屏独立居中漂移，内容区紧贴左侧分类导航固定 32px 间距左对齐，与顶部「设置与账号」标题网格对齐。
- 设置导航扩充为「邮箱账号 / 本地存档 / 应用偏好 / 阅读与写信 / 后台任务 / 关于雁信」六类；新增「阅读与写信」集中承载「邮件签名」与「大模型翻译」。
- 「应用偏好」将「界面语言」「后台检查」「系统通知与启动」「网络代理」改为从上到下的单列整行卡片，左侧标题与说明、右侧交互控件；「测试系统通知」置于通知卡片右上角，代理关闭时补充直连说明。
- 「邮件签名」改为顶部工具栏 + 中部全宽 1:1 等宽等高一致圆角编辑/实时预览 + 底部保存按钮与状态 Badge。
- 主侧栏、设置分类导航与按钮禁用文字选区并在右键时清除落入其中的选区，修复 macOS WebKit 右键出现黑底字符选中的问题。
- 搜索框旁「邮件筛选」弹层新增默认勾选的「过滤已发送邮件」（`excludeSent` / `exclude_sent`）：在「全部邮件」等综合视图下默认排除已发送邮件，取消勾选后展示（「已发送」与具体服务器文件夹视图不受影响）。
- 双向 IMAP IDLE 实时推送收取已在运行中的 `0.1.26` 开发预览复验通过：
  - `lalis@chaizhou.cn` → `ynzxj@qq.com`（`雁信联调 20261023-RT-01`，`892d2cfb-210e-42fb-86e3-6a642a09c438`）：SMTP 确认于 `2026-10-23T06:54:58.419Z`，`服务器实时通知` 于 `06:55:01.371Z`（**2.95s**）主动触发，目录阶段 **894ms** 收完。
  - `ynzxj@qq.com` → `lalis@chaizhou.cn`（`雁信联调 20261023-RT-02`，`c90a17f3-c95b-4eb8-ae7d-7fd470094351`）：SMTP 确认于 `2026-10-23T06:55:54.102Z`，`服务器实时通知` 于 `06:55:58.771Z`（**4.67s**）主动触发，目录阶段 **815ms** 收完。
  - 此前 `14:12:29` 邮件延迟系发版前 `14:11:15` 停止开发预览所致，`14:12:44` 启动 `/Applications/雁信.app` 后于 `14:12:45` 由「监听连接后补查」**740ms** 收完。

## 本轮本地全量门槛

- `npm test -- --maxWorkers=2`：59 文件、399 项通过。
- `npm run test:desktop`：35 项通过。
- `npm run test:rust`：394 通过、3 项既有条件忽略；二进制与 doc-tests 也通过。
- `cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`、`npm run build:preview`（Pages 隔离）、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check`、`git diff --check` 均通过；双语配置 1226 键。
- 云端 Checks 与 Release check 均独立通过同样的前端/桌面/Rust/IMAP、格式及生产构建；两架构 build 和 draft job 全部成功。
- 七资源长度/SHA-256 与 GitHub 元信息一致；说明原文（含末尾换行）、固定源码、Release body、`latest.json` 一致，两架构 URL 与签名文件一致。`minisign` 用既有公钥独立核验两份更新归档通过。
- 两包版本 `0.1.26`、`arm64` / `x86_64`、标识 `dev.maildesk.desktop`、最低 macOS 12、`zh-Hans` / `en` 声明、EML 关联与许可资源通过。固定代码签名与精确 DR 核验通过：`identifier "dev.maildesk.desktop" and certificate root = H"9bdb640cfd84667d5ea3edeb37859c316abb4109"`。
- 原生 OAuth 编译参数以本机既有配置在内存核对，不打印值；两架构 DMG 校验有效，只读挂载后的 App 全部文件和符号链接与对应更新归档一致，核验后卸载。
- 正式发布后七资源匿名公开下载与审计副本逐字节一致；标准 `/releases/latest/download/latest.json`（无查询参数）完全匹配。发布前后 asset ID/长度/摘要和标签源码均未变。

## 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.26_aarch64.app.tar.gz` | 12505325 | `195e3d393623cb9e9be6f1deaa1cdf115a308e57a7ff9a10937a964b0f5c8a91` |
| `Anser_0.1.26_aarch64.app.tar.gz.sig` | 424 | `0ae5dacf50b73080751c4c74dfe0d3fafcdab316db7882edb1acb3b7c2585bd9` |
| `Anser_0.1.26_aarch64.dmg` | 13073840 | `95a368af5e87b00d1c32575a34f67c1ab39d1682efda76669a77d2125712f73c` |
| `Anser_0.1.26_x86_64.app.tar.gz` | 13109742 | `cb1ba8e4c9793d777aa8d6474caff73d12de01cf12ff4e73a020b3a5ae149950` |
| `Anser_0.1.26_x86_64.app.tar.gz.sig` | 424 | `417f33e0c15e61eabbde9757f4f877abb4611c73479e10cdff6ff5acd483e016` |
| `Anser_0.1.26_x86_64.dmg` | 13754967 | `f32100be97735d3cbac46f227da1371417a48f17615e3102c820580fc447819f` |
| `latest.json` | 4326 | `3f25e8e7a38a7891994b7d32fcce872b52f56b7a1be2dfaf6476fbab58606f07` |

## 验收边界与后续

正式包实际安装与应用内原位升级、Intel 实机运行、系统通知真实横幅点击仍未复验；项目自签名不等同 Apple Developer ID、公证或 Gatekeeper 认可。本版代码、完整自动检查、双架构云端构建、独立产物审计、公开发布与 Homebrew 同步/幂等均已完成。
