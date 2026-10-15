# 邮件图片超时与正文调试（2026-10-13）

## 当前发布状态（2026-10-15）

本工作点的功能和修复已随 [0.1.17](https://github.com/ansermail/anser/releases/tag/v0.1.17) 的固定源码 `7312e5c` 正式发布，远程全量检查/双架构、七资源及标准更新端点核验完成，Homebrew 配方同步。发布证据与签名、实际安装/升级的独立边界见 [发布工作点](RELEASE_0_1_17_WORKING.md)。下方开发预览与未提交/未发布文字保留为当时历史，不能覆盖本项；更多服务商/模板及外部真实图片故障矩阵仍待独立验收。

## 发布前执行点（2026-10-15，X 排版占位图误报已完成开发预览验证）

- main / 83c1a4a，保留此前全部暂存及未暂存改动。原生截图对应的 X 邮件共 7 张 img：1 张统计像素、1 张 X 标志和 5 张相同的 130×1 占位图。标志正常解码，占位图 GET 为 HTTP 500 / text/html（270 字节），原生图片通道正确拒绝；不是正文照片缺失，也不是字体/翻译拦截。
- 旧状态逻辑只排除双边均 ≤1px，遗漏 130×1 / 1×130 的无内容标签细条。新增共享装饰分类，已知尺寸且无 alt/ARIA 内容说明的细条不影响正文状态；明确常规 spacer/blank/transparent/clear 文件名、确定单像素尺寸且非响应式图片的排版资源在派生 DOM 中用本地透明 GIF 保持布局，不再请求失效的远程占位图。真实图片/未知尺寸/有内容说明/响应式来源继续原加载路径；不改 MIME、不把错误 HTML 当图片、不放开脚本或 CSP。
- 图片分类/原生组件/净化/打印专项 33/33、完整前端 53 文件 / 327 项通过；生产/Pages/UI/格式及 diff 检查通过。原生 X/Google/Qoder 核验均通过，见下节。开发预览已更新并停留在原 X 邮件，检查器已关闭；下一步用户核对实际效果。未提交、安装新包或发布。

### 本阶段最终验证（2026-10-15）

- `npm test -- src/lib/mail-image-decorations.test.ts src/lib/mail-images.test.ts src/components/mail-content-loading.test.tsx src/lib/mail-html.test.ts src/lib/mail-print.test.ts`：33/33；完整 `npm test`：53 文件、327/327。覆盖横/竖细条、多个域名的透明占位资源、图片语义标签、未知尺寸真实缺图、CSS 覆盖、srcset/picture 候选保护、定时清理/重试与原生组件告警。
- `npm run build`（含 `check:ui` / 类型检查）、`npm run build:preview` 与 Pages 原生桥隔离、`npm run format:check`、工作区和暂存区 `git diff --check` 均通过。首轮构建遗漏 querySelectorAll 的 HTMLImageElement 泛型导致两项类型错误，补齐后最终构建成功；既有 Vite 大 chunk / 混合导入警告保留。未修改 Rust、脚本、版本或原生权限，本阶段没有重跑 Rust/桌面脚本和全量发布门槛。
- 复用稳定 Tauri 开发实例（父进程仍为 Tauri CLI），无后端重编译或重启：X 原邮件 total=7、decoded=7、localSpacers=5、waiting/timedOut/failed=0、busy=false、alert=false；截图确认 X 标志和正文排版保持，失败条消失。原生 sandbox 仍为 allow-same-origin allow-top-navigation-by-user-activation，不执行邮件脚本。
- 同实例回归 Google AI Studio：8/8 图片解码，waiting/timedOut/failed=0、busy=false、alert=false；Qoder：5 张中 4 张正文图解码，隐藏统计图不计入，waiting/timedOut/failed=0、busy=false、alert=false。诊断记录数量/状态及必要无查询参数的资源路径，未向仓库或公开渠道写入真实正文/跟踪参数/截图。
- 没有发信、请求模型、改账号/代理/密钥/存档或 MIME；只重建派生阅读 DOM。保留原 X 邮件供用户核对，检查器已关闭。源码及全部此前暂存内容保持本机未提交状态，尚未安装新正式包、推送或发版。外部真实内容图的删除、拒绝访问、超时仍会正常提示；本轮修复不冒充这些外部故障已恢复。

## 目标与边界

- 图片加载中的占位条需要超时收起；正文区域右键提供浏览器调试，查看Console与资源错误。
- main / 887e297 / 0.1.13，保留前阶段未提交修改。通知点击用户已确认直达正文。当前本地包已安装；本轮先本地重建，用户确认前不推送或远程发布。

## 设计与代码

- mail-images.ts 为每张图片设15秒期限，布局变化不延长等待；超时收起动画并使用shadcn Alert/Button提供重试，失败单独提示。只重试未成功的图片，保留净化后src/srcset，成功图片和MIME原件不变。
- 浏览器继续处理已发出的图片请求，迟到成功移除提示；WebKit sandbox事件受限时通过仅在有未完成图片期间的1秒检查更新状态。切换正文/卸载释放计时器、监听与过期回调。
- MailContent只读阅读处显式inspectable；正文iframe恢复系统原生右键（Inspect Element），正文容器/纯文本通过data-mail-debug-region豁免默认菜单屏蔽。写信/签名预览继续原屏蔽规则，业务自定义菜单继续shadcn。
- Tauri devtools Cargo feature及main窗口devtools配置使本地Release包也可检查；不新增IPC权限，不放宽邮件净化、CSP或scripts-disabled iframe sandbox。

## 首轮自动检查记录（历史）

- 图片期限4项、默认菜单边界2项、布局4项、安全HTML11项，共21项已通过。
- 尚需组件超时/重试显示回归，UI/生产/预览/格式检查，ego-browser虚构图状态与原生右键开发者工具验收。
- 尚未重建或安装本轮桌面包；接续从上述验证开始。真实邮件不修改原件，不因测试清空真实草稿或批量改标记。

## 浏览器与原生首轮结果

- ego-browser空间27复用应用React运行时挂载虚构MailContent，两张data图片中仅一张用DOM状态模拟持续等待；实际15秒后占位条消失、aria-busy=false、提示/重试可见。重试恢复占位条，迟到成功清除提示，成功图片src未变、正文保留。临时DOM/root/状态已清理，没有修改业务源码注入或真实邮件。
- 首轮本地desktop:build成功，27.96MiB；备份上一包至`/Users/zhangxiaojun/.config/yanxin-release/local-backups/20261013-185636/雁信-before-image-debug.bundle`并安装。codesign深度严格校验通过、DR内容与通知包一致。
- 真实HTML阅读区域原生右键出现Inspect Element，实际打开WebKit检查器，Console与Network可用。用户也提供了控制台截图。随后发现64次scripts-disabled跨帧事件警告，首轮包仍存在此警告，不标作已修复。

## 用户补充：电子工程周报缺图及控制台警告（2026-10-13）

- 用户指出《电子工程周报》2026年第35期所有远端图片未显示；同服务商第27期在本机也复现，图片都来自`www.eechina.com/edm/image.php`。首张公共图接口`id=eNews`可独立核对，无账号/正文查询参数。
- WebView Network实际GET为HTTP200、HTML、约16.45KB，naturalWidth=0；同URL主页面Image对照也失败。HEAD仅返回image/gif不能证明实际GET是图片，后续命令行GET同样返回200/text/html约16124字节，内容为阿里云WAF浏览器/验证码验证页。没有执行该验证页脚本、解验证码或绕过限制。
- 用户已确认在其他地方查看这封邮件也不能加载图片，缺图按服务端限制记录；不改原件或图片地址，不为了第三方验证开启allow-scripts。
- 重复控制台警告另由WebKit的scripts-disabled帧事件限制处理：原生阅读不绑定子文档load/error/click/auxclick监听；状态使用父页面1秒检查/布局观察，外链继续既有原生导航路由。浏览器端仍保留事件拦截；native组件与tracker专项验证不绑定子文档回调且保留sandbox。
- 更新后的图片/菜单/布局/安全HTML/原生回调边界共25项通过、格式检查通过；该轮包已构建安装，后续控制台结果见下方记录。

## 用户补充：对话规则与Qoder误加载提示（2026-10-13）

- 已核对前后端conversation实现：同账号Message-ID/serverMessageId/In-Reply-To/References形成引用连通关系，标题及Re前缀不参与；不同账号分开，缺少引用头可能无法合并。同标题隔离/缺失祖先/分支/服务端ID回归4项通过。
- 原生Qoder图片清单共5张：四张可见图片naturalWidth>0，Logo143×40、社交图标24×24；另一张统计请求display:none/width:1px/height:1px，naturalWidth=0且TLS错误。正文图片本身已加载，旧状态统计把隐藏img也算入，解释截图的多余占位/超时。诊断仅记录尺寸/状态及去查询参数的资源路径，不把跟踪参数加入文档。
- watchMailImages根据自身/祖先display:none、opacity:0、content-visibility:hidden及自身visibility隐藏状态排除隐藏图片；有确定渲染/CSS/HTML尺寸且两边不超过1px的小像素也不参与。零布局框但没有确定尺寸的真实未完成图片继续等待，避免隐藏真实缺图。重试前重新检查可见性；不改HTML图片地址/MIME或执行邮件脚本。
- 当前新增隐藏统计/祖先隐藏/重新显示及native组件回归；图片、组件、安全HTML、菜单、布局、对话共32项通过。浏览器及桌面安装结果见下方。
- 前一sandbox监听修复包已构建安装，备份于20261013-191511/雁信-before-sandbox-listener-fix.bundle；本轮原生检查器未见Blocked script execution，已有资源TLS及ResizeObserver日志，不能记作控制台全无错误。

## 隐藏图片修复自动检查与浏览器结果

- `npm test -- src/components/mail-content-loading.test.tsx src/lib/mail-images.test.ts src/lib/context-menu.test.ts src/components/mail-content.test.tsx src/lib/mail-html.test.ts src/lib/conversations.test.ts`：32项通过。
- `npm run build`（含check:ui）、`npm run build:preview`及原生桥隔离检查、`npm run format:check`、Rust fmt和`git diff --check`通过；生产构建保留已有大chunk/混合import提示。
- ego-browser空间27挂载虚构MailContent：一张成功内容图、两张明确隐藏/1×1像素，DOM模拟像素持续pending；真实等待16秒后aria-busy=false，无占位/超时/失败提示，原图片DOM仍存在。临时root/DOM全部清理，该浏览器检查空间已关闭。较早单独两轮间因页面刷新丢失临时fixture，未作为超时验收；最终同一轮完整验证通过。
- `npm run desktop:build`完成，App27.96MiB、更新归档11.29MiB，使用既有稳定Apple Development签名；未公证/未获得Developer ID，此为本地验证包。没有触发远程流水线或发布。

## 本地桌面最终验证与接续入口

- 已备份上一安装至`/Users/zhangxiaojun/.config/yanxin-release/local-backups/20261013-192718/anser-before-hidden-image-fix.bundle`，可逆覆盖`/Applications/雁信.app`。codesign深度严格校验通过，签名DR与上一包一致；安装二进制与构建包SHA-256均为`e12303f169cc9131994ce66c754d027ce86df55eca8e1e55f26fe111752d767e`。账号/存储标识及原件未改。
- 新安装包实际打开原Qoder邮件，Logo/正文/表格正常，超过等待期限后无占位/超时/失败提示。原生检查器读取：四张可见图片complete=true、naturalWidth>0，隐藏统计图片complete=false/naturalWidth=0/display:none；正文aria-busy=false，bar=false，notice=false。已关闭检查器并保留原邮件阅读页供用户查看。
- 新包正文原生右键Inspect Element实际可用，控制台本轮未见Blocked script execution，iframe仍为allow-same-origin且不允许邮件脚本；不能据此承诺所有资源或其他控制台警告都消失。
- 本轮目标修复/相关自动检查/浏览器及这封真实邮件本地验证完成；等待用户确认显示效果后再进入提交和正式发布全量门槛。公开版本仍0.1.13，未推送/打标签/远程发布。其他历史未完验收与Developer ID事项保持各自工作点，不由本轮替代。

## 2026-10-15 Google AI Studio 正文图片代理缺口（已本地安装验证）

- 基线 main / 83c1a4a；保留中文打印与签名方向等既有未提交修改。用户反馈正文看似完整但有图片超时。
- 原生检查器确认 8 张 img 中仅 Logo 完成；正文 GIF、多个图标和推广 PNG 仍 complete=false/naturalWidth=0，另有统计像素。只记录资源类型/状态，不公开真实邮件或跟踪地址。
- 公共 gstatic 资源使用当前终端代理 GET 成功（GIF 4,606,564 字节、PNG 48×48），关闭代理的同资源 GET 15 秒连接超时；macOS 系统 HTTP/HTTPS/SOCKS 代理均关闭。当前全局代理只覆盖协议与 OAuth，WebView 图片存在直连缺口。
- 计划：原生图片通过仅提供图片的异步资源入口读取当前全局代理配置，保留 TLS 校验、HTTPS 重定向、容量/时间/并发限制及原始 MIME。净化后的 img/srcset/背景图接入，网页示例保持浏览器资源行为；补充真实图片失败与隐藏像素回归。
- 实现、专项/生产/Pages 检查、稳定开发预览和本地安装验证均已完成，结果如下；本轮未推送或发版。

### 实现与回归

- 新增 `src-tauri/src/mail_images.rs` 和 `src/lib/mail-image-resources.ts`；主 WebView 注册图片专用异步协议，读取现有全局代理，包含 SOCKS5 远端 DNS、代理认证及可选连接失败直连。只有净化后的原生图片资源被映射，含 srcset/背景；字体和被 CSP 禁止的外部样式不改走图片入口。
- 单张 20 MiB、并行 6、总期限 40 秒及最多 5 次受限 HTTPS 跳转；按 GET 字节判断图片，WAF HTML 不伪装为图片。响应 no-store/nosniff、禁用脚本的 CSP，不向资源服务器转发邮箱凭据/Cookie/Referer，不改 MIME 或保存设置。
- `safeMailHtml`、图片状态、组件/打印相关专项 26 项通过；最终 CSS import 保留专项 12 项复测通过。`npm test` 全量、`npm run test:desktop` 30/30、`cargo test` 330 通过/1 忽略及 fmt/UI/格式/diff 检查通过；`npm run build`、`npm run build:preview` 的共享 UI/原生桥隔离检查通过。Rust 新增 3 项图片入口回归和 1 项实际 HTTP 代理认证传输测试。
- ego-browser 空间 3 的虚构设置页文案核对通过；浏览器模式保留 HTTPS 原地址、不生成图片协议、净化脚本且 native bridge=false。截图接口超时，没有将该截图标记为视觉验收；空间已关闭。原生设置中也实际读到新增的正文图片范围说明。

### 原生与本地包结果

- 稳定 `npm run desktop` 进入 Running，开发应用父进程为 Tauri。原 Google 邮件图片 8/8 complete 且 naturalWidth>0（含 512×288 GIF、1080×554 PNG 和图标），busy=false，notice=false；最终字体 import 未改走图片路由，iframe 仍禁止脚本。Qoder 四张可见图片全部完成，隐藏统计请求 naturalWidth=0 不导致占位或超时提示。
- `npm run desktop:build` 成功生成 arm64 本地包（App 28.22 MiB、更新归档 11.40 MiB），使用既有 Apple Development 稳定身份，designated requirement 与原安装包一致；codesign 深度严格核验通过，版本仍 0.1.16、标识仍 dev.maildesk.desktop、简体中文本地化保留。
- 正常退出开发预览并关闭本轮启动器后，旧安装备份至 `/Volumes/Others/yanxin-local-backups/2026-10-15-mail-images-preinstall/雁信.app`；覆盖 `/Applications/雁信.app`。安装/构建二进制 SHA-256 一致，为 `55eb5020fce3e7b1d973fc0ccf7c1783806857d638a935aa4c4c598dca4b3049`。新 PID 54518 为系统独立启动，账号/代理配置载入正常。
- 安装包再次打开同一 Google 邮件，检查器实际返回 loaded=8、total=8、busy=false、notice=false；截图中原来空白的正文赛车场动图清楚显示。检查器已关闭并保留该邮件阅读页。期间 CUA 焦点/应用变化保护导致部分操作重试，未把那些中间操作记为成功验收。
- 打印图片的代理与等待有自动回归；本轮未完成新增图片等待后的实际系统打印面板验收。Intel/其他 Mac、无代理直连、其他代理类型的真实图片请求和第三方故障矩阵未扩充为通过；远端图片失效、验证页或超出容量仍可能正确显示失败，不承诺所有外部资源可用。
- 本轮没有发测试邮件、修改代理/签名/保存范围、迁移存档或发布真实截图。源码仍未提交/远程发布，公开 Release 及 Homebrew 维持原 0.1.16。下一步为用户核对本地效果，后续收到发版要求后按全量发布门槛处理并同步 Tap。


## 2026-10-15 字体样式限制调整（已本地安装验证，未发布）

- 用户明确要求调整字体样式策略；沿用 main / 83c1a4a 与所有既有未提交改动。字体文件此前由 font-src 允许，但字体描述 CSS 被 style-src 拦截，直接放开 WebView HTTPS 仍无法使用应用代理。
- 新增 anser-style/anser-font 专用通道，复用现有 HTTPS、代理、6 并发及总 40 秒限制；CSS 1 MiB、字体 10 MiB，CSS 必须 text/css/UTF-8，字体按 WOFF/WOFF2/TTF/OTF/collection 字节头核对，错误/验证 HTML 拒绝。CSS parser 重写导入、字体与背景图资源，相对地址以最终重定向 URL 为基准。资源响应不转发凭据/Cookie/Referer；字体提供匿名 CORS。
- 净化保留仅 HTTPS 的 stylesheet link、原有 @import/font-face；只在隔离正文放开对应资源 CSP。网页保持 HTTPS，不生成原生入口；打印删除邮件 link/style，不将邮件 CSS 注入主页面。导航沙箱维持用户点击例外，未放开脚本或任意顶层导航。
- ResizeObserver 的 body 尺寸变化只安排下一帧写高度，iframe 只响应宽度变化，避免写高度造成自身观察循环。
- 已验证：正文 HTML/打印/组件/布局专项 25/25；CSS 重写与类型保护 Rust 2/2。完整检查、原生字体加载及点击、本地包构建/安装待继续；尚未提交、推送或发版。


### 本轮实际验证

- `npm test` 完整 49 文件 / 294 项通过；`cargo test` 332 通过 / 1 忽略，桌面脚本 30/30，Rust fmt、前端格式、diff、UI、生产构建与 Pages 原生桥隔离均通过。生产构建保留既有 chunk/mixed import 提示。
- 稳定 `npm run desktop` 新 PID 56771 的父进程为 Tauri。只读临时 EML 字体 fixture 可显示；最终以原 Google AI Studio 邮件核对：实际 FontFaceSet 已加载 Google Sans、Roboto、Open Sans，font error=0；图片 8/8 完成解码，busy=false，沙箱仍 `allow-same-origin allow-top-navigation-by-user-activation`。
- 同一原生 WebView 中用 safeMailHtml 生成无真实数据的临时外链 fixture。AX accessibility press 会复现截图中的 Unsafe navigation 提示（不具有真实用户激活）；实际鼠标点击该链接正常由 Tauri 委托系统 Chrome 打开 example.com，雁信页面保持原位。因此保留用户激活要求，不新增 allow-top-navigation 或放开邮件脚本。临时 DOM 已删除、检查器关闭，本轮新开的 Chrome 标签已清理。
- 字体/图片本次正常加载期间未见字体 style-src 拦截或 ResizeObserver loop；这不是对所有模板/外部服务器的无错误承诺。ResizeObserver 的写入时序/忽略自身高度/保留宽度重排另有新增组件回归。
- 开发预览已关闭；`npm run desktop:build` 正在运行。安装包原生结果、备份/签名与交付待继续；未提交、推送或发布。

### 最终本地包交付

- `npm run desktop:build` 成功，arm64 更新归档约 11.47 MiB；沿用既有稳定 Apple Development 签名，未办理 Developer ID/公证。构建、旧安装与新安装 designated requirement 相同，codesign --verify --deep --strict 均通过，版本 0.1.16 / dev.maildesk.desktop / zh-Hans 保持。
- 开发预览与启动器已关闭。安装前备份 `/Applications/雁信.app` 至 `/Volumes/Others/yanxin-local-backups/2026-10-15-mail-fonts-preinstall/雁信.app`，随后覆盖安装并启动新包。安装与构建二进制 SHA-256 均为 `e2ccc47e464201431c589decf11511933aee214665320b72897c1f3bcea4f80e`。
- 最终安装包的 tauri://localhost 原邮件再次实际返回：loadedFonts=[Google Sans,Roboto,Open Sans]，failedFonts=0，images=8/8，busy=false；正文仍为禁止脚本的既有 sandbox。该轮检查未见截图中的字体 style-src 拦截或尺寸循环警告。检查器已关闭，保留该邮件阅读供用户验证。
- 本地实现、自动检查、原生开发及安装包的这封邮件已完成验证；其他模板/Intel、远端失效/容量/超时故障矩阵与本轮更改后的实际系统打印面板未扩充为通过。打印安全移除 link/style 有回归验证，不将远程邮件 CSS 带入主页面。
- 没有发信、修改账号/代理/签名、迁移存档或发布真实截图。尚未提交、推送或触发云端发版，公开版与 Homebrew 仍为原 0.1.16。下一步为用户体验验证；用户后续要求发版时再按完整发布门槛处理版本/发布说明、双架构资源与 Tap。
