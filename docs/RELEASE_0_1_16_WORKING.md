# 0.1.16 Alpha 邮件链接修复与发布工作点

## 当前状态（2026-10-14）

0.1.16 已从固定源码 `8a13673a5bdd0cc8f13f976956f84e035e64ec61` 经组织双架构流水线构建、审计并正式发布，详情见文末“云端发布与审计”。标准 latest URL 经短暂 CDN 缓存后已返回与审计清单逐字节相同的 0.1.16。实际原位升级及真实代理测试仍独立待验收。

## 目标与基线（历史）

用户在 0.1.15 正式发布后报告邮件正文外链点击被 CSP `frame-src` 拦截，控制台暴露旧英文名 `yanxin-mail-link.invalid`。0.1.15 已发布，不覆盖标签或产物；在 `main` 基于 `63fb6c25e62506a790b61532127199251f701f5d` 准备 0.1.16。用户此前授权提交代码并通过组织仓库远程流水线发版，本修复沿用该交付路径。

根因：原生安全外链被改写为内部 HTTPS 路由，但在禁脚本邮件 iframe 内导航，主页面 CSP 在 Tauri 导航钩子前拦截。修复将安全链接设置为 `_top`，iframe 仅允许用户操作触发顶层导航，由 Tauri 取消并转交系统浏览器或写信。内部路由与新生成标记改用 Anser；历史本地布局键、签名环境变量别名、更新密钥路径及 `dev.maildesk.desktop` 保持兼容。

## 已验证

- 前端相关 15 项及 Rust 路由 1 项通过，`npm run check:ui` 通过（修复阶段初测，最终门槛需重跑）。
- 使用实际 `safeMailHtml` 生成的安全链接在隔离浏览器测试页面点击后发起顶层导航，未再遭 `frame-src` 拦截；独立浏览器没有 Tauri 导航钩子，因此其 DNS 错误只表明导航尝试，不能当作原生系统浏览器验收。
- `npm run desktop` 编译并运行 0.1.16 开发预览后，在虚构演示邮件中临时注入仅供本地回归的 `https://example.com/` 链接；原生阅读页的链接显示 Anser 安全路由，实际点击后系统 Chrome 打开 Example Domain，原应用未离开阅读页。临时注入已从源码移除。该验证是原生开发预览，不等于正式安装包或升级验收。
- `npm test` 49 文件/290 项、`npm run test:desktop` 30 项、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 和 `npm run release:check` 已通过。完整门槛其他命令仍在执行。
- 其余本地门槛完成：`npm run test:rust` 326 通过/1 独立性能项忽略，vendored IMAP 39 通过，`cargo check --manifest-path src-tauri/Cargo.toml`、`npm run build` 与 `npm run build:preview`（含虚构数据及原生桥隔离）通过。脚本临时目录命名改为 Anser 后 `npm run test:desktop` 30 项及 `npm run format:check` 已重跑通过。
- `npm run desktop:build` 生成本地 arm64 `雁信.app` 及更新归档/签名；完整 `codesign --verify --deep --strict` 通过，Info.plist 为 0.1.16、标识 `dev.maildesk.desktop`。旧 `/Applications/雁信.app` 先备份到 `/Volumes/Others/yanxin-local-backups/2026-10-14-links-preinstall/雁信.app`，再覆盖安装；已安装二进制 SHA-256 与构建包一致，启动后设置页显示 Anser · 雁信 0.1.16，既有三个账号和代理配置仍可见。这是 Apple Development 本地签名，正式发布/原位升级和钥匙串复授权未据此宣称验收。

## 发布前执行步骤（已完成）

1. 已审阅暂存隐私并固定源码推送组织 `main`；`mailto:` 原生点击及打开失败反馈尚未独立验收。
2. 已启动新版本双架构 `release.yml`，逐项审计草稿七资源、清单、签名、App、DMG、OAuth 编译配置后发布并核对公开端点。代码、云端构建、正式发布和真实场景验收分别记录如下。

## 未完成验收

- 正式包安装/原位升级、真实代理收发/OAuth 刷新，以及 Apple Developer ID 签名和公证目前尚未通过实际验收。

## 固定源码与云端发布

- 仅暂存本轮 27 个代码/版本/文档文件；`git diff --cached --check` 通过，暂存文件名无 `.env`、数据库、MIME、截图、私钥或安装包。本机 `.env.local` 中 3 个长度足够的配置值与暂存差异比较均未命中，未输出配置值。
- 提交 `8a13673a5bdd0cc8f13f976956f84e035e64ec61` 已推送组织 `main`。此前经认证查询 0.1.16 Release 和 tag 均返回 404，远端 main 为 0.1.15 源码。触发 [Release macOS 38547036796](https://github.com/ansermail/anser/actions/runs/38547036796)，event=`workflow_dispatch` 且 headSha 为本次源码；check、Apple Silicon、Intel、draft 四项全部成功。
- 草稿 Release ID `412579399`、目标提交、发布说明原文（含末尾换行）与 7 资源身份已在发布前复核。七资源下载到仓库外 `/tmp/anser-release016-audit-8a13673`，逐项大小/SHA-256 与 GitHub 元数据匹配；清单版本、说明原文、两平台 URL 和签名与源码/资源匹配。
- 两架构更新归档由应用配置中同一公钥及独立 minisign 验证器验签通过。两 App 均为 0.1.16，arm64/x86_64 架构、`dev.maildesk.desktop`、完整 codesign、许可资源及 EML 声明核对通过；两个 DMG 磁盘校验通过，挂载后每个 App 的 8 个文件/链接逐项散列与对应更新归档相同。
- 两架构 `auth::client_id`/`auth::exchange` 函数中的 Google/Microsoft OAuth 配置经精确引用字节或立即数重建后与本机忽略配置匹配，未输出配置值；两个 App 的前端资源不含本机 OAuth 值。云端构建前的三项 OAuth Secret 非空检查通过。
- 发布前草稿 ID、目标、说明及七资源 ID/大小/摘要与审计快照不变；发布前标准 latest 为 0.1.15，0.1.16 标签不存在。于 18:16:42（Asia/Shanghai）正式发布 [v0.1.16](https://github.com/ansermail/anser/releases/tag/v0.1.16)。发布后 ID、目标、说明和七资源仍一致，标签精确指向 `8a13673a5bdd0cc8f13f976956f84e035e64ec61`。七份按版本公开下载文件逐字节匹配审计文件。
- GitHub `releases/latest` API 已指向本版；标准无参数 `releases/latest/download/latest.json` 曾短暂返回缓存的 0.1.15，随后已返回 0.1.16 并与审计清单逐字节相同。带刷新参数的同一入口此前也已匹配，未用它代替标准端点验收。
