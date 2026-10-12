# 0.1.12 Alpha 发布工作点

## 正式发布结果（2026-10-12）

0.1.12 Alpha 已于 15:38:33（Asia/Shanghai）正式发布为 latest。源码固定 `996738d82f5e55af5f0dddb13ddba9a5248a9d05`，已快进合入并推送组织 main；[Release macOS 38217856007](https://github.com/ansermail/anser/actions/runs/38217856007) 的 check、aarch64、x86_64、draft 全部成功，[GitHub Release v0.1.12](https://github.com/ansermail/anser/releases/tag/v0.1.12)。同源 Checks38217845164 和 Pages38217845146 成功。

草稿ID410321936：发布前后目标源码、说明原文（含末尾换行）、七资源ID/大小/SHA-256保持不变；标签解析到同一提交。七资源和两架构更新签名与沿用的公钥核对通过；两个正式 App 的 0.1.12/架构/稳定标识、完整codesign、EML关联及许可资源逐字节对应固定源。Google/Microsoft原生配置在对应二进制函数中精确核对，优化器拆分的短值通过指定交换函数重建核对，未输出配置值，前端/资源不含配置；不等于真实OAuth授权/发信通过。两份DMG完整校验且各8个App文件与更新归档逐文件一致，审计后卸载DMG。审计资料在仓库外 `/tmp/anser-release012-audit-996738d`，本段保留可接续结论。

发布后经匿名下载的 Apple Silicon/Intel DMG 与两份更新归档均逐字节等于审计资源；标准 `releases/latest/download/latest.json` 曾短暂返回缓存的0.1.11，随后确认与0.1.12已审计清单逐字节相同。实际安装/原位升级、图片粘贴/拖拽、草稿重开和真实富文本互发未在本轮完成，由用户下载后继续验收。没有进行真实邮件发送/删除、存档迁移或账号配置修改；Apple Developer ID/公证仍未完成。

## 目标与范围

2026-10-12 用户要求提交当前代码，通过组织仓库 GitHub 双架构流水线发布新版本，供自行下载测试。工作分支 `codex/rich-body-images`，基线 main/a030672；origin `git@github.com:ansermail/anser.git`。范围为富文本写信/正文图片、中英文字体、图片右键/选区修复、更新说明 Markdown。发布说明 `docs/releases/v0.1.12.md`，版本五处同步。应用标识 `dev.maildesk.desktop`、更新公钥及仓库端点不变。

## 发布前检查点（历史）

- 当时 0.1.11 已正式发布，0.1.12 查询无 Release、无远端标签；尚未提交、推送或触发远程构建。后续结果见上方正式发布记录。
- 本机 `npm test` 255/255、`npm run test:rust` 307通过/1独立性能项忽略、`npm run test:desktop` 28/28、IMAP parser 39/39、`npm run release:check`、`npm run format:check`、`npm run build`、`npm run build:preview` 通过。`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 和 `git diff --check` 通过。
- 开发预览曾验证虚构 PNG 插入、草稿自动保存、菜单、字体和选区；更新说明在浏览器虚构页确认 Markdown DOM/列表样式，截图接口超时。完整格式真实互发、图片粘贴/拖拽、草稿重开及正式原位升级未验收；本版由用户下载后继续验证，不把自动测试视为这些真实场景通过。

## 发布前计划（历史）

1. Rust 全量完成后复核 diff、隐私与版本/说明一致性，提交到工作分支；将候选合入 main，固定源码并推送组织仓库。
2. 从固定 main 提交触发 `release.yml`；核对 check、Apple Silicon/Intel build、draft 的同一 `headSha` 和全部通过。
3. 核对草稿目标/说明逐字节一致、七资源名称/大小/摘要、latest.json 的版本/两个平台/链接/签名、App/DMG 的版本/架构/标识/许可/签名及 OAuth 配置。确认公开 latest 仍是 0.1.11，再正式发布草稿。
4. 核对公开 latest.json 与草稿清单、两个 DMG/归档可下载及 Release 页面；更新 README/开发记录中的实际发布状态。真实安装/原位升级由用户下载后继续验收。
