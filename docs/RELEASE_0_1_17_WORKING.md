# 0.1.17 Alpha 发布工作点

## 当前执行点（2026-10-15，正式发布及 Homebrew 同步完成）

- [0.1.17 Alpha](https://github.com/ansermail/anser/releases/tag/v0.1.17) 于 15:05:12（Asia/Shanghai）正式发布为 latest，Release ID `413506609`；标签固定源码 `7312e5c01f7e7cc4f08e8b40e14e4a2a853724c1`，与推送前后核对一致。
- [Release macOS 38695017325](https://github.com/ansermail/anser/actions/runs/38695017325) 的全量检查、Apple Silicon / Intel 构建与草稿全部成功。独立 Checks 原运行的两项默认 5 秒超时由测试提交 `bc383b4026ea39334e3d68fc0755ab8c30ff52ab` 修复；[新 Checks 38695703813](https://github.com/ansermail/anser/actions/runs/38695703813) 及 [Pages 38695703836](https://github.com/ansermail/anser/actions/runs/38695703836) 全部成功，不沿用历史失败或重跑冒充修复。
- 仓库外 `/tmp/anser-release017-audit` 保存本轮审计脚本、元信息和下载副本。`releaseFiles` 真实入口核对完整七资源、清单/发布说明（含末尾换行），资源大小/摘要与 GitHub 一致；保持原更新公钥，两架构归档独立验证 Tauri 签名。
- 两架构 App 的版本（含 CFBundleVersion）、架构、稳定标识 `dev.maildesk.desktop`、简体中文声明、EML 关联、许可资源与 `codesign --verify --deep --strict` 通过；DMG 完整性及内部 App 全部 8 个文件/链接逐项匹配更新归档。原生 auth 函数的实际引用/重建字节与本机 Google/Microsoft 编译配置精确比较通过，未输出私密值，本地前端资源未包含配置。
- 正式发布前重新核对草稿 ID/说明/资源身份/标签和成功门槛，发布后同一 ID 及七资源不变；七份按版本公开下载均逐字节匹配，**不带查询参数的标准** `https://github.com/ansermail/anser/releases/latest/download/latest.json` 逐字节匹配审计清单，公开 latest API 指向 0.1.17。
- Homebrew Tap 提交 [`6f4bb79`](https://github.com/ansermail/homebrew-tap/commit/6f4bb790b3e0d5d199498d69853241205725b240) 已推送 main，远端 SHA 与匿名公开配方逐字节核对通过。`brew style --cask ansermail/tap/anser`、`brew audit --cask ansermail/tap/anser`、Apple Silicon `brew fetch --cask ansermail/tap/anser` 通过；两架构公开 DMG 摘要见下表。没有覆盖安装本机应用或清理用户数据。后续仅提交发布记录，不再触发或重建同版本桌面发布。
- 实际范围：代码/本地自动测试、开发预览样本、云端双架构、产物与公开更新验证已完成；本轮未安装 0.1.17、未实际原位升级或在 Intel Mac 运行。已有用户代理/升级验收属于此前版本。正式包沿用 ad hoc 应用代码签名与项目更新签名；Developer ID/公证按用户决定不做，不宣称系统信任或固定自签身份已验收。

### 七资源公开核验（2026-10-15）

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.17_aarch64.app.tar.gz` | 12268608 | `c713b0412600ab6ed1365814edd2eb9c5ca9b9c585f4364e9142216c4857c7f7` |
| `Anser_0.1.17_aarch64.app.tar.gz.sig` | 424 | `a894494130987033f7182a8689ee42d89d5647f665efd6ef9bcb656c9836e008` |
| `Anser_0.1.17_aarch64.dmg` | 12842424 | `5667493345306b36087789e88ac443f3e614a0c29531fe4ab644f4278c55761b` |
| `Anser_0.1.17_x86_64.app.tar.gz` | 12859677 | `f2397bd4c8dfcd9be8b46a9c0e593d791ba9e2c09cb24c9d74e683251bc25c25` |
| `Anser_0.1.17_x86_64.app.tar.gz.sig` | 424 | `5339306dfa3005ce6f7427fe1dc50e4d2e9e224af0b945c37d434d8afdf38b3d` |
| `Anser_0.1.17_x86_64.dmg` | 13508510 | `225f73d89f3c8aa16ffe8f3944e34d0aa25b4508ad2bbc214a2b22b4de545061` |
| `latest.json` | 3280 | `a45c33fd3fc2cadfa25cba043151042024c7193e78ce8f6189398dabfeea66db` |


## 发布前准备与阶段记录（2026-10-15，历史）

- 用户授权完成当前改动、提交代码并通过组织远程流水线发版；基线 main / 83c1a4a。已核对 origin 为 ansermail/anser，远端 main 与本机 HEAD 一致，0.1.17 的 Release 查询明确 404、tag 查询成功且不存在。现有 0.1.16 不改写。
- 发布范围：逐段双语翻译、兼容模型配置/选择/连接修复、按钮内双语、翻译最近活动、正文图片/CSS/字体代理、透明占位图误报及中文打印。现有暂存与未暂存改动均属本轮已完成范围；不含用户凭据/真实邮件/截图/本机配置。
- 五处版本已同步 0.1.17，发布说明见 releases/v0.1.17.md；README/使用说明同步功能和主动翻译的数据边界。更新公钥、应用标识及既有签名流程沿用。
- 当前下一步：等待双架构/草稿，审计完整七资源、更新签名、App/DMG、版本与配置后正式发布，再核对公开更新端点并同步 Homebrew Tap。本地门槛、隐私审阅、源码提交和唯一标签推送已完成。
- 本地完整门槛已通过：前端 54 文件 / 330 项、桌面脚本 30 项、Rust 345 通过/1 既有性能项忽略、vendored IMAP 39 项；版本、前端/Rust 格式、UI、生产/Pages 构建和原生桥隔离、工作区/暂存区 diff 检查均通过。生产构建保留既有 Vite 警告。使用本机 Rust 1.91.1，与 CI 一致。
- 已审阅 50 个候选文件；本机 3 个长度足够的 OAuth 配置值与完整改动比较无命中，凭据模式扫描未命中，未输出任何值。没有 env、数据库、MIME、截图、私钥或安装包进入候选文件。
- 固定源码 `7312e5c01f7e7cc4f08e8b40e14e4a2a853724c1` 已提交并推送 main 和唯一新标签 v0.1.17，远端两者均逐字核对一致。触发 [Release macOS 38695017325](https://github.com/ansermail/anser/actions/runs/38695017325)；同源 [Checks 38695008980](https://github.com/ansermail/anser/actions/runs/38695008980)、[Pages 38695009152](https://github.com/ansermail/anser/actions/runs/38695009152) 同时执行。
- 当前等待云端检查/双架构/草稿，尚未正式发布；公开仍 0.1.16。审计目录为仓库外 `/tmp/anser-release017-audit`。下一步从远程运行状态与草稿七资源继续，不重新触发同版本流水线。代码/自动测试、原生开发验收、云端构建、资源审计、正式包实际升级分别记录。

## 独立 Checks 超时修复（2026-10-15）

- 同源 Checks 38695008980 前端 328 通过、2 项超过默认 5 秒；失败点均为既有 205 封分页集成测试。日志耗时分别 6.7 秒与 5.6 秒，未出现业务断言失败。同一源码在 Release macOS 的完整前端及其余检查全部通过。
- 已将整组跨页阅读用例统一为原有长用例的 15 秒有界期限，保留全部断言与延迟/失败/重试覆盖，不设置全局宽限或自动重试。此修复仅涉及测试，正式安装包源码仍固定为原标签 7312e5c，不移动标签或改写发布资源。
- 本地分页组 8/8、格式及 diff 检查通过；单独提交测试修复并让新 Checks 验证，正式公开前核对新运行结果。历史失败邮件对应原运行，应与新运行分别记录。

## 云端检查与构建进展（2026-10-15）

- Release macOS 38695017325 的全量检查通过；Apple Silicon 构建成功，Intel 打包及签名检查完成、正在保存缓存。等待草稿任务及完整七资源。
- 测试期限修复提交 `bc383b4026ea39334e3d68fc0755ab8c30ff52ab` 已推送 main；[新 Checks 38695703813](https://github.com/ansermail/anser/actions/runs/38695703813) 的完整前端、桌面脚本和生产构建已通过，Rust 检查中；[同源 Pages 38695703836](https://github.com/ansermail/anser/actions/runs/38695703836) 已成功。

## 交付入口（2026-10-15）

- 用户可在应用内检查更新，或从正式 Release 下载；Homebrew 用户执行 `brew update` 后运行 `brew upgrade --cask ansermail/tap/anser`，首次安装使用 `brew install --cask ansermail/tap/anser`。
- 代码提交、自动测试、开发样本与云端/公开资源已完成；下一步为用户验证 0.1.17 的实际阅读/翻译/安装升级。未验证范围保持上方边界，不把真实外部图片服务故障宣称为全部恢复。
