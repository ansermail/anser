# Windows 首次正式发布工作点（2026-10-28）

## 目标和授权

继续 Windows App 局域网真实桌面验收；用户确认发送和打印已测试，无需代理重复发送。测试没有阻断问题后发布 0.1.35，并更新官网 Windows 安装器与按访问电脑系统默认选择的下载区。正式公开前仍执行最终源码构建和资源审计。

## 代码与环境

- 主目录 `/Volumes/Others/mail`，开工分支 `codex/windows-support`，发布后已切回 `main`，origin `git@github.com:ansermail/anser.git`。从 `957d828` 快进接上原干净工作树的 `9c3aaae`。两处既有图片诊断 WIP 不进入本轮提交。
- Windows 用户已安装 `9c3aaae` 验证包并登录。代理使用 Windows App 的已授权会话，不保存或提交连接地址、用户名、密码和真实邮件截图。
- 顶栏、菜单、GUI 子系统和托盘修正已经存在；本轮新增官网 `src/site/download-platform.ts`、官网双语/元数据/样式与 10 项平台识别用例。保持现有 shadcn 体系；Mac 芯片不根据简化 UA 猜测。
- 托盘自动化诊断/修正见 `scripts/windows-smoke.ps1` 和 Windows validation 的可选 `installer_run_id` 隔离冒烟入口；隔离运行与完整构建并行组独立。

## 已有证据

