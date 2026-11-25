# 0.1.46 发布工作点

更新于 2026-11-25，时区 Asia/Shanghai。

- 候选范围：新版「大雁传书」图标、0.1.45 之后合入 main 的界面修订及 pnpm 构建迁移。四处版本同步为 0.1.46，说明见 [v0.1.46](../../releases/v0.1.46.md)。
- 本机隔离预览已退出，已安装的雁信仍在运行。正式客户端由用户自行升级。
- 本地已通过版本、格式、前端、桌面脚本、生产与 Pages 构建检查，Rust 482 项通过、5 项既有忽略，vendored IMAP 39 项通过。原生预览验收覆盖新图标，正式包的实机安装与升级留待后续。
- 注释标签 `v0.1.46` 指向 `0a92cf230846377f378f74c0494bb732ce860e22`。四处版本及发布说明已从暂存对象和固定提交分别复核。[Release desktop 45560298955](https://github.com/ansermail/anser/actions/runs/45560298955) 于 15:02（Asia/Shanghai）完成，检查、Mac 双架构构建、Windows x64 构建及草稿汇总均成功。
- 草稿审计：九份资源逐项匹配 GitHub 大小与 SHA-256，其中八份安装、更新和签名资源也与 Actions 产物逐字节一致。公开说明和清单说明均与固定源码原文一致，既有更新公钥通过三份签名校验，`latest.json` 的版本、三平台 URL 与签名对应。
- 两架构 Mac 安装镜像和更新归档的包内文件一致。确认正式持久身份、版本、中文本地化能力、项目固定签名和新版 ICNS。Windows 安装与 WebView2 冒烟由云端通过，独立解包验证客户端 PE x64 GUI 子系统、版本与六个新图标尺寸。
- [0.1.46 正式发行](https://github.com/ansermail/anser/releases/tag/v0.1.46) 于 15:28:02 公开为 latest，Release ID `457755894`。公开前后的标签、说明及资源身份一致，九份公开资源匿名请求均返回 HTTP 200，标准 `latest.json` 匿名下载与审计清单逐字节一致。
- [Homebrew 45568357638](https://github.com/ansermail/anser/actions/runs/45568357638) 成功，提交 `b83e620` 只更新 `Casks/anser.rb`，两架构 DMG 摘要均匹配。官网待版本提交合入 main 后重新部署。
- 本机正式应用原位升级、真实邮箱 OAuth、Intel 与 Windows 实机使用未核验。
