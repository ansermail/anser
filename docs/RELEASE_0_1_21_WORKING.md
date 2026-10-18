# 0.1.21 发布工作点

更新：2026-10-18。用户已授权提交、触发远程流水线与正式发布。

## 当前状态：本地发布检查通过，准备提交与云端构建

- 开发分支 `codex/settings-layout`，起点与组织 main 均为 `0c300cb0cd1b17c5dfa027fa140f1f36cbcd32c1`；本轮工作树修改均属设置布局与交互。
- 五处版本已同步 0.1.21，发布说明见 `docs/releases/v0.1.21.md`。
- 本机完整前端 388 项（56 文件）、Rust 389 通过/3 既有条件忽略、桌面脚本 35、IMAP 39 通过；格式/UI/生产构建/Pages 隔离/版本/diff 检查通过。实际命令为 `npm test`、`npm run test:rust`、`npm run test:desktop`、`cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`、`npm run build`、`npm run build:preview`、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check` 和 `git diff --check`。
- 已核对 23 个本轮暂存文件，无凭据、数据库、原件或截图文件；公开 latest 仍为 0.1.20。0.1.21 标签、云端构建、资源审计、正式发布与 Homebrew 更新尚未执行。

## 本版范围

设置五类导航、容器宽度适配、卡片层级与间距、分类切换输入保留；后台任务标题/说明点击展开，独立刷新旋转、忙碌文字、防重复点击和失败恢复。详细开发证据见 `SETTINGS_LAYOUT_WORKING.md`。

## 发布检查点

- [x] 本地完整前端、Rust、脚本与 IMAP 测试，格式/UI/生产/Pages 隔离/版本检查。
- [ ] 聚焦提交，合入组织 main，固定唯一新标签 v0.1.21。
- [ ] Release macOS、Checks 与 Pages 分别核对结果。
- [ ] 七资源、说明/清单原文、两架构版本/签名/标识/中文配置/EML/许可、原生 OAuth 配置及 DMG/更新归档一致性独立核验。
- [ ] 正式发布，核对匿名公开资源和标准 latest 更新端点。
- [ ] 主仓库 Homebrew 流水线更新，配方、公开两架构摘要与 Homebrew 验证。
- [ ] 回填固定源码、Actions、Release、资源摘要及验收边界。

## 边界

开发原生浅色账号、存档、应用偏好、后台任务已核对；1000px/1440px 虚构浏览器布局通过。原生窄窗口/深色完整矩阵、正式包实际安装/原位升级及 Intel 实机未验证，不沿用旧版验收。安装包审计不替代这些验收。
