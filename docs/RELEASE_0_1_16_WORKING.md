# 0.1.16 Alpha 邮件链接修复与发布工作点

## 目标与状态（2026-10-14）

用户在 0.1.15 正式发布后报告邮件正文外链点击被 CSP `frame-src` 拦截，控制台暴露旧英文名 `yanxin-mail-link.invalid`。0.1.15 已发布，不覆盖标签或产物；在 `main` 基于 `63fb6c25e62506a790b61532127199251f701f5d` 准备 0.1.16。用户此前授权提交代码并通过组织仓库远程流水线发版，本修复沿用该交付路径。

根因：原生安全外链被改写为内部 HTTPS 路由，但在禁脚本邮件 iframe 内导航，主页面 CSP 在 Tauri 导航钩子前拦截。修复将安全链接设置为 `_top`，iframe 仅允许用户操作触发顶层导航，由 Tauri 取消并转交系统浏览器或写信。内部路由与新生成标记改用 Anser；历史本地布局键、签名环境变量别名、更新密钥路径及 `dev.maildesk.desktop` 保持兼容。

## 已验证

- 前端相关 15 项及 Rust 路由 1 项通过，`npm run check:ui` 通过（修复阶段初测，最终门槛需重跑）。
- 使用实际 `safeMailHtml` 生成的安全链接在隔离浏览器测试页面点击后发起顶层导航，未再遭 `frame-src` 拦截；独立浏览器没有 Tauri 导航钩子，因此其 DNS 错误只表明导航尝试，不能当作原生系统浏览器验收。
- `npm run desktop` 编译并运行 0.1.16 开发预览后，在虚构演示邮件中临时注入仅供本地回归的 `https://example.com/` 链接；原生阅读页的链接显示 Anser 安全路由，实际点击后系统 Chrome 打开 Example Domain，原应用未离开阅读页。临时注入已从源码移除。该验证是原生开发预览，不等于正式安装包或升级验收。
- `npm test` 49 文件/290 项、`npm run test:desktop` 30 项、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 和 `npm run release:check` 已通过。完整门槛其他命令仍在执行。
- 其余本地门槛完成：`npm run test:rust` 326 通过/1 独立性能项忽略，vendored IMAP 39 通过，`cargo check --manifest-path src-tauri/Cargo.toml`、`npm run build` 与 `npm run build:preview`（含虚构数据及原生桥隔离）通过。脚本临时目录命名改为 Anser 后 `npm run test:desktop` 30 项及 `npm run format:check` 已重跑通过。
- `npm run desktop:build` 生成本地 arm64 `雁信.app` 及更新归档/签名；完整 `codesign --verify --deep --strict` 通过，Info.plist 为 0.1.16、标识 `dev.maildesk.desktop`。旧 `/Applications/雁信.app` 先备份到 `/Volumes/Others/yanxin-local-backups/2026-10-14-links-preinstall/雁信.app`，再覆盖安装；已安装二进制 SHA-256 与构建包一致，启动后设置页显示 Anser · 雁信 0.1.16，既有三个账号和代理配置仍可见。这是 Apple Development 本地签名，正式发布/原位升级和钥匙串复授权未据此宣称验收。

## 下一步

1. 审阅暂存隐私，固定源码推送组织 `main`；`mailto:` 原生点击及打开失败反馈尚未独立验收。
2. 启动新版本双架构 `release.yml`，逐项审计草稿七资源、清单、签名、App、DMG、OAuth 编译配置后发布并核对公开端点。代码、云端构建、正式发布和真实场景验收分别记录。

## 未完成验收

- 正式包安装/原位升级、真实代理收发/OAuth 刷新，以及 Apple Developer ID 签名和公证目前尚未通过实际验收。
