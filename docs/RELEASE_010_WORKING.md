# 0.1.10 发布工作点

2026-10-11，开发分支codex/search-scale，从main/7e4b122接续。SEARCH-01 b65e3ab、PAGING-01 0f2c8a9/f11bbfa之后完成前端页/邻居、日期/正文覆盖和统计索引优化。固定源码fa6bb6e2ce70278d120400d311f2e739003772ce已合入并推送组织main，已完成本地/远端codex/search-scale分支删除；[Release macOS 38104135660](https://github.com/ansermail/anser/actions/runs/38104135660)于2026-10-11 10:07:45（Asia/Shanghai）启动，check、双架构与draft全部成功；七资源核验后于2026-10-11 10:16:43（Asia/Shanghai）正式发布0.1.10为latest。

## 发布范围

FTS候选与短词/NUL精确回退、派生schema3与覆盖统计索引、逐封/对话SQL固定页及版本/范围游标、同WAL快照、无变化刷新保留尾页、锚点阅读、shadcn日历/正文覆盖提示；Pages继续纯虚构内存协议与禁用原生桥。包版本五文件同步0.1.10，无凭据/真实截图/MIME进入Git。

## 本机验证

最终本机门槛：npm test 222项/39文件；cargo test --manifest-path src-tauri/Cargo.toml 297通过/1手动门槛ignore；npm run test:desktop 19；vendored IMAP39；npm run build（含check:ui）/build:preview（静态桥隔离）/format:check/cargo fmt --check/release:check/diff检查通过。手动Release性能门槛已独立执行1项通过，不把ignore当已执行。

Release性能调用：`cargo test --release --manifest-path src-tauri/Cargo.toml actual_store_50000_pages_and_search_measurement -- --ignored --nocapture`。五万合成记录、1800/36000字节文本分布、2/3已保存、20发件身份、34天/未知日期/引用对，单机连接/图冷与热，OS缓存不清空。优化后逐封首屏291/279ms、对话1051/730ms；标题/稀有正文首批247~266ms，两字正文逐封423/410ms、对话748/744ms；目标所测范围通过，不扩充为真实冷磁盘或多Mac结论。此前对话两字987ms接近门槛，改用typed统计/文件夹覆盖索引后降低；真实原件不变。

原生稳定启动器Running/父进程Tauri确认，页面通过新IPC加载首200并追加为400/4158。未打开/改标记/发送/移动/删除真实邮件，只滚动并恢复顶部；真实界面图像仅工具内观察，未保存/提交。静态Pages本机4174/anser纯虚构示例，日期应用/清除、正文覆盖显示通过；Popover原自动宽度塌缩已修成固定宽度，实际304×518px在视口内。ego TaskSpace11已finish，不用它续做未完成工作。

## 云端与资源待办

已完成提交/合并/分支清理并workflow_dispatch；接下来只等待同一固定源38104135660，不重新触发。固定运行/源码，核验双架构七资源、SHA256/更新签名/manifest、公钥、版本/架构/稳定标识/EML/完整codesign/许可/OAuth backend配置、DMG与归档，再发布草稿。实际安装/原位升级仍独立待验收，不能用CLI资源核验冒充。

## 接续

SEARCH_SCALE_WORKING.md记录代码与性能/真实限制；本节点构建/发布完成后继续附件转发/拖拽与快捷操作，同时保留SAVE/SYNC/服务商/正式安装与P1完整未完范围。未有Apple证书，不更换既有更新密钥。

## 正式构建/发布结果（2026-10-11）

固定源fa6bb6e2ce70278d120400d311f2e739003772ce / [Release38104135660](https://github.com/ansermail/anser/actions/runs/38104135660) 全成功；[0.1.10](https://github.com/ansermail/anser/releases/tag/v0.1.10)于10:16:43（Asia/Shanghai）发布为latest。标签指向固定源，未覆盖0.1.9。

- 七资源大小/GitHub SHA256 digest一致；两份更新归档沿用原公钥及现有Tauri/minisign路径核验。
- manifest版本/两架构下载链接/独立sig匹配；App版本0.1.10、arm64/x86_64、稳定标识、EML声明、完整codesign/CodeResources通过。
- 许可资源与固定源逐字节相同，原生Google/Microsoft默认配置精确核对；Intel优化短串在指定函数内重建，不打印配置或反汇编常量。资源目录未检出对应配置值；未上传原始配置JSON/env/私钥/真实邮件。
- DMG校验和通过，逐架构只读挂载的全部8个app文件与更新归档SHA256相同，验证后卸载，未安装或启动正式包。
- 匿名公开latest.json与审计清单逐字节相同，版本0.1.10，两架构更新URL HTTP200；同源Checks38104099996和Pages38104100008也成功。
- 已合入main并删除本地/远端codex/search-scale。浏览器TaskSpace11和本轮4174虚构静态预览服务器已结束；原生开发应用继续保留。

代码/本机门槛/单机合成性能/原生接口使用/云端构建/资源/正式发布分别完成；实际安装/原位升级、OS冷缓存/多Mac/真实负载与其余矩阵未验证。下一入口ATTACHMENTS_NEXT_WORKING.md；整个计划仍未完成。
