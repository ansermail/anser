# 0.1.8 云端构建工作点

2026-10-10，main。本轮阶段：SYNC-02B2 在途只读 FETCH 中断、新 Google OAuth 构建配置、个人使用许可及 App 资源。0.1.7 来源 1de47d7 的已发布标签/资源不改写。

## 已完成

- 同账号 INBOX 只读下载 socket 中断、注册竞态/展开清理、残缺响应不发布、旧来源/原件保留、失步连接退出及新轮次优先。SMTP/COPY/MOVE 与其他账号/目录不受影响。
- 五处版本同步到 0.1.8，新版本说明 v0.1.8.md 完成；Google 仓库 Secrets 与原生双架构构建接线已有 fe22226，原更新密钥与存储 ID 保持。
- 发布门槛：207 前端、275 Rust、19 桌面脚本、39 vendor IMAP 通过；UI、TypeScript、生产/Pages 构建、格式、cargo fmt、release:check 及 diff 检查通过。日志 /tmp/anser018-{frontend,rust,scripts,vendor,build,preview,format}.log 仅作本轮辅助，继续以记录与云端状态核对。
- 原生开发预览显示 0.1.8，两授权邮箱 IDLE 连接后收件箱补查成功，5478 存档保留，新“本轮结束”日志可见；已恢复收件箱界面。没有新发信、修改范围、移动或删除邮件。QQ/企业邮旧异常容器仍被隔离，不把这个全目录错误当作收件箱失败。该启动补查不算新实时到达/在途大附件真实验收。

## 发布步骤

- [ ] 提交主分支并记录固定源 SHA。
- [ ] 从组织仓库远程触发 Release macOS（workflow_dispatch），记录同一运行。
- [ ] 等待 check / 两架构构建 / draft 成功。
- [ ] 下载七项资源，核对元数据 SHA256/大小、manifest/两签名、App 版本/架构/完整 codesign、许可资源和 Google 编译配置。
- [ ] 核对 DMG 与归档、发布草稿，检查匿名公开 latest.json 和两个更新 URL。

## 仍未验证及接续

真实大附件繁忙到达、网络/睡眠恢复和其他服务商矩阵；新 Google Client 真实授权/长期刷新；正式安装/原位升级/默认 EML/多 Mac，以及 Developer ID/公证仍未完成。Microsoft Client 注册有独立本机待办，本轮不声明接入。云端包完成后继续 SYNC_02B2_WORKING.md 的真实矩阵，再推进搜索/后端分页。
