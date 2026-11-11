# 0.1.41 发布工作点

更新：2026-11-11（Asia/Shanghai）。

## 当前状态：正式发布与分发完成

- 主线业务改动为 `49388dc94a4bc9de21e461a1d5afcfc29e843aff`。阅读区四周统一为 10px，HTML 正文区域使用 12px 圆角。该提交已通过 Checks、Windows validation 和用户的开发预览验收。
- 固定源码 `c360d27b587a5b9aee4a1e07e24b00929cb5b65b`，注释标签 `v0.1.41`（对象 `d8ad0102adf615342b4f3f08fd6fa576943407fc`）已推送。五处版本已通过 Git 暂存对象及固定提交双重核对；发布说明见 [v0.1.41](releases/v0.1.41.md)。
- 本机 Apple Silicon 通过 `npm run test:ci`（70 文件 / 485 项）、`npm run test:rust`（454 通过 / 5 条件忽略）、钥匙串迁移示例（16 通过 / 2 条件忽略）、`npm run test:desktop`（37 项）、vendored IMAP 回归（39 项）、`npm run build`、`npm run build:preview`、`npm run format:check`、Rust fmt 与 `npm run release:check`。
- Release ID `441692517`，于 2026-11-11 20:55:53（Asia/Shanghai）公开为 latest。[v0.1.41](https://github.com/ansermail/anser/releases/tag/v0.1.41)
- [Release desktop 43019626935](https://github.com/ansermail/anser/actions/runs/43019626935) 的全量检查、macOS 双架构、Windows x64 和草稿汇总均成功。Windows Rust 453 项通过、3 项条件忽略；正式安装、启动和托盘恢复冒烟通过。
- 草稿九资源的大小、SHA-256、三平台清单、发布说明原文与固定标签均核验。八份安装/更新文件及签名与 Actions 独立下载的产物逐字节一致，三个更新包使用原公钥经 minisign 验签通过。
- macOS 双架构 App 代码签名及精确 designated requirement、架构、应用标识、版本、本地化、邮件关联及许可均核对通过；双 DMG 只读挂载后与更新归档内应用逐文件一致。macOS 使用项目固定自签名。
- 九资源在公开后匿名下载均返回 HTTP 200，资源 ID、大小与 SHA-256 保持一致。标准 latest 清单与审计清单逐字节一致。
- 安装器公开并核验后推送主线，[Preview Pages 43024671859](https://github.com/ansermail/anser/actions/runs/43024671859) 部署成功。线上官网模块为 0.1.41，双 DMG 与 Windows EXE 链接均返回 HTTP 200，下载摘要与审计文件一致。
- [Homebrew 43024599221](https://github.com/ansermail/anser/actions/runs/43024599221) 通过 style/audit/fetch，配方提交 `8cdd10a` 只修改 `Casks/anser.rb`，其 0.1.41 版本与双 DMG SHA-256 已独立核对。
- 推送 main 同时触发 [Checks 43024671931](https://github.com/ansermail/anser/actions/runs/43024671931) 与 [Windows validation 43024671926](https://github.com/ansermail/anser/actions/runs/43024671926)。分发核验完成时两项仍在执行；正式包的全量检查与 Windows 冒烟结果见上述 Release desktop。

| 资源 | 字节 | SHA-256 |
|---|---:|---|
| `Anser_0.1.41_aarch64.app.tar.gz` | 13077826 | `dfbdbbc2908275d93fbf19168c3fcf890e53cce404b4d84db1e16e5eebdecc9c` |
| `Anser_0.1.41_aarch64.app.tar.gz.sig` | 424 | `9a444658707c386f0466b94c2a462da46106c43b12be74bf8798d0cb08cd87c0` |
| `Anser_0.1.41_aarch64.dmg` | 13620636 | `fb39e636e5ea12f0789de3ec92bae00374a2027e460a10a3b806bf1202883b2b` |
| `Anser_0.1.41_x86_64-setup.exe` | 10317999 | `927695c17ab7da26fc6091b35984bea74fb538841abcc29991144f884952ce45` |
| `Anser_0.1.41_x86_64-setup.exe.sig` | 436 | `5fe24bf9434c8447fe37391c05953b985ae4ca9ca7aeabd1f6198259c4fefe34` |
| `Anser_0.1.41_x86_64.app.tar.gz` | 13695495 | `7cc257af5ad3d21a131a2bd13b391b623d3bb61bb963667180334f6c13e3997e` |
| `Anser_0.1.41_x86_64.app.tar.gz.sig` | 424 | `ae543fab71be45d7d79f568f5903fa10394a09eeb30a3bfb387045500a735b4e` |
| `Anser_0.1.41_x86_64.dmg` | 14351986 | `cdb56014afaffc6e909ac678c91688da93cf10ac8be1e67b3f3bd18f8021df42` |
| `latest.json` | 2306 | `b7aad1a2c708810630fa60393ba028149c6f4f06210196ccbb427bce15a1812a` |

## 真实场景验收范围

此前主线阅读样式已在本机 Apple Silicon 开发预览中由用户验收。Windows 实机、Intel Mac、更多邮件模板及正式包原位升级待验证。本机安装包仍为 0.1.40。
