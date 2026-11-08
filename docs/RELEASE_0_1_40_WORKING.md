# 0.1.40 发布工作点

更新：2026-11-08（Asia/Shanghai）。本轮已完成本地验证、云端构建、公开资源审计、Homebrew 与官网分发；本机正式安装更新仍由用户自行完成。

## 当前状态：正式发布与分发完成

- 固定源码：`66b959e1f54ebb775fa4284c4ec4b120a55b63cf`
- 注释标签：`v0.1.40`，tag object `189ae13961240358a54bfa8a948d7544f0dd1e61`，解引用为上述源码。
- Release ID `438054978`，于 2026-11-08T05:38:06Z 公开为 latest：[v0.1.40](https://github.com/ansermail/anser/releases/tag/v0.1.40)。
- Homebrew 配方提交 `5198b069116c1124cd0a490550381956a769cf51`，只更新 `Casks/anser.rb`。
- 官网返回 0.1.40，线上 macOS 双架构 DMG 与 Windows x64 EXE 链接实际返回 HTTP 200。
- 不替换 `/Applications/雁信.app`，不把本机原位升级作为本轮自动验收结果。

## 本版范围

- 阅读页工具栏区分常用回复、全部回复、转发与低频的打印、导出、本地整理；服务器操作独立分组。
- 搜索范围、已发送过滤、正文检索边界与零结果恢复路径更明确；保留旧正文时提示其是否会改变搜索结果。
- 正文图片加载、失败与翻译状态统一为右上角悬浮胶囊，不参与正文排版，避免状态切换推动正文。
- 远端正文先使用回退字体显示；深色阅读处理近黑文字，同时保留作者品牌色、背景图与彩色底面。
- 邮件列表时间按当天、同年、跨年分层显示并保留完整时间；没有摘要时移除空行。
- 临时阅读缓存、在线邮件与完整本地保存的状态说明更清楚；存档统计、管理动作与删除风险区重新分组。
- 过滤规则使用一致命名和明确空态；写信低频格式集中到“更多格式”，正文文件入口改为“导入正文…”。

## 本轮本地门槛

环境：本机 macOS / Apple Silicon。

- `npm run test:ci`：非 App 69 个测试文件、397 项通过；App 88 项通过。合计 70 个测试文件、485 项通过。
- `npm run test:rust`：454 项通过、5 项条件忽略；二进制与文档测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 项通过、2 项需原生钥匙串 fixture 的既有用例忽略。
- `npm run test:desktop`：37 项通过。
- `cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`：UI 铁律、1463 条双语键、TypeScript 与 Vite 生产构建通过；保留既有分包/体积提示。
- `npm run build:preview`：生产预览构建与 Pages 公用布局、虚构数据、原生桥隔离和发布路径检查通过。
- `npm run release:check`、`npm run release:secrets`、`npm run format:check`、Rust fmt 与 `git diff --check` 通过；更新签名私钥未写入仓库或日志。

## 云端验证与资源审计

- [Checks 42449075123](https://github.com/ansermail/anser/actions/runs/42449075123)：成功。
- [Windows validation 42449075214](https://github.com/ansermail/anser/actions/runs/42449075214)：成功，包含 Windows 前端、Rust/IMAP、验证安装包、安装启动和真实托盘恢复冒烟。
- [Release desktop 42449122495](https://github.com/ansermail/anser/actions/runs/42449122495)：成功，完成 macOS arm64/x86_64、Windows x64 与草稿汇总。首轮 arm64 DMG 工具失败后仅重跑失败任务，未改业务代码或资源。
- 九资源已从公开标准 latest 地址匿名下载，大小和 SHA-256 与草稿 API 及审计文件一致。

| 资源 | 字节 | SHA-256 |
|---|---:|---|
| `Anser_0.1.40_aarch64.app.tar.gz` | 13085540 | `83ae9293ad65a99092a24e6450e14f069bb390f93d78d0793e8a9583ff050693` |
| `Anser_0.1.40_aarch64.app.tar.gz.sig` | 424 | `3b4ec8ae2cb5272769092f508f1a0712a7e0361be4fa8bd4572736148fefb8cc` |
| `Anser_0.1.40_aarch64.dmg` | 13626589 | `1ee2fa147425ce22024e90dced9ceb29fbb82219c626c8aaf8e5cb66a47d3d06` |
| `Anser_0.1.40_x86_64-setup.exe` | 10315587 | `263a1429c1be406d17ed600e68d0ce4f04611af41feb25bfd95752dc317fafc3` |
| `Anser_0.1.40_x86_64-setup.exe.sig` | 436 | `4bd26241639ae83db2f04408b502f9fc9664e26e2ad1b99ed52d867b5179b89f` |
| `Anser_0.1.40_x86_64.app.tar.gz` | 13688754 | `30dbef09b11ff022857c352f5801b447718b93ec507ffc55d268e186e9df1b6f` |
| `Anser_0.1.40_x86_64.app.tar.gz.sig` | 424 | `4949f48956c01cd5b0147e73c729e6f75d6dbf03a19a07d75acfe2e33c8a0745` |
| `Anser_0.1.40_x86_64.dmg` | 14344437 | `30f5cd9bdf4d3e25d0ab7eff5960e84058d94079ab90e645ce8c24f95368c9f9` |
| `latest.json` | 3861 | `ab605ac119b7d4ad8dc9e65722ca3b4dc064764d0f1c7db258c1409069ff1afa` |

- 三个更新包均使用现有 updater 公钥和 minisign 验签通过；`latest.json` 版本为 0.1.40，包含 `darwin-aarch64`、`darwin-x86_64` 与 `windows-x86_64`。
- Mac 双架构 `codesign --verify --strict --deep` 通过，固定证书根与精确 designated requirement 一致；标识为 `dev.maildesk.desktop`，版本 0.1.40，架构分别为 arm64/x86_64，包含 `zh-Hans`/`en` 与 EML、EMLX、MSG Alternate 关联。
- 两个 DMG 只读挂载后，包内应用与更新归档逐文件一致；LICENSE、NOTICE、LICENSING.md 与 shadcn 许可均存在，许可文件摘要与源码一致。
- macOS 分发包继续使用固定免费的项目自签名，未使用 Apple Developer ID 签名或公证。Gatekeeper 对未受信任的自签名应用拒绝执行符合当前约束，Release 说明未宣称已获得 Developer ID 或公证认可。

## 分发结果

- [Homebrew 42451544717](https://github.com/ansermail/anser/actions/runs/42451544717)：成功；发布选择与完整性保护、公开 DMG 下载、双架构 SHA-256、`brew style/audit/fetch` 通过，配方只更新 `Casks/anser.rb`。
- [Preview Pages 42451625454](https://github.com/ansermail/anser/actions/runs/42451625454)：成功；官网模块已更新为 0.1.40。
- 官网 `aarch64.dmg`、`x86_64.dmg` 与 Windows `setup.exe` 的 GitHub Release 下载链接均实际返回 HTTP 200。
- 标准端点 `https://github.com/ansermail/anser/releases/latest/download/latest.json` 已匿名下载并通过摘要与内容审计。

## 发版耗时观察

成功路径从 2026-11-08T05:01:01Z 到 05:34:05Z，约 32 分钟；用户感知接近一小时主要来自此前两次大型分页测试超时、重新提交和重建，以及同一源码在 Checks、Windows validation 和 Release desktop 中重复执行完整验证。

- Release desktop 内 `check` 约 7 分 54 秒，其中前端测试约 4 分 46 秒、Rust 测试约 1 分 52 秒。
- x86_64 Mac 构建步骤约 2 分钟，arm64 构建约 3 分钟；arm64 作业此前等待 macOS runner 约 20 分钟。
- Windows 正式安装包构建约 6 分 38 秒，之前的 Windows Rust 回归约 10 分 15 秒；同提交的 Windows validation 又独立执行前端、Rust、安装包和冒烟。
- 本轮未临时改发布架构。后续加速应作为独立 CI 变更验证，重点减少同提交重复测试、复用已验证源提交，并评估 macOS 双架构作业的调度方式。

## 尚未验证

- Windows 实机、Intel Mac、更多邮件模板和正式安装包原位升级未在本轮单独验收。
- `/Applications/雁信.app` 未替换；用户自行下载、升级和验收正式应用。
- 自动测试、云端构建、正式公开、Homebrew 与官网分别完成，不能相互替代。
