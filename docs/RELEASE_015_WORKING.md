# 0.1.15 Alpha 发布工作点

## 当前状态（2026-10-14）

0.1.15 已正式发布，结果见文末“正式发布结果”。用户发现本版邮件正文外链被 CSP 拦截，修复另用 [0.1.16 工作点](RELEASE_0_1_16_WORKING.md) 跟踪；本文件以下准备及草稿待办均为发布前历史记录。

## 发布前目标与基线（历史）

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

## 固定源码与云端流水线

- 已审阅并暂存 25 个源码/文档/版本文件，`git diff --cached --check` 通过；文件名排查无 `.env`、数据库、MIME、截图、私钥或安装包。将本机 `.env.local` 中长度足够的配置值与暂存差异比较，没有命中；未输出配置值。
- 已提交并推送组织 `main`：`63fb6c25e62506a790b61532127199251f701f5d`。GitHub `main` 完整 SHA 与本机相同，提交后工作树干净。
- `gh workflow run release.yml --repo ansermail/anser --ref main` 已触发 [Release macOS 38510852394](https://github.com/ansermail/anser/actions/runs/38510852394)；首次核对 event=`workflow_dispatch`、headSha 为上述固定源码，check job 当时 queued。此项只确认触发与源码，不能计为检查或构建成功。
- 后续 check job 在 5m40s 完整成功：版本与格式、前端、桌面脚本、生产构建、Rust 和 vendored IMAP 步骤全部通过；Apple Silicon 与 Intel 构建任务已启动。尚无草稿或资源审计结果。

## 云端草稿与发布前审计

- [Release macOS 38510852394](https://github.com/ansermail/anser/actions/runs/38510852394) 已完整成功：check、Apple Silicon、Intel、draft 四个 job 全部通过；event/headSha 仍为 workflow_dispatch/`63fb6c25e62506a790b61532127199251f701f5d`。草稿 Release ID `412338504`，目标同一完整 SHA，发布前仍为 draft。
- 草稿七资源下载至仓库外 `/tmp/anser-release015-audit-63fb6c2`。名称、大小、SHA-256 与 GitHub 资源元数据逐项相同；清单版本/两平台链接/签名及 Release body 与固定源码说明逐字一致，包含末尾换行。
- 两架构更新归档使用应用现有公钥及独立 minisign 验证器验签通过；解包后版本 `0.1.15`、架构 arm64/x86_64、标识 `dev.maildesk.desktop`、完整 codesign、许可资源和 EML 声明通过。两份 DMG 的磁盘校验通过，只读挂载后各 8 个 App 文件/链接逐项散列等于对应更新归档，已卸载。
- 原生 OAuth 配置在 arm64 的 `auth::client_id`/`auth::exchange` 引用数据和 Intel 的同两函数内立即数重建后，与本机忽略配置精确匹配；没有输出配置值，两个 App 的前端资源均不含本机 OAuth 值。云端构建前的三项 OAuth Secret 存在检查通过。公开 canonical latest 在正式发布前仍为 0.1.14；0.1.15 标签查询为空。
- 正式发布前仍须重新读取草稿身份、目标、说明和七资源 ID/摘要，排除审计后变化；发布后核对标签、公开更新端点和资源。

## 正式发布结果（2026-10-14）

- 发布前重新核对同一草稿 ID `412338504`、目标提交、发布说明原文与七资源 ID/大小/摘要，均与审计结果一致；于 12:35:05（Asia/Shanghai）正式发布 [v0.1.15](https://github.com/ansermail/anser/releases/tag/v0.1.15)。标签指向 `63fb6c25e62506a790b61532127199251f701f5d`，发布后 Release ID、说明及资源保持一致。
- 公开 canonical `latest.json` 与已审计的清单逐字节一致。七份资源已在发布前从 GitHub 下载并核验；公开安装/更新资源的发布后重新下载未执行，不把元数据复核写作逐字节公开下载。
- 用户随后报告邮件正文外链点击遭到 CSP `frame-src` 拦截，0.1.15 的原生邮件正文链接存在该缺陷；修复将进入新版本，不覆盖本标签或资源。真实代理收发、OAuth 刷新、正式安装与原位升级继续待验收。
