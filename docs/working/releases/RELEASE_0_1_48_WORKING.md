# 雁信 0.1.48 发布工作点（2026-11-27）

- **代码完成**。固定源码 [`986f783`](https://github.com/ansermail/anser/commit/986f7839827f5b082a093bc4e9fa5e010383a4d9)，注释标签 `v0.1.48`（标签对象 `d824c7b524ee3ae6fe00a8bd6a987c048ccb6c21`）。`package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 与 `src-tauri/tauri.conf.json` 已通过 Git 暂存区与提交对象双重核对为 `0.1.48`，发布说明位于 [docs/releases/v0.1.48.md](../../releases/v0.1.48.md)。工作区未跟踪的 `marketing/` 素材未纳入提交。
- **本地全量门槛通过**。前端 82 文件 / **647 项**（81 文件 547 项 + `src/App.test.tsx` 100 项）、Rust 后端 **493 项**（5 项手工用例跳过）、vendored `imap-proto` **39 项**、桌面脚本 **38 项**，以及 `pnpm release:check`、`pnpm check:ui`、`pnpm check:i18n`（1,993 条双语键）、`pnpm format:check`、`cargo fmt --check`、`pnpm build`、`pnpm build:preview` 与 `git diff --check`。
- **云端构建通过**。
  - [Release desktop 45947574985](https://github.com/ansermail/anser/actions/runs/45947574985)：5/5 任务通过（`check`、`build (aarch64-apple-darwin)`、`build (x86_64-apple-darwin)`、`build-windows` 含 WebView2 冒烟、`draft`）。
  - [Checks 45951261699](https://github.com/ansermail/anser/actions/runs/45951261699)、[Windows validation 45951261689](https://github.com/ansermail/anser/actions/runs/45951261689) 与 [Preview Pages 45951261426](https://github.com/ansermail/anser/actions/runs/45951261426) 全部成功。
- **草稿独立审计通过**（Release ID `460232665`）：
  - 九份资源大小与 SHA-256 全部匹配 GitHub 记录，其中八份安装/更新/签名文件与 Actions 原始产物逐字节一致；`latest.json` 版本、三平台 URL、签名与发布说明原文（含末尾换行）与源码完全一致。
  - 既有更新公钥通过三份 `minisign` 签名校验（`darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`）。
  - Apple Silicon（`f4a1de1d45a3a055100bf288b5e5a96eb05dffd820fdd11824a2af36751aa48b`）与 Intel（`0ea963d71947ed662a96ecd135e7e934bac23d23f27e089c100de3db75e46622`）两套 DMG 与 `.app.tar.gz` 均通过 `codesign --verify --strict --deep`、项目固定证书校验、`dev.maildesk.desktop` / `0.1.48` / 架构校验及 `diff -qr` 逐文件一致；Windows 安装程序确认为 PE32 GUI NSIS 自解压安装包。
- **正式发布与分发核验通过**。
  - 于 `2026-11-27 14:20:43`（Asia/Shanghai）公开为 [v0.1.48 Alpha (latest)](https://github.com/ansermail/anser/releases/tag/v0.1.48)。公开前后 Release ID、标签、目标提交、说明与九份资源摘要保持不变。
  - 全部九份公开资源及标准 `https://github.com/ansermail/anser/releases/latest/download/latest.json` 匿名下载均返回 HTTP 200，大小与 SHA-256 与审计清单逐字节一致。
  - [Update Homebrew Cask 45951250966](https://github.com/ansermail/anser/actions/runs/45951250966) 成功，提交 [`8167d4a`](https://github.com/ansermail/anser/commit/8167d4a) 仅更新 `Casks/anser.rb`，版本与双架构 DMG SHA-256 一致。
  - 官网 `https://ansermail.github.io/anser/` 返回 HTTP 200，部署产物为 `0.1.48`（`assets/home-B9e5PfYg.js`）。
- **真实场景验收与未验证边界**。Apple Silicon 开发预览已验收 Ollama、Grok 和 Adobe 正文深色显示与配色切换，以及 Dribbble 失败图片占位与重试。正式安装版原位升级（含升级后凭据读取）、Intel Mac 实机、Windows 实机，以及多账号拖拽排序、收取异常面板、目录折叠展开与 Windows 端腾讯企业邮登录仍未验证。
