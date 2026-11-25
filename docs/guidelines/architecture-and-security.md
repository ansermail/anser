# 架构、平台与安全规范

本文件沉淀跨平台架构、官网与 Web 预览部署架构、应用持久身份与代码签名、凭据与隐私红线、OAuth 客户端配置及项目许可边界。各专项详细实现直接复用已有核心文档。

## 1. 跨平台桌面架构

- **支持平台**：macOS（Apple Silicon / Intel）与 Windows（首阶段 Windows 10/11 x64 + WebView2），共用同一套 React / TypeScript / shadcn/ui 界面、Rust 邮件协议与原始 MIME 存档格式；平台原生行为分别适配。
- **Windows 平台约束**：GUI 子系统（`PE Subsystem=2`）、融合顶栏与三键 capability、主窗口最小化/关闭进系统托盘与外部窗口独立策略、NSIS 专用 hooks（禁止写扩展名默认值或 `UserChoice`）、LF 换行与 PowerShell 7 脚本、UIA/MSAA 托盘验收等完整规范，详见并维护于 **[docs/WINDOWS.md](../WINDOWS.md#平台工程约束)**。
- **Homebrew 分发（macOS）**：主仓库 `Casks/anser.rb` 单仓维护、显式信任 `ansermail/tap/anser` 单配方校验、`GITHUB_TOKEN` 更新与非官方收录边界，详见并维护于 **[docs/HOMEBREW.md](../HOMEBREW.md)**。

## 2. 官网与 Web 预览架构（GitHub Pages）

- **单源共享**：GitHub Pages 根路径为产品官网，`/demo/` 直接共用桌面 App 与业务组件；官网首页应用展示区复用 `/demo/` 可交互场景并随同一次 Pages 构建更新（已有功能页签链接到对应演示场景，窄屏保留全页入口），官网与演示双向导航，严禁单独维护仿制界面。
- **操作系统下载适配**：官网按访问电脑 OS 默认展示 macOS 或 Windows 下载区并保留手动切换；浏览器无法可靠区分 Mac 芯片时同时提供 Apple Silicon / Intel；手机、平板与未知系统不伪称支持，展示通用下载入口。
- **部署时序**：官网下载地址直接使用 package 版本；准备新版本并推送 `main` 会提前触发 Pages。发布前必须安排好部署时序——安装器公开前保持上一正式版官网，公开后再部署新版并核对线上下载链接返回 HTTP 200，不得将提前成功的 Pages 当作发行完成。

## 3. 应用持久身份、固定签名与凭据隐私

- **持久身份不可变**：应用存储与钥匙串标识 `dev.maildesk.desktop`、钥匙串密钥条目名 `anser-credentials-key-v2` 与加密凭据文件名 `credentials.vault` 均属持久身份，严禁随版本修改，避免丢失既有账号、凭据与本地存档。
- **本地加密凭据库与固定自签证书**：
  - 邮箱密码/OAuth 令牌、全局代理密码与模型 API Key 共用 AES-256-GCM 加密的 `credentials.vault`（权限 `0600`、原子替换）；macOS 密钥由 `/usr/bin/security` 创建和读取，不得改回进程内直接读写统一条目，也不得明文落盘 SQLite 或普通文件；后台 OAuth 刷新写失败保内存待写、不判整次收取失败；升级迁移、删除墓碑及 Windows Credential Manager 适配详见 **[docs/KEYCHAIN.md](../KEYCHAIN.md)**。
  - 开发预览、本地打包与 GitHub 双架构构建统一使用公开证书指纹固定的免费项目自签身份（私钥/P12 密码只在仓库外或 GitHub Secrets），不自动轮换、不把自签根加入系统信任，缺失或不匹配时直接失败，不回退 Apple Development 或临时签名（ad hoc）。
  - 用户已确定不办理付费 Developer ID 或 Apple 公证；开发签名、项目固定自签与 Tauri 更新归档签名均**不等同于 Apple Developer ID 签名、Apple 公证或 Gatekeeper 认可**，文档与发布记录必须明确区分。
- **敏感信息零泄漏**：密码、OAuth 令牌、凭据库密钥、客户端私密配置、Tauri 更新私钥、真实 MIME/数据库/备份严禁进入 Git、发布资源、截图、公开日志、备份或导出；诊断只输出协议结构与任务状态，不输出认证内容或真实邮件正文；凭据库文件不复制进邮件存档与备份。

## 4. 桌面 OAuth 客户端配置与装包核对

- **Google 桌面 OAuth**：更换客户端时同步更新本机受忽略的 `.env.local` 与组织仓库 Secrets `MAIL_GOOGLE_CLIENT_ID` / `MAIL_GOOGLE_CLIENT_SECRET`；仅在原生发布构建注入，禁止使用公开 Repository Variables 或 `VITE_` 变量；编译配置须重建后生效；旧客户端令牌与手填 Client ID 不得当作已迁移，新授权与刷新须独立验收。
- **Microsoft 桌面 OAuth**：使用产品自有公共客户端注册、PKCE 与 `http://localhost/callback` 本机回调；Client ID 同步受忽略 `.env.local` 与组织仓库 Secret `MAIL_MICROSOFT_CLIENT_ID`（仅原生发布构建注入）。所需 IMAP/POP/SMTP 权限为用户委托权限；应用注册/权限声明、用户实际同意、企业租户管理员批准与发布者验证分别记录，不通过新增客户端密钥或无关密码流替代浏览器授权。
- **原生 OAuth 装包核对**：不能只依赖连续字节或 `strings` 搜索（编译器优化可能拆分短字符串常量）；必须在对应配置/交换函数内精确核对重建字节或实际运行结果，不输出配置值或含值反汇编，并核实配置未进入前端构建资源。

## 5. 项目许可边界

- 个人自用免费（含处理个人工作邮件）；企业统一部署、商业集成或销售需事先取得书面授权。
- 对外称“源码公开”，严禁宣称 MIT / Apache / GPL 或允许不受限商用；以仓库根目录 `LICENSE` 为准，不得替换第三方依赖/vendor 原许可，不得自行承诺商业授权价格、范围或合同。完整说明复用 **[docs/LICENSING.md](../LICENSING.md)**。
