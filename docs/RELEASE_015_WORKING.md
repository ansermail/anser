# 0.1.15 Alpha 发布工作点

## 目标与当前状态（2026-10-14）

用户要求提交全局网络代理改动，并从组织仓库启动远程双架构流水线发版。工作分支 `main`，开工与 `origin/main` 一致，基线 `5209976a728df09290d4b4821b31c31bda0caeca`。公开 latest 为 0.1.14；认证 GitHub 查询 0.1.15 Release 返回 404，远端精确标签查询为空，未把查询失败当作不存在。候选版本 0.1.15，五处版本与说明在本阶段准备。

范围包括设置页全局 SOCKS5/HTTP/HTTPS 代理、密码钥匙串、IMAP/POP3/SMTP 隧道、应用内 OAuth 令牌请求及可选预握手直连回退。0.1.14 已发布资源与标签不改写。用户已拿到本地 arm64 安装包进行测试；真实代理收发和 OAuth 刷新尚未得到通过反馈，本轮发布说明如实标明。

## 执行顺序

1. 完成五处版本、发布说明、用户/实现/开发记录与 README；本地执行前端、Rust、桌面脚本、vendored IMAP、版本/格式/UI/生产/Pages 检查，审查暂存内容和隐私边界。
2. 仅提交本次发布范围并推送组织 `main`，固定完整源码 SHA；从该源码触发 `release.yml`，核对 workflow_dispatch/headSha 和所有 job。
3. 检查草稿目标、说明原文及末尾换行、七资源、更新签名、公钥、App 版本/架构/标识/codesign/许可/EML/OAuth 配置和两 DMG 与更新归档一致性。
4. 草稿核验无误后正式发布，重新核对标签、公开更新清单及两架构资源，再记录实际结果。代码、测试、云端构建、正式发布和真实场景验收分别记载。

## 未完成验收

- 用户真实代理下的 IMAP/POP3、SMTP、OAuth 令牌交换/刷新结果待反馈；系统浏览器首次登录页仍由浏览器网络配置决定。
- 正式原位升级、钥匙串授权、Apple Developer ID 签名/公证未验证。

## 本地发布门槛（2026-10-14）

- `cargo check --manifest-path src-tauri/Cargo.toml` 通过；`npm test` 49 文件/290 项通过；`npm run test:rust` 326 项通过、1 项独立性能测试忽略；`npm run test:desktop` 30 项通过；vendored IMAP 39 项通过。
- `npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check`、`npm run build`（含 UI/TypeScript/Vite）及 `npm run build:preview`（含虚构数据与原生桥隔离）均通过。
- 上述是本地源码检查；云端任务、草稿资源与真实代理环境尚未验证。