- 真实 Windows 11：窗口融合无英文菜单、最大化/还原、最小化隐藏、原账号和邮件可读，空白写信关闭未增加空白卡片，虚构 `WINDOWS-QA-20261028` 富文本草稿保存后重开仍保留主题与正文，测试系统通知横幅实际显示。测试草稿未发送、保留供核对；原有草稿未操作。
- 用户确认：Windows 发送已测、打印已测且没问题。具体纸张/设备与分页参数未由代理记录，不扩大为代理逐页 PDF 审计。
- 虚构长 EML 在独立窗口正常显示收件人/抄送、正文末尾 `DOCUMENT-END-060` 与 `windows-qa.txt`。局域网 HTTP 下载被 Chrome 提醒，由用户自行保留并打开。
- [独立安装冒烟 40647081835](https://github.com/ansermail/anser/actions/runs/40647081835) 成功：安装器 SHA-256 `f96ce1f488113874507ba63fa6e6ddbc83254c1f9619a5fa50beafa3fed57e59`、App SHA-256 `791b4347cafaecc1c4eb30656ac0fc541a6e97024832134caea2aa06966f9436`。真实 MSAA 托盘点击恢复、GUI Subsystem=2、窗口按钮、无默认菜单、首屏、EML/原生外链、四许可、协议及默认关联保护通过。
- 失败过程：40645448876 证实任务栏只有 UIA Pane、没有图标子节点；改 MSAA 后 40645811619 在 PowerShell 把 `0xfffffffc` 解析成有符号 -4 转 uint 处失败，使用无符号 DWORD 的十进制值后通过。断言未移除、未添加自动重试。
- 本地：`npm test -- src/site/download-platform.test.ts` 10/10；`npm run build` 与 `npm run build:preview` 的 UI/i18n/TypeScript/产物隔离检查通过。

## 发布步骤与当前入口

最终源码 `bd4d062faaa46c20b5f15ad997af00bbfd981011`、版本 0.1.35，已完成三平台构建、资源审计与 latest 公开；[Release desktop 40650749349](https://github.com/ansermail/anser/actions/runs/40650749349) 和 [Windows validation 40650747611](https://github.com/ansermail/anser/actions/runs/40650747611) 全部成功。main 与发布标签须保持固定源码，后续仅补开发记录和配方。官网与 Homebrew 同步已完成；最终文档提交不改变固定发布标签。下一入口：按需验证尚未覆盖的真实场景。

## 未验证的边界

Windows 10 实机、全服务商兼容、IDLE 主动新到达、绑定邮件通知冷启动、跨版本原位升级未验证；Mac 本轮不替换已安装应用，Intel 实机/真实纸张和升级沿用未验证边界。Tauri 更新签名与 Authenticode、Apple Developer ID/公证相互独立。

## 最终构建首轮（历史失败）

最终源码 `5c4901127c3a7b3f932a9b3e728e8d71870333d9` 的 Release desktop 40648825019 首轮前端 461/463 通过，两条失败均为既有大列表超时：固定页尾游标刷新超过 5 秒、逐封模式七次跨页导航 38,229ms 超过 30 秒。已读取完整失败日志，未见业务断言失败；按项目约定对同一提交重跑失败作业一次，不改时限和断言、不加自动重试。Windows validation 40648822153 同源码继续运行。

## 大列表 CI 进程隔离（本轮通过）

同提交 Mac 第二轮仍在相同两条用例超时（6,531ms 和 34,924ms），不是通过再跑解决；Windows 首轮 462/463，仅另一条未读边界用例 16,870ms 超过 15 秒。该提交导出的干净源码 `/tmp/anser-source-5c49011` 本机 67 文件/463 全通过，相关三个用例 1,888/7,304/2,980ms。

为核对测试进程资源影响，新增 `npm run test:ci`：先执行除 `src/App.test.tsx` 外所有测试，再以新 Vitest 进程执行完整 App 集成测试；没有遗漏文件、减少 205 行数据、删除断言、修改时限或加入自动重试。CI、Release、Windows validation 共用此入口。改善效果须以新流水线实测确认，失败时继续定位，不能把此假设记作已证实根因。

最终提交 `bd4d062` 的干净源码本地 `npm run test:ci` 完成 66 文件/378 项加完整 App 85 项，合计 463/463。Mac Release check 与 Windows frontend 本轮也各完成 463/463；固定页尾刷新分别 4,303/3,269ms、未读边界分别 10,625/5,339ms，均在原时限内。该结果支持进程隔离改善资源影响，仍不把一次通过扩大为已证明全部 runner 性能原因。Mac check 同时通过 Rust 433/4 忽略、IMAP 39、桌面脚本 37、格式/UI/i18n 与生产构建。

## 最终源码阶段验收（2026-10-28）

Windows validation 40650747611 已完整成功，native 的 Rust 432 passed / 2 ignored、IMAP 39 通过；安装器 SHA-256 `187263d11a4bc28b78af3fa55018b2656d4bfe5d2b8f9a60f8fe8c43743fe0bc`，App SHA-256 `9d2c316b7f92285094f18a604d4bf76c26aceca0183e4485046ce1fd8203fc73`。实际托盘恢复、窗口控件、无默认菜单、GUI 子系统、EML/外链、四许可、协议及默认关联保护通过。此验证包不是最终签名发布资源。

Release 40650749349 的 Mac 两架构构建成功；下载后的固定签名/DR、版本/标识、语言、架构、四许可和 DMG/更新归档逐文件一致性均通过。Windows 发布任务已通过原生测试，正在构建带更新签名的正式安装器。该阶段尚未公开，最终结果见下节。

## 正式发布资源审计

Release id `426172686`，发布时间 `2026-10-28T08:04:03Z`，源码 `bd4d062faaa46c20b5f15ad997af00bbfd981011`；九项公开资源逐项匿名下载后与已审计草稿的长度和 SHA-256 一致，标准 latest 清单和说明原文一致。三个 Tauri 更新签名验证通过；Mac 双架构固定身份/DR、版本/标识/语言/架构/四许可及 DMG 逐文件一致性通过。

| 资源                                  |     字节 | SHA-256                                                            |
| ------------------------------------- | -------: | ------------------------------------------------------------------ |
| `Anser_0.1.35_aarch64.dmg`            | 13485140 | `ca9e4e81d9c76de6b43a854bafc38eb4e39ea3116baef7e0eae951da00d2ea3c` |
| `Anser_0.1.35_aarch64.app.tar.gz`     | 12906065 | `e4e48c697e094717ffbae6fb7e2713938cf5a5f8e76f952d2233c2142812192a` |
| `Anser_0.1.35_aarch64.app.tar.gz.sig` |      424 | `a26eedafe8dd23d10875104a964c024aa6041003ad287336e4c9dd582fb21b3c` |
| `Anser_0.1.35_x86_64.dmg`             | 14183578 | `7a9ee121aa2fa366796e5072aa944652744db2f645824fb9990b36c2020601b4` |
| `Anser_0.1.35_x86_64.app.tar.gz`      | 13537599 | `6713e8239fb00623f4f36e17e47618c4c8abb8d656ce62f798d2573e7a6e4537` |
| `Anser_0.1.35_x86_64.app.tar.gz.sig`  |      424 | `c07c8a6db4d7b2a77db0c233b85c09a46ba7518069028f191201e91f54e11dbb` |
| `Anser_0.1.35_x86_64-setup.exe`       | 10172155 | `46d51eb38a29d743ae777c2634447a9931b16e85768f66856f521e7eed5eb8d4` |
| `Anser_0.1.35_x86_64-setup.exe.sig`   |      436 | `7f9e3a568b6ebfd148437227cf54bc3c114149a4e48a50a265a407b9cc1a110b` |
| `latest.json`                         |     4048 | `b2258dba250d2128fa50fcb73352db7aff0c534ab32d2fcae557eff6bd4b388d` |

## 官网、Homebrew 与收尾

[Pages 40654140088](https://github.com/ansermail/anser/actions/runs/40654140088) 成功部署 `bd4d062`。线上真实浏览器核对 Windows 默认 EXE、macOS 默认双 DMG、手动切换及语言切换；英文 Windows 下载区在 390px 无横向溢出。本地双语/双平台 390px 已检查；手机/未知系统不误标 Windows 或 Mac。公开安装器链接与三平台 `latest.json` 均指向固定 v0.1.35。

[Homebrew 40654170192](https://github.com/ansermail/anser/actions/runs/40654170192) 成功执行 style/audit/fetch；提交 `547e78afbb695d19481abc0b3b1f54805c60ec12` 仅更新 `Casks/anser.rb`，两个 DMG 哈希与上表一致。本轮未另外重复工作流验收幂等；已有六项分发保护测试通过。

GitHub 发布从固定 target 创建 `v0.1.35`，已 fetch 并确认解析至 `bd4d062faaa46c20b5f15ad997af00bbfd981011`。发布触发的同提交重复 tag Release、main Windows validation 和 signing-check 已主动取消，避免重复已通过的构建；正式发布依据为上方完整成功的 Release 与 Windows validation。[main Checks 40654140111](https://github.com/ansermail/anser/actions/runs/40654140111) 也已完整成功，463 项前端、Rust/IMAP、桌面脚本、格式/UI/i18n 与生产构建再次通过。

临时本地官网预览已停止，浏览器任务空间已完成；两份解包审计 App 已移入废纸篓，未替换本机已安装 App；Windows 用户会话和原有草稿/邮件保留。两处既有图片诊断 WIP 摘要仍为 `763e0c3ddc73dc727764b4e8efca565e0b93e8f2d51366790178780fc4b43011`，不进入提交。
