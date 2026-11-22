# 0.1.44 发布工作点

更新于 2026-11-22，时区 Asia/Shanghai。

## 发布候选

- 版本已在 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 和 `src-tauri/tauri.conf.json` 同步为 `0.1.44`。
- 候选范围包含富文本与 Markdown 表格编辑、官方邮箱服务商图标、0.1.43 走查修正、深色邮件品牌页脚、附件真实缩略图、定时发送未来时间约束、长收件人列表行内展开、WebView Backspace 防护和错误边界。
- 发布说明为 [v0.1.44](releases/v0.1.44.md)。正式安装器公开前，README、Homebrew 配方和官网继续保留 0.1.43。
- 本轮使用 `/Volumes/Others/mail` 的本地 `main`。已有五个功能提交保留在原位，其余发布候选修改在完成门禁后作为独立提交加入。

## 已完成的原生复核

- macOS arm64 本地签名包只读核对真实 Soniox 深色页脚、ArcZip 透明图片缩略图、2×3 表格菜单、定时发送浮层、Gmail 长路径三列布局和服务器同步表操作列。
- 定时发送实际输入过当天过去的时分，界面自动回到下一有效分钟；日期面板中过去日期不可点击，取消后没有创建计划。
- 含 24 个抄送的 MVNE 邮件显示前 3 项与 `+21`，可在字段行内展开和收起，未修改或发送邮件。
- 写信表格菜单已在 macOS WebView 核对插入前后全部操作入口、菜单收缩和底部可达性。

## 本地发布门槛

- `npm run release:check` 通过，五处版本一致且发布说明非空。
- 完整前端最终通过 77 个文件 601 项。首轮与 Rust 并行时，`App.test.tsx` 的一个固定分页刷新用例超过本地 5 秒期限；退出并行负载后该用例单独重跑 3.25 秒通过，整文件 91 项再次全部通过。
- 桌面脚本 37 项、Rust 473 项通过且 5 项既有条件忽略、vendored IMAP 39 项通过。
- 生产构建与 Pages 预览构建通过，UI 铁律、1,863 条双语键、TypeScript 和网站检查通过；保留既有动态导入及分包体积提示。
- Prettier、Rust 格式、发布资源检查和差异检查通过。
- 本地签名包构建成功，版本 `0.1.44`、标识 `dev.maildesk.desktop`、项目证书签名与严格 `codesign --verify` 通过。应用包约 32.56 MiB，更新归档 13,722,907 字节且签名文件非空；未做 Apple 公证。

## 云端发布与分发

- 待提交并推送 `main`，创建与候选源码一致的注释标签 `v0.1.44`，触发 Release desktop。
- 待核对 Release desktop 的检查、双架构 macOS、Windows x64 和草稿汇总；九份资源齐全后才公开为 latest。
- 待核验资源大小与 SHA-256、说明原文、三份更新签名、Mac 包元数据与固定签名、DMG/更新归档一致性、Windows 安装启动冒烟及匿名下载。
- 正式 Release 公开后等待 Homebrew 自动更新，核对配方版本与双 DMG 摘要，再触发 Preview Pages 并检查首页版本与三个安装器链接。

## 验证边界

- Windows 与 Intel Mac 实际桌面使用、原位升级及更多真实邮件模板仍需单独验收。
- macOS 正式包继续使用项目自签名，不代表 Apple Developer ID、公证或 Gatekeeper 系统信任。
- 原生复核只读使用真实邮件，未发送、删除或修改邮件。正式安装后的用户验证由用户完成。
