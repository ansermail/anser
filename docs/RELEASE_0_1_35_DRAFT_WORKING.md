# 0.1.35 草稿与资源核验工作点（2026-10-28）

> 历史快照：以下为 2026-10-28 09:39 的早期草稿证据。用户后续授权发版，最终源码 `bd4d062` 于 16:04:03（Asia/Shanghai）公开为 0.1.35 latest；草稿资源已整体替换，不能沿用下方旧散列。当前结果见 [正式发布工作点](WINDOWS_RELEASE_WORKING.md)。

## 当时结果

源码 `cb8b8321893890d175590f2c084f09cf20a54fee`，分支 `codex/windows-support`。
[Release desktop 40522234419](https://github.com/ansermail/anser/actions/runs/40522234419) attempt 2 全部成功，2026-10-28 09:39（Asia/Shanghai）生成草稿；[Windows validation 40522206291](https://github.com/ansermail/anser/actions/runs/40522206291) 同源码完整成功。
草稿 ID `426172686`，`draft=true`、`published_at=null`、target_commitish 精确等于源码，九资源齐全。
[草稿入口](https://github.com/ansermail/anser/releases/tag/untagged-5a07cfca4e948c873840)（需仓库权限）。未发布、未合并 main，公开 latest 仍为 0.1.34；Windows 真实桌面验收由用户执行。

## 验证分层

- 代码：Windows 10/11 x64/WebView2、凭据与落盘、系统控件/Ctrl、正文资源/外链、每用户 NSIS 和默认关联保护；Mac A4 上方留白/字号及外部窗口长正文截断修复已提交。
- 自动门槛：云端 Mac 前端 447/447、桌面脚本 37/37、Rust 433/4 既有忽略、IMAP 39；格式/五版本/UI/i18n 1,362 键/生产构建通过。Windows Rust 432/2 既有忽略与 NSIS 构建、安装、x64 PE/版本/四许可、WebView2 首屏、外部 EML、原生正文外链点击、通知协议和原默认关联保护通过。
- 首轮 Mac check 两条七次跨页导航在 32,486/33,399ms 超过既有 30 秒时限；核对完整日志后同提交重跑一次，447 项全部通过，未修改时限/断言，未添加自动重试。
- 本机干净工作树：生产构建、完整格式、打印/外部窗口 13 项、固定签名候选 App 成功。此前同版本全目标 Rust 库 433/4 忽略、迁移示例 16/2 忽略、前端 447 与桌面 37 均通过，具体源码阶段见 Windows 工作点。
- Mac 原生：候选包沿用原三个账号及 5,499 封完整存档，无钥匙串授权提示。Cmd+K、失焦后 Cmd+N、空白写信关闭不新增草稿、Finder 打开独立虚构 EML、CID 图片、To/Cc 分行、安全外链实际交给系统浏览器通过；本轮未向真实邮箱发信。
- 打印根因：外部窗口 html/body 的固定高度和 overflow:hidden 裁掉后续页；初始 NSPrintInfo 边距 0 与 CSS 16mm 不一致，WebKit 后续回填 CSS 边距时改变绘制区域，导致额外缩小/页顶留白。打印媒体中解除应用外层裁切，原生初始边距匹配 CSS；邮件 Shadow DOM 的作者样式保留。
- `npm run test:mac-print` 使用生产 printableMail、构建 CSS、原生 NSPrintInfo 和实际 WKWebView 打印。主/外部窗口各 HTML/纯文本四组合均输出 60 段/5 页 A4，顺序与唯一性、末尾标记、附件名、无应用 UI 通过；x=45.35pt、文字顶 y=50.24pt。2026-10-28 再执行四组合仍全通过。
- 实际候选 App 中文系统面板实测 A4 210×297mm、竖排、100%、所有 7 页。系统“保存为 PDF”输出 595×842pt/7 页；60 个编号段落按序各一次，DOCUMENT-END-060 和附件名称完整；首行 x=45.354330pt、文字顶 y=50.237046pt，即 16mm 页边距加字体内留白。首末页 PNG 目视保留品牌蓝色、真实尺寸 CID 图片、表格与字号，无异常页顶空白。未点击实体打印机“打印”。
- 资源：本地九资源长度/SHA-256 与 GitHub digest 逐一一致；两个 Mac 归档和 Windows 安装器的 Tauri 更新签名均经既有公钥验证。Mac 双架构固定证书/精确 DR、版本/标识/中文本地化/四许可通过；两个 DMG 只读挂载后与对应更新归档 App 逐文件一致并已卸载。资源集合与清单平台、URL、签名及发布说明原文通过 releaseFiles 校验。

## 已提供的 Windows 安装器

`/Users/zhangxiaojun/Downloads/Anser-0.1.35-draft/Anser_0.1.35_x86_64-setup.exe`，同目录有 SHA256SUMS.txt 和验证说明。
SHA-256：`dcdbde3641b0bc06abe162c3120eaf1b69f71802d6f5a05328d9f18ecc6cdda2`；10,187,040 字节。
Windows 实机按 [检查清单](WINDOWS.md) 验证；草稿未公开，不能把资源 URL 的匿名 404 视为下载失败或通过匿名公开审计。

## 未完成与下一步

Windows 真实账号收发/IDLE、通知冷启动点击、A4 实际打印、原位升级仍待用户在 Windows 10/11 x64 验收；Mac 真实纸张打印、Intel 实机及正式升级未验证。Tauri 更新签名不等同于 Authenticode 或 Apple Developer ID/公证。仍保持草稿，任何正式发布需用户后续明确指令。
本轮使用固定签名候选包验证，没有替换 `/Applications/雁信.app`；验证后恢复原 0.1.34。原目录两处图片诊断 WIP 的 diff SHA-256 保持 `763e0c3ddc73dc727764b4e8efca565e0b93e8f2d51366790178780fc4b43011`，未进入提交或干净候选构建。生成的验证副本退出/取消注册后移入废纸篓；保留工作树以继续 Windows 验收。

## 草稿资源

| 资源                                |     字节 | SHA-256                                                          |
| ----------------------------------- | -------: | ---------------------------------------------------------------- |
| Anser_0.1.35_aarch64.app.tar.gz     | 12916723 | 9e6c2d09493baace69bf0462c8b783db1953c5ad531e0983d566b287b70d0583 |
| Anser_0.1.35_aarch64.app.tar.gz.sig |      424 | 58e579f5c972f47d5644fc873d0b48ca84407ff491918cc23868a6fe6efd47be |
| Anser_0.1.35_aarch64.dmg            | 13470171 | 0019dc8fefae4ee4f464b6f1ae192aacc9e3729b96d7ed1dfe11e7c9d4892984 |
| Anser_0.1.35_x86_64-setup.exe       | 10187040 | dcdbde3641b0bc06abe162c3120eaf1b69f71802d6f5a05328d9f18ecc6cdda2 |
| Anser_0.1.35_x86_64-setup.exe.sig   |      436 | 147cd86e4e0d910c255024aaaa6f5bcb2c19c28b86133092d952c90bcf09cabf |
| Anser_0.1.35_x86_64.app.tar.gz      | 13531409 | 895d0cbb7b45673eea93434c2723d9d45d13b8cac0ef76f165a26e51de22744f |
| Anser_0.1.35_x86_64.app.tar.gz.sig  |      424 | cdcacd3896cba22b43cff3dbe3d11feac72761d8ab682cf2f1220ba41b1f1c82 |
| Anser_0.1.35_x86_64.dmg             | 14182875 | d97d1502ac0c68265ef869e14491f82c46de3cf11671051a2b1bb59654a85649 |
| latest.json                         |     3787 | 02650ac62d09c548e32957272ea4341a8ad21e93a898526ec00a56f8007b1e21 |

验证副本清理位置：`~/.Trash/Anser-0.1.35-validation-20261028/`（含可恢复的资源审计与原生 PDF 证据）。候选包及审计 App 已取消 LaunchServices 注册；工作树的临时 target 符号链接已移除，原 target 目录未删除。
