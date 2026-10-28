# Windows 首次正式发布工作点（2026-10-28）

## 目标和授权

继续 Windows App 局域网真实桌面验收；用户确认发送和打印已测试，无需代理重复发送。测试没有阻断问题后发布 0.1.35，并更新官网 Windows 安装器与按访问电脑系统默认选择的下载区。正式公开前仍执行最终源码构建和资源审计。

## 代码与环境

- 主目录 `/Volumes/Others/mail`，分支 `codex/windows-support`，origin `git@github.com:ansermail/anser.git`。从 `957d828` 快进接上原干净工作树的 `9c3aaae`。两处既有图片诊断 WIP 不进入本轮提交。
- Windows 用户已安装 `9c3aaae` 验证包并登录。代理使用 Windows App 的已授权会话，不保存或提交连接地址、用户名、密码和真实邮件截图。
- 顶栏、菜单、GUI 子系统和托盘修正已经存在；本轮新增官网 `src/site/download-platform.ts`、官网双语/元数据/样式与 10 项平台识别用例。保持现有 shadcn 体系；Mac 芯片不根据减化 UA 猜测。
- 托盘自动化诊断/修正见 `scripts/windows-smoke.ps1` 和 Windows validation 的可选 `installer_run_id` 隔离冒烟入口；隔离运行与完整构建并行组独立。

## 已有证据

- 真实 Windows 11：窗口融合无英文菜单、最大化/还原、最小化隐藏、原账号和邮件可读，空白写信关闭未增加空白卡片，虚构 `WINDOWS-QA-20261028` 富文本草稿保存后重开仍保留主题与正文，测试系统通知横幅实际显示。测试草稿未发送、保留供核对；原有草稿未操作。
- 用户确认：Windows 发送已测、打印已测且没问题。具体纸张/设备与分页参数未由代理记录，不扩大为代理逐页 PDF 审计。
- 虚构长 EML 在独立窗口正常显示收件人/抄送、正文末尾 `DOCUMENT-END-060` 与 `windows-qa.txt`。局域网 HTTP 下载被 Chrome 提醒，由用户自行保留并打开。
- [独立安装冒烟 40647081835](https://github.com/ansermail/anser/actions/runs/40647081835) 成功：安装器 SHA-256 `f96ce1f488113874507ba63fa6e6ddbc83254c1f9619a5fa50beafa3fed57e59`、App SHA-256 `791b4347cafaecc1c4eb30656ac0fc541a6e97024832134caea2aa06966f9436`。真实 MSAA 托盘点击恢复、GUI Subsystem=2、窗口按钮、无默认菜单、首屏、EML/原生外链、四许可、协议及默认关联保护通过。
- 失败过程：40645448876 证实任务栏只有 UIA Pane、没有图标子节点；改 MSAA 后 40645811619 在 PowerShell 把 `0xfffffffc` 解析成有符号 -4 转 uint 处失败，使用无符号 DWORD 的十进制值后通过。断言未移除、未添加自动重试。
- 本地：`npm test -- src/site/download-platform.test.ts` 10/10；`npm run build` 与 `npm run build:preview` 的 UI/i18n/TypeScript/产物隔离检查通过。

## 发布步骤与当前入口

1. 完成官网 390px 中英文/双平台切换与默认系统浏览器核对，提交最终源码（不含图片诊断 WIP）。
2. 运行 Release desktop 与 Windows validation；对失败读取原日志，修正原因或按既有同提交重跑规则处理。
3. 下载最终九资源，核对长度/SHA-256、三个更新签名、Mac 双架构固定身份/DR/许可/DMG 归档一致性及更新清单。
4. 检查 main 没有其他变更后快进合并；创建固定源码标签，公开 Release latest；部署官网及匿名下载/latest 清单审计。
5. 同步 Homebrew，记录 Actions/提交及限制，更新顶部检查点和 README。

## 未验证的边界

Windows 10 实机、全服务商兼容、IDLE 主动新到达、绑定邮件通知冷启动、跨版本原位升级未验证；Mac 本轮不替换已安装应用，Intel 实机/真实纸张和升级沿用未验证边界。Tauri 更新签名与 Authenticode、Apple Developer ID/公证相互独立。
