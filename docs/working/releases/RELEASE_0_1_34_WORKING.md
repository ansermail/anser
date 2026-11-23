# 0.1.34 发布工作点

更新：2026-10-27。用户要求保留原邮件打印格式、正常 A4 比例；完成开发后要求恢复本机原正式版、清理临时产物与预览、提交代码发版。

## 当前状态：正式发布、资源审计、Homebrew 与清理均完成

- 工作区 `/Volumes/Others/mail`，main，基线 c6985a2；上一公开版本 v0.1.33。
- 范围：完整安全净化文档的隔离打印、原 CSS/字体/字号/配色/间距、有界资源等待、长邮件分页，以及 macOS 独立 A4/纵向/100% 参数与系统面板控件。实现与原生预览证据见 MAIL_PRINT_FORMAT_WORKING.md。
- 五处版本同步为 0.1.34，应用标识/本地存档/钥匙串与更新公钥不变。
- 既有 mail-images.ts 与 mail-images.test.ts 未提交修改单独保护，验证及发布提交不包含该 WIP，现已逐字节恢复。
- 当前开发进程已退出，开发 bundle 已注销注册并移入废纸篓；本轮 30 份测试 PDF/截图/探针等及 14 份开发/旧审计 App 副本已可恢复清理，清单在废纸篓 Anser-print-cleanup-20261027-161225/cleanup-report.json。正式 `/Applications/雁信.app` 0.1.33 保留并恢复启动，界面确认原三个账号、5,499 封完整存档与 5,939 个对话可读；LaunchServices 最终只注册该正式路径。本轮 dist/dist-preview 与空开发包目录也已移入废纸篓，当前清理清单 47 项（14 个 App、30 个测试文件、3 个生成目录）。

## 发布清单

- [x] 本地全量门槛：`npm test` 64 文件 445/445；`cargo test` 429 passed / 4 ignored；桌面脚本 36/36；vendored IMAP 39/39。UI、i18n（1,348 条）、TypeScript、生产/Pages 构建、Prettier、rustfmt、五处版本及 diff 检查通过，只有既有 Vite 分包提示。
- [x] 暂存对象与固定提交五处版本、敏感文件核对。发布提交 c1e827e0b908c73307cb23e106c4a4368a7a40b2，仅包含本轮范围；v0.1.34 为新注释标签，解引用为同一提交。
- [x] main 与 v0.1.34 已推送。
- [x] [Checks 40472389821](https://github.com/ansermail/anser/actions/runs/40472389821) 与 [Pages 40472389775](https://github.com/ansermail/anser/actions/runs/40472389775) 成功。
- [x] [Release macOS 40472397842](https://github.com/ansermail/anser/actions/runs/40472397842) 的 check、Apple Silicon、Intel 与 draft 全部成功。
- [x] 七资源元数据、大小/SHA-256 与 GitHub digest 一致；两份更新签名通过既有公钥验证。两架构 App 版本/架构/标识/最低 macOS/语言/EML/许可、固定签名与精确 DR、两份 DMG 与更新归档逐文件一致，说明原文及平台 URL/签名匹配。
- [x] Release ID 425195190 于 2026-10-27 16:35:01（Asia/Shanghai）正式发布为 latest，标签与源码不变。
- [x] 发布后匿名重新下载全部七资源，ID/大小/SHA-256 与审计一致；标准 latest/download/latest.json 与审计清单逐字节相同。
- [x] [Homebrew 40474521258](https://github.com/ansermail/anser/actions/runs/40474521258) 成功，style/audit/fetch 通过，提交 [866ab92](https://github.com/ansermail/anser/commit/866ab923889cb4f5074d0e50468c898fd1f16140) 仅修改 Casks/anser.rb；两架构 DMG SHA-256 与审计一致。重复运行 [40474833538](https://github.com/ansermail/anser/actions/runs/40474833538) 成功，明确返回 Cask is already current; no commit needed.
- [x] 两处既有 WIP 恢复，逐字节与保护快照一致。dist / dist-preview / 空开发包目录已移入废纸篓；正式应用进程来自 /Applications/雁信.app。
- [x] 下载、解包与审计临时目录移入同一废纸篓，清理清单共 49 项；最终核对仅 /Applications/雁信.app 注册并运行，版本仍为用户原正式 0.1.33。既有两处 WIP 与保护快照逐字节相同，未删除邮箱数据、配置、凭据或源码。
- [x] README、UPDATES、USAGE 与当前检查点更新为实际交付结果；末次提交仅维护发布记录，标记 [skip ci]，不另行重建已核验的固定发布源码。

## 边界

原格式和 A4 默认值已在开发包原生系统面板与 PDF 核对；真实纸张打印、原生长正文分页、正式 0.1.34 安装/升级及 Intel 实机未验证。恢复本机原正式 0.1.33 与发布 0.1.34 分别记录，不把旧包启动当作新包验收。

## 最终交接

本轮目标完成。用户可继续使用本机原 0.1.33，或通过公开 0.1.34 Release、应用内更新或 Homebrew 取得新版；本轮未自动替换正式应用。当前工作树只保留开工前的两处图片诊断 WIP。恢复物与审计报告保存在废纸篓 Anser-print-cleanup-20261027-161225，47-anser-release-0.1.34 内含 audit.json 与 public-verification.json，未永久清空废纸篓。

## 七资源审计

| 资源 | 字节 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.34_aarch64.app.tar.gz` | 12921804 | `4ecec4e61fbf5318e0536a375c8f49e05dc80e9b4ff2f0648bd404973897b1ca` |
| `Anser_0.1.34_aarch64.app.tar.gz.sig` | 424 | `698d90d50b2a075f3ed5a63c1e8a7a9b783512b6e6c2dc484e470e9d3c342daf` |
| `Anser_0.1.34_aarch64.dmg` | 13471541 | `2a7eda4da50de2ad0e3934f36eb841fd98094d617198851ca0f94df7a44fa35e` |
| `Anser_0.1.34_x86_64.app.tar.gz` | 13532184 | `5591d2cc3de4af58c8d25f2d0839e4f1163b3bd0b16179ea56290571a0f94ea3` |
| `Anser_0.1.34_x86_64.app.tar.gz.sig` | 424 | `a8854aee7ae00d52ed49335c469d52a49be8cbeb4386e8c02df270f400ef4924` |
| `Anser_0.1.34_x86_64.dmg` | 14182628 | `b8e5e52bc01475e5106d404416fa0dd288523d5b76bd9f627bbc31c3873b4a52` |
| `latest.json` | 2541 | `7dd7219fdd85654c72ca2528900b223a178a2a97d55536dd50f42fad9a0664f6` |
