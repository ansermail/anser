# 0.1.14 Alpha 发布工作点

## 当前检查点（2026-10-13）

0.1.14 Alpha已于2026-10-13 20:14:21（Asia/Shanghai）正式发布为latest：[下载页](https://github.com/ansermail/anser/releases/tag/v0.1.14)。固定源码`f1921c2cb9704b6641bb255be86c579b8b4ed542`，Release ID411618618，组织[Release macOS 38391912165](https://github.com/ansermail/anser/actions/runs/38391912165)的check、Apple Silicon、Intel及draft全部成功。公开标准更新清单及两架构安装/更新资源已经核验；实际正式安装与原位升级留给用户继续下载测试，Developer ID/公证未完成。

用户已明确要求提交代码并触发远程更新发版，解除此前“本地确认前不发布”的限制。开工基线为main/origin/main一致的`7561a35`。本轮保留打印、账号侧栏、目录、草稿清空、系统通知定位及图片/调试修复，不改写已发布0.1.13。下方为发布前历史步骤与实际执行证据。

- 已查询GitHub：公开latest为0.1.13，新版本0.1.14的Release及标签均不存在；查询成功，未把网络失败当版本缺失。
- 五处版本同步0.1.14，发布说明`docs/releases/v0.1.14.md`保留原文与末尾换行。
- 前阶段本地包已安装验证，详情分别见LOCAL_PRINT_014_WORKING、GMAIL_FOLDERS_WORKING、DRAFT_CLEAR_WORKING、NOTIFICATION_OPEN_WORKING、MAIL_IMAGES_DEBUG_WORKING；这些结果不替代本轮全量发布门槛。用户确认通知直达，Qoder误加载提示已原生复验。
- Apple Developer ID申请仍等待用户入会，未提供正式稳定Apple签名/公证；本地Apple Development签名不能当作云端升级钥匙串免授权验收。公开Release说明保留该限制。

## 执行计划与未完成项

1. 全量前端、Rust、桌面脚本、vendored IMAP、版本/格式/UI/生产及Pages构建检查，审阅暂存范围与隐私边界。
2. 提交并推送组织main，固定完整SHA，从该源码触发release.yml；核对每个job源码与双架构结果。
3. 独立核验草稿说明原文、固定源、精确七资源/大小/摘要、更新签名、公钥、App版本/架构/标识/许可/EML/OAuth编译配置、codesign、DMG与归档一致性。
4. 核验后正式发布，检查标签、公开更新端点及两架构资源；更新开发检查点、UPDATES及README。实际原位升级由用户继续下载测试，不计入本轮已通过。

本轮全量本机门槛通过：290项前端、321项Rust通过/1项独立性能项忽略、30项桌面脚本、39项vendored IMAP；format:check、cargo fmt、release:check、UI/生产构建、Pages构建/原生桥隔离及diff检查通过。最初JSON版本写入引起Tauri配置格式检查失败，Prettier修正后完整格式门槛通过，不记失败轮为通过。

暂存51份实际源码/文档/测试文件，经文件名与内容核对，无真实MIME、截图、数据库、私钥或本机OAuth值；更新公钥与既有发布公钥一致。此为提交前检查记录，后续实际进度见下方。

## 固定源码与云端运行

- 已提交并推送组织main：`f1921c2cb9704b6641bb255be86c579b8b4ed542`，GitHub main完整SHA核对相同。提交前工作树/暂存核对完成，提交后工作树干净。
- `gh workflow run release.yml --repo ansermail/anser --ref main`已触发[Release macOS 38391912165](https://github.com/ansermail/anser/actions/runs/38391912165)。接续检查运行headSha、check/两架构/draft，不能以触发成功代替构建完成。
- 资源审计目录准备于仓库外`/tmp/anser-release014-audit-f1921c2`，尚未下载或核验新资源；仍未正式发布，公开latest保持0.1.13。

## 云端与正式发布结果

- 本次Release流水线源码/event已核对为固定SHA/workflow_dispatch；云端49文件/290项前端、321Rust通过/1项忽略、30脚本、39IMAP全部通过，格式/UI/生产及双架构构建成功。Checks 38391910188、Preview Pages 38391910050均成功，Pages不作为桌面发布证据。
- GitHub按标签查询草稿曾返回404，未据此判断版本缺失或重新构建；通过认证的Release列表精确定位唯一草稿ID411618618，再按ID复核。状态查询两次TLS超时均作为查询失败处理，没有重复触发流水线。
- 七资源名字/大小/SHA-256与GitHub元数据一致，清单版本/两平台链接/签名、发布说明原文及末尾LF与固定源码一致。两更新包用既有公钥验签通过；两App版本/架构/稳定标识/完整codesign/许可/EML及原生OAuth配置核对通过，配置值未输出且不在前端资源中。Intel优化常量按对应函数重建完整字节核对。
- 两份DMG完整校验通过，只读挂载后各8个App文件逐个散列匹配对应更新归档，已卸载；没有安装或启动云端包。草稿身份、目标源、说明与七资源ID/摘要在发布前重新读取核对不变。
- 发布前匿名canonical latest为0.1.13。PATCH draft=false/make_latest=true于20:14:21发布，返回公开0.1.14；发布前后七资源和说明未改，GitHub latest为同一Release ID，轻量/附注标签保护入口确认tag指向固定源码。
- 匿名`releases/latest/download/latest.json`逐字节匹配本次审计清单；Apple Silicon和Intel两份DMG、两份更新归档及两份签名分别公开重新下载，大小/摘要与审计资源一致。审计与日志全部在`/tmp/anser-release014-audit-f1921c2`，没有提交资源、配置或原件。
- 发布目标已完成。接续用户下载/应用内原位升级及长期实际使用；正式稳定Apple签名/公证仍从DEVELOPER_ID_WORKING继续，不能把更新签名/codesign或本地开发签名当作该验收通过。

## 发布记录提交后的Checks #41失败（2026-10-13）

- 用户报告`docs: record verified 0.1.14 release #41`失败。已定位[Checks 38396331257](https://github.com/ansermail/anser/actions/runs/38396331257)，源码为`c8752fe`，失败步骤npm test；289项通过、1项通知迟到结果回归失败，邮件标题为undefined。0.1.14 Release 38391912165及之前Checks #40的成功结果保留，失败记录不冒充通过。
- 已可控复现：在通知元信息待返回期间，等待启动时200ms空搜索防抖执行；旧逻辑即使搜索未变化也创建新Query对象，通知保护将其误认为用户导航，丢弃最新点击。该问题属于真实时序，不通过重试CI或延长断言掩盖。
- App仅在搜索值实际变化时更新Query，防抖回调也保留同值Query身份；搜索/手动导航真正变化时的过期通知保护继续保留。原测试增加明确跨越初始防抖的控制步骤，修复前稳定得到与云端一致的失败。
- 修复后通知4项及前端全量49文件/290项通过，format:check、check:ui、TypeScript/生产构建、Pages构建/原生桥隔离和diff检查通过。ego-browser空间28仅用虚构演示账号核对实际搜索：Notion筛选为1条，清空恢复8条，已关闭检查空间；不把演示检查作为原生通知验收。即将提交main触发新的Checks验证。
- 已发布0.1.14标签/资源不改写；本轮修复先进入main，尚未构建或发布含此修复的新桌面版本。
