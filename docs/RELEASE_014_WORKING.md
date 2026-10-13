# 0.1.14 Alpha 发布工作点

## 当前检查点（2026-10-13）

用户已明确要求提交代码并触发远程更新发版，解除此前“本地确认前不发布”的限制。组织仓库`ansermail/anser`，main与origin/main在`7561a35`一致；保留全部已完成的本轮打印、账号侧栏、目录、草稿清空、系统通知定位及图片/调试修复，不改写已发布0.1.13。

- 已查询GitHub：公开latest为0.1.13，新版本0.1.14的Release及标签均不存在；查询成功，未把网络失败当版本缺失。
- 五处版本同步0.1.14，发布说明`docs/releases/v0.1.14.md`保留原文与末尾换行。
- 前阶段本地包已安装验证，详情分别见LOCAL_PRINT_014_WORKING、GMAIL_FOLDERS_WORKING、DRAFT_CLEAR_WORKING、NOTIFICATION_OPEN_WORKING、MAIL_IMAGES_DEBUG_WORKING；这些结果不替代本轮全量发布门槛。用户确认通知直达，Qoder误加载提示已原生复验。
- Apple Developer ID申请仍等待用户入会，未提供正式稳定Apple签名/公证；本地Apple Development签名不能当作云端升级钥匙串免授权验收。公开Release说明保留该限制。

## 执行计划与未完成项

1. 全量前端、Rust、桌面脚本、vendored IMAP、版本/格式/UI/生产及Pages构建检查，审阅暂存范围与隐私边界。
2. 提交并推送组织main，固定完整SHA，从该源码触发release.yml；核对每个job源码与双架构结果。
3. 独立核验草稿说明原文、固定源、精确七资源/大小/摘要、更新签名、公钥、App版本/架构/标识/许可/EML/OAuth编译配置、codesign、DMG与归档一致性。
4. 核验后正式发布，检查标签、公开更新端点及两架构资源；更新开发检查点、UPDATES及README。实际原位升级由用户继续下载测试，不计入本輪已通过。

本轮全量本机门槛通过：290项前端、321项Rust通过/1项独立性能项忽略、30项桌面脚本、39项vendored IMAP；format:check、cargo fmt、release:check、UI/生产构建、Pages构建/原生桥隔离及diff检查通过。最初JSON版本写入引起Tauri配置格式检查失败，Prettier修正后完整格式门槛通过，不记失败轮为通过。

暂存51份实际源码/文档/测试文件，经文件名与内容核对，无真实MIME、截图、数据库、私钥或本机OAuth值；更新公钥与既有发布公钥一致。源码提交、远程构建、草稿资源、正式发布及公开端点尚未完成，逐步补记实际证据。
