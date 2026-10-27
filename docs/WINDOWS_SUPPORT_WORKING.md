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
- [ ] 主窗口/外部邮件、Windows 快捷键及双语文案。
- [ ] WebView2 邮件资源/CSP/链接与打印检查。
- [ ] Windows 通知与冷启动定位路径。
- [ ] NSIS 安装器、Windows CI/冒烟与下载验证构建。
- [ ] 跨平台发布资源和更新清单，保留 macOS/Homebrew。
- [ ] 本地与云端结果、限制及继续入口更新。

## 当前入口

按上述清单实现，先修凭据/存档和窗口/资源，再接 Windows CI。不能把 macOS 的测试结果或 Windows 编译成功记为 Windows 实机验收。
