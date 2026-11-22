# 0.1.44 发布工作点

更新于 2026-11-22，时区 Asia/Shanghai。

## 发布候选

- 版本已在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 同步为 `0.1.44`。
- 候选范围包含富文本与 Markdown 表格编辑、官方邮箱服务商图标、0.1.43 走查修正、深色邮件品牌页脚、附件真实缩略图、定时发送未来时间约束、长收件人列表行内展开、WebView Backspace 防护和错误边界。
- 发布说明为 [v0.1.44](releases/v0.1.44.md)。正式安装器公开前，README、Homebrew 配方和官网继续保留 0.1.43。
- 本轮使用 `/Volumes/Others/mail` 的本地 `main`。已有五个功能提交保留在原位，其余发布候选修改在完成门禁后作为独立提交加入。

## 已完成的原生复核

- macOS arm64 本地签名包只读核对真实 Soniox 深色页脚、ArcZip 透明图片缩略图、2×3 表格菜单、定时发送浮层、Gmail 长路径三列布局和服务器同步表操作列。
- 定时发送实际输入过当天过去的时分，界面自动回到下一有效分钟；日期面板中过去日期不可点击，取消后没有创建计划。
- 含 24 个抄送的 MVNE 邮件显示前 3 项与 `+21`，可在字段行内展开和收起，未修改或发送邮件。
- 写信表格菜单已在 macOS WebView 核对插入前后全部操作入口、菜单收缩和底部可达性。

## 本地发布门槛

- `npm run release:check` 通过，五处版本一致且发布说明非空。
- 完整前端最终通过 77 个文件 601 项。首轮与 Rust 并行时，`App.test.tsx` 的一个固定分页刷新用例超过本地 5 秒期限；退出并行负载后该用例单独重跑 3.25 秒通过，整文件 91 项再次全部通过。
- 桌面脚本 37 项、Rust 473 项通过且 5 项既有条件忽略、vendored IMAP 39 项通过。
- 生产构建与 Pages 预览构建通过，UI 铁律、1,863 条双语键、TypeScript 和网站检查通过；保留既有动态导入及分包体积提示。
- Prettier、Rust 格式、发布资源检查和差异检查通过。
- 本地签名包构建成功，版本 `0.1.44`、标识 `dev.maildesk.desktop`、项目证书签名与严格 `codesign --verify` 通过。应用包约 32.56 MiB，更新归档 13,722,907 字节且签名文件非空；未做 Apple 公证。

## 云端发布与分发

2026-11-22 已提交并推送 `main`，固定源码 `aa8ed1d019952b2868b711cc1186df1a35d3b27f`，创建与源码一致的注释标签 `v0.1.44`。远端保护分支拒绝本地合并提交后，将历史线性化，候选文件树保持不变，未产生错误 Release。[Checks 45015594342](https://github.com/ansermail/anser/actions/runs/45015594342)、[Windows validation 45015594364](https://github.com/ansermail/anser/actions/runs/45015594364) 和 [Release desktop 45015608793](https://github.com/ansermail/anser/actions/runs/45015608793) 全部成功，Release desktop 的检查、Apple Silicon、Intel Mac、Windows x64 与草稿汇总均通过。

正式 [Release v0.1.44](https://github.com/ansermail/anser/releases/tag/v0.1.44)，ID `454405997`，于 2026-11-22 19:48:37（Asia/Shanghai）公开为 latest。九份资源均已匿名下载并与 Actions 产物及审计结果逐字节一致：

| 资源                                  |     字节 | SHA-256                                                            |
| ------------------------------------- | -------: | ------------------------------------------------------------------ |
| `Anser_0.1.44_aarch64.app.tar.gz`     | 13890127 | `c090c4ba5b23edd1a0dbbd334709dbbd529c3e5798b96f838c01a2d3381d64ad` |
| `Anser_0.1.44_aarch64.app.tar.gz.sig` |      424 | `39219fda5728ac9b3a4fa853f5ac700ef1a88573deec8e6cde1d1cb1914559a6` |
| `Anser_0.1.44_aarch64.dmg`            | 14417676 | `d6f64dda39f53e38394f18921350b793f4a9a048195b7e4c2f0817ac452b9f22` |
| `Anser_0.1.44_x86_64-setup.exe`       | 10917246 | `bfbdc34ba79f4c3d1da2c789cedb6c489798a7243582bbac496d63ee4cb19f80` |
| `Anser_0.1.44_x86_64-setup.exe.sig`   |      436 | `8eedc53201b523920274ea3cdda93e2cc444a905b7c51ee6c8d483df7373d78a` |
| `Anser_0.1.44_x86_64.app.tar.gz`      | 14545338 | `e260ff5778155b0351e14c0942dc1467766cbc7e7b33d29615095ef5b2444bf8` |
| `Anser_0.1.44_x86_64.app.tar.gz.sig`  |      424 | `c07255bb6e0b6e94edeaf7dbd44ab2a1f18522f0b7b53ed0ea06bc9cabd0e0a8` |
| `Anser_0.1.44_x86_64.dmg`             | 15182365 | `6649c1b68aaa6dae7592f8489af020c5eb79700a5e71fe636ec64c895834c30d` |
| `latest.json`                         |     3379 | `add9ce61eec11a8963bb04a58cf3c1c96a423898bc29e1b162c68aae2d87abe1` |

`latest.json` 的版本、平台 URL 与三份更新签名匹配，Release 正文、清单 notes 和 [发布说明](releases/v0.1.44.md) 原文一致。Mac 双架构 App 版本、架构、标识、macOS 12.0、`zh-Hans/en`、EML/EMLX/MSG 关联、许可、严格签名与精确 designated requirement 通过。Windows 冒烟覆盖 GUI 子系统、无原生菜单、最小化到托盘、托盘恢复、外部邮件窗口、原生外链、协议注册及受保护关联不变，全部为真。三个安装器匿名访问返回 HTTP 200，标准更新端点 `releases/latest/download/latest.json` 返回 200 且与草稿版清单逐字节一致。

[Homebrew 45019129529](https://github.com/ansermail/anser/actions/runs/45019129529) 成功，`main` 远端产生配方提交 `36c69b3`，只修改 `Casks/anser.rb`。配方版本为 `0.1.44`，Apple Silicon 与 Intel DMG 摘要分别为 `d6f64d…` 和 `6649c1…`，与公开资源一致。

首次 [Preview Pages 45015594375](https://github.com/ansermail/anser/actions/runs/45015594375) 在安装器公开前主动取消，官网保持 0.1.43。安装器公开后触发 [Preview Pages 45019437445](https://github.com/ansermail/anser/actions/runs/45019437445)，部署成功。线上首页 bundle 版本为 `0.1.44`，Apple Silicon DMG、Intel DMG 与 Windows x64 安装器链接指向公开的 `v0.1.44` 资源，三个链接均返回 HTTP 200。

## 验证边界

- Windows 与 Intel Mac 实际桌面使用、原位升级及更多真实邮件模板仍需单独验收。
- macOS 正式包继续使用项目自签名，不代表 Apple Developer ID、公证或 Gatekeeper 系统信任。
- 原生复核只读使用真实邮件，未发送、删除或修改邮件。正式安装后的用户验证由用户完成。
