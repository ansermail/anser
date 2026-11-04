# 0.1.38 发布工作点

更新：2026-11-04（Asia/Shanghai）。用户授权提交并正式发布，本机安装更新由用户自行完成。

## 当前状态：正式发布与分发核验完成

- 固定发行源码 `81656baf2e2df8e6415ad1d7ecb4a9686c5a3b06`、注释标签 `v0.1.38` 已推送；基线 `main` / `1a99af8`；包含 `1105598` 性能、`55b6560` 附加存档/双级校验与 `46b1928` 翻译及排版修复。
- 五处版本同步为 0.1.38。0.1.37 已有固定旧源码标签与九资源草稿，保持未发布、不移动标签；本轮使用新标签。
- 三平台云端构建、独立九资源审计与三个更新签名核验已通过；0.1.38 于 2026-11-04 20:11:31（Asia/Shanghai）正式公开为 latest，Release id `433870388`。公开后九资源匿名下载、标准更新端点、官网与 Homebrew 均已核对通过。
- 官网发布时序已执行：推送前恢复 0.1.36 并暂停自动部署，安装器公开后恢复并部署 0.1.38，三平台公开链接与 Homebrew 配方均通过。

## 本轮完整本地门槛

环境：本机 macOS / Apple Silicon，Rust 1.91.1；日志保存在仓库外 `/tmp/anser-release-0.1.38/`。

