# 0.1.42 发布工作点

更新：2026-11-15（Asia/Shanghai）。

## 当前状态：0.1.42 已公开，等待主页部署收尾

- 固定源码为 `2faab2545d147f3c272cb08c68727da007a8c4a4`，注释标签 `v0.1.42`；正式 Release ID 为 `446061216`，于 `2026-11-15T13:08:09Z` 公开为 latest。
- 本版包含 AI 邮件摘要与写信助手、日历与多维工作台、邮件标签、数据表格及当前工作台交互修正。发布说明见 [v0.1.42](releases/v0.1.42.md)，Release 正文与发布文件逐字节一致。
- 本地门槛通过：前端 74 文件 562 项，Rust 472 项通过/5 项条件忽略，桌面脚本 37 项，IMAP 39 项，钥匙串迁移示例 16 项通过/2 项条件忽略；生产与 Pages 构建、UI 铁律、1794 条双语键、Prettier、Rust 格式、发布资源检查及 diff 检查通过。
- [Release desktop 43713551214](https://github.com/ansermail/anser/actions/runs/43713551214) 的检查、macOS arm64、macOS x86_64、Windows x64 和草稿汇总全部通过。Windows CI 完成正式安装、启动与真实托盘恢复冒烟。
- 九资源、三个更新签名、标准 latest 清单、macOS 双架构 App 元数据与固定签名、DMG 与更新归档一致性及匿名公开下载均通过。两个 App 均为版本 0.1.42、标识 `dev.maildesk.desktop`、开发区域 `zh-Hans`，声明 `zh-Hans`/`en` 并提供 EML、EMLX、MSG 关联；架构分别为 `arm64` 与 `x86_64`，严格签名和 designated requirement 与固定证书一致。
- [Homebrew 43717403327](https://github.com/ansermail/anser/actions/runs/43717403327) 已成功，配方提交 `0f63a6e` 只更新 `Casks/anser.rb`，版本为 0.1.42，双 DMG SHA-256 与正式资源一致。
- `main` 尚待推送合并提交。推送后分别核对 Checks、Windows validation 与 Preview Pages，并确认官网模块和三个安装器入口。

## 正式资源

| 资源 | 字节 | SHA-256 |
|---|---:|---|
| `Anser_0.1.42_aarch64.app.tar.gz` | 13409042 | `2711d800d1db91289042924d350f6afb6aefad4896c4f64fe7db98c99e673832` |
| `Anser_0.1.42_aarch64.app.tar.gz.sig` | 424 | `0a56710e129d04b22cb96db7675350845b2ae63c6678e63eb9dbf14c127ae7ac` |
| `Anser_0.1.42_aarch64.dmg` | 13948880 | `a75c3bb0bebdac8c3d83120227028043a2b4941184f09f9ab9fab06f18b552dc` |
| `Anser_0.1.42_x86_64-setup.exe` | 10584726 | `894d9fe83ccdc04d5a7edefeac91082f8e5a4df2861d245970f2d38af80eee13` |
| `Anser_0.1.42_x86_64-setup.exe.sig` | 436 | `ba70551fd133aa0b5b6f78f90bc8b0c9f1efdf256e883aabfc36ef7088152914` |
| `Anser_0.1.42_x86_64.app.tar.gz` | 14047469 | `5ff07a44aa3de457b130e74e99cd308ccc6ff7ecd38481c67551776c40229504` |
| `Anser_0.1.42_x86_64.app.tar.gz.sig` | 424 | `d26d1966553938ec839723647216b42e155b7441853576c61e6d19e7d7209514` |
| `Anser_0.1.42_x86_64.dmg` | 14702766 | `3bcebf3c930e152d49102399a5ad2c6ffbcdc954bd228e4e17d9c5c00289e459` |
| `latest.json` | 3330 | `8de29f2ec7dc3656e4bc899b0605c83525b56278bed29d508c8a8813654935ab` |

匿名下载的大小和 SHA-256 均与 GitHub API 一致；`releases/latest/download/latest.json` 与 Release 内清单逐字节一致。标准更新平台严格为 `darwin-aarch64`、`darwin-x86_64` 与 `windows-x86_64`，三个签名值对应三个更新包。两个 DMG 均通过 `hdiutil verify`，只读挂载后的 App 与更新归档逐文件一致，`Applications` 链接指向 `/Applications`。

## 真实验收边界

本轮未替换 `/Applications/雁信.app`，未执行正式包原位升级。Windows 正式安装、启动与托盘恢复已由 CI runner 冒烟，Windows 实机长期使用、Intel 实机与更多邮件模板仍需单独验收。官网与 `main` 工作流结果在部署完成后补充。
