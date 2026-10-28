# Windows 客户端工作点（更新：2026-10-28）

## 当前检查点：实机验收已补充，正式发版准备中

2026-10-28 用户确认 Windows 邮件发送与打印已自行测试通过，并授权无阻断问题后发布。代理在真实 Windows 11 上确认融合顶栏、最大化/还原、最小化隐藏、空白写信关闭、草稿保存重开、系统通知横幅、长 EML/To/Cc/附件显示；不重复发送邮件。

[40647081835](https://github.com/ansermail/anser/actions/runs/40647081835) 对 `9c3aaae` 安装器补验通过，SHA-256 `f96ce1f488113874507ba63fa6e6ddbc83254c1f9619a5fa50beafa3fed57e59`：UIA 的任务栏子项缺失时使用 MSAA 定位实际图标并点击，主窗口恢复；GUI Subsystem、窗口按钮、原生菜单、外部 EML/外链、许可、通知协议与默认关联保护全部通过。旧草稿的 `cb8b832` 资源不可当成这些顶栏修正的最终包。

官网 Windows 下载及按系统默认选择已开发。当前正式发布流程、最终源码/资源/验收边界统一从 [Windows 发布工作点](WINDOWS_RELEASE_WORKING.md) 继续。旧的“只保存草稿”等限制属于当时指令，已由本轮用户的新发版指令替代；仍只在实际构建与资源核验通过后发布。

## 以下为早期草稿与开发历史（不作为当前入口）


源码 `cb8b8321893890d175590f2c084f09cf20a54fee` 的三平台 [Release desktop 40522234419](https://github.com/ansermail/anser/actions/runs/40522234419) attempt 2 完整成功；[Windows validation 40522206291](https://github.com/ansermail/anser/actions/runs/40522206291) 同源码完整成功。九资源与三个更新签名、Mac 双架构身份/元数据/许可/DMG 一致性已核验。[GitHub 草稿](https://github.com/ansermail/anser/releases/tag/untagged-5a07cfca4e948c873840) 保持 draft=true / published_at=null；公开 latest 仍为 0.1.34。

Mac 打印修复的四组合原生 PDF 自动检查通过，候选 App 系统面板和实际保存 7 页 A4 PDF 验证通过，页顶留白正常、60 段和末尾/附件完整。本机原账号/存档、快捷键、EML/CID/原生外链及空白草稿关闭已实测，未替换已安装正式 App。原目录两处 WIP 保留。

Windows 安装器已下载到 `~/Downloads/Anser-0.1.35-draft/`，SHA-256 `dcdbde3641b0bc06abe162c3120eaf1b69f71802d6f5a05328d9f18ecc6cdda2`。接下来由用户按 [Windows 真实桌面清单](WINDOWS.md) 验收收发/IDLE、通知冷启动、A4 打印和升级；验收结果出来前继续保持草稿。完整测试与资源表见 [草稿工作点](RELEASE_0_1_35_DRAFT_WORKING.md)。

## Windows 11 专业版局域网验收（2026-10-28，原生外壳修复中）

用户授权局域网安装测试并自行完成登录。代理已通过 Windows App 11.4.4 进入真实 Windows 桌面，实际看到运行中的雁信；此处不是 CI 或浏览器模拟。微软官方客户端包签名与 App 签名/公证检查通过，用户目录运行；未启用磁盘、打印机或智能卡共享。IP、用户名、凭据不写入公共仓库。

### 实机发现

- 用户和代理实见默认英文 File/Edit/Window/Help 菜单。根因是 lib.rs 无条件创建并设置 Tauri 默认菜单。
- 发布入口 main.rs 缺少 windows_subsystem 属性，Windows PE 按控制台程序链接，双击可创建终端。新增发布版 GUI 子系统声明，并在安装后读取 PE Optional Header Subsystem 验证为 2。
- 托盘实际已经创建；代理展开通知区域时看见雁信图标。Windows 默认把它收入折叠区，不能把“未固定显示”当成未创建。当前最小化只落到任务栏，现按用户要求增加 Windows 主窗口最小化后隐藏到托盘，关闭策略与既有后台行为保留；点击托盘复用 unminimize/show/focus。外部阅读窗口仍按系统方式最小化。
- 代码已修正，Mac cargo check/cargo fmt 通过。新 Windows 安装冒烟将核对真实窗口 GetMenu 为零、最小化后隐藏、真实系统托盘点击恢复及外部窗口无菜单；尚未运行的检查不记通过。

### DBX 融合式顶栏补充（2026-10-28，进行中）

用户进一步要求 Windows 标题栏参考 DBX：右侧三个窗口按钮与应用界面融合，去掉额外的图标/应用名。当前 5d7fc69（默认菜单/GUI 子系统/最小化到托盘）已推送；其 Release desktop 40627196271 因新设计要求取消，不会用它覆盖草稿。

最新未提交实现：DesktopTitlebar 在主/外部窗口共用现有 shadcn Button；Windows decorations=false，32px 统一顶栏，应用操作行留出右侧三个按钮位置。Tauri API 提供 minimize/toggleMaximize/close，resize 同步 maximize 状态；两窗口 ACL 已补齐，阻止标题栏操作导致写信/设置 Dialog 外部点击关闭。Mac 和网页端保持原有行为。窗口按钮新增五条双语文案，原生安装冒烟将真实点击最大化/还原/最小化并检查系统状态，而非只调用 ShowWindow。

本地最终新组件 6 项/外部窗口 4 项共 10/10 通过（包含原生动作、最大化图标同步、API 失败反馈、浏览器/Mac 无额外控件、Dialog 不误关闭）；UI/i18n 1,367 键/TypeScript/生产构建、格式与 cargo check/cargo fmt 通过。初轮测试全局类型声明报错已修正；Windows 编译、安装和 RDP 实机验收仍未完成。

RDP 当前已登录。客户端“连接中心”和目标桌面是不同窗口；操作客户端菜单后应重新在“窗口”菜单选中目标会话，再按最新截图操作；不能把连接中心截图当作远程 Windows 画面。先前拖动托盘图标后未确认固定成功，不记为已固定。待新包就绪后继续系统设置/托盘实际操作。

### 当前下一步

用户调整顺序：先构建临时 Windows 验证包并在真实 Windows 11 上验收，草稿资产最后统一处理。`8c662ab` 的 Windows frontend 成功，native 的 Rust 432 passed / 2 ignored、IMAP 39 passed、NSIS 构建均通过；安装冒烟仍在通知区域自动化定位处失败。验证工作流已把安装器与冒烟报告拆开上传，避免报告失败阻断实机测试。此修改尚需推送与新构建，之后下载并核对安装器 SHA-256，在当前 Windows 会话验证菜单消失、无新增终端、窗口按钮、最小化/关闭与托盘恢复，再继续 EML/Ctrl/打印检查。0.1.35 原草稿保持不动，三平台草稿构建 40628599647 因 Windows 冒烟失败未进入草稿步骤；真实账号收发/IDLE、通知冷启动和升级继续单独记录。

## 以下为 2026-10-27 开发历史（不作为当前入口）

## Mac 原生打印复验（2026-10-27，修复中）

- 干净源码 e05d2b6：Mac 全目标 Rust 库 433 passed / 4 ignored、迁移示例 16 passed / 2 ignored；前端 447/447、桌面脚本 37/37、生产构建通过。
- 固定自签身份的 0.1.35 候选 App 构建与签名/DR 核验通过；本机原账号/存档可读，无钥匙串提示。Cmd+K、失焦后的 Cmd+N、空白写信关闭无新增草稿、Finder 冷启动外部虚构 EML、CID 图、To/Cc 分行及原生正文外链打开系统浏览器实测通过。
- 60 段虚构长邮件的原生打印预览只显示一页，后半正文截断；用户指出上边距异常。先修复并保存实际原生 PDF 检查位置与完整分页，再构建最终草稿。旧 Release desktop 40517803029 的同提交重跑 check 已通过，后续构建已取消；第一次失败为 Mac jsdom 固定页刷新用例 6,655ms 超过 5,000ms，日志核对后同提交重跑通过，未提高超时。
- 本机 `/Applications/雁信.app` 0.1.34 未替换；真实邮件未发送；用户于 2026-10-28 验证 Windows，仍禁止正式发布。

## 打印修复结果（2026-10-27，候选 App 复验待完成）

- 根因已对照真实 WKWebView PDF：外部窗口的 html/body 固定高度+overflow:hidden 导致只输出第一页/8 段；打印媒体中解除外层裁切后 60 段及附件完整。原生边距 0 与 CSS 16mm 使首次布局和最终绘制区域不一致；同为 16mm 后首行 x=45.35pt、文字顶 y=50.24pt，旧参数为 y=86.69pt 且文字缩小。
- 新增 `npm run test:mac-print`，直接使用生产 printableMail、构建 CSS、原生打印参数与 PDFKit。主/外部窗口 × HTML/纯文本四组合实际打印均为 5 页 A4、60 段按序各一次、末尾标记及附件名完整，无应用内容；首末页渲染检查通过。
- 最终修复的干净候选 App、系统面板及云端草稿资源仍待本轮继续；前一版本 e05d2b6 的 Windows validation 40517678031 已完整成功，不能替代最终修复源码的草稿构建。

## 当时的草稿准备检查点

用户最新要求：0.1.35 先保存 GitHub Release 草稿，不发布；Windows 实机验收由用户于 2026-10-28 进行。本轮先执行 Mac 自动回归、双架构签名/资源核验及本机原生检查；公开 0.1.34/latest/Homebrew 保持不变。已在独立干净工作树 `/Users/zhangxiaojun/.codex/worktrees/windows-release-draft/mail` 准备 Mac 验证，原目录既有图片诊断 WIP 保留。源码版本已同步 0.1.35，草稿资源构建及 Mac 验收结果待下文更新。

- 0.1.35 源码 `e05d2b6b18fe0be9ee302c2a371b683c2804717e` 已推送，手动触发 [Release desktop 40517803029](https://github.com/ansermail/anser/actions/runs/40517803029)，该工作流只生成草稿，没有发布步骤；不推送版本标签、不合并 main。并行 Windows validation 40517678031 负责同版本回归。
- 干净工作树的 Mac 前端 65 文件 447/447、UI/i18n（1,362 键）/TypeScript/生产构建通过；桌面脚本 37/37、五处版本一致性通过。Mac 全目标 Rust 与固定签名候选包构建仍进行中。
- 前一固定源码 `d61e1df` 的 [Windows validation 40514572315](https://github.com/ansermail/anser/actions/runs/40514572315) 完整成功：Windows Rust 432 通过/2 既有忽略、IMAP 39；NSIS、x64 PE/版本/四项许可文件、WebView2 首屏、外部 EML 与正文外链实际点击、通知协议和原默认处理程序保护均通过。Artifact `12740640493` 的 ZIP SHA-256 为 `26ec6aac7658dc9faa2029c92de8f47aaeeda21d138c786fdb31f3611bbc39c8`，本地下载一致；安装器 SHA-256 为 `fcc843a35d3d21b8f8ba766685a0cf8bab497626c649e0cf597d3124d380c3cf`，与 Windows 冒烟 JSON 一致。它的内部版本仍为 0.1.34，仅作为历史验证，明日应使用后续 0.1.35 草稿安装器。

### 调整为草稿前的构建入口

`d61e1dfcce124cfecaff6190b9fde00b0708c5eb` 已推送。当前 [Windows validation 40514572315](https://github.com/ansermail/anser/actions/runs/40514572315) 的 frontend 成功，native 已通过 Rust 全量及 IMAP 测试，2026-10-27 21:53:34（Asia/Shanghai）进入 NSIS 构建；PE 与许可审计/安装首屏/外部 EML/外链点击尚未完成，未提供或正式发布 Windows 安装器。`f4e904b` 安装器关联及附件保护已包含在本轮源码，先前两轮因新修正推送而取消，不计通过。

当时下一步（已完成，当前见顶部）：等待该 Windows 作业完整结果，失败读取原日志修复；成功后下载 artifact，核对 Windows 冒烟 JSON 和安装器 SHA-256，更新清单与开发记录。本地仅两处开工前图片诊断 WIP 继续保留；浏览器预览目录已移至 `/Users/zhangxiaojun/.Trash/Anser-Windows-QA-20261027-2139/dist-preview`，Vite 和 ego QA 已结束，本机 App 仍为已安装正式包。

## 目标与边界

- 用户要求在现有 macOS 客户端之外支持 Windows。首阶段按 Windows 10/11 x64、WebView2 与每用户 NSIS 安装包推进，继续共用 React/Tauri/Rust、协议及存档格式。
- 分支 `codex/windows-support`，基线 `05f40f1`；保留已有 `src/lib/mail-images.ts` 与测试的未提交修改，不混入本轮提交。
- 本机为 macOS，已安装正式 App 不重建或替换，不启动开发预览。Windows 编译、单元测试和安装包由 Windows CI 验证；原生界面、真实收发和升级单独记录。
- 0.1.34 已发布资源保持不可变；本轮先提供 Windows 验证构建，正式跨平台发布另用新版本。

## 初始发现

- keyring 仅启用 apple-native，Windows 会落到不可用的后端；加密凭据库和存档在写入后直接打开目录 fsync，Windows 不支持此 Unix 路径。
- 外部邮件窗口整段只在 macOS 编译；主窗口、快捷键提示与固定文案默认 Mac。
- 图片、CSS、字体使用 anser-* 自有协议，WebView2 需要相应的 http(s) 映射与 CSP；不能直接照搬 WKWebView 地址。
- 发布仅有双架构 macOS、七资源和 darwin 清单；本地打包入口强制 macOS 签名。
- Windows 默认文件关联由系统控制，不能写 UserChoice 绕过用户选择；安装器只注册可选处理程序。

## 实施清单

- [x] 凭据与文件落盘的平台适配及 Windows 回归。
- [x] 主窗口/外部邮件、Windows 快捷键及双语文案实现与前端回归。
- [ ] WebView2 邮件资源/CSP/链接与打印检查。
- [ ] Windows 通知与冷启动定位路径。
- [x] NSIS 安装器、Windows CI/冒烟与下载验证构建。
- [x] 跨平台发布资源和更新清单实现与脚本测试，保留 macOS/Homebrew（正式包待发布验收）。
- [x] 本地与云端结果、限制及继续入口更新。

## 初始开发入口（历史）

- 第一阶段提交 4467ce0 已推送独立分支，Windows validation 40492755820 首轮在格式检查失败：Windows checkout 自动将约 240 份源文件转换为 CRLF；macOS 同一提交格式检查通过。已新增 .gitattributes 固定 LF，下一轮核对原失败是否消失，不跳过检查。
- 当前实现：Windows Credential Manager 密钥、加密文件/存档落盘、外部邮件窗口、HTTPS 资源与 CSP、Ctrl 提示、Windows 默认应用入口、协议型通知和 NSIS 验证构建；后续验证以实际 Windows 日志为准。
- 本地前端全量 65 文件 447/447、Rust 432 passed / 4 ignored、桌面脚本 37/37、UI/i18n/TypeScript/生产构建/格式通过。两处既有 WIP 暂存保护后执行上述全量回归，随后按原字节恢复。
- 发布代码已扩展为 macOS 双架构 + Windows x64，共九资源，清单含 windows-x86_64；新的 Release desktop 工作流等三目标全部构建后才生成草稿。仅本地脚本验证通过，未执行跨平台正式发版，不修改 0.1.34 已发布资源。
- 43bfc6d 的第二轮 Windows 检查已通过 LF/格式门槛，前端 440/447 通过；App 大列表/连续阅读 7 条只有超时失败（5 秒及 30 秒），尚未进入 Rust。同一提交重跑一次 40493473297 attempt 2 为 441/447，仍有 6 条超时。两次测得固定页组 7–20 秒，七次跨页组 34–46 秒；仅这两组在 Windows 分别定界 30/60 秒，多次切换单封用例定界 15 秒，Mac 时限和断言保留。不添加自动重试或全局延长。
- Chromium 模拟 Win32 已核对 root 平台类、0px 标题栏留白、Ctrl 提示、Ctrl+K 聚焦和 Ctrl+N 打开空白写信；只使用虚构演示数据，不代表 Windows/WebView2 验收。未启动 macOS Tauri 开发包，未替换已安装应用。
- 已补 Windows 安装/开发/发布边界说明，以及 README、USAGE、IMPLEMENTATION、UPDATES 与 KEYCHAIN 的平台说明；公开 0.1.34 不变。
- f5123b5 的 [Windows validation 40510640832](https://github.com/ansermail/anser/actions/runs/40510640832) 前端作业成功：65 文件 447/447、脚本 37/37、格式通过。原生作业已编译 Windows 库与测试二进制，但整体 cargo test 在 keychain-migrate 示例遗漏 durable_file 模块处 E0433 失败；不是 WinRT API 错误。该遗漏已在 macOS 单独复现并修复，文件发布测试移至 archive，修后 cargo check 示例及 cargo test --all-targets 通过（库 432/4 忽略、示例 16/2 忽略）。
- 已为后续原生失败保留依赖缓存，并让正式 Windows 发布构建同样执行 Rust 回归及安装冒烟。下一步：推送示例修正，继续 Windows Rust 测试、NSIS 安装器与原生冒烟，全部成功后下载验证包和记录源码/资源证据。

## 安装与附件边界复核（e4d060f 验证期间）

- 发现默认 NSIS APP_ASSOCIATE 会改写 HKCU 扩展名默认值，尽管不触碰 UserChoice。Windows 配置现在清空继承的 fileAssociations，专用 hooks 只注册 OpenWithProgids、Applications/SupportedTypes 和 Capabilities；卸载只移除自有注册。冒烟同步检查三类邮件原默认值和候选项，不把“UserChoice 未变”当作完整证明。
- Windows 由系统关联打开附件，既有预览拦截遗漏 VBS/HTA/快捷方式等 Shell 可执行类型。已补齐脚本、控制面板、安装器及快捷方式类型；原始字节和另存入口保留。本地附件预览两项回归通过，含普通 PDF/TXT 仍可预览。
- 原生冒烟新增安装后 PE x64、源码版本、四项许可文件和安装器/App SHA-256 记录；实际验证待后续 Windows 作业。
- 本机正式 App 元数据现为 0.1.34，本轮未安装/替换它；浏览器 QA 已结束，Vite 已停止。
- e4d060f 的原生作业在新安装器修正推送后取消，日志已读取：Windows Credential Manager 与文件发布测试通过，发现启动参数测试硬编码 /tmp Unix 路径，不能在 Windows 去重断言；改用系统临时目录及 Url::from_file_path，保留相对路径/文件 URI 去重与拒绝网页参数断言。该轮未完成，不能标记 Rust 全量通过。f4e904b 已推送 NSIS hooks/附件/安装审计；下一轮继续携带可移植测试修正。
