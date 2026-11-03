# 0.1.36 发布工作点

更新：2026-11-03（Asia/Shanghai）。用户已授权提交与正式发布。

## 当前状态：正式发布、分发核验与本机正式版恢复完成

0.1.36 Alpha 于 2026-11-03 11:00:02（Asia/Shanghai）公开为 latest，Release id `432228247`，固定源码 `68b509ad4d5894c97827baf542914412aad11882`、唯一注释标签 `v0.1.36`。三平台完整构建、Windows 原生安装冒烟、九资源长度/散列、三个更新签名、Mac 固定签名/DR/元数据/许可、DMG 与更新归档文件一致性均通过。公开前再次核对草稿身份、固定标签及全部资源 ID/长度/摘要，发布未改动已审计资源。

九资源匿名公开下载与审计副本大小/摘要一致，标准 `/releases/latest/download/latest.json`（无查询参数）逐字节匹配，公开 latest API、Release/源码/更新清单说明原文一致，资源 ID/长度/摘要及标签未变。`public-audit.log` 与 `release-public.json` 保存证据。草稿按 ID `432228247` 查询；tag REST 端点对草稿曾返回 404，未将其当作草稿不存在。

Pages 41566362433 第一次恢复新版部署在获取 OIDC ID token 时发生 `socket hang up`，已检查配置包含 `id-token: write`；只重跑失败 deploy 后第三次运行成功，线上实际 JS 模块版本为 0.1.36，三平台安装器均已公开。证据在 `website-audit.log`。Homebrew [41569507114](https://github.com/ansermail/anser/actions/runs/41569507114) style/audit/fetch 全成功，提交 `f961c7084ae68265f47515035a41fd35715b8f31` 仅改 Casks/anser.rb，版本与双 DMG 摘要匹配。未额外重复工作流验证幂等。

用户随后要求恢复本机正式版，已退出开发预览和 Tauri/Vite 启动器。正式 0.1.35 更新中心显示 0.1.35 → 0.1.36，实际下载、签名校验后安装；`/Applications/雁信.app` 已为 0.1.36，固定签名/DR 与发行二进制核对通过。更新后进程曾无可见主窗，停止该实例并重新打开正式 App 后恢复，原账号配置与 5499 封存档可见，“关于”实际显示 0.1.36；再次检查更新显示“当前版本 0.1.36 / 当前没有可用更新”，已保留正式版版本信息页面。没有改写数据、清理存档或重新配置凭据。自动重启窗口恢复有一次异常，未定位根因，不能将本轮写成全程无异常的升级验收。后续若复现，从 updater restart 与主窗口生命周期继续核查。

下一步只保留真实场景补验入口：更新后窗口恢复、实际菜单栏点击、未读数变化/语言切换、真实收发及通知、Windows/Intel Mac 实机和其他升级路径。下方保留发布前阶段历史。

## 发布前阶段记录（历史）

构建阶段快照：Mac 双架构构建与六项资源审计成功，Windows validation 全成功，正式 Release 的 Windows 原生回归也已通过，正在构建 EXE 与签名更新包。待安装冒烟、草稿汇总和九资源核验完成后公开。

- 修复提交 `8abb6d7`；工作树 `/Users/zhangxiaojun/.codex/worktrees/release-0.1.36/mail`，分支 `codex/release-0.1.36`。
- 原工作区 `/Volumes/Others/mail` 的 `src/lib/mail-images.ts` 与 `src/lib/mail-images.test.ts` 既有 WIP 保留且不进入发行源码。
- 五处版本已从暂存对象与提交分别核对为 0.1.36；固定源码 `68b509ad4d5894c97827baf542914412aad11882` 已推送 main，唯一注释标签 `v0.1.36` 指向同一提交。当时公开 latest 仍为 0.1.35，尚未正式发布。
- [Checks 41566362477](https://github.com/ansermail/anser/actions/runs/41566362477) 与 [Release desktop 41566370328](https://github.com/ansermail/anser/actions/runs/41566370328) 的完整检查阶段成功；后者 Mac 双架构成功、Windows 正式构建继续运行。[Windows validation 41566362451](https://github.com/ansermail/anser/actions/runs/41566362451) 已全部成功，前端 463、Rust 432/2 既有忽略、IMAP 39 通过并生成验证安装器；该流程可选 smoke 未运行，正式 Release 的安装冒烟仍待执行。[Pages 41566362433](https://github.com/ansermail/anser/actions/runs/41566362433) 已部署，下载时序修正见下一项。
- 官网时序核查：网站下载 URL 直接使用 package 版本，Pages 41566362433 已先于安装器公开完成部署。尝试取消时该运行已结束；已重跑旧固定源码 `bd4d062` 的 Pages 40654140088 恢复 0.1.35 下载，待 0.1.36 公开后再重跑新版部署。最终须独立核对线上链接，不能把早期 Pages 成功算作发行分发完成。

## 修复范围与已有证据

macOS 不创建原生菜单栏 tooltip；Windows 保留随语言切换的静态提示；移除每 5 秒动态 tooltip 写入，同值标题不重复刷新，Dock 原定时刷新保留。本机旧正式 0.1.35 原生观察到独立“帮助标记”，修复版开发预览关闭主窗切到访达并跨至少 15 秒无提示残留。稳定项目签名与精确 DR 通过，既有账号及存档可读；这不是正式安装或升级验收。

## 本轮发布门槛

以下均在排除既有图片 WIP 的独立发行工作树执行：

- `npm ci` 成功；`npm run test:ci`：前端 67 文件 463 项（378 + App 85）通过。
- `CARGO_TARGET_DIR=/Volumes/Others/mail/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml`：Rust 433 通过、4 项既有忽略；原生源码与测试均编译通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 通过、2 项既有忽略。
- `npm run test:desktop`：37/37；`cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39/39。
- `npm run build`、`npm run build:preview`（含官网/演示原生桥隔离）、`npm run format:check`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run release:check`、`git diff --check` 均通过；UI 与 i18n 1367 双语键通过，只有既有 Vite 分包/体积提示。
- 本轮日志在仓库外 `/tmp/anser-0.1.36-*.log`；发行资源审计目录 `/tmp/anser-release036-Dw6rHc`。

五处版本已在暂存对象与固定提交核对；发行提交范围确认不含两处图片 WIP。

## 发布前计划（历史，已执行）

Mac 双架构 Actions 构建均成功。已提前下载同一运行的六项 Mac 资源：两个更新签名、固定代码签名与精确 DR、0.1.36 版本/架构/稳定标识、zh-Hans/en、EML 声明及四许可均通过；两个 DMG 只读挂载后，App 全部文件散列与各自更新归档一致，已卸载。证据在审计目录 `mac-audit.log` 与 `mac-proof.json`；最终 Release 下载副本必须匹配这些指纹，Windows 与九项资源核验仍待完成。

1. 等待同一固定源码的 Checks / Pages / Windows validation / Release desktop，失败时先读日志，不自动改时限或弱化断言。
2. 审计九资源长度/摘要、三个更新签名、Mac 双架构固定签名/DR/元数据/许可与 DMG 一致性、Windows 资源和清单/说明原文。
3. 重新核对草稿身份与标签后公开 latest；核对匿名下载与标准更新端点，等待 Homebrew 同步并更新最终记录。

## 验收边界

菜单栏实际点击恢复、未读数变化与语言切换、Windows 与 Intel Mac 实机本轮未验证；本机 0.1.35 → 0.1.36 已执行，但有上方记录的重启窗口异常；其他协议及通知真实场景未扩充验收。未授权范围外发信、改写存档或更换凭据身份。

## 九资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.36_aarch64.dmg` | 13469851 | `7b1279290419d4849a60c72dccb26ed9f039b5df0de35e7865260a931a4356c3` |
| `Anser_0.1.36_aarch64.app.tar.gz` | 12913554 | `67431ec7de4b822759490476ec82f9421c9ecd0c0eb5d3e39ef69b03b8db62b6` |
| `Anser_0.1.36_aarch64.app.tar.gz.sig` | 424 | `a94f1ea88f08ba02c8ec8338db4ca61c61f10fd095022872a916fac0fe29cb1d` |
| `Anser_0.1.36_x86_64.dmg` | 14213708 | `366f714c366d6258a584162f64a10f8b604eeb0ba7e718e765bf82fab074bf91` |
| `Anser_0.1.36_x86_64.app.tar.gz` | 13537494 | `6be956a5069bcf69b49ff63596a4dbb26f098c6cda9bb5c172b316f40093b4b5` |
| `Anser_0.1.36_x86_64.app.tar.gz.sig` | 424 | `873ae886cba2d033365f9a5849acb6b76d3fa2965548d343add88222ef1f717b` |
| `Anser_0.1.36_x86_64-setup.exe` | 10180750 | `3f3c967811b17a7c9cded8cf499c7fcf8569ba2b770630a653dd443c3a6bc0e8` |
| `Anser_0.1.36_x86_64-setup.exe.sig` | 436 | `5469f6c7006c147f283518cdc382d4c5069f02b1d5abcc4575e0d6977ddc6dd1` |
| `latest.json` | 2860 | `09649ae93cb8e26815d0b034f3992b5f3239afefd04c9eae1e5000a9e540aa7b` |
