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
4. 等待两架构构建和草稿生成，核验 DMG、app.tar.gz、sig、latest.json 和版本说明；再发布草稿。当前 v0.1.2 仍属于 Alpha，不代表开发计划全部完成。
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
