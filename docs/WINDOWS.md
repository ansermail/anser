# Windows 客户端

首阶段面向 Windows 10/11 x64，使用系统窗口控件、Microsoft Edge WebView2 和每用户 NSIS 安装器。与 macOS 共用邮件协议、SQLite 索引和原始 MIME 存档。当前在 `codex/windows-support` 验证；公开 0.1.34 仍只有 macOS 安装包。

## 安装与使用

本轮使用独立版本 0.1.35，按用户要求仅保存 GitHub Release 草稿，不正式发布。Windows validation 成功后，也可从对应 Actions 的 `Anser-Windows-x64-validation` artifact 获取 `*-setup.exe`。此前 0.1.34 验证包仅为构建检查，不属于公开 0.1.34 资源。Windows 实机验收安排在 2026-10-28；验收后是否发布另行决定。

安装器默认仅安装给当前用户。未安装 WebView2 Runtime 时，通过嵌入的引导程序下载运行环境，此时需要联网。当前没有 Windows Authenticode 代码签名，系统可能显示未知发布者；Tauri 更新签名与 Windows 发布者签名分别验证。

界面保留原生最小化、最大化和关闭按钮；新建邮件、搜索、回复和转发使用 Ctrl 快捷键。邮箱密码、OAuth 令牌和代理密码仍保存在本地加密凭据库，库的密钥存入当前用户的 Windows Credential Manager。

安装器注册 EML 打开方式和 `anser:` 通知激活协议，但不替用户修改受保护的默认应用选择。需要设为默认应用时，在“设置与账号 → 应用偏好”打开 Windows 默认应用设置，由用户选择；也可从资源管理器的“打开方式”选择雁信。

关闭窗口后仍可通过系统托盘打开、检查邮件或退出。系统通知使用持久化的不透明定位令牌；通知目标失效时不会按主题或服务器 UID 猜测邮件。真实收发、通知点击、系统打印和升级验收单独记录。

## Windows 开发

需要 Node.js 22.15+、Rust MSVC 工具链、Visual Studio Build Tools 的“使用 C++ 的桌面开发”及 Windows SDK、WebView2 Runtime。CI 固定 Rust 1.91.1，PowerShell 脚本使用 PowerShell 7。

```powershell
npm ci
npm run desktop
```

`npm run desktop` 复用项目启动器，在 Windows 不执行 macOS 签名或应用包封装。OAuth 配置仍由仓库外配置或环境变量加载，不提交令牌或客户端配置。

```powershell
npm run build
node scripts/windows-build.mjs
```

上述命令生成不发布更新的验证安装器，输出在 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。本地构建需配置既有三项桌面 OAuth 环境变量。正式打包使用 `npm run desktop:build` 或 Release desktop 工作流，并要求既有 Tauri 更新私钥。

## 验证与发布边界

Windows validation 执行格式、前端与脚本测试、生产构建、Rust 与 IMAP 测试，然后安装 NSIS 包。原生冒烟检查 WebView2 首屏、外部虚构 EML 正文、正文外链实际点击、通知协议注册及默认关联未被改写；完成后卸载隔离测试应用。它不连接真实邮箱。

Release desktop 将 macOS 两架构与 Windows x64 一并收齐后才生成草稿。新版本共九项资源：两组 Mac DMG/更新归档/签名，Windows NSIS EXE/签名，以及包含三平台的 `latest.json`。Homebrew 仍仅同步两份 Mac DMG。

Windows 真实桌面、收发/IDLE、通知点击冷启动、附件打开、A4 打印和原位升级尚需相应环境验收。每轮已执行结果与失败入口见 [Windows 工作点](WINDOWS_SUPPORT_WORKING.md)。
