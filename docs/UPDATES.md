# 发布与应用内更新

## 用户流程

正式应用启动后自动检查更新，之后每 6 小时再检查。只有检测到新版本才在“本地优先”前显示更新图标。设置与账号中的“关于与更新”始终提供手动检查。

点击更新图标 → 查看版本与发布说明 → 下载更新（显示进度）→ 校验签名 → 安装并重启。Tauri 更新器替换当前应用所在位置，后续无需把应用重新拖入 Applications。写信窗口打开时禁止安装；重启前等待正在进行的收取/发送完成并保存窗口状态。

开发预览允许检查，禁止下载安装覆盖开发实例。首次安装仍需使用 DMG；旧版本如果没有更新器，需要先安装含更新器的版本。当前未有 Apple Developer ID 证书，未做签名公证；Tauri 更新签名用于校验来源，不等同于 Apple 的签名公证。更换应用代码签名身份时，钥匙串可能要求重新授权。

## 已配置的流水线

- `.github/workflows/ci.yml`：main 推送和 PR 执行前端/脚本/Rust 回归及 UI 检查和生产构建。
- `.github/workflows/release.yml`：推送 `v*` tag，或 Actions 手动运行；验证版本、发布说明和测试后，分别构建 Apple Silicon 与 Intel Mac 的 DMG、app.tar.gz 与签名。
- 构建任务只产出架构独立的 artifacts；汇总任务检查两个架构文件齐全，统一生成 latest.json 并创建草稿 Release，避免并行写清单丢失架构。
- 发布后的同版本不可覆盖。草稿可重跑上传；`releases/latest/download/latest.json` 只有正式发布后才可用。用户检查不读取草稿。
- 仓库是公开的 `ansermail/anser`；客户端不包含 GitHub token。端点仅 HTTPS，签名必须有效；失败时保留当前安装，不执行重启。

## 签名密钥

本机更新密钥在 `~/.config/yanxin-release/updater.key`，权限 0600，公钥已写入 Tauri 配置。私钥已上传仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`，没有提交到 Git 或写进日志。密钥没有密码，流水线明确使用空密码；应保管仓库外的密钥备份，后续版本复用同一密钥，不能重新生成替换已部署应用的公钥。

换开发机时恢复原密钥和 `.pub` 文件，然后运行 `npm run release:secrets`。脚本先验证公钥匹配和 GitHub 登录，只通过 stdin 上传密钥。

## 下次发布

1. 同步修改 package.json、package-lock.json（npm install --package-lock-only）、src-tauri/Cargo.toml、Cargo.lock 和 tauri.conf.json 的版本。
2. 写 `docs/releases/v版本.md`，运行 `npm run release:check` 和回归，提交并推送。
3. 推送对应 `v版本` tag，或者运行 `gh workflow run release.yml --ref main`。
4. 等待两架构构建和草稿生成，核验 DMG、app.tar.gz、sig、latest.json 和版本说明；再发布草稿。当前仍属于 Alpha，不代表开发计划全部完成。
5. 用含更新器的旧正式版检查新版本、下载安装并重启，确认账号、本地存档、窗口及新版本号。

## 验收记录

本地 120 项前端、170 项 Rust、13 项脚本回归及 UI/TypeScript/生产构建通过。前端覆盖无更新隐藏、有更新展示、下载先于安装、签名失败不安装、重复检查保护、重启失败只重启不重复安装、写信中阻止安装和开发预览保护。真实 GitHub Actions 构建和正式安装升级的结果以开发检查点记录为准，不能把模拟交互测试计为真实升级验收。

## 0.1.1 修复

0.1.0 首次 CI 包缺完整应用签名，虽更新归档签名有效，仍未通过 codesign 验证，已撤出稳定 latest。0.1.1 使用官方支持的 ad-hoc 完整应用签名并在 CI 强制验证 CodeResources/codesign；仍不是 Apple Developer ID 公证。

同版本已发布时，流水线提前跳过构建，不再把 tag push 的重复触发计为发布失败。升级版本同步更新 npm/Tauri/Cargo，页面从实际运行的 native 应用获取版本，不读取更新服务器版本来冒充已安装版本。格式检查已加入 CI，Rust 1.91.1 与本机验证一致；解析器兼容修改保留独立回归。

## 0.1.2 启动恢复

正常启动和更新重启完成时，在 Ready 事件主动显示主窗口，避免新进程启动但窗口不可见。--autostart 保持后台启动。最近活动记录启动版本和实际窗口可见状态；完整原位升级验收结果以 DEVELOPMENT_STATUS.md 为准。

## 0.1.2 验收结果

双架构流水线、发布文件/清单及签名验证通过，0.1.2 已作为 latest 发布。从实际 GitHub 0.1.1 包完成应用内下载、原位替换和新进程启动；新二进制与 GitHub 包逐字节一致，启动日志记录主窗口已显示，账号与存档保留。自动重启后工具不能读取窗口；另行正常打开同一更新后的包确认 0.1.2/Alpha，具体限制和待办保留在开发检查点。不能把正常重新打开视为自动重启时的视觉验收。

## 0.1.3 发布范围

0.1.3 包含已验收的收取优化、补存、保存引导和此前阅读/服务器操作功能，仍为 Alpha。正在开发的异步规则扩展另存分支，没有进入这个版本；本机 Google OAuth 测试配置也不进入公开包。发布说明见 docs/releases/v0.1.3.md，发布与原位升级的实际验收状态见 DEVELOPMENT_STATUS.md。

## Anser 与组织仓库迁移

项目英文名为 Anser，中文名为雁信。后续代码和发布使用 ansermail/anser，安装包以 Anser_版本_架构命名。0.1.5 发布的更新器与发布页使用组织仓库。

存储/钥匙串标识 dev.maildesk.desktop、已有布局/草稿格式标记和更新公钥继续保留。发布密钥仍沿用 ~/.config/yanxin-release/updater.key，避免生成另一把密钥导致旧客户端不能验证更新；开发签名优先读取 ANSER_DEV_SIGNING_IDENTITY，也兼容此前变量名。

个人仓库中已构建的 0.1.3 草稿没有发布。旧安装包仍请求旧仓库的更新端点；代码克隆不会产生 GitHub 转移重定向。需要一次迁移更新或安装组织版后，客户端才改用新端点。删除个人仓库前先完成这一步。

## 组织版 0.1.5 发布结果

v0.1.5 已在 ansermail/anser 正式发布为 latest。Checks 与 Release macOS 全部通过，Apple Silicon 与 Intel 的 DMG、更新归档、签名和统一清单均核验。公开 latest 端点已可读取；应用标识与更新公钥沿用原值。详细运行、签名和存档证据见 DEVELOPMENT_STATUS.md。

旧个人仓库地址不会因克隆自动重定向；旧安装包迁移和新正式包原位更新矩阵仍待验收，不以开发实例显示新版本代替。

## 独立界面预览

公开地址为 https://ansermail.github.io/anser/ 。组织仓库 Pages 使用 GitHub Actions 发布源，`.github/workflows/preview.yml` 在 main 的前端相关变更后构建并部署，也支持手动启动。`npm run build:preview` 生成 `dist-preview`，仅包含虚构示例与展示组件，不包含真实账号连接、桌面命令或发信接口。

本地检查可运行 `npx vite preview --mode preview --host 127.0.0.1 --port 4174`，访问 `http://127.0.0.1:4174/anser/`。Pages 发布与桌面 Release 独立；网页部署成功不表示新版桌面包已发布。

