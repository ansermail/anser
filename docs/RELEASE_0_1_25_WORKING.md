# 0.1.25 发布工作点

更新：2026-10-22。用户明确要求“提交发版”，授权完成版本、提交、云端构建、资源核验、正式发布与 Homebrew 同步。

## 当前状态：本地检查通过，准备提交与标签

- 基线 `main` / `490a432778b48745efbc490e3c26957ef012fb53`，本轮全部未提交内容均为通知/阅读布局修复，没有混入其他工作。
- 版本统一为 0.1.25（npm、npm lock、Cargo、Cargo lock、Tauri），新标签 `v0.1.25` 在远端不存在；公开 latest 仍为 0.1.24。
- 本版包含通知重复点击重新定位、长对话选中邮件开头锚定、WebKit 布局滚动误判修正、固定阅读头尾、shadcn 常驻正文滚动条及数量 Badge。完整用户说明在 `docs/releases/v0.1.25.md`。
- 前一开发阶段相关 85 项回归与浏览器/原生 41 封阅读检查通过，详情见 `READING_LAYOUT_WORKING.md`；发布阶段全量结果见下，不沿用旧版本全量结果。

## 本轮发布检查

- `npm test -- --maxWorkers=2`：59 文件、397 项通过。
- `npm run test:desktop`：35 项通过。
- `npm run test:rust`：393 通过、3 项既有条件忽略；二进制与 doc-tests 也通过。
- `cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`、`npm run build:preview`（Pages 隔离）、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check`、`git diff --check` 均通过；双语配置 1219 键，保留既有大 chunk 提示。
- 仓库外检查日志与审计目录：`/tmp/anser-release025-PkVYqk`。

## 必须继续

1. 记录本轮前端全量、桌面脚本、Rust、IMAP、生产/Pages 隔离构建、格式/版本/diff 检查实际结果。
2. 检查暂存文件与内容，排除凭据/数据库/真实邮件/截图；提交推送 main，创建与源码同一提交的唯一版本标签，跟踪 Checks、Pages 与 Release macOS。
3. 双架构构建成功后下载草稿七资源，核对 GitHub 长度/SHA-256、说明原文、清单 URL/签名、既有更新公钥、App 版本/架构/标识/语言/许可/EML/固定代码签名、OAuth 编译配置存在性和 DMG/更新归档一致性。
4. 正式发布为 latest，匿名核对七资源与标准 latest.json，确保发布前后源码标签和资源身份未变。
5. 跟踪主仓库 Homebrew 配方更新，必要时 dispatch；核对双 DMG 摘要、style/audit/fetch 与重复运行幂等，更新 README/UPDATES/开发状态及本文件。

## 验收边界

系统通知真实横幅点击仍未复验：开发阶段调用现有 `test_notification` 后，CUA 访问 Notification Center 返回 -10005 timeoutReached。自动回归与真实对话阅读通过不代表横幅点击通过。正式包安装、应用内升级与 Intel 实机未验证；自签名不等同 Developer ID、公证或 Gatekeeper 认可。不覆盖本机安装包，不发送真实测试邮件，不改变系统信任或代理配置。
