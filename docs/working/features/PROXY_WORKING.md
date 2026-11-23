# 全局网络代理工作点（2026-10-14）

## 目标和范围

用户最初参考截图提出代理名称、SOCKS5/HTTP/HTTPS、地址、端口、可选用户名/密码和“代理失败时直连”。随后明确只要设置页一个全局代理，由本地代理端自行分流，不做账号级配置。当前分支 `main`，基线为本轮开工时 `origin/main`；本轮改动尚未提交或发布。2026-10-14 按用户要求完成本地 macOS 构建、安装和启动，供用户测试。

## 已改代码

- `src/components/network-proxy-settings.tsx`、`src/App.tsx`：设置页全局代理卡片和编辑弹窗，组合现有 shadcn 组件；默认关闭，开启后新连接使用。
- `src-tauri/src/models.rs`、`productivity.rs`、`lib.rs`：代理非敏感配置随全局 Preferences 持久化；独立写入命令避免通知/检查间隔的旧快照清掉代理；启动恢复。
- `src-tauri/src/proxy.rs`、`network.rs`：SOCKS5 或 HTTP CONNECT、HTTPS 代理 TLS、单次回环隧道；IMAP/POP3/SMTP 在隧道之上以原服务器名称继续 TLS 校验。直连回退仅在代理握手未完成时发生，已开始发件不跨路线重试。
- `src-tauri/src/auth.rs`：应用内 OAuth 授权码交换与刷新令牌使用同一全局代理；仅连接失败且允许回退时使用直连。系统浏览器加载 OAuth 授权页面不受应用内代理控制。
- `src/lib/api.ts`、`types.ts`：隔离演示数据中的设置保存。代理密码仅使用 `dev.maildesk.desktop` 钥匙串 `network-proxy` 条目；SQLite、前端持久数据和日志不含密码。

## 已执行验证

- `cargo check --manifest-path src-tauri/Cargo.toml`：最终小改动后复核通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`：325 通过、0 失败、1 原有性能项忽略；当时已有 4 项本轮代理测试；之后补 SOCKS5 用户名/密码测试，当前代理专项 5/5 通过，并在既有偏好测试中增加全局代理持久性断言，单项复测通过。最新两处补测尚未再次全量复跑 Rust。
- `npm run format:check`、`npm run build`：通过，包含 `check:ui`、TypeScript 和 Vite 生产构建。
- `npm run build:preview`：通过，虚构数据与原生 IPC 隔离检查通过。
- 前端首次 `npm test` 为 289/290 通过；演示模式保存通知偏好时多写 `proxy:null` 导致 1 项旧断言失败，修复后 `npx vitest run src/components/storage-tools.test.tsx` 4/4 通过，最终 `npm test` 全量 290/290 通过。
- 浏览器演示预览：在“设置与账号”中打开弹窗，保存 `Clash / SOCKS5 / 127.0.0.1:7890`，卡片显示并在页面重开后继续存在；截图 `/tmp/anser-proxy-preview.png` 仅含虚构数据，未入仓库。
- 2026-10-14 `npm run desktop:build`：生产前端、Rust release 编译、本地 `.app` 打包、Apple Development 签名及更新归档/签名成功。构建机 arm64，产物 `src-tauri/target/release/bundle/macos/雁信.app`；`codesign --verify --strict` 通过，Info.plist 标识 `dev.maildesk.desktop`、版本 `0.1.14`、原生可执行文件 arm64。未进行 Apple 公证。
- 原 `/Applications/雁信.app` 为 ad hoc 签名；退出后台实例后备份至 `/Volumes/Others/yanxin-local-backups/2026-10-14-proxy-preinstall/雁信.app`，将本地新包安装至 `/Applications/雁信.app` 并启动，进程路径已核对。新包为稳定 Apple Development 签名，因旧包签名要求不同，钥匙串访问可能需要用户首次确认；未读取或更改任何邮箱凭据。本地存储标识与账号目录保持原值。

## 未完成和下一步

1. 用户测试本地安装包的设置页与真实代理连接；真实本地代理下的 IMAP/POP3、SMTP、OAuth 令牌交换/刷新尚未执行。未对未授权收件人发信。
2. 系统浏览器的初次 OAuth 登录页仍取决于浏览器自身网络设置；应用代理只作用于后台令牌请求。HTTPS 代理需要可信证书。正式双架构构建、云端流水线、发布、原位升级均未验证，公开版本保持 0.1.14。
