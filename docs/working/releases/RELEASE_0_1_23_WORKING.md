# 0.1.23 发布工作点

更新：2026-10-20。用户已授权提交、构建与正式发布。

## 当前状态：正式发布与 Homebrew 完成

- 0.1.23 Alpha 于 2026-10-20 11:19:48（Asia/Shanghai）正式发布为 latest，固定源码 `6fb7d55c3cfb2167a860efbf5cc65de4e41ea1ef`。[Release macOS 39362486985](https://github.com/ansermail/anser/actions/runs/39362486985)、[Checks 39362479797](https://github.com/ansermail/anser/actions/runs/39362479797) 与 [Pages 39362479801](https://github.com/ansermail/anser/actions/runs/39362479801) 均成功，[0.1.23 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.23) 已公开。
- 功能提交 `0828545` 与版本核对修正 `6fb7d55` 已进入组织 main，发布标签 v0.1.23 指向固定源码；五处版本从暂存和标签分别核对一致。
- 本版包含 1196 条 JSON 中英文文案、独立持久语言偏好、日期/日历和原生菜单/通知固定提示、保留未保存表单的即时切换，以及语言标签与 160px 下拉选择器同一行布局。
- 0.1.22 的初次提交漏暂存 Tauri 版本配置，[Release 39362340564](https://github.com/ansermail/anser/actions/runs/39362340564) 在 npm/Tauri 版本检查阶段失败；没有创建草稿或资源。保留标签，使用新版本重新验证，不改写已推送标签。
- [Homebrew 运行 39363711322](https://github.com/ansermail/anser/actions/runs/39363711322) 成功，主仓库 [配方提交 43b96d6](https://github.com/ansermail/anser/commit/43b96d67dd1578401e9065674fec116b23c6e93d) 仅更新 Casks/anser.rb；重复核验 [39363835908](https://github.com/ansermail/anser/actions/runs/39363835908) 成功并返回 `Cask is already current; no commit needed.`。配方与两架构公开 DMG 摘要一致，本机 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。

## 实际检查

- 本轮完整本地门槛：npm test 58 文件/393 项、Rust 390 通过/3 既有条件忽略、桌面脚本 35、IMAP vendor 39；执行时工作树版本 0.1.22。0.1.23 仅版本与记录变更后重新通过格式、版本/暂存/标签核对、生产构建；0.1.23 固定源码的云端 Checks 与 Release check 重新完整通过。
- 生产与 Pages 构建、UI/1196 文案键与占位符、原生 IPC 隔离、Prettier、cargo fmt、plutil、git diff 检查通过；既有大 chunk 提示保留。
- 本机构建 `npm run desktop:build` 成功，`src-tauri/target/release/bundle/macos/雁信.app` 为 0.1.23 / arm64 / dev.maildesk.desktop，声明 zh-Hans 与 en。完整固定签名及精确 DR、原生 OAuth 函数引用、前端配置隔离通过；未启动或安装此包。
- 七资源的长度/摘要与 GitHub 元信息一致；说明原文（含末尾换行）与固定源码/Release body/latest.json 一致，两架构 URL 和签名文件一致，minisign 与既有公钥独立验证通过。
- 两包版本 0.1.23、arm64/x86_64、稳定标识 dev.maildesk.desktop、最低 macOS 12、EML Viewer、zh-Hans/en 声明与许可资源通过。代码签名和精确 DR 为 `identifier "dev.maildesk.desktop" and certificate root = H"9bdb640cfd84667d5ea3edeb37859c316abb4109"`。
- 原生 Google/Microsoft 配置在对应 auth::client_id / auth::exchange 函数内精确核对引用或重建分段写入，不使用零散字节片段冒充一致；本地 dist/dist-preview 无相应配置，不输出值或反汇编。
- 两架构 DMG 校验有效，只读挂载后的全部 App 文件与对应更新归档逐字节一致；核验后卸载。
- 正式发布后七资源匿名公开下载与审计副本完全一致；标准 `/releases/latest/download/latest.json` 不带查询参数，逐字节匹配。发布前后 asset ID/长度/摘要与标签固定源码不变。
- 审计文件与日志存于仓库外 `/tmp/anser-release022-feo_5pne`。

## 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.23_aarch64.app.tar.gz` | 12480483 | `23c95eb4c7e9e45b0ac34a94ccd9110ab04c75ef6b926e5c88c967247763030f` |
| `Anser_0.1.23_aarch64.app.tar.gz.sig` | 424 | `ac3944db79d4555b629f3e97f6845d7dce43771caf355152f93b1cad99948168` |
| `Anser_0.1.23_aarch64.dmg` | 13042718 | `c02501018ee2e149faa085a4996db3f90e60e04b982eb2bc411491bff67d72ea` |
| `Anser_0.1.23_x86_64.app.tar.gz` | 13075883 | `582ceb94d1376d14335471ed5389a67eb158dd5466ecb161341f4293afee607b` |
| `Anser_0.1.23_x86_64.app.tar.gz.sig` | 424 | `ccd88f4f0304c5db3660eee0589f5fdbce903d514ff488ff6483375f5e18482f` |
| `Anser_0.1.23_x86_64.dmg` | 13759528 | `98cd8e3a3bc4464400a929d7e3f81d8548aa74b537667c1060965ea8181b6e9b` |
| `latest.json` | 2785 | `b108f14c0ce753f69bfcad0d9c436338be947a535d9ce893982621979f540a0f` |

## 验收边界

原生托盘实际点击、系统通知横幅、系统文件/打印面板、正式包安装与应用内原位升级、Intel 实机未验证。自签名和更新归档签名不等同于 Apple Developer ID、公证或 Gatekeeper 认可。

## 后续入口

本版代码、云端构建、产物审计、公开发布与 Homebrew 同步分别完成。后续用户验证正式包安装/升级及原生交互；本轮文档提交后的 Checks 以对应 GitHub 运行结果单独核对，不沿用为桌面实机验收。
