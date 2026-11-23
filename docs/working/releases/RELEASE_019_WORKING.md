# 0.1.9 发布工作点

2026-10-10，main，基线 1191ce1。0.1.9 已于 20:22:33（Asia/Shanghai）正式发布为 latest，源码 220f4cc6bc179ec700691e5dab3f9975f424ffc8；[Release macOS 38051136526](https://github.com/ansermail/anser/actions/runs/38051136526) 全部成功，[Release](https://github.com/ansermail/anser/releases/tag/v0.1.9)。

## 范围与本机门槛

QQ SMTP 自动已发送副本有限次新连接只读核对/旧精确回执恢复、IDLE 60 秒与 NOOP 45 秒绝对截止、跨时区排序与未读点固定宽度；包括已提交的 Microsoft 原生发布配置。Google/Microsoft Secret 与更新公钥沿用当前配置，本机标识/原件保持。

- npm test：209 项 / 37 文件。
- cargo test --manifest-path src-tauri/Cargo.toml：283 项。
- npm run test:desktop：19 项。
- cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml：39 项。
- npm run build（含 check:ui）、npm run build:preview（静态桥隔离）、npm run format:check、cargo fmt --check、npm run release:check、git diff --check：通过。
- 授权双邮箱 C/D 的 SMTP/收件/副本及原件散列核对通过，C 实时通知和在线正文通过；D 无独立实时延迟证据。见 SENT_IDLE_RELIABILITY_WORKING.md。真实 NOOP 静默补查与其他矩阵不扩充为通过。

## 云端/资源/正式发布

固定源 `220f4cc6bc179ec700691e5dab3f9975f424ffc8`，workflow_dispatch 于 20:12:49（Asia/Shanghai）启动；check、Apple Silicon、Intel 与 draft 全部成功，随后完成以下核验并于 20:22:33 发布草稿为 latest：

- 七份资源：两架构 DMG、app.tar.gz、sig 与 latest.json，大小及 GitHub SHA256 digest 全部匹配。
- 两份更新归档用现有 Tauri/minisign verifier 与固定源公钥核验，manifest 两架构 URL/签名/版本一致。
- 两包版本 0.1.9、arm64/x86_64、稳定标识 dev.maildesk.desktop、EML 声明及完整 codesign/CodeResources 通过。
- LICENSE/NOTICE/LICENSING.md/shadcn 原许可与固定源资源逐字节匹配；Google 与 Microsoft 当前编译配置仅在原生 backend，前端资源中未检出对应配置。
- Intel 对微软 Client ID 与 Google 交换常量使用函数内 movabsq/movq/movl 精确重建优化后的分段分配字节；简单连续字节搜索不足以断言漏注入，核验不打印值/汇编常量。此过程未改变发布源码/产物。
- DMG 校验和通过；逐架构只读挂载，包内全部 8 个 app 文件的 SHA256 与更新归档相同，核验后已卸载挂载卷，未安装/启动正式包。
- 发布后 tag 指向固定源码；匿名公开 latest.json 与已审计清单逐字节相同，版本为 0.1.9，两架构更新 URL 均 HTTP200。
- 同源 Checks 38051110930 与 Pages 38051110935 也已成功；不把 Pages 部署当作桌面安装/升级验收。


## 未完成与接续

未执行本次正式安装/原位升级/默认 EML/冷启动、多 Mac；无 Developer ID/公证，旧个人仓库安装迁移仍待安排。新 Google 授权/刷新与微软实际邮箱 SMTP/刷新独立记录。正式发布完成后继续 SEARCH_SCALE_WORKING.md，同时保留 SYNC/SAVE 真实故障矩阵，不声明整体开发完成。
