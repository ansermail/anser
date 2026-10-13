# 本地打印修复工作点（2026-10-13）

## 目标与边界

用户在已发布 0.1.13 的 macOS 包中点击邮件打印，收到 `Command plugin:webview|print not allowed by ACL`；账号列表上下过密；询问“其他文件夹”父项聚合是否意味着根目录协议警告已修复。用户明确要求先本地构建桌面端验证，待其确认后才触发远程流水线。本阶段不推送、打标签或发布。

## 已定位与已改

- `src-tauri/capabilities/main.json` 的主窗口权限缺少 `core:webview:allow-print`，而本地生成的 Tauri schema 已声明此权限。补齐后增加桌面脚本回归，防止后续遗漏。
- 账号组容器增加 8px 纵向间距；用户复核截图后，账号行背景内部也增加上下各 6px 留白，避免选中底色贴近两行文字。异常账号的提示对“空目录但返回 UID”增加说明。
- 父目录邮件聚合只读取可信子目录来源。服务端根目录 `EXAMINE/EXISTS=0` 但 `UID SEARCH` 返回 UID 的矛盾仍存在，根目录继续隔离；不能因界面可汇总子目录而恢复其来源。此轮未对真实邮箱执行写操作或解除隔离。
- `docs/USAGE.md`、`docs/IMPLEMENTATION.md` 已同步行为与原生打印权限要求。

## 本地验证与下一步

- `npm run check:ui`、相关前端 64 项、桌面脚本 29 项、`npm run build`、`npm run format:check`、`git diff --check` 已通过。首次 `format:check` 提示 2 个新改文件需格式化，运行 Prettier 后复核通过。
- `npm run desktop:build` 本机成功，生成 `src-tauri/target/release/bundle/macos/雁信.app`（27.78 MiB）及更新归档；App bundle 的 `codesign --verify --deep --strict` 通过，标识仍为 `dev.maildesk.desktop`。这只是本地开发签名构建，未发布或公证。
- 关闭旧 `/Applications/雁信.app` 进程后，原生启动上述新构建，进程路径核对为仓库内 bundle。打开已有已发送联调邮件，点击阅读页打印图标，macOS 原生 `PDPrintPanel` 正常出现且显示 `Page 1 of 1`；点击 `Cancel` 后回到邮件，无 ACL 错误，也未实际打印。邮件属于既有已发送测试样本，本轮没有发信、移动、批量已读或解除目录隔离。原生侧栏可见账号之间有新增纵向间距。
- 本地包交用户测试。用户确认前不触发远程流水线；提交与正式发版状态分别记录。

## 用户复核后的背景留白（2026-10-13）

用户指出先前只拉开了账号之间的距离，选中底色仍贴近名称与地址。`src/index.css` 的 `.account-navigation` 增加上下各 6px 内边距，保留账号组间原有 8px 间距。重新执行 `npm run check:ui`、`npm run format:check`、`git diff --check` 和 `npm run desktop:build` 均通过，bundle `codesign --verify --deep --strict` 通过。旧进程退出后重新启动仓库内新 bundle，原生窗口选中腾讯企业邮箱时可见背景四周留白，名称和地址不再贴边；进程路径核对为本地构建。未重复执行邮件打印专项，上一轮原生打印面板验证仍适用于未改动的打印逻辑与权限。仍等待用户确认后才可触发远程。

## 用户再次复核：圆角、加载宽度和钥匙串（2026-10-13，已完成本地签名修复）

- 选中账号背景使用了未定义的 `--radius`，故实际直角；改用现有 `--radius-md` 并裁切内部按钮的 hover 底色，待原生视觉复核。
- 目录加载后侧栏出现纵向滚动，滚动条会改变内容可用宽度；侧栏内容加入 `scrollbar-gutter: stable`，待原生加载前后复核。
- 本地 `desktop:build` 与正式 CI 当前配置 `signingIdentity: "-"`，生成的两个版本 designated requirement 均只包含各自 `cdhash`，每次更新会变。开发启动器已有稳定 Apple Development 签名，但本地打包入口没沿用；已让本地构建选用该固定证书，待重新构建并核对 DR。用户确认目前没有 Developer ID Application 证书，因此正式发布的重复钥匙串授权仍需独立解决，不能把本地签名修复当作正式发布修复。本轮不更改钥匙串 ACL、不导出真实凭据、不触发远程流水线。

