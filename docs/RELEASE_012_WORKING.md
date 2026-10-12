# 0.1.12 Alpha 发布工作点

## 目标与范围

2026-10-12 用户要求提交当前代码，通过组织仓库 GitHub 双架构流水线发布新版本，供自行下载测试。工作分支 `codex/rich-body-images`，基线 main/a030672；origin `git@github.com:ansermail/anser.git`。范围为富文本写信/正文图片、中英文字体、图片右键/选区修复、更新说明 Markdown。发布说明 `docs/releases/v0.1.12.md`，版本五处同步。应用标识 `dev.maildesk.desktop`、更新公钥及仓库端点不变。

## 当前检查点

- 0.1.11 已正式发布，0.1.12 查询无 Release、无远端标签；尚未提交、推送或触发远程构建。
- 本机 `npm test` 255/255、`npm run test:rust` 307通过/1独立性能项忽略、`npm run test:desktop` 28/28、IMAP parser 39/39、`npm run release:check`、`npm run format:check`、`npm run build`、`npm run build:preview` 通过。`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 和 `git diff --check` 通过。
- 开发预览曾验证虚构 PNG 插入、草稿自动保存、菜单、字体和选区；更新说明在浏览器虚构页确认 Markdown DOM/列表样式，截图接口超时。完整格式真实互发、图片粘贴/拖拽、草稿重开及正式原位升级未验收；本版由用户下载后继续验证，不把自动测试视为这些真实场景通过。

## 发布顺序

1. Rust 全量完成后复核 diff、隐私与版本/说明一致性，提交到工作分支；将候选合入 main，固定源码并推送组织仓库。
2. 从固定 main 提交触发 `release.yml`；核对 check、Apple Silicon/Intel build、draft 的同一 `headSha` 和全部通过。
3. 核对草稿目标/说明逐字节一致、七资源名称/大小/摘要、latest.json 的版本/两个平台/链接/签名、App/DMG 的版本/架构/标识/许可/签名及 OAuth 配置。确认公开 latest 仍是 0.1.11，再正式发布草稿。
4. 核对公开 latest.json 与草稿清单、两个 DMG/归档可下载及 Release 页面；更新 README/开发记录中的实际发布状态。真实安装/原位升级由用户下载后继续验收。