## 0.1.6 云端发布结果

0.1.6 使用组织仓库 GitHub Actions 双架构流水线，包含邮件签名、存档保存位置、设置/写信体验与 EML 文件查看；版本同步五处，发布说明见 [v0.1.6](releases/v0.1.6.md)。本机只执行门槛检查，不提供本地桌面构建作为本次交付。源码 e8e049d，[双架构流水线](https://github.com/ansermail/anser/actions/runs/37940050741) 全部成功。2026-10-09 22:13:59（Asia/Shanghai）[v0.1.6](https://github.com/ansermail/anser/releases/tag/v0.1.6) 已发布为 latest；七个资源 SHA-256、架构/版本/EML 声明、完整 codesign、DMG/更新包二进制及更新签名已核验，公开 latest.json 与验证清单相同。实际正式安装、默认 EML/冷启动与原位升级未在本轮执行，详见 [发布记录](RELEASE_016_WORKING.md)。

## 0.1.7 构建准备

首个持续开发节点包含 RULES-03 完整保存/在线正文核对、EML 入口简化和保存范围数量/磁盘预算。五处版本同步 0.1.7，门槛与原生只读预算检查通过；按用户要求使用组织仓库 workflow_dispatch 构建，草稿/资源/正式发布结果分别在 [工作点](RELEASE_017_WORKING.md) 记录。该准备阶段公开 latest 为 0.1.6；随后 0.1.7 已发布，见下节，开发版本不作为发布证明。

## 0.1.7 云端发布结果

[source1de47d7的Release macOS 38017514986](https://github.com/ansermail/anser/actions/runs/38017514986)双架构与草稿全部成功，核验七资源、签名、公钥、版本/架构/EML、codesign、DMG及对应二进制后，2026-10-10 10:59:30（Asia/Shanghai）[0.1.7](https://github.com/ansermail/anser/releases/tag/v0.1.7)发布为latest。匿名canonical清单逐字节匹配核验文件，更新链接两平台均HTTP200；详见[工作点](RELEASE_017_WORKING.md)。该包包含RULES-03和保存预算，不包含之后e2f7cf6的SYNC下载边界改动。正式安装与原位升级仍未执行，没有Apple Developer ID/公证。
