# 0.1.18 Alpha 发布工作点

## 当前执行点（2026-10-16，正式发布及 Homebrew 同步完成）

- 0.1.18 Alpha 于 10:16:28（Asia/Shanghai）正式发布为 latest，固定源码 `71224095b21aefea3f59d2cc89c23a87a85fb86d`；[Release macOS 38838641843](https://github.com/ansermail/anser/actions/runs/38838641843) 的完整检查、Apple Silicon / Intel 构建与草稿任务全部成功，[Checks 38838641804](https://github.com/ansermail/anser/actions/runs/38838641804) 和同源 Pages 也成功。[正式下载](https://github.com/ansermail/anser/releases/tag/v0.1.18)。
- Release ID `414465258`；七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及原公钥、App 版本/架构/稳定标识/中文配置/EML/许可/codesign/原生 OAuth 配置、DMG 与更新归档逐文件一致性均核验通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。
- 本地完整门槛：前端 335、Rust 348 通过/1 忽略、桌面脚本 30、vendored IMAP 39；格式/UI/生产/Pages 隔离/版本/diff/隐私通过，本机 Rust 1.91.1。云端 Checks / Release 所有步骤成功。
- Tap 提交 [870f4b4](https://github.com/ansermail/homebrew-tap/commit/870f4b43a48e9fc9cbd31ec9da51ed15a2147406) 已推送 main，远端 SHA 与匿名公开配方逐字节一致；brew style/audit/Apple Silicon fetch 通过，双架构公开 DMG 摘要见表。未覆盖安装本机应用。
- 开发预览的原邮件两批真实模型请求共 102 个片段成功；0.1.18 正式包实际安装/原位升级及 Intel 实机运行未执行，不沿用此前版本验收。保持 ad hoc 应用代码签名与项目更新签名，按用户决定不办理 Developer ID/公证。
- 本轮审计位于仓库外 `/tmp/anser-release018-audit`，包含独立更新签名验证、App 包内核对与 OAuth 函数精确引用/重建字节比较；未输出配置值或反汇编，本地构建的前端资源未含本机配置。下一步用户通过应用内更新、正式下载或 Homebrew 安装/升级验证；其他模型与真实故障矩阵不扩充为通过。

### 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.18_aarch64.app.tar.gz` | 12286774 | `ab97824f834d91902c4e151b5fc2a7c6305bd34f90822ec5a4598f4d9f387711` |
| `Anser_0.1.18_aarch64.app.tar.gz.sig` | 424 | `6db1c3a1536c883f6841a5d90f5f9d0e3b4d17292fc9918a26d869d12e0c9755` |
| `Anser_0.1.18_aarch64.dmg` | 12836966 | `c522ed9a0536ca0296a01da94f1b674afa7f9ed34a94fb070932e339fb531ce7` |
| `Anser_0.1.18_x86_64.app.tar.gz` | 12874855 | `22532b717ebe7efd2f5e1da3317cbe73eee7c460ddce9e0494ce3d2be5f3e958` |
| `Anser_0.1.18_x86_64.app.tar.gz.sig` | 424 | `2d0057b6df7a007f1c6050ced0f82d550d303807d4d85b8684979e5286ea6fb6` |
| `Anser_0.1.18_x86_64.dmg` | 13524717 | `c21a446ba32f7e518d44a8604cd6c3f7e8c4beb1272a8bd9bf30421481133471` |
| `latest.json` | 2787 | `3559cd702768e1331adf441e4b501f5d07bd4e9e952dd69cc6c376804b69c35a` |


## 发布准备与本地阶段（2026-10-16，历史）

- 用户授权提交本次翻译修复并发版。基线 main / 2d8c136，origin 已核对为组织仓库。认证 GraphQL 成功返回 v0.1.18 Release 与标签均不存在，远端 main 与基线一致；不改写 0.1.17。
- 范围为按段翻译返回校验、保留段落上下文的分批、细分错误与活动记录、v3 缓存及相应回归/文档。接手 10 个改动文件均为已完成的本轮修复，没有其他未验收业务工作混入。
- 开发预览实际同封邮件已 102/102，64 片段/3166 字与 38 片段/955 字分别为 6.1/3.2 秒真实模型请求成功。历史原始返回未保留，不将校验缺陷推断写成历史响应的唯一子原因；完整记录见 TRANSLATION_WORKING.md。
- 五处版本同步 0.1.18，说明见 releases/v0.1.18.md；保持应用标识、更新密钥、既有 ad hoc 应用签名与项目更新签名，不办理 Developer ID/公证。
- 下一步：重新执行本次发布完整门槛、暂存及隐私审阅，提交推送 main 和唯一新标签；等待 Checks/Pages/Release 全部成功，审计双架构完整七资源后正式发布，再核验公开标准更新地址及 Homebrew。
- 此时仍公开 0.1.17；0.1.18 代码提交、云端构建、安装包审计、正式发布及实际安装/升级分别记录，未执行的部分不得标通过。

## 本次提交前验证（2026-10-16）

- 本机 Rust 1.91.1，与 CI 一致。本次 0.1.18 源码重新执行：`npm test` 54 文件/335 项通过；`cargo test --manifest-path src-tauri/Cargo.toml` 348 通过/1 既有性能项忽略；`npm run test:desktop` 30/30；vendored IMAP 39/39。
- `npm run build`（含 check:ui/类型）、`npm run build:preview`（含原生桥隔离）、`npm run format:check`、Rust fmt、`npm run release:check` 和 diff 检查通过。版本同步时 JSON 序列化使 Tauri 配置格式检查曾告警，已用 Prettier 恢复官方项目格式并重跑通过；生产构建仅保留既有 Vite 警告。
- 18 个候选文件均已审阅；完整改动及新增文件与 3 个本机 OAuth 编译配置值精确比较无命中，凭据模式扫描未命中；不输出配置值。无 env、原始邮件/数据库、截图、私钥或二进制资源进入提交范围。
- 接下来固定源码提交与唯一 v0.1.18 标签，推送后从远程检查/双架构状态继续；安装包尚未生成或正式发布。

## 固定源码与远程运行（2026-10-16）

- 源码 `71224095b21aefea3f59d2cc89c23a87a85fb86d` 已提交并推送组织 main 与唯一新标签 v0.1.18；远端 SHA 逐字一致。提交前暂存区再次与 3 项本机配置值比较，未命中，凭据模式扫描通过；18 文件实际提交范围与审阅一致。
- [Release macOS 38838641843](https://github.com/ansermail/anser/actions/runs/38838641843)、[Checks 38838641804](https://github.com/ansermail/anser/actions/runs/38838641804)、[Pages 38838641801](https://github.com/ansermail/anser/actions/runs/38838641801) 已启动；仅由新标签触发一次 Release，不额外 workflow_dispatch。
- 当前等待检查/双架构/草稿。下一步从上述运行状态及完整七资源审计继续，审计目录为仓库外 `/tmp/anser-release018-audit`。公开仍为 0.1.17，未发布新版。

## 云端检查完成（2026-10-16）

- 源码 7122409 的 Checks 38838641804、Pages 38838641801 已全部成功，Release 38838641843 的 check 也完整成功；未重跑旧源码或跳过门槛。
- Apple Silicon / Intel 构建现已启动，等待安装包、更新归档及草稿七资源。公开仍 0.1.17；从双架构构建完成和草稿审计接续。

## 公开下载验证记录（2026-10-16）

- 首轮匿名下载有一份签名文件连接 GitHub CDN 超时；其余六份已匹配。改用限次 curl 补验后七资源全部按大小/摘要/字节核对通过，标准 latest 地址也逐字节匹配。此为本机下载链路现象，远程 Checks / Release 均首次运行成功，没有重跑或重建资源。