## 整行悬停、Gmail 展平和分组提示（2026-10-13，等待用户本地验收）

- 账号外层统一承载 hover/focus/active 背景，内部 Button 悬停底色透明；保留圆角、6px 上下留白和组间 8px。此前仅用 scrollbar-gutter 的原生截图仍出现约 5px 可用宽度差异，增加固定纵向滚动条空间，待本次原生复核。
- Gmail 非邮箱分组在显示树中展平，原始 `[Gmail]/子目录` 路径、未读计数键、右键已读范围不变。用户标签自己的子树保留。
- 腾讯/QQ 的“其他文件夹”与“我的文件夹”、Gmail 的分组根目录按服务商主机及精确名称识别为不可选容器；新发现与旧缓存均应用，正常收取只访问真实子目录。旧隔离来源、完整存档和诊断记录保留；侧栏仅过滤对应容器的历史选择错误，混合摘要中其他目录的错误仍显示。
- 前一轮本地包已使用固定 Apple Development 证书，codesign 校验通过，DR 与开发预览相同；正式流水线仍未接入 Developer ID，正式更新无重复授权尚未验收。证书申请见独立工作点，不在本轮触发发布。
- 相关前端9项、Rust目录/协议50项、桌面脚本30项通过；UI/生产构建/格式检查通过。新协议测试首次编译因测试误把 ingest 的 bool 当作邮件 ID 失败，修正后通过，覆盖腾讯/QQ/Gmail 三类容器，验证根目录无 EXAMINE、子目录继续扫描、旧来源隔离及存档不变。本地原生重建继续执行。

### 本轮完成结果与剩余边界

- 最新 `npm run desktop:build` 已完成，生成 `/Volumes/Others/mail/src-tauri/target/release/bundle/macos/雁信.app`（27.78 MiB）及本地更新归档。`codesign --verify --deep --strict` 通过，两次内容不同的本地构建 DR 完全一致，标识仍为 `dev.maildesk.desktop`。当前运行进程路径核对为该本地 bundle。
- 原生窗口与可访问树已确认：Gmail 收件箱、星标、重要邮件、已发送、草稿、所有邮件、垃圾邮件、已删除在同一级展示，没有 `[Gmail]` 分组；腾讯/QQ 账号不再展示已知分组选择告警，QQ“其他文件夹”保留聚合未读数。真实服务器连接的其他错误保留提示。本轮没有主动发信、移动、删除、批量已读或解除隔离。
- 原生自动点击连续收到工具提示 `The user changed ...雁信.app. Re-query ...`；重新获取状态、绑定和重置运行时后仍受阻，停止该自动交互，未把尝试记作成功。明暗悬停及目录加载宽度改在 ego-browser 空间27、共享 App 的虚构演示数据中验收：名称区和箭头区 hover 均使整行显示相同背景，子按钮背景透明，圆角8px；固定1512×949视口，展开前后账号行宽均为266.2890625px、右边缘均为282.2890625px，侧栏内容由657px增至760px仍无缩窄。截图 `/tmp/anser-sidebar-hover-demo.png` 与 `/tmp/anser-sidebar-hover-dark-demo.png` 为虚构预览，仅用于本轮核查，未入Git。
- 首次浏览器宽度测量有约1px差异，复核发现浏览器截图/动作改变了视口且预览工具注入额外节点；在相同固定视口并等待布局完成后测量一致，没有据此修改应用布局。浏览器深色检查后已恢复浅色主题。
- 最后格式检查及 diff 检查通过。代码仍在 main 未提交工作区，保留独立 Developer ID 申请文件；本轮没有推送、标签或远程流水线。下一步由用户测试本地包，明确确认后再准备新版本及全量发布门槛。正式包稳定签名/公证和真实原位升级仍独立待验收。
- 为覆盖共享目录读取对快照、映射、留存及规则入口的影响，追加完整 `cargo test --manifest-path src-tauri/Cargo.toml`：311项通过、1项独立性能测试按现有配置忽略，0失败；不把忽略项记作通过。
