# 雁信 0.1.49 发布工作点（2026-11-28）

- **发布范围**。OpenPGP 签名及加密、PGP/MIME 附件显示、队列撤销倒计时、收取中暂停账号、英文引用头、翻译排版与连接诊断、Windows 标题栏避让。发布说明见 [v0.1.49.md](../../releases/v0.1.49.md)。
- **代码与场景验收**。见 [开发检查点](../../DEVELOPMENT_STATUS.md)。本地 Apple Silicon 开发版、独立 WKWebView、合成 OpenPGP 密钥与此前单向真实收发的验收各有记录。真实 SMTP 倒计时、Windows x64 实际桌面使用、Intel Mac 实机及正式安装包原位升级未验证。
- **发布顺序**。标签固定源码后由云端构建并审计草稿，三平台安装器公开后将发布提交推至 `main`，再部署 Pages 下载链接。

- **固定源码与本地发布门槛**。标签 `v0.1.49` 已指向 [`3e38f84`](https://github.com/ansermail/anser/commit/3e38f848c4642c2c092d8ff63d95dd4aad9fd0c2)。在暂存区和提交对象核对四处版本与发布说明。前端 85 文件 / 660 项、Rust 501 项通过（5 项忽略）、vendored `imap-proto` 39 项、桌面脚本 38 项均通过。版本预检、格式、生产及 Pages 预览构建和差异检查通过。
- **云端构建通过**。[Release desktop 46109067806](https://github.com/ansermail/anser/actions/runs/46109067806) 的五项任务均通过，包含两种 macOS 架构的固定签名验证、Windows x64 原生回归与 WebView2 启动冒烟，并生成九份资源的草稿（Release ID `461322908`）。
- **草稿独立审计通过**。九份资源大小和 SHA-256 均与 GitHub 记录相符，八份安装、更新和签名文件均与 Actions 原始产物摘要一致。三平台更新签名及 `latest.json` 的 URL、版本与发布说明原文核对通过。双架构 Mac DMG 与更新归档内应用通过固定签名、版本、身份和架构校验，文件逐一一致。

- **正式发布与分发**。2026-11-28 13:25:41（Asia/Shanghai）公开 [v0.1.49 Alpha](https://github.com/ansermail/anser/releases/tag/v0.1.49) 为 latest。九份公开资源和标准更新端点均可匿名访问，完整内容与审计 SHA-256 一致。Intel 更新归档整包匿名下载超时后，使用四段 HTTP 范围请求拼合并核对完整文件。
- **官网及 Homebrew**。[Preview Pages](https://github.com/ansermail/anser/actions/runs/46112084864) 通过，官网 `home-IaMn0PuN.js` 与 `index-GpOccuyw.js` 同本地 `0.1.49` 构建逐字节一致。[Homebrew](https://github.com/ansermail/anser/actions/runs/46112063371) 发布提交 [`622a9de`](https://github.com/ansermail/anser/commit/622a9de)，配方版本和双架构 DMG 摘要一致。
- **PR**。[PR #4](https://github.com/ansermail/anser/pull/4) 于 13:31:08（Asia/Shanghai）关闭，账号暂停和 Windows 抽屉两项改动均已进入发布版本。
- **发布后主线检查**。发布流水线已通过全量检查与三平台验证。单独的 `main` 推送流水线 [Checks](https://github.com/ansermail/anser/actions/runs/46112084901) 与 [Windows validation](https://github.com/ansermail/anser/actions/runs/46112084899) 在记录时仍运行中。
