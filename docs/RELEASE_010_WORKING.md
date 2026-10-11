# 0.1.10 发布工作点

2026-10-11，开发分支codex/search-scale，从main/7e4b122接续。SEARCH-01 b65e3ab、PAGING-01 0f2c8a9/f11bbfa之后完成前端页/邻居、日期/正文覆盖和统计索引优化。固定源码/Actions待写回；正式最新仍为0.1.9，不能把源码完成计为新包已发布。

## 发布范围

FTS候选与短词/NUL精确回退、派生schema3与覆盖统计索引、逐封/对话SQL固定页及版本/范围游标、同WAL快照、无变化刷新保留尾页、锚点阅读、shadcn日历/正文覆盖提示；Pages继续纯虚构内存协议与禁用原生桥。包版本五文件同步0.1.10，无凭据/真实截图/MIME进入Git。

## 本机验证

最终本机门槛：npm test 222项/39文件；cargo test --manifest-path src-tauri/Cargo.toml 297通过/1手动门槛ignore；npm run test:desktop 19；vendored IMAP39；npm run build（含check:ui）/build:preview（静态桥隔离）/format:check/cargo fmt --check/release:check/diff检查通过。手动Release性能门槛已独立执行1项通过，不把ignore当已执行。

Release性能调用：`cargo test --release --manifest-path src-tauri/Cargo.toml actual_store_50000_pages_and_search_measurement -- --ignored --nocapture`。五万合成记录、1800/36000字节文本分布、2/3已保存、20发件身份、34天/未知日期/引用对，单机连接/图冷与热，OS缓存不清空。优化后逐封首屏291/279ms、对话1051/730ms；标题/稀有正文首批247~266ms，两字正文逐封423/410ms、对话748/744ms；目标所测范围通过，不扩充为真实冷磁盘或多Mac结论。此前对话两字987ms接近门槛，改用typed统计/文件夹覆盖索引后降低；真实原件不变。

原生稳定启动器Running/父进程Tauri确认，页面通过新IPC加载首200并追加为400/4158。未打开/改标记/发送/移动/删除真实邮件，只滚动并恢复顶部；真实界面图像仅工具内观察，未保存/提交。静态Pages本机4174/anser纯虚构示例，日期应用/清除、正文覆盖显示通过；Popover原自动宽度塌缩已修成固定宽度，实际304×518px在视口内。ego TaskSpace11已finish，不用它续做未完成工作。

## 云端与资源待办

完整门槛通过后提交当前工作分支、合入组织main并删除已完成分支，先workflow_dispatch release.yml。固定运行/源码，核验双架构七资源、SHA256/更新签名/manifest、公钥、版本/架构/稳定标识/EML/完整codesign/许可/OAuth backend配置、DMG与归档，再发布草稿。实际安装/原位升级仍独立待验收，不能用CLI资源核验冒充。

## 接续

SEARCH_SCALE_WORKING.md记录代码与性能/真实限制；本节点构建/发布完成后继续附件转发/拖拽与快捷操作，同时保留SAVE/SYNC/服务商/正式安装与P1完整未完范围。未有Apple证书，不更换既有更新密钥。
