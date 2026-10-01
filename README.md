# 雁信 Yanxin

面向 Apple Silicon Mac 的多账号邮件客户端。React + shadcn/ui + Tauri 2 + Rust。

“雁信”取意鸿雁传书。窗口标题、菜单栏提示、界面及应用包统一使用“雁信”，开发项目名称为 `yanxin`。

macOS 开发预览通过临时的“雁信.app”启动，Dock 名称使用中文；`Info.plist` 明确设置中文显示名。临时应用包位于 Cargo 输出目录，无需安装，继续支持热更新。

**当前版本：0.1.0 Alpha。** 已有可运行的桌面应用与协议实现，腾讯企业邮已实际收取并保存邮件；尚未完成 PRD 全部 P0 验收，以及各服务商真实账号的完整收发联调。

## 界面

按用户指定的 [shadcn dashboard-01](https://ui.shadcn.com/view/new-york-v4/dashboard-01) 调整：中性色、可收起侧栏、内嵌圆角内容区、卡片和紧凑导航。使用官方 Sidebar 和 Card 组件，邮件采用三栏布局，操作按钮位于发件人信息右侧，邮件信息固定、正文独立滚动。应用图标暂定米白底绿色信封 v3。

![桌面界面](docs/dashboard-mail.png)

上图为早期演示界面，当前布局及功能以运行版本和实施状态为准。

## 运行

需要 Node.js 22、Rust stable、Xcode Command Line Tools；本轮在 arm64 macOS 上验证。

```sh
npm ci
npm run desktop
```

`npm run desktop` 会启动 Vite 并直接打开 macOS 开发版，支持真实邮箱与本地存档，无需打包或安装。保持命令运行，前端修改自动刷新，Rust 修改自动重新编译并启动；按 Ctrl+C 停止。日常界面调整和联调使用此命令，交付应用时再运行 `npm run desktop:build`。

只预览界面：`npm run dev`，访问 `http://127.0.0.1:1420`。浏览器不支持真实邮件收发，点击“先体验一下”加载演示账号和示例邮件。

```sh
npm test
npm run test:rust
npm run desktop:build
```

桌面产物：`src-tauri/target/release/bundle/macos/雁信.app`。当前为本地开发构建，未配置 Developer ID 分发签名、公证或自动更新。

## 已接入

- Gmail、Outlook、Microsoft 365、QQ、网易、腾讯/网易企业邮和自定义服务器入口。
- IMAP / POP3 收件、SMTP 发件、TLS / STARTTLS、密码/授权码、OAuth PKCE 代码路径。IMAP 支持 UIDVALIDITY 的 STATUS 兜底；完全缺失时逐封下载并按完整内容去重（每轮重下载）。
- 多账号收件箱、按标题/发件人/收件人/正文搜索、未读/星标/附件组合筛选、阅读、附件保存与 EML 导出。
- 纯文本及富文本写信、附件与 CC/BCC、草稿自动保存、回复/全部回复/转发。回复尊重 Reply-To，全部回复去重并排除已配置的本人地址；尚未写入邮件会话引用头，转发附件仍需手动添加。
- 本地通讯录、从邮件创建联系人、收件人地址自动补全；常用地址同时来自已保存邮件。
- 编辑账号名称、收发服务器及认证配置；收、发连接验证成功后保存，邮箱身份保持不变，已有邮件与本地操作状态保留。
- 兼容声明 GBK/GB18030 等字符集的旧式原始邮件头；保留 HTML 邮件的排版样式，列表摘要不包含样式代码。已有存档在启动时从本地原件更新显示信息。
- 可配置规则：账号范围、多条件 AND / OR、优先级、命中后停止、预览、对历史邮件执行；归类、已读、星标和废纸篓动作只作用于本地。
- 完整原始 MIME 邮件独立留存；存档以 SHA-256 命名，读取时校验，先持久化再归类。服务端清理或移除账号不会删除已完整下载的原始邮件。
- SQLite 索引、存档备份/恢复、macOS 钥匙串保存凭据、菜单栏入口；后台检查可设为 1/5/10/15/30/60 分钟。检测到定时循环长时间暂停后补收，真实睡眠唤醒仍待验收。
- 批量校验本地原始 MIME 的哈希与附件解码，列出缺失或损坏的存档；不会修改或删除原件。
- 发送记录显示 SMTP 确认、服务器拒绝和结果未确认；支持手动准备重发草稿及恢复已发送邮件的本地副本。
- HTML 邮件直接显示外部图片；网页链接在系统浏览器打开，mailto 链接进入本应用写信窗口；清洗脚本和表单。阅读区采用紧凑地址、标题布局，回复与转发位于顶部，列表及阅读时间显示完整年月日与时分秒。

## 连接真实邮箱前

QQ、网易等通常需在邮箱官网启用 IMAP/POP3/SMTP 并获取授权码。企业服务器配置及权限取决于管理员；这些预设尚未逐服务商联调。

Gmail / Microsoft 的 OAuth 需要注册属于本产品的应用。可以在账号高级设置填写 Client ID，或构建前设置 `MAIL_GOOGLE_CLIENT_ID`、`MAIL_MICROSOFT_CLIENT_ID`；Google 桌面应用如需 client secret，可设置 `MAIL_GOOGLE_CLIENT_SECRET`。不要提交实际凭据。原生应用中的 client secret 不是可保密的服务端秘密。

代码使用系统浏览器、PKCE 和本机临时端口回调；Google 应配置桌面客户端，Microsoft 应配置公共原生客户端与 localhost 重定向及邮件委托权限。OAuth 应用发布审核、租户策略和真实授权仍需验证。参考 [Google 原生应用 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Microsoft 邮件协议 OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)。

## 数据与行为

- 默认数据目录由 Tauri `app_data_dir` 决定，macOS 通常为 `~/Library/Application Support/dev.maildesk.desktop/`；应用设置页显示实际位置。
- `archive/*.eml` 保存原始 MIME，SQLite 保存索引和本地操作状态；文件本身尚未做应用层加密。
- 关闭窗口保留后台运行；点击菜单栏图标直接显示并聚焦主窗口，不弹出二级菜单。关闭窗口后点击 Dock 图标也会重新显示，最小化的窗口会恢复。退出使用应用菜单或 ⌘Q。退出 App、Mac 睡眠或断网时不能继续下载。**必须在服务端删除前完成下载**，才能保留本地副本。
- 备份包含邮件、存档元数据、规则和本地联系人，不包含凭据、账号、草稿或待发队列。恢复时合并缺失的规则和联系人，保留已有同 ID 的规则及同邮箱的联系人；不恢复服务端文件夹关系。兼容没有联系人表的旧备份。
- 发送前在界面等待 8 秒，可取消；进入 SMTP 阶段后不能撤回。失败不自动重发。应用中断时未完成的发送记录转为“结果未确认”；准备重发必须先确认重复发送风险，只创建草稿，仍需手动点击发送。
- 当前没有云端处理、遥测或自动上传。用户已允许后续设计云端能力。

## 下一阶段

详见 [实施状态](docs/IMPLEMENTATION.md) 和 [PRD](PRD.md)。主要待完成：真实邮箱联调、服务器文件夹树及双向状态同步与离线操作队列、全文索引与大邮箱性能、会话聚合及回复引用头、附件预览/拖拽、通知、窗口与栏宽记忆、签名公证与更新。P1 的签名、模板和定时发送尚未实现。

本机 macOS 工具链存在符号裁剪导致 Mach-O 错误的问题，release 配置关闭 strip；见 [Rust upstream issue](https://github.com/rust-lang/rust/issues/157750)。`imap-proto 0.10.2` 有未来 Rust 兼容性警告，后续应更换或升级协议库。
