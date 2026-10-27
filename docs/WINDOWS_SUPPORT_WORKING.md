# Windows 客户端工作点（2026-10-27）

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

- [ ] 凭据与文件落盘的平台适配及回归。
- [x] 主窗口/外部邮件、Windows 快捷键及双语文案实现与前端回归。
- [ ] WebView2 邮件资源/CSP/链接与打印检查。
- [ ] Windows 通知与冷启动定位路径。
- [ ] NSIS 安装器、Windows CI/冒烟与下载验证构建。
- [x] 跨平台发布资源和更新清单实现与脚本测试，保留 macOS/Homebrew（正式包待发布验收）。
- [ ] 本地与云端结果、限制及继续入口更新。

## 当前入口

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
