# 发布与应用内更新

## 当前正式版本：0.1.16（2026-10-14）

0.1.16 Alpha 已于 18:16:42（Asia/Shanghai）正式发布为 latest。固定源码 `8a13673a5bdd0cc8f13f976956f84e035e64ec61` 经 [Release macOS 38547036796](https://github.com/ansermail/anser/actions/runs/38547036796) 完整检查、Apple Silicon / Intel 构建和草稿任务成功；[v0.1.16 下载页](https://github.com/ansermail/anser/releases/tag/v0.1.16)。七资源大小/摘要、两架构更新签名与公钥、App 版本/架构/标识/codesign/许可/EML/OAuth 原生配置及 DMG 与归档逐文件一致性已核验；发布前后草稿说明与资源身份不变，标签指向固定源码，七份按版本公开下载资源逐字节匹配。标准 latest 端点经短暂 CDN 缓存后也已逐字节匹配审计清单，见 [发布工作点](RELEASE_0_1_16_WORKING.md)。真实代理收发、正式包原位升级与 Apple Developer ID 签名/公证仍待验收。

## 0.1.16 修复准备记录（历史）

0.1.15 发布后发现邮件正文外链在桌面版被 CSP `frame-src` 拦截。0.1.16 使用新的 Anser 内部路由并修复用户点击的原生导航，五处版本及说明见 [v0.1.16](releases/v0.1.16.md)。本地/云端门槛、草稿审计及正式发布进展见 [0.1.16 发布工作点](RELEASE_0_1_16_WORKING.md)；准备时公开 latest 为 0.1.15，正式结果见上方。

## 前一正式版本：0.1.15（2026-10-14）

0.1.15 Alpha 已于 12:35:05（Asia/Shanghai）正式发布为 latest。固定源码 `63fb6c25e62506a790b61532127199251f701f5d`，[Release macOS 38510852394](https://github.com/ansermail/anser/actions/runs/38510852394) 的检查、双架构与草稿任务全部成功；[下载页](https://github.com/ansermail/anser/releases/tag/v0.1.15)。七资源元数据/摘要、更新签名、公钥、App 版本/架构/标识/codesign/许可/EML/OAuth 原生配置、两份 DMG 与归档一致性及公开 latest 清单已核验。真实代理收发/OAuth 刷新和正式原位升级未验收；本版邮件正文链接存在 CSP 拦截，见上方修复准备及 [发布工作点](RELEASE_015_WORKING.md)。Apple Developer ID 签名与公证未完成。

## 0.1.15 发布准备记录（历史）

用户已要求提交全局网络代理改动并启动组织仓库远程发版。候选 0.1.15 同步五处版本，说明见 [v0.1.15](releases/v0.1.15.md)；本地门槛、固定源码、双架构构建、资源审计及正式发布按 [0.1.15 发布工作点](RELEASE_015_WORKING.md) 分别记录。当时公开 latest 为 0.1.14；后续正式结果见上方。真实代理收发与 OAuth 刷新、正式原位升级和 Apple Developer ID/公证尚未验收。

## 前一正式版本：0.1.14（2026-10-13）

0.1.14 Alpha已于2026-10-13 20:14:21（Asia/Shanghai）正式发布为latest。固定源码`f1921c2cb9704b6641bb255be86c579b8b4ed542`，[Release macOS 38391912165](https://github.com/ansermail/anser/actions/runs/38391912165)的check、Apple Silicon、Intel与draft全部成功；[v0.1.14下载页](https://github.com/ansermail/anser/releases/tag/v0.1.14)。本机/云端290前端、321Rust通过（1独立性能项忽略）、30脚本、39IMAP与格式/UI/生产检查通过。七资源摘要/大小、更新签名、公钥、App版本/架构/标识/codesign/许可/EML及原生OAuth配置、DMG与归档全部8文件一致性核验通过；草稿发布前后说明和资源不变，标签指向固定源码，匿名标准更新清单逐字节等于审计清单，两架构四份安装/更新文件公开下载字节一致。正式包实际安装/原位升级与Developer ID/公证仍独立未完成，详情见[发布工作点](RELEASE_014_WORKING.md)。

## 0.1.14 发布准备记录（2026-10-13，历史）

用户已要求提交本地修复并远程发版，五处版本同步0.1.14。范围为邮件打印权限、账号侧栏背景/间距/稳定宽度、服务商目录分组与加载、草稿清空、macOS通知定位、正文图片超时及隐藏统计像素误提示、正文原生调试。说明见[v0.1.14](releases/v0.1.14.md)，全量门槛/固定源码/双架构构建/资源审计/正式发布分开记录于[发布工作点](RELEASE_014_WORKING.md)。当前公开latest仍0.1.13，Developer ID/公证及原位升级未完成。

## 前一正式版本：0.1.13（2026-10-13）

0.1.13 Alpha 已于 2026-10-13 10:02:13（Asia/Shanghai）正式发布为 latest。固定源码 `887e297859938b640fd51104690f8be8c66a53f0`，组织 [Release macOS 流水线](https://github.com/ansermail/anser/actions/runs/38334231416) 的 check、Apple Silicon、Intel 和 draft 全部成功；[v0.1.13 下载页](https://github.com/ansermail/anser/releases/tag/v0.1.13)。本机 262 前端、310 Rust（1 独立性能项忽略）、28 桌面脚本、39 IMAP 及 UI/格式/生产/Pages 构建通过；云端全量检查通过。七资源大小/SHA-256、两架构更新签名、公钥、App 版本/架构/标识/完整 codesign/许可/EML 与原生 OAuth 配置均已核验；两份 DMG 的全部 8 个 App 文件逐个匹配更新归档。草稿发布前后说明原文及七资源 ID/大小/摘要不变，标签指向固定源码；匿名公开标准更新端点逐字节匹配已审计清单，四份公开安装/更新资源与审计资源逐字节一致。实际安装、原位升级、真实邮箱目录批量已读和 macOS 系统打印仍待用户下载验收；Apple Developer ID 签名/公证未完成。详情见 [0.1.13 发布工作点](RELEASE_013_WORKING.md)。

## 0.1.13 候选准备记录（2026-10-13）

用户要求将本地目录修复与新增的单封邮件打印经组织仓库远程双架构流水线发布 0.1.13。五处版本已同步，说明见 [v0.1.13](releases/v0.1.13.md)。当时公开 latest 仍为 0.1.12；本机全量门槛、远程构建、资源审计和正式发布分别按 [0.1.13 发布工作点](RELEASE_013_WORKING.md) 记录，后续结果见上方正式发布。

初版源码 `4c52035` 推送后曾触发 [Release macOS 38333548322](https://github.com/ansermail/anser/actions/runs/38333548322)，用户随即补充所有账号文件夹右键标记已读要求；该运行已在检查阶段取消，未生成草稿。补充功能随后从新固定源码重新运行，旧候选没有发布。

## 前一正式版本：0.1.12（2026-10-12）

0.1.12 Alpha 已于 2026-10-12 15:38:33（Asia/Shanghai）正式发布为 latest。源码 `996738d82f5e55af5f0dddb13ddba9a5248a9d05`，组织 [Release macOS 流水线](https://github.com/ansermail/anser/actions/runs/38217856007) 的 check、Apple Silicon、Intel 和 draft 全部成功；[v0.1.12 下载页](https://github.com/ansermail/anser/releases/tag/v0.1.12)。本机255前端、307Rust（1独立性能项忽略）、28桌面脚本、39 IMAP及 UI/格式/生产/Pages构建通过；远程检查与双架构完成。七资源大小/SHA-256、两架构更新签名、App版本/架构/稳定标识/完整codesign/许可/EML、原生OAuth编译配置及DMG与归档逐文件一致均已核验。标签指向固定源码，发布前后草稿说明及资源ID/摘要未变；匿名标准更新端点已逐字节匹配新清单，两架构安装包和更新归档公开下载字节一致。实际安装、原位升级及完整富文本真实互发尚待用户下载后验收；Apple Developer ID 签名/公证仍未完成。详情见 [0.1.12 发布工作点](RELEASE_012_WORKING.md)。

## 0.1.12 候选准备记录（2026-10-12）

用户已授权提交当前富文本/正文图片及更新说明修复并通过组织仓库远程流水线发布 0.1.12，供下载测试。五处版本已同步，说明见 [v0.1.12](releases/v0.1.12.md)。本机 255 项前端、307 项 Rust（1独立性能项忽略）、28 项桌面脚本、39 项 IMAP 解析器、UI/格式/生产与 Pages 构建通过；远程双架构、资源审计和正式发布分开记录在 [工作点](RELEASE_012_WORKING.md)。真实富文本互发/草稿重开与正式原位升级仍待独立验收。

## 更早正式版本：0.1.11（2026-10-12）

0.1.11 Alpha 已于 2026-10-12 08:55:48（Asia/Shanghai）正式发布为 latest。源码 `652fad54779f330767b251b7acc23914ecdd29f4` 已合入组织 main；[Release38189306087](https://github.com/ansermail/anser/actions/runs/38189306087) 全量检查/双架构/draft 成功，[下载版本](https://github.com/ansermail/anser/releases/tag/v0.1.11)。本次云端 241 前端、305 Rust（1独立性能项忽略）、28桌面脚本、39 IMAP 及格式/UI/生产构建通过。七资源尺寸/摘要、完整说明/清单、更新签名、公钥、App 版本/架构/稳定标识/EML/许可/codesign/原生OAuth、DMG全部8文件与归档一致性已重新核验。发布前后资源未替换，标签指向固定源码，匿名标准更新端点逐字节等于本次清单，两架构更新包匿名下载字节一致、DMG HTTP200。首次公开查询短暂缓存0.1.10，随后标准端点已确认0.1.11；实际安装/原位升级未验证，Apple Developer ID/公证未完成。

## 前一发布准备（2026-10-12）

用户授权正式发布 0.1.11，完成开发阶段合入 main，固定新源由组织 GitHub 流水线重新构建。七资源与公开更新端点核验完成后再记录正式发布；当前公开仍为 0.1.10。接续 RELEASE_011_WORKING.md，安装/原位升级独立待验收。

## 前一候选构建（2026-10-11）

0.1.11最新候选为fdc1049 / [Release38150754149](https://github.com/ansermail/anser/actions/runs/38150754149)，check/双架构/draft与新源七资源、更新/App签名、DMG、版本/标识/EML/许可/原生OAuth配置核验完成；草稿目标与说明、资源及匿名公开latest核对后不变，正式仍0.1.10。包含附件/快捷操作、筛选日期/层级、Status表头和草稿源码/说明保护；五项原生组合、标记恢复、计划取消与双向收件附件字节通过，用户确认系统拖入。复杂焦点/拖拽边界及大附件故障、安装/原位升级仍独立待验收；尚未正式合入main或发布，详情 RELEASE_011_WORKING.md。

## 用户流程

正式应用启动后自动检查更新，之后每 6 小时再检查。只有检测到新版本才在“本地优先”前显示更新图标。设置与账号中的“关于与更新”始终提供手动检查。

点击更新图标 → 查看版本与发布说明 → 下载更新（显示进度）→ 校验签名 → 安装并重启。Tauri 更新器替换当前应用所在位置，后续无需把应用重新拖入 Applications。写信窗口打开时禁止安装；重启前等待正在进行的收取/发送完成并保存窗口状态。

更新中心将发布说明的 Markdown 渲染为标题、列表、代码、表格和链接；渲染前净化 HTML，只允许安全的外部链接和 HTTPS 图片。桌面版点击链接通过系统默认浏览器打开，失败时显示反馈。该界面改动已随 0.1.12 发布；已发布 0.1.11 的更新清单及产物未改。

开发预览允许检查，禁止下载安装覆盖开发实例。首次安装仍需使用 DMG；旧版本如果没有更新器，需要先安装含更新器的版本。当前未有 Apple Developer ID 证书，未做签名公证；Tauri 更新签名用于校验来源，不等同于 Apple 的签名公证。更换应用代码签名身份时，钥匙串可能要求重新授权。

## 已配置的流水线

- `.github/workflows/ci.yml`：main 推送和 PR 执行前端/脚本/Rust 回归及 UI 检查和生产构建。
- `.github/workflows/release.yml`：推送 `v*` tag，或 Actions 手动运行；验证版本、发布说明和测试后，分别构建 Apple Silicon 与 Intel Mac 的 DMG、app.tar.gz 与签名。
- 构建任务只产出架构独立的 artifacts；汇总任务检查两个架构文件齐全，统一生成 latest.json 并创建草稿 Release，避免并行写清单丢失架构。
- 发布后的同版本不可覆盖。`scripts/release-draft.mjs` 对缺失/未发布/已发布状态进行明确查询；查询失败停止，不能按“缺失版本”处理。未发布草稿重建先同步完整提交 SHA 与当前说明，上传前后核对身份、版本、两架构清单/签名及精确七资源；已有轻量或附注标签必须指向该提交，否则要求新版本，不移动标签。所有发布运行串行；外部人工操作仍可能与 GitHub 请求之间竞争，构建期间不要手动发布或替换资源，正式发布前独立审计。`releases/latest/download/latest.json` 只有正式发布后才可用，客户端不读取草稿。
- 仓库是公开的 `ansermail/anser`；客户端不包含 GitHub token。端点仅 HTTPS，签名必须有效；失败时保留当前安装，不执行重启。

## Google OAuth 发布配置

组织仓库 `ansermail/anser` 使用仓库级 GitHub Secrets `MAIL_GOOGLE_CLIENT_ID` 和 `MAIL_GOOGLE_CLIENT_SECRET`。macOS 发布流水线在 Apple Silicon / Intel 构建前检查两项是否存在，并仅注入原生构建步骤；不使用公开 Repository Variables 或 `VITE_` 变量，不给 Pages / PR 检查提供凭据。

更换客户端时同步更新两项 Secrets 和被 Git 忽略的本机 `.env.local`（权限 0600），然后重新启动开发应用或构建新版本。现有安装包的编译配置不会随 Secrets 修改而变化；已发布版本不可覆盖。Google 桌面客户端的 secret 会参与原生令牌交换，无法像服务端秘密一样保密；原始 JSON、本机配置及令牌不作为独立发布文件上传。

2026-10-10 已按用户提供的新桌面客户端文件更新本机配置及上述两项仓库 Secrets。发布流水线接线已完成；新客户端的浏览器授权、令牌刷新和包含新配置的双架构发布验收需另行记录，不能沿用此前客户端的验收结果。

## Microsoft OAuth 发布配置

组织仓库 Secret `MAIL_MICROSOFT_CLIENT_ID` 保存产品自有公共桌面客户端的 ID。Apple Silicon / Intel Release 原生构建先检查配置存在，再注入 Rust 编译环境；不进入 Pages/PR 环境或 `VITE_` 变量，不使用微软客户端密钥。修改 Secret 不会更新已经发布的安装包，需要在后续新版本云端构建中纳入，不能覆盖已发布资源。

2026-10-10 已完成应用注册、移动和桌面平台回调及 IMAP/POP/SMTP/离线访问委托权限声明；本机忽略配置与仓库 Secret 已同步。开发版授权和 IMAP 连接验证通过，个人账号误用企业发件配置时 SMTP 返回 535，尚需实际 Outlook 地址重测；真实收发/刷新、企业管理员批准和发布者验证未完成。含微软配置的双架构包构建与正式发布另行记录。

## 签名密钥

本机更新密钥在 `~/.config/yanxin-release/updater.key`，权限 0600，公钥已写入 Tauri 配置。私钥已上传仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`，没有提交到 Git 或写进日志。密钥没有密码，流水线明确使用空密码；应保管仓库外的密钥备份，后续版本复用同一密钥，不能重新生成替换已部署应用的公钥。

换开发机时恢复原密钥和 `.pub` 文件，然后运行 `npm run release:secrets`。脚本先验证公钥匹配和 GitHub 登录，只通过 stdin 上传密钥。

## 下次发布

1. 同步修改 package.json、package-lock.json（npm install --package-lock-only）、src-tauri/Cargo.toml、Cargo.lock 和 tauri.conf.json 的版本。
2. 写 `docs/releases/v版本.md`，运行 `npm run release:check` 和回归，提交并推送。
3. 推送对应 `v版本` tag，或者运行 `gh workflow run release.yml --ref main`。
4. 等待两架构构建和草稿生成，核验 DMG、app.tar.gz、sig、latest.json 和版本说明；再发布草稿。当前仍属于 Alpha，不代表开发计划全部完成。
5. 用含更新器的旧正式版检查新版本、下载安装并重启，确认账号、本地存档、窗口及新版本号。

## 验收记录

本地 120 项前端、170 项 Rust、13 项脚本回归及 UI/TypeScript/生产构建通过。前端覆盖无更新隐藏、有更新展示、下载先于安装、签名失败不安装、重复检查保护、重启失败只重启不重复安装、写信中阻止安装和开发预览保护。真实 GitHub Actions 构建和正式安装升级的结果以开发检查点记录为准，不能把模拟交互测试计为真实升级验收。

## 0.1.1 修复

0.1.0 首次 CI 包缺完整应用签名，虽更新归档签名有效，仍未通过 codesign 验证，已撤出稳定 latest。0.1.1 使用官方支持的 ad-hoc 完整应用签名并在 CI 强制验证 CodeResources/codesign；仍不是 Apple Developer ID 公证。

同版本已发布时，流水线提前跳过构建，不再把 tag push 的重复触发计为发布失败。升级版本同步更新 npm/Tauri/Cargo，页面从实际运行的 native 应用获取版本，不读取更新服务器版本来冒充已安装版本。格式检查已加入 CI，Rust 1.91.1 与本机验证一致；解析器兼容修改保留独立回归。

## 0.1.2 启动恢复

正常启动和更新重启完成时，在 Ready 事件主动显示主窗口，避免新进程启动但窗口不可见。--autostart 保持后台启动。最近活动记录启动版本和实际窗口可见状态；完整原位升级验收结果以 DEVELOPMENT_STATUS.md 为准。

## 0.1.2 验收结果

双架构流水线、发布文件/清单及签名验证通过，0.1.2 已作为 latest 发布。从实际 GitHub 0.1.1 包完成应用内下载、原位替换和新进程启动；新二进制与 GitHub 包逐字节一致，启动日志记录主窗口已显示，账号与存档保留。自动重启后工具不能读取窗口；另行正常打开同一更新后的包确认 0.1.2/Alpha，具体限制和待办保留在开发检查点。不能把正常重新打开视为自动重启时的视觉验收。

## 0.1.3 发布范围

0.1.3 包含已验收的收取优化、补存、保存引导和此前阅读/服务器操作功能，仍为 Alpha。正在开发的异步规则扩展另存分支，没有进入这个版本；本机 Google OAuth 测试配置也不进入公开包。发布说明见 docs/releases/v0.1.3.md，发布与原位升级的实际验收状态见 DEVELOPMENT_STATUS.md。

## Anser 与组织仓库迁移

项目英文名为 Anser，中文名为雁信。后续代码和发布使用 ansermail/anser，安装包以 Anser_版本_架构命名。0.1.5 发布的更新器与发布页使用组织仓库。

存储/钥匙串标识 dev.maildesk.desktop、已有布局/草稿格式标记和更新公钥继续保留。发布密钥仍沿用 ~/.config/yanxin-release/updater.key，避免生成另一把密钥导致旧客户端不能验证更新；开发签名优先读取 ANSER_DEV_SIGNING_IDENTITY，也兼容此前变量名。

个人仓库中已构建的 0.1.3 草稿没有发布。旧安装包仍请求旧仓库的更新端点；代码克隆不会产生 GitHub 转移重定向。需要一次迁移更新或安装组织版后，客户端才改用新端点。删除个人仓库前先完成这一步。

## 组织版 0.1.5 发布结果

v0.1.5 已在 ansermail/anser 正式发布为 latest。Checks 与 Release macOS 全部通过，Apple Silicon 与 Intel 的 DMG、更新归档、签名和统一清单均核验。公开 latest 端点已可读取；应用标识与更新公钥沿用原值。详细运行、签名和存档证据见 DEVELOPMENT_STATUS.md。

旧个人仓库地址不会因克隆自动重定向；旧安装包迁移和新正式包原位更新矩阵仍待验收，不以开发实例显示新版本代替。

## 独立界面预览

公开地址为 https://ansermail.github.io/anser/ 。组织仓库 Pages 使用 GitHub Actions 发布源，`.github/workflows/preview.yml` 在 main 的前端相关变更后构建并部署，也支持手动启动。`npm run build:preview` 生成 `dist-preview`，仅包含虚构示例与展示组件，不包含真实账号连接、桌面命令或发信接口。

本地检查可运行 `npx vite preview --mode preview --host 127.0.0.1 --port 4174`，访问 `http://127.0.0.1:4174/anser/`。Pages 发布与桌面 Release 独立；网页部署成功不表示新版桌面包已发布。

## 0.1.6 云端发布结果

0.1.6 使用组织仓库 GitHub Actions 双架构流水线，包含邮件签名、存档保存位置、设置/写信体验与 EML 文件查看；版本同步五处，发布说明见 [v0.1.6](releases/v0.1.6.md)。本机只执行门槛检查，不提供本地桌面构建作为本次交付。源码 e8e049d，[双架构流水线](https://github.com/ansermail/anser/actions/runs/37940050741) 全部成功。2026-10-09 22:13:59（Asia/Shanghai）[v0.1.6](https://github.com/ansermail/anser/releases/tag/v0.1.6) 已发布为 latest；七个资源 SHA-256、架构/版本/EML 声明、完整 codesign、DMG/更新包二进制及更新签名已核验，公开 latest.json 与验证清单相同。实际正式安装、默认 EML/冷启动与原位升级未在本轮执行，详见 [发布记录](RELEASE_016_WORKING.md)。

## 0.1.7 构建准备

首个持续开发节点包含 RULES-03 完整保存/在线正文核对、EML 入口简化和保存范围数量/磁盘预算。五处版本同步 0.1.7，门槛与原生只读预算检查通过；按用户要求使用组织仓库 workflow_dispatch 构建，草稿/资源/正式发布结果分别在 [工作点](RELEASE_017_WORKING.md) 记录。该准备阶段公开 latest 为 0.1.6；随后 0.1.7 已发布，见下节，开发版本不作为发布证明。

## 0.1.7 云端发布结果

[source1de47d7的Release macOS 38017514986](https://github.com/ansermail/anser/actions/runs/38017514986)双架构与草稿全部成功，核验七资源、签名、公钥、版本/架构/EML、codesign、DMG及对应二进制后，2026-10-10 10:59:30（Asia/Shanghai）[0.1.7](https://github.com/ansermail/anser/releases/tag/v0.1.7)发布为latest。匿名canonical清单逐字节匹配核验文件，更新链接两平台均HTTP200；详见[工作点](RELEASE_017_WORKING.md)。该包包含RULES-03和保存预算，不包含之后e2f7cf6的SYNC下载边界改动。正式安装与原位升级仍未执行，没有Apple Developer ID/公证。

## 0.1.8 已发布（2026-10-10）

在途收件箱只读 FETCH 可因实时通知停止；中断不保存部分原件、不清理旧来源或复用连接。纳入 e2f7cf6 的下载边界让出、项目许可资源与新 Google OAuth 编译配置；双架构构建从仓库 Secrets 注入，不改原更新密钥/标识。已从 f118cf3 完成远程 Release macOS 38033190031；15:22:16（Asia/Shanghai）发布为 latest。七项资源、更新签名、完整 codesign、许可资源、DMG/归档一致性、新 Google 编译配置及公开更新端点核验通过，详见 RELEASE_018_WORKING.md。真实繁忙/睡眠/其他服务商与正式原位升级仍待验收；本轮 QQ→企业邮只由定时补查观察到收件，QQ 自动已发送副本核对也有待处理项。0.1.7 产物保持不变。

## 0.1.9 构建准备（2026-10-10）

本机关键节点包含 QQ 自动副本只读核对、IDLE/NOOP 截止、跨时区排序/未读显示和 Microsoft 默认发布配置。209 前端/283 Rust/19 脚本/39 IMAP 与 UI/格式/生产/Pages 检查通过；固定源码、双架构 Actions、资源核验与正式发布持续记录 RELEASE_019_WORKING.md。当前仍以 0.1.8 为公开 latest，源码完成不等于新版已发布；真实 OAuth/升级等未执行项目继续保留。

## 0.1.9 发布结果（2026-10-10）

已从 220f4cc 远程构建并于 20:22:33（Asia/Shanghai）发布 latest：[Release macOS 38051136526](https://github.com/ansermail/anser/actions/runs/38051136526)、[Release 0.1.9](https://github.com/ansermail/anser/releases/tag/v0.1.9)。七资源/更新签名/版本架构/EML/完整 app 签名/许可/OAuth backend 编译配置、DMG 与更新包一致性、公开清单字节/固定标签/更新 URL HTTP200 全部通过。发布含 Microsoft 默认 Client ID；实际新授权/SMTP/刷新与本次原位更新仍独立待验收，不以配置装包冒充完成。详见 RELEASE_019_WORKING.md。

## 0.1.10 发布准备（2026-10-11）

搜索候选索引、两模式固定页/锚点阅读、日期/覆盖说明、无变化刷新尾页保持及统计优化完成开发分支验收，五文件版本同步。关键节点先完成全量门槛合入main，远程双架构构建后核验并发布草稿；固定源/运行/资源结果持续写RELEASE_010_WORKING.md。当前公开latest仍0.1.9，不能把开发预览或Pages成功当新版已发布。

## 0.1.10 正式发布（2026-10-11）

fa6bb6e / [Release38104135660](https://github.com/ansermail/anser/actions/runs/38104135660)双架构成功，10:16:43（Asia/Shanghai）发布[0.1.10](https://github.com/ansermail/anser/releases/tag/v0.1.10)为latest；七资源及更新/应用签名、版本架构/标识/EML/许可/OAuth默认配置、DMG与归档一致性、公开清单/固定tag/两架构URL通过。存储标识、公钥、原件未更换。开发代码/资源核验完成不代表实际原位升级，正式安装/多Mac等继续独立待验收，见RELEASE_010_WORKING.md。