- `npm run test:ci`：前端 67 文件 389 项，加 App 85 项，共 474 项通过。
- `npm run test:rust`：Rust 库 451 项通过、5 项条件忽略；其余二进制/文档测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 项通过、2 项既有忽略。
- `npm run test:desktop`：37 项通过；`cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`、`npm run build:preview`、UI、i18n 1422 条双语键、`npm run format:check`、Rust fmt、`npm run release:check` 与 diff 检查通过；仅有既有 Vite 分包/体积提示。
- Pages 标签部署被既有 github-pages 分支保护拒绝，改为重跑原 main 的 [41566362433](https://github.com/ansermail/anser/actions/runs/41566362433) 已成功恢复 0.1.36；发布前暂时禁用自动部署，安装器公开后已恢复。
- 推送前已在三份开发文档和未推送提交中脱敏两条真实邮件主题；原本地提交保留在不推送的 `local-backup/pre-release-0.1.38` 分支。

## 云端阶段与提前审计

- Checks 41822622432 全部成功；日志确认 Rust 451/5 条件忽略、桌面 37、IMAP 39，前端 474 项通过。
- Release desktop 41822622565 的 check 与 Apple Silicon / Intel 两个 build 已成功；Windows 原生回归、正式 EXE/签名与安装启动/托盘冒烟已通过，完整流水线成功。
- Windows validation 41822622471 全成功；前端 474、Rust 450/3 条件忽略、桌面脚本 37、IMAP 39 通过，验证安装器已生成。其可选 smoke 跳过；正式发行任务的独立原生安装冒烟已通过。Windows Rust 测试实际耗时 566.43 秒，未修改超时或断言。
- 提前下载两个 Mac artifact，两个归档的更新签名以现有公钥验证通过；App 版本/架构/稳定标识/中文本地化/EML 声明、项目固定签名/精确 DR、许可原文和 DMG/更新归档逐文件一致性全部通过。证据 `mac-audit.log`；这不是正式安装或实机运行验收。

## 验证范围与限制

此前开发验收：前端 474、Rust 库 451/5 忽略、桌面脚本 37，通过；副本 5,499 封归档/取回与快速校验通过，深度校验 5,497/5,499，另 2 封为已有 MIME Base64 异常。原生设置页已核对配置、确认及断盘状态，未用有数据副本走完整进度/取消/取回。

本轮发布门槛已独立重新执行并记录于上方，未沿用开发阶段结果冒充。6.4 万封真实规模、Windows/Intel 实机、磁盘满/热插拔与强制退出恢复、正式安装和原位升级仍未验证；不替换 `/Applications/雁信.app`。

## 云端运行

- [Checks 41822622432](https://github.com/ansermail/anser/actions/runs/41822622432)
- [Windows validation 41822622471](https://github.com/ansermail/anser/actions/runs/41822622471)
- [Release desktop 41822622565](https://github.com/ansermail/anser/actions/runs/41822622565)

## 九资源草稿审计

- 草稿按 id `433870388` 审计；固定源码与标签均为本轮唯一提交，公开前再次核对资源 ID/名称/长度/摘要未变。
- 九资源逐项大小/SHA-256、三个现有公钥更新签名、清单三平台 URL、源码/Release/清单的完整说明（含末尾换行）通过。
- Mac 双架构固定应用签名及精确 DR、版本/架构/标识/中文声明/EML/许可，以及 DMG 与更新归档逐文件一致性通过。
- 审计与发布证据保存在 `/tmp/anser-release-0.1.38/` 的 `audit.log`、`asset-audit.json`、`release-before.json` 和 `publication-result.json`。

## 公开与分发核验

- 公开后 Release id、固定标签及全部九资源 ID/长度/摘要未变；公开 latest API 为 0.1.38，三个按版本更新 URL 与源码一致。
- 九资源均通过匿名公开下载并逐项匹配审计大小/SHA-256；无查询参数的标准 `/releases/latest/download/latest.json` 与审计清单逐字节相同，完整说明原文不变。证据 `public-audit.log`、`release-public.json`。
- [Pages 41827157227](https://github.com/ansermail/anser/actions/runs/41827157227) build/deploy 成功；线上实际加载模块为 0.1.38，Mac 双架构 DMG 和 Windows EXE 链接均 HTTP 200。证据 `website-audit.log`。工作流已恢复 active。
- [Homebrew 41827139283](https://github.com/ansermail/anser/actions/runs/41827139283) style/audit/fetch 成功，配方提交 `60ae6eb` 仅改 Casks/anser.rb；本地已 fast-forward，同步核对版本与两个正式 DMG 的 SHA-256 一致。
- 本机正式应用与用户数据未替换。审计展开的两个临时 App 副本已移除，资源与审计日志保留在仓库外，不会产生额外可打开邮件文件的审计 App。

## 下一步

发布与分发已完成。后续只继续上方列明的真实场景与大规模副本验收；本机安装/原位升级由用户自行完成，不以资源审计或 runner 冒烟代替。

## 资源摘要

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.38_aarch64.app.tar.gz` | 13019031 | `bdaad03b6ed108c3750cccd86fd8356063b682ee2c416b24c71fd3b360eab325` |
| `Anser_0.1.38_aarch64.app.tar.gz.sig` | 424 | `b9881cdde625de98b0dad0b16a61ba997b4198796a5bfb7166862911f1ac7bf9` |
| `Anser_0.1.38_aarch64.dmg` | 13549143 | `65838213012b8091392115673a85f629d0b1f18a31d7d5256ed40461b3c4f5ed` |
| `Anser_0.1.38_x86_64-setup.exe` | 10293016 | `68456177b85de4ebfd03dc01f4350f811bff33e323cf2f6f013956df4e51d868` |
| `Anser_0.1.38_x86_64-setup.exe.sig` | 436 | `8104468cf6fa7d563789ae7b484b62f2a0228a03ce81cc98e351dbcdf8586dbd` |
| `Anser_0.1.38_x86_64.app.tar.gz` | 13662087 | `ca703917f7b908d0231c155576ecafe6304d7892a5a976b456b48c89b08b8745` |
| `Anser_0.1.38_x86_64.app.tar.gz.sig` | 424 | `7473d65a40a70b8238f163c16cb16ed06c4b68595a53ef29981aebc960a40bd5` |
| `Anser_0.1.38_x86_64.dmg` | 14316910 | `727d24b75388748f634a61699b3279825769013b68208325ff82babf1556a53f` |
| `latest.json` | 3800 | `42f6176675ce6154fa0a317785709c669f5b1222265a2a58099695fe37a80203` |
