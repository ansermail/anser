# 0.1.40 发布工作点

更新：2026-11-08（Asia/Shanghai）。用户已授权提交并正式发布；本机正式安装更新由用户自行完成。

## 当前状态：发布候选验证中

- `main` 上的界面与阅读稳定性改进已提交为 `d221ed0`；当前未提交内容只包含 0.1.40 版本号、发布说明和分发记录。
- 五处版本已更新为 0.1.40：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。
- 正式安装包、标签、GitHub Release、官网与 Homebrew 尚未在本工作点确认；云端构建和公开资源审计完成后再更新本文件。
- 不替换 `/Applications/雁信.app`，不把本机原位升级作为本轮自动验收结果。

## 本版范围

- 阅读页工具栏区分常用回复/转发与低频的打印、导出、本地整理；服务器操作独立分组。
- 搜索范围、已发送过滤、正文检索边界与零结果恢复路径更明确；保留旧正文时提示其是否会改变搜索结果。
- 正文图片加载、失败与翻译状态统一为右上角悬浮胶囊，不参与正文排版，避免状态切换推动正文。
- 远端正文先使用回退字体显示；深色阅读处理近黑文字，同时保留作者品牌色、背景图与彩色底面。
- 邮件列表时间按当天、同年、跨年分层显示并保留完整时间；没有摘要时移除空行。
- 临时阅读缓存、在线邮件与完整本地保存的状态说明更清楚；存档统计、管理动作与删除风险区重新分组。
- 过滤规则使用一致命名和明确空态；写信低频格式集中到“更多格式”，正文文件入口改为“导入正文…”。

## 本轮本地门槛

环境：本机 macOS / Apple Silicon。

- `npm run test:ci`：非 App 69 个测试文件、397 项通过；App 88 项通过。合计 70 个测试文件、485 项通过。
- `npm run test:rust`：454 项通过、5 项条件忽略；二进制与文档测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 项通过、2 项需原生钥匙串 fixture 的既有用例忽略。
- `npm run test:desktop`：37 项通过。
- `cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`：UI 铁律、1463 条双语键、TypeScript 与 Vite 生产构建通过；保留既有分包/体积提示。
- `npm run build:preview`：生产预览构建与 Pages 公用布局、虚构数据、原生桥隔离和发布路径检查通过。
- `npm run release:check`、`npm run release:secrets`、`npm run format:check`、Rust fmt 与 `git diff --check` 通过；更新签名私钥未写入仓库或日志。

首次云端 [Checks 42446658853](https://github.com/ansermail/anser/actions/runs/42446658853) 与 [Release desktop 42446712417](https://github.com/ansermail/anser/actions/runs/42446712417) 在共享 macOS 15 runner 上超时失败，`Preview Pages 42446658887` 已按发布顺序提前取消。失败均来自大型分页交互测试的时间预算：两个 205 行用例未继承 CI 的 30 秒，七次跨页用例实测 33.7 秒、超过 30 秒；安全、分页和交互断言没有报错。

已只为 `App.test.tsx` 修正 CI 测试预算：205 行用例统一使用 CI 30 秒，七次跨页导航使用 CI 60 秒；本地分别保留 5 秒和 30 秒。`CI=true` 定向运行相关 12 项通过。未改业务实现、断言或自动重试；重建标签前继续执行完整本地门槛。

## 发布顺序

1. 完成剩余本地门槛并核对未提交范围。
2. 提交 0.1.40 发布准备，创建并推送注释标签；`main` 推送后立即取消自动触发的 Pages/Preview，保持 0.1.39 官网在线。
3. 等 Checks、Windows validation、Release desktop 成功，审计草稿源码、九个资源、签名、`latest.json` 与匿名下载。
4. 将 Release 公开为 latest，核对标准更新端点和公开安装包链接。
5. Homebrew 校验通过并只更新 `Casks/anser.rb` 后，再部署 Preview Pages；核对线上版本为 0.1.40 且双 DMG、Windows EXE 可下载。

## 尚未验证

- Windows 实机、Intel Mac、更多邮件模板和正式安装包原位升级。
- 云端三平台构建、公开资源、Homebrew 与官网上线结果；完成前不能标记发布成功。
