# 0.1.45 发布工作点

更新于 2026-11-24，时区 Asia/Shanghai。

## 发布候选

- 版本已在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 同步为 `0.1.45`。
- 候选范围包含 0.1.44 真机走查与前后端全量审计修复（详情见 [0.1.44 真机走查与前后端优化工作点](../features/UI_UX_AND_BACKEND_AUDIT_0_1_44_WORKING.md)），含工作台「日期 + 具体时间」等高单行正向开关优化。
- 发布说明为 [v0.1.45](../../releases/v0.1.45.md)。
- 本地隔离开发预览包（`雁信预览.app`、`dev.maildesk.preview0144` 数据目录及本地 Vite 1428 服务）已在发版前停止并清理。

## 本地发布门槛

- `npm run release:check` 通过，五处版本一致且发布说明非空。
- `npm run test:ci` 全部通过（77 文件 616 项），`npm run test:desktop`（37 项）、`cargo test --lib`（482 通过/5 项既有条件忽略）、vendored IMAP（39 项）通过。
- `npm run build`、`npm run build:preview`、UI 铁律、1,887 条双语键、Prettier、`cargo fmt --check` 与 `git diff --check` 通过。

## 云端发布与分发

2026-11-24 已提交并推送 `main`，固定源码 `1e7e238bb8cd974c289cd570afc5dde641307664`，创建注释标签 `v0.1.45`。[Checks 45340348743](https://github.com/ansermail/anser/actions/runs/45340348743)、[Windows validation 45340348545](https://github.com/ansermail/anser/actions/runs/45340348545)（首次共享 runner 单条大列表用例 65.3s 超时后重跑失败作业全绿）与 [Release desktop 45340357092](https://github.com/ansermail/anser/actions/runs/45340357092) 全部成功，后者完成检查、Apple Silicon、Intel Mac、Windows x64（含安装与托盘冒烟）与草稿汇总。

正式 [Release v0.1.45](https://github.com/ansermail/anser/releases/tag/v0.1.45)，ID `456407212`，于 2026-11-24 15:04:35（Asia/Shanghai）公开为 latest。九份资源均已核验：

| 资源                                  |     字节 | SHA-256                                                            |
| ------------------------------------- | -------: | ------------------------------------------------------------------ |
| `Anser_0.1.45_aarch64.app.tar.gz`     | 14070119 | `23378af6a4bc2a2f90ca9f687eb88697ed1f00610553733464565acfc0ba0d04` |
| `Anser_0.1.45_aarch64.app.tar.gz.sig` |      424 | `af65632483cc849799e5135d5a04e4ddf80616d936439fbdf6e2eff499a79f83` |
| `Anser_0.1.45_aarch64.dmg`            | 14589686 | `a422c8126270e341e72d28a87261812d3128a890d80bf60bb4f1d0dd49e634f1` |
| `Anser_0.1.45_x86_64-setup.exe`       | 10960310 | `08b971690d7aa0e8562c125e2290a9db6a7b1490a48ad10b7047450c5ce9b65a` |
| `Anser_0.1.45_x86_64-setup.exe.sig`   |      436 | `fef1f7e5866e21ebc6c2f24a60ec2ef03a4669e768e446a67b9908b2ee854fae` |
| `Anser_0.1.45_x86_64.app.tar.gz`      | 14746849 | `424689859b9d687d253e0b6d13603fd1a93a17d7f128034441ab56cadb4c27fe` |
| `Anser_0.1.45_x86_64.app.tar.gz.sig`  |      424 | `6fd0494eba2f352cf68968225ebaca88a41c70405ede7dc0c79277ac37b4b21e` |
| `Anser_0.1.45_x86_64.dmg`             | 15361862 | `8b5626ede67aaa3b10cbd68c75f24b5366a1bedea9d6c573ecd6fc8a4312dd67` |
| `latest.json`                         |     3836 | `83a49c338cc8d7c29b042ed39c18dea1b82678591be80139317241cf53c57ba8` |

`latest.json` 版本为 `0.1.45`，覆盖 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64` 三个平台与 424/424/436 字节签名，三个正式安装器及标准更新端点 `releases/latest/download/latest.json` 匿名访问均返回 HTTP 200。

[Update Homebrew Cask 45345188443](https://github.com/ansermail/anser/actions/runs/45345188443) 成功，在 `main` 生成配方提交 `b962bd0`（仅修改 `Casks/anser.rb`），版本 `0.1.45`，双架构 DMG SHA-256 与公开资源逐字节一致。

首次 [Preview Pages 45340348583](https://github.com/ansermail/anser/actions/runs/45340348583) 在安装器公开前主动取消，官网保持 0.1.44；公开后触发 [Preview Pages 45345215670](https://github.com/ansermail/anser/actions/runs/45345215670) 部署成功。

## 验证边界

- 本机 `/Applications/雁信.app` 未替换，正式更新与原位升级由用户自行完成。
- Windows 与 Intel Mac 实际桌面使用、短窗发送详情定时改期、托盘退出/Dock 角标/双语测试通知与外部 `.eml` 窗口复用仍需单独实机验收。
- macOS 正式包继续使用项目自签名证书，不代表 Apple Developer ID 或公证。
