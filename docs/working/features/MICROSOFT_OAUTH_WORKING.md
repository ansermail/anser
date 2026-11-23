# Microsoft OAuth 应用注册工作点

更新：2026-10-10。工作分支 main；保留其他任务的版本、收件可靠性、发件副本及 UI 未提交改动，本任务按用户随后明确要求重编译并重启开发应用，未发布新版。

## 已完成

- 用户在 Chrome 经 GitHub 登录后进入可管理的全球 Azure Default Directory；已通过 UI 确认 Entra ID 免费版、全局管理员和空应用列表。旧无目录/银行卡前置阻塞已解除，不能把旧 ego-browser 页面继续当作当前入口。
- 用户确认注册即接受 Microsoft 平台策略后，创建 `Anser（雁信）`；UI 成功通知和应用概览确认创建。账号类型为组织及个人 Microsoft 账户，公共移动/桌面平台，唯一回调 `http://localhost/callback`，无客户端机密。
- Authentication 页面已核对桌面回调。当前授权码+PKCE 可按 native 回调判断公共客户端，不需开启其他无回调场景的 fallback 公共客户端开关，保持禁用。依据：[应用清单 fallback 属性](https://learn.microsoft.com/en-us/entra/identity-platform/reference-microsoft-graph-app-manifest)、[公共与机密客户端](https://learn.microsoft.com/en-us/entra/identity-platform/msal-client-applications)。先前聊天中将此开关概括为必须开启过于宽泛，本工作点替代。
- 当前目录“我的组织使用的 API”搜索 Office 365 Exchange Online 返回空结果；在 Microsoft Graph 委托权限入口找到并保存 `IMAP.AccessAsUser.All`、`POP.AccessAsUser.All`、`SMTP.Send`、`offline_access`。保存后 UI 明确显示五项（含注册默认 User.Read），均为委托权限。未授予全租户管理员同意。Graph 注册入口提供的名称见 [官方权限参考](https://learn.microsoft.com/en-us/graph/permissions-reference)；实际协议 scope 仍使用完整 Outlook 资源 URL，未修改 Rust endpoints，不能改用 Graph audience 令牌连接协议服务器。
- Client ID 保存于被 Git 忽略的 `.env.local`，权限 0600；现有 backend loader 读取值与注册匹配。通过 stdin 更新组织仓库 `ansermail/anser` Secret `MAIL_MICROSOFT_CLIENT_ID`；Secret 名称/更新时间已确认，不输出配置/令牌，不更改既有 Google 或更新签名 Secret。
- `.github/workflows/release.yml` 增加 Microsoft 配置存在性检查及双架构原生 tauri-action env；Pages/PR 不注入。AGENTS/USAGE/UPDATES/DEVELOPMENT_STATUS 同步边界。流水线和文档在用户要求下本轮创建本地 Git 提交，尚未推送或云端构建；已发布资源不变。

## 本轮实际验证

- Chrome UI：创建成功、组织及个人账号、公共客户端回调、API 权限保存清单确认。
- 忽略/权限/loader：`git check-ignore .env.local`、0600 文件模式及 loader 值匹配检查通过；实际 Client ID 不写入 Git 或工作点。
- `npm run test:desktop`：19 项通过；`npm run format:check`、`npm run release:check`、`git diff --check` 通过。没有业务/Rust 代码改动，不将其他任务的测试或收发结果计为微软验收。
- 用户随后要求编译，已通过 `npm run desktop` 稳定启动器重编译 0.1.9 开发版并启动；Microsoft 默认配置在新签名二进制中匹配，本机深度签名验证和 Cargo/开发 bundle UUID 一致性检查通过。新 app PID 74059 的父进程为 Tauri 73814，仅为本次临时证据。未构建/发布双架构正式包；用户随后完成微软浏览器授权与 IMAP 连接验证，但 SMTP 返回 535 5.7.3；真实收件正文/发送和刷新未验收。

## 剩余入口

1. 用户已明确当前仅用 QQ 地址注册 Microsoft 账号，没有 Outlook/Hotmail/Live 邮箱别名。授权及 IMAP 连接验证成功、SMTP 认证失败；测试表单选择了 Microsoft 365，使用企业 SMTP 主机。先给现有账号添加 Outlook.com 地址，再用 Outlook 个人预设和实际微软邮箱地址重测，不能将 Microsoft OAuth 当作 QQ 邮箱授权。
2. 新运行已带默认 Microsoft 配置；用户提供实际邮箱后复用当前开发应用，先核对运行状态与其他真实验收。按浏览器规则在实际扩大邮箱访问权限时取得当次确认，再让用户完成登录。授权、IMAP/SMTP 连接、刷新分别验收；发信仍只在 AGENTS 授权范围内。
3. 若企业租户需管理员批准，针对实际租户走必要流程；不通过创建客户端密钥、盲目全租户授权或开启密码流代替。应用概览提示新多租户应用的未验证发布者限制；正式发布者验证需真实组织/Partner ID 材料，尚未完成。
4. 将本任务修改单独提交/推送时不能混入其他阶段的未验收 WIP；后续新版本双架构构建才会纳入 Microsoft 默认配置。当前注册及声明完成不等于实际授权/刷新/收发或公开发布均完成。

原生界面启动后的用户测试已确认授权和 IMAP 连接验证通过，SMTP 535 仍需正确邮箱身份与个人预设重测。浏览器登录与同意由用户完成，旧 ego-browser TaskSpace 9 为历史前置开通流程。

## SMTP 535 登录测试诊断（2026-10-10）

- 用户截图证明账号连接流程进入 SMTP 阶段，报“收件成功，但 SMTP 连接失败：535 5.7.3 Authentication unsuccessful”。结合代码，前半句仅表示 IMAP 登录/退出验证通过，不证明真实新邮件收取或 SMTP 发送通过。
- 原生表单确认使用 Microsoft 365 / smtp.office365.com，地址是个人 Microsoft 账号的外部邮箱登录名；用户确认尚无 Outlook/Hotmail/Live 别名。已确认账号类型与服务商配置不匹配；535 本身不能唯一定位用户名、权限或服务端策略，不能将尚未重试的方案记作已修复。个人 Outlook 官方 SMTP 为 smtp-mail.outlook.com:587 / STARTTLS / OAuth2。
- 已打开服务商选择；用户随后关闭表单，未完成 Outlook 新表单保存或再次连接，没有修改已有账号。打开微软官方 account.live.com/names/manage 供用户添加 Outlook 地址；此项会增加登录别名，地址选择、身份验证及创建由用户完成，不删除原别名或改主别名。
- 下一步以新实际 Outlook 地址和个人预设验证连接；不发送任何未授权邮件，不关闭租户安全默认值、不新增 SMTP 客户端密钥。正式发布者验证及企业租户策略仍独立保留。

## 阶段提交边界（2026-10-10）

用户要求提交本轮修改；仅提交 Microsoft 发布接线与相应文档/记录，0.1.9 可靠性及版本改动保持在工作区。只创建本地提交，不推送或发版；实际客户端配置、截图、邮箱地址/数据和令牌不入 Git。正式包含微软配置需后续独立流水线验收。

## 2026-10-10 0.1.9 发布配置装包

注册/Secret/流水线接线已由后续 220f4cc 的双架构 Release 38051136526 构建纳入，并于20:22:33正式发布0.1.9。Apple Silicon 与 Intel 原生二进制默认配置核对通过，前端资源不含该配置；更新签名/完整 app 签名等结果见 RELEASE_019_WORKING.md。此项只完成默认配置装包；实际 Outlook 邮箱 SMTP、令牌刷新、管理员批准与发布者验证仍按前文接续，不扩大发信授权。
