# 0.1.19 发布工作点

## 当前状态：正式发布与 Homebrew 已完成（2026-10-16）

- 0.1.19 Alpha 于 2026-10-16 15:55:41（Asia/Shanghai）正式发布为 latest，固定源码 `037d7aaaa8a2104236af3bd1675e8dd830afb5ee`。[Release macOS 38869273847](https://github.com/ansermail/anser/actions/runs/38869273847)、[Checks 38869273770](https://github.com/ansermail/anser/actions/runs/38869273770)、[Pages 38869273892](https://github.com/ansermail/anser/actions/runs/38869273892) 全部成功，[0.1.19 正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.19) 已公开。包含正文图片通用状态修复、跨版本完整更新说明、统一钥匙串与本地/云端一致的固定免费项目签名。
- 七资源大小/SHA-256、说明与清单完整原文（含末尾换行）、两架构更新签名及既有公钥、App 版本/架构/标识/中文配置/EML/许可/原生 OAuth 配置、固定证书与精确 DR、DMG 与更新归档逐文件一致性全部通过。发布前后资源身份与标签不变，七份按版本公开下载及不带查询参数的标准 latest 更新端点逐字节匹配。
- [Tap 18a6820](https://github.com/ansermail/homebrew-tap/commit/18a6820f2385e340ce094b202b172ddf1e5fa7f0) 已公开，配方/公开两架构 DMG 摘要及 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。
- 本次本地完整门槛：前端 363、Rust 368 通过/3 忽略、桌面脚本 28、IMAP 39，格式/UI/生产/Pages 隔离/版本/diff/隐私通过。本机 Rust 1.91.1，与 CI 一致。
- 本版正式包实际安装/应用内原位升级、Intel 实机及系统拒绝/锁定矩阵未执行，不沿用此前版本结果。自签名不等于 Apple Developer ID、公证或 Gatekeeper 认可；不修改用户系统信任或 quarantine。
- 审计记录位于仓库外 `/tmp/anser-release019-audit`，包含独立更新验签、App/DMG/固定 DR、原生 OAuth 函数精确引用/重建字节比较；不输出配置值或反汇编，前端资源不含本机私有配置。下一步用户通过正式下载/应用内更新或 Homebrew 验证新包，其他服务商及故障矩阵不扩充为通过。

### 七资源公开核验

| 资源 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.19_aarch64.app.tar.gz` | 12345320 | `154c91c670b511fca54edb4422ee0cc80177ebd976a3d8336137d28a24d17178` |
| `Anser_0.1.19_aarch64.app.tar.gz.sig` | 424 | `6b6f58a70656631505859745247f6aebe4fe962337a2545673a2767756c84ca1` |
| `Anser_0.1.19_aarch64.dmg` | 12913889 | `752fbc733a5d8fe9beac0e9eb2fdfb69a464cc935340c429eacc164f7d69afa0` |
| `Anser_0.1.19_x86_64.app.tar.gz` | 12924821 | `8bee02a6b3cb505c4c1f3b54f26a699461e3600c558ca78499b913b60ebf1acc` |
| `Anser_0.1.19_x86_64.app.tar.gz.sig` | 424 | `0e98cb0dc7cf7f27ece7a8521d0849675d1e9474308d356e11b3992b990c0e23` |
| `Anser_0.1.19_x86_64.dmg` | 13583757 | `5586549faca22cf78d0620572f83d1bd48dfae0ac67f79a1fa3a6a2deac0d7b3` |
| `latest.json` | 3517 | `2f257226929587077dd962d2f1c32cd05d3d8231abd74be83c260af0f386be48` |

## 固定源码与云端构建（2026-10-16，发布前历史）

- 源码 `037d7aaaa8a2104236af3bd1675e8dd830afb5ee` 已提交并原子推送组织 main 与唯一新标签 v0.1.19，远端两处 SHA 已核对。
- [Release macOS 38869273847](https://github.com/ansermail/anser/actions/runs/38869273847)、[Checks 38869273770](https://github.com/ansermail/anser/actions/runs/38869273770) 与 [Pages 38869273892](https://github.com/ansermail/anser/actions/runs/38869273892) 已启动；仅新标签触发一次 Release，没有重复 dispatch。
- 本地与云端全部检查通过，独立 Checks / Pages 成功。Apple Silicon / Intel 构建、固定签名校验和临时钥匙串清理均成功，正在汇总草稿七资源；下一步下载后独立审计，再正式公开。公开仍 0.1.18，未提前发布。
- 审计目录 `/tmp/anser-release019-audit` 在仓库外；独立更新验签和 App/DMG/OAuth/固定 DR 审计入口已准备，必须等本次产物实际生成再核验。

## 发布准备与本地阶段（2026-10-16，历史）

- 用户授权处理完成后提交、触发远程流水线并发新包。基线 main / `b030d5d4feb585f1b4fb497ce8368da60abd0f6e`，工作树干净，origin 为组织仓库。
- 已认证查询确认组织仓库 v0.1.19 的 Release 与标签均不存在；不将查询失败当作不存在，不改写公开 0.1.18。
- 发布范围：通用正文图片状态修复、跨版本完整升级说明、统一钥匙串和固定免费项目自签名。既有已完成提交 e639292 / 2aa8dc6 / 380f566；功能各自真实验证及限制见对应工作点。
- 已同步 npm / lock / Cargo / lock / Tauri 五处 0.1.19，新增 `releases/v0.1.19.md`；不改标识、账号或原件，不更换更新公钥/私钥。
- 下一步执行本次源码完整本地发布门槛及隐私审阅，提交推送 main 与唯一新标签，等待 Checks / Pages / Release 检查及双架构构建；七资源审计后发布，再核验公开端点和 Homebrew。
- 当前尚无 0.1.19 安装包或正式发布；此前签名验证 App 不当作本版产物。正式自动更新安装、Intel 实机和系统拒绝/锁定矩阵仍需独立验收。

## 验证与产物记录

本次完整门槛、固定源码、Actions、七资源大小/摘要、两架构 App/DMG/更新签名与固定 DR、公开下载、Tap 逐阶段补充。未执行项不标通过。

### 本地发布门槛（2026-10-16）

- 本机 Rust 1.91.1，与流水线相同。本次 0.1.19 源码执行 `npm test`：54 文件 / 363 通过；`cargo test --manifest-path src-tauri/Cargo.toml`：368 通过 / 3 忽略；`npm run test:desktop`：28/28；vendored IMAP：39/39。
- `npm run build`（含 UI/TypeScript）、`npm run build:preview`（含原生桥隔离）、`npm run format:check`、Rust fmt、`npm run release:check`、`git diff --check` 全部通过；仅保留已有 Vite chunk 提示。
- 完整发布增量与本机三项 OAuth 编译配置逐值比对无命中，私钥/token 模式无命中；本次提交范围仅五处版本及说明/开发记录，不包含 env、原始邮件、数据库、截图、私钥或安装包。
- 原生图片对照、统一钥匙串和双架构固定签名已有各工作点的独立实际验证；版本元数据更新未当作本轮正式包实机安装/升级完成。本版产物仍待云端构建与审计。
