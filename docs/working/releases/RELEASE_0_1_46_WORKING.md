# 0.1.46 发布工作点

更新于 2026-11-25，时区 Asia/Shanghai。

- 候选范围：新版「大雁传书」图标、0.1.45 之后合入 main 的界面修订及 pnpm 构建迁移。四处版本同步为 0.1.46，说明见 [v0.1.46](../../releases/v0.1.46.md)。
- 本机隔离预览已退出，已安装的雁信仍在运行。正式客户端由用户自行升级。
- 本地已通过版本、格式、前端、桌面脚本、生产与 Pages 构建检查，Rust 482 项通过、5 项既有忽略，vendored IMAP 39 项通过。原生预览验收覆盖新图标，正式包的实机安装与升级留待后续。
- 注释标签 `v0.1.46` 指向 `0a92cf230846377f378f74c0494bb732ce860e22`。四处版本及发布说明已从暂存对象和固定提交分别复核。[Release desktop 45560298955](https://github.com/ansermail/anser/actions/runs/45560298955) 于 15:02（Asia/Shanghai）完成，检查、Mac 双架构构建、Windows x64 构建及草稿汇总均成功。
- 草稿审计：九份资源逐项匹配 GitHub 大小与 SHA-256，其中八份安装、更新和签名资源也与 Actions 产物逐字节一致。公开说明和清单说明均与固定源码原文一致，既有更新公钥通过三份签名校验，`latest.json` 的版本、三平台 URL 与签名对应。
- 两架构 Mac 安装镜像和更新归档的包内文件一致。确认正式持久身份、版本、中文本地化能力、项目固定签名和新版 ICNS。Windows 安装与 WebView2 冒烟由云端通过，独立解包验证客户端 PE x64 GUI 子系统、版本与六个新图标尺寸。
- [0.1.46 正式发行](https://github.com/ansermail/anser/releases/tag/v0.1.46) 于 15:28:02 公开为 latest，Release ID `457755894`。公开前后的标签、说明及资源身份一致，九份公开资源匿名请求均返回 HTTP 200，标准 `latest.json` 匿名下载与审计清单逐字节一致。
- [Homebrew 45568357638](https://github.com/ansermail/anser/actions/runs/45568357638) 成功，提交 `b83e620` 只更新 `Casks/anser.rb`，两架构 DMG 摘要均匹配。公开后将发版版本和说明按线性历史同步到 main，[Preview Pages 45569324281](https://github.com/ansermail/anser/actions/runs/45569324281) 成功。浏览器核对线上官网的两条 Mac 下载链接、一条 Windows 下载链接和新版图标均正确。
- 本机正式应用原位升级、真实邮箱 OAuth、Intel 与 Windows 实机使用未核验。

## 主分支 Windows 前端验证超时（2026-11-25）

- [随发布记录触发的 Windows validation](https://github.com/ansermail/anser/actions/runs/45569324370/job/139051781046) 中，`pnpm test:ci` 的两条跨页阅读用例分别经过 62.6 秒（按对话分组）和 68.5 秒（逐封邮件）后报告超过 60 秒时限。更早的[图标提交验证](https://github.com/ansermail/anser/actions/runs/45556019518/job/139008137590) 中，同组用例分别为 58.9 秒通过和 64.1 秒超时。
- 两条用例各在 jsdom 渲染 200 行列表并执行七次相邻导航。两次失败之间没有分页实现或测试修改。相同发布记录提交的 [macOS Checks](https://github.com/ansermail/anser/actions/runs/45569324309) 分别用时 31.8 秒和 27.5 秒并通过。本机 Apple Silicon 以 `CI=1 pnpm exec vitest run src/App.test.tsx -t 'loads the next page and keeps previous navigation'` 复跑，两条分别用时 8.5 秒和 9.3 秒并通过。
- 日志只报告测试超时，具体耗时热点仍待定位。两次主分支 Windows 原生作业和 0.1.46 标签的正式发布作业均通过。当前核查未修改测试门槛或重跑远程作业。
- 后续修复：邮件列表同轮渲染复用日期格式化器。两条用例保留实际 200 行分页、两种模式、跨页往返、连续越界读取和末封禁用，将页外测试邮件从五封减为两封。超时门槛未改。本机以 `CI=1` 执行 12 项分页和跨页阅读检查，全部通过，两条用例分别用时 5.1 秒和 6.2 秒。格式、日期单测、前端全量 626 项、生产及 Pages 构建均通过。Chromium 对照演示中英文邮件列表日期，均与原格式一致。
- 修复提交 [`e08b78d`](https://github.com/ansermail/anser/commit/e08b78d16088e5bff6eb59c1f7bfc13cbd75c3ca) 的 [Windows validation](https://github.com/ansermail/anser/actions/runs/45574430358) 全部通过，前端 626 项和桌面脚本 37 项通过，两个用例分别从 62.6／68.5 秒降至 37.6／42.7 秒。Windows 原生包和 WebView2 冒烟、[macOS Checks](https://github.com/ansermail/anser/actions/runs/45574430347) 与 [Preview Pages](https://github.com/ansermail/anser/actions/runs/45574430385) 均通过。正式 `v0.1.46` 标签和发行资源保持原样。
