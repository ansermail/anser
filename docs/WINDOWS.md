# Windows 客户端

首阶段面向 Windows 10/11 x64，使用融合式窗口顶栏、Microsoft Edge WebView2 和每用户 NSIS 安装器。与 macOS 共用邮件协议、SQLite 索引和原始 MIME 存档。0.1.35 已正式发布，完成 Windows 11 实机与云端安装冒烟；Windows 10 实机仍未验证。

## 安装与使用

0.1.35 可从[官网](https://ansermail.github.io/anser/)或[GitHub Releases](https://github.com/ansermail/anser/releases/latest)下载 `Anser_0.1.35_x86_64-setup.exe`。官网默认选择访问电脑的 Windows/macOS，也可手动切换；手机或未知系统显示通用电脑下载提示。

安装器默认仅安装给当前用户。未安装 WebView2 Runtime 时，通过嵌入的引导程序下载运行环境，此时需要联网。当前没有 Windows Authenticode 代码签名，系统可能显示未知发布者；Tauri 更新签名与 Windows 发布者签名分别验证。

Windows 顶栏与应用界面融合，右上角提供最小化、最大化/还原和关闭按钮，不重复显示图标与应用名，也不额外展示 File/Edit 等默认菜单栏；新建邮件、搜索、回复和转发使用 Ctrl 快捷键。邮箱密码、OAuth 令牌和代理密码仍保存在本地加密凭据库，库的密钥存入当前用户的 Windows Credential Manager。

安装器注册 EML 打开方式和 `anser:` 通知激活协议，但不替用户修改受保护的默认应用选择。需要设为默认应用时，在“设置与账号 → 应用偏好”打开 Windows 默认应用设置，由用户选择；也可从资源管理器的“打开方式”选择雁信。

Windows 主窗口最小化或关闭后继续在后台运行，可通过系统托盘打开、检查邮件或退出；独立邮件窗口按系统方式最小化。Windows 可能将新图标收进右下角“显示隐藏图标”，可在系统任务栏设置中将雁信固定显示。系统通知使用持久化的不透明定位令牌；通知目标失效时不会按主题或服务器 UID 猜测邮件。真实收发、通知点击、系统打印和升级验收单独记录。

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

Windows 11 真实窗口、草稿、系统通知横幅及外部邮件已检查；发送与打印由用户实测通过。Windows 10 实机、IDLE 新到达、绑定邮件通知冷启动及原位升级尚未验证。完整记录见 [Windows 发布工作点](WINDOWS_RELEASE_WORKING.md)。

## 2026-10-28 实机与云端验收

- [x] 真实 Windows 11 的融合顶栏、最大化/还原、最小化隐藏；原有账号及邮件可读。
- [x] 空白写信关闭没有新增草稿；虚构草稿保存后重开仍保留主题和正文。
- [x] 测试系统通知横幅实际显示。
- [x] 外部长 EML 的收件人/抄送、60 段正文末尾及附件名称可见。
- [x] 用户确认邮件发送、打印已测且没有问题；未由代理另行发送或逐页审计打印 PDF。
- [x] 最终源码的 Windows validation：前端 463、Rust 432（2 项既有忽略）、IMAP 39、桌面脚本 37，安装与原生窗口/托盘/EML/外链/默认关联保护通过。
- [ ] Windows 10 实机、Ctrl 快捷键完整组合、全服务商兼容、凭据重启读取专项。
- [ ] IDLE 主动新到达、绑定邮件通知在运行中与冷启动的定位。
- [ ] EMLX/MSG、普通附件实际打开、系统默认应用选择及真实桌面卸载专项。
- [ ] 跨版本升级及数据保留；首次安装不作为升级证据。

用户实机安装的是 `9c3aaae` 验证包；最终源码 `bd4d062` 的 Windows validation 40650747611 全部通过，安装器 SHA-256 为 `187263d11a4bc28b78af3fa55018b2656d4bfe5d2b8f9a60f8fe8c43743fe0bc`。该验证包不等同于随后带更新签名的正式资源，正式资源审计继续见发布工作点。虚构 `WINDOWS-QA-20261028` 测试草稿未发送，保留供核对。

正式资源：`Anser_0.1.35_x86_64-setup.exe`，10172155 字节，SHA-256 `46d51eb38a29d743ae777c2634447a9931b16e85768f66856f521e7eed5eb8d4`。已核对公开匿名下载和 Tauri 更新签名；该签名不等同于 Authenticode。
