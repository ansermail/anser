# SEARCH / SCALE 后续工作点

2026-10-10，当前功能基线 220f4cc，0.1.9 已完成云端构建/资源核验与正式发布。当前开发分支 `codex/search-scale`（从 main / 7e4b122 接续）。索引和 SQL 页/邻居后端子阶段已接入；前端分页/时间筛选与整体规模验收仍未完成；正式 0.1.9 不含本分支。

## 未完成要求

- FTS 本地正文/标题/发件人/收件人索引，保留中文与短关键词、字面符号及各字段范围行为；未下载正文必须明确检索范围，不能以未知正文当空正文或为搜索自动下载。
- 时间范围筛选，业务日期界面用现有 shadcn Calendar / Popover，不使用原生 date。
- 真正后端分页，逐封与会话两种模式均解除前端累计 5000 条限制；滚动/连续阅读不得重复、漏项或采用旧范围响应。
- 五万封首屏 ≤3 秒、搜索首批 ≤1 秒的原目标，需要记录冷/热查询、数据分布、时间与返回量；临时合成数据不能代替多 Mac 和真实服务商验收。

## 当前证据

- `Store::snapshot`（store.rs）在 readable_listing 上字符串 instr 搜索，body 查询还读取 messages JSON；无 SQL LIMIT，先反序列化全部匹配项，再在 Rust 会话聚合并 truncate。
- `Query.limit` 被限制到 5000，App.tsx 的更多/连续阅读将 limit 每次增加 200；这属于重复请求更大前缀，没有真正分页。
- conversation.rs 使用 revision 缓存关联图，跨账号隔离 Message-ID/References；摘要选最新匹配项但合并匹配成员的未读/星标/附件状态，计数按完整图的原语义。不能先截断邮件再聚合，否则会话会重现、计数/状态丢失。
- message_listing 触发器跟随 messages 增删改；规则、恢复、解析修复与保存均通过 messages 更新。FTS/分页投影也须覆盖同样发布事务与来源可信边界，不能只维护新收邮件。

## 建议实施顺序

1. 先定分页协议：固定大小页、稳定日期+ID/会话ID次序、查询范围/快照代际、matched 与下一页 cursor；明确新邮件/标记/删除/账号变化时重置/重查，保留当前阅读邻居与过期响应保护。
2. 建立 SQL 可查询的日期/状态/会话成员投影及索引，保证逐封和会话页面都只返回当前页；COUNT/聚合需要在 SQL 或持久投影处理，不把扫描全部 JSON 换成扫描全部 Rust 对象。
3. 接入 FTS、事务性更新/旧数据库建索引与重建检查，中文/短词/符号测试先于搜索入口替换；明确全文只含已有派生正文，原始 MIME 不改写。
4. 加时间筛选和正文覆盖说明，前端按页合并/重置与连续阅读，Pages 继续虚构数据分页且不引入原生桥。
5. 端到端两模式/范围变化/阅读边界验证与五万封测量，完成关键节点后再按全量发布门槛触发下一版本云端构建。

## 当前接续

RELEASE_019_WORKING.md 云端发布已完成。QQ 自动副本核对和 C 实时收件通过，真实大附件繁忙/断网睡眠矩阵仍按 SYNC_02B2_WORKING.md 单独保留。Microsoft 注册/默认发布配置已完成，实际邮箱 SMTP/刷新未完成。事务性检索投影已按下方 SEARCH-01 子阶段接入。SQL 对话成员/摘要投影、页协议与锚点邻居接口已接入，下一步前端分页/时间筛选/覆盖提示；虚构实验不计作生产性能完成。

## 2026-10-10 0.1.9 构建期间的索引方案实测

0.1.9 已发布，源码 220f4cc，Release 38051136526 全成功；当前开发从该基线接续。研究没有修改生产存储或原件，FTS/真正分页功能仍未接入；静态演示和当前应用继续原语义。

在仓库外独立 Rust/rusqlite 0.32 bundled 实验中，建立五万条纯虚构记录（主体约十五次重复的中文项目说明、每千条一个稀有标题/带字面符号正文；每三条一个合成对话）。FTS5 external-content + trigram 候选与 `instr(lower(subject||' '||body),lower(?))` 二次核对；三字符以下仍扫描。中文 `预算审核`、两字 `预算`、一字 `预`、`100%`、`ABC_`、带引号 literal、NOT 和不存在词均与完整字面扫描结果一致。输入作为参数及双引号转义的 FTS phrase，不把 `%`/`_` 当 LIKE 通配符、不把 NOT 当布尔语法。

实验命令为独立 Cargo crate（依赖与项目一致）的 `cargo run --offline --release`；SQLite 版本、建库与两轮数值见下面记录。connection-cold 只表示重新打开连接，操作系统页缓存未清空，不算真正磁盘冷启动。每项时间包含完整扫描基线与 FTS 查询，不能把它冒充生产 FTS 搜索首批延迟。SQL `row_number() OVER(PARTITION BY thread ORDER BY instant DESC,id ASC)` 再取 n=1、LIMIT200；COUNT DISTINCT=16667，页固定200行。没有下载/加载真实原件，未测试真实引用图、可信来源/状态合并或前端游标。

采用依据：[SQLite FTS5 trigram 文档](https://www.sqlite.org/fts5.html#the_trigram_tokenizer)。短词不使用 FTS MATCH；外部内容表与增删改必须事务性更新，删除/恢复/解析迁移及正文覆盖需独立测试。不要把预览/规则对未知正文的保护替换为空值匹配。

### 下一实现约定

- typed 日期/状态/检索字段派生投影；保留原 JSON/MIME，不因索引改日期。相同时间 ID 稳定次序、未知时间置后。
- SQL 查询先范围/可信来源过滤，再组内状态合并与最新代表，最后 LIMIT/游标；全图计数保留现有去重身份语义，不先截取单封再分组。
- 拆开拓扑 revision 与查询 revision：单纯已读/星标/分类不需重建完整引用图，但应废弃影响筛选的旧 cursor；新增引用/服务器别名、来源隔离恢复等重建对应图与持久成员投影。读取同一事务的版本、成员、页和计数。
- 页协议固定上限、nextCursor 与 scope/revision 检查；范围或数据版本变化返回明确 reset，前端丢弃迟到页并重查，保持阅读正文和邻居处理，真正解除5000累积前缀。
- 字段检索保留原语义；至少三字符使用安全 FTS phrase 候选 + literal 确认，一/两字与不适用输入走投影扫描。跨字段拼接、Unicode大小写/符号/空白还需扩展专项，不以本实验代替。
- 原目标冷/热五万封首屏≤3秒、搜索首批≤1秒必须在真实 Store 两种列表与迁移后测量，当前实验仅支持候选方案可行。

### 虚构实验数值（单机，不是生产验收）

```text
sqlite=3.46.0
insert_50000_ms=2497
connection-cold needle="预算审核" count=50 comparative_ms=103
connection-cold needle="预算" count=50 comparative_ms=104
connection-cold needle="预" count=50 comparative_ms=110
connection-cold needle="100%" count=50 comparative_ms=96
connection-cold needle="ABC_" count=50 comparative_ms=94
connection-cold needle="\"literal\"" count=50 comparative_ms=95
connection-cold needle="NOT" count=0 comparative_ms=95
connection-cold needle="不存在的词" count=0 comparative_ms=103
connection-cold conversation_count_and_page_ms=62
hot needle="预算审核" count=50 comparative_ms=102
hot needle="预算" count=50 comparative_ms=102
hot needle="预" count=50 comparative_ms=110
hot needle="100%" count=50 comparative_ms=95
hot needle="ABC_" count=50 comparative_ms=92
hot needle="\"literal\"" count=50 comparative_ms=94
hot needle="NOT" count=0 comparative_ms=93
hot needle="不存在的词" count=0 comparative_ms=103
hot conversation_count_and_page_ms=56
```

实验代码已保存为 `docs/experiments/search-scale-probe.rs`，不接入产品与真实数据库。重现时在仓库外新建仅含 `rusqlite = { version = "0.32", features = ["bundled"] }` 的临时 Cargo crate，复制此文件为 src/main.rs，执行 `cargo run --release -- /一个不存在的临时路径/fictional.sqlite3`；程序拒绝覆盖既有文件，只创建虚构实验库。测量前检查编译工具链/SQLite版本，环境漂移不可沿用本轮数值。

复现代码在保存后再次以相同 bundled 依赖编译/运行成功；所有虚构 literal 比较与200条SQL页断言通过。0.1.9 已发布，下一生产改动从此工作点推进，不能沿用本实验作为产品性能门槛。

## SEARCH-01 索引子阶段（2026-10-10，codex/search-scale）

### 已完成代码

- 新 `src-tauri/src/search.rs`：search_documents typed 日期/状态/正文覆盖投影、外部内容 FTS5 trigram、schema marker 和原子升级/缺失索引恢复。只重建派生对象，不读写 MIME 原件。
- messages 插入/更新/删除通过 SQLite triggers 原子维护投影及 FTS；已读/星标等不改变 all_text 时不重写全文索引。恢复/解析修复沿用同一触发入口，失败回滚不会留下“成功”标记或半索引。
- Store 初始化在后续解析修复前建立索引；snapshot 搜索不再扫描原始 messages JSON 正文，改为 FTS 候选与投影字段 literal 确认。保留原默认字段拼接、中文/Unicode/标点/大小写语义，MATCH 使用参数化转义 phrase，不执行用户布尔语法。
- 一/两字和含 NUL 的查询直接扫描；含 NUL 的记录加入候选扫描回退。实际回归发现 FTS 截断 NUL 后文本，已修复并覆盖索引安全/不安全两种记录，未删字符或改写原件。
- 检索结果仍由 readable_listing/trusted_sources 过滤；body_known 标注完整且未解码失败的已保存正文，未知正文不下载/不冒充已知。

### 实际验证

- `cargo test --manifest-path src-tauri/Cargo.toml`：288 项全量通过（含5项新搜索专项）；`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` / `git diff --check` 通过。
- 专项：旧记录迁移、缺失 FTS 恢复、初始化幂等；增改删与回滚；多字段中文/短词/引号/%/_/Unicode/跨字段子串/NUL；未知正文与隔离来源；解析修复和标记/原件保持。FTS integrity-check 与 external content 核对通过。
- 首轮专项失败为测试 TempDir 被 `_` 立即释放和误用 body-free 列表摘要比较全文元数据，已修正；随后发现真实 FTS NUL 截断行为并加回退，最终全量通过。未把失败过程藏成一次通过。
- 原生稳定启动器重编译 Running 后（应用父进程仍为 Tauri）复用开发预览，搜索既有 `雁信联调 20261010-SYNC-NOOP` 返回 C/D 两封联调样本；恢复空搜索，未打开/标记/发送邮件、未改真实保存范围或提交真实截图/数据库。
- 本轮只改 Rust，无前端/脚本/Pages 代码，未重复它们的检查；没有生产性能数字、云端构建或正式发布，不能沿用0.1.9结果为本阶段发布证明。

### 当前未完成与下一入口

1. `snapshot` 仍把所有匹配记录反序列化再对话汇总/truncate，原累计5000限制尚在；不能把 FTS 接入记作真正分页。
2. 继续 typed 投影的查询 revision/引用图 revision 拆分，SQL 对话成员/去重计数/范围内状态合并，固定页与游标。读取版本/图/筛选/页在同一 SQL 快照，旧范围响应废弃。
3. 接入前端页追加/重置与连续阅读；Pages 内存数据对应同一协议。日期界面使用 shadcn Calendar/Popover，解释现有正文检索范围，不自动下载未知正文。
4. 完整 Store 两模式五万封冷/热首屏/首批测量，真正脱离前缀重载；随后全量门槛、版本更新、合入main并删除完成分支，关键节点先远程构建下一新版。

阶段文件：src-tauri/src/search.rs、store.rs、lib.rs 与 AGENTS/USAGE/IMPLEMENTATION/本工作点/DEVELOPMENT_STATUS。源码提交以本分支最新 SEARCH-01 提交为准；后续继续此分支，不能把未完成分页功能混入正式包。

## PAGING-01 后端固定页与阅读锚点（2026-10-10）

codex/search-scale，从SEARCH-01/b65e3ab接续，仍未合入main或发布。新文件paging.rs；涉及conversation/lib/remote/search/store。

### 已完成

- `mail_page` IPC 与 Store::mail_page：PageRequest含query、cursor、dateFrom、dateBefore；每页限制1..200，SQL count/窗口分组/状态合并后截取，只反序列化本页Mail，正文仍为空。未知日期置后，同时间ID稳定次序；日期下限包含、上限排除，使用与SQLite一致的整数Julian毫秒换算，保留原始日期。
- 持久conversation_members/counts从完整可信引用图生成，计数保留服务器副本身份去重及跨账号隔离语义。按当前范围挑最新代表、合并范围内已读/星标/附件，完整图计数不受页大小或筛选截断。
- 引用图revision与查询revision拆分；标记/分类/日期/文本更新废弃查询cursor但不重建引用图，引用/别名/垃圾箱/完整保存可见性及来源变化影响图。普通source相同值更新和account lastSync/error不误重置页。
- 图过期时在独立IMMEDIATE事务更新派生成员；正常计数/过滤/分页/元信息在同一只读WAL快照，网络任务不因分页长持写锁。snapshot_metadata与remote_folders_in共用调用连接，查询结果/计数/来源错误和元数据不会跨连接拼接不同快照。
- Base64URL JSON游标绑定规范化范围hash、数据版本、实际时间/ID；空白/畸形/跨范围/不存在锚点拒绝。版本改变返回新的第一页及reset=true，前端必须替换，不能合并旧结果。游标中不存检索文本或凭据。
- `mail_neighbor` IPC与Store::mail_neighbor：query/date范围+id+previous/next，直接seek相邻结果，允许当前锚点因已读离开未读筛选；结果仍遵守当前范围，跳过同一对话，校验账号/可读来源和参数。返回body-free Mail及revision；不会从头加载第5000行前的页，也不改列表页流或标记。
- 旧snapshot保持兼容供前端过渡，尚未删除其全量反序列化/5000前缀路径。不能把新后端接口视作当前UI已经解除限制。

### 实际验证

`cargo test --manifest-path src-tauri/Cargo.toml` 296项全量通过（47.52s，含8项新分页/邻居专项）；cargo check、cargo fmt --check、git diff --check通过。首轮测试编译缺Page Debug derive，已补充并重跑，未把该失败计为通过。

专项用6103条虚构派生记录（无真实MIME/账号数据）证明：逐封与对话都可遍历>5000结果、固定197页、同时间/未知时间不重不漏；对话计数/状态/范围与旧语义一致；字段/附件/文件夹/远端范围；标记改变reset而图不重建、跨范围/假游标拒绝；毫秒时区上下边界；未知正文/隔离来源覆盖计数；无变化来源及后台状态不reset；WAL读取期间另连接提交仍保持旧计数/标记/版本快照；5000行以后直接查邻居、已读离开未读过滤、同线程跳过、未知日期/账号限制。

本轮未改UI/脚本/Pages，没有原生界面对新接口的使用验收、没有五万封生产测量、云端新版构建或发布。正式0.1.9不含本分支。

### 前端接续必须完成

1. src/lib/api.ts新增mailPage/mailNeighbor桥，native调用对应IPC；Pages/demo继续隔离虚构内存数据，同样实现cursor/reset/日期/相邻范围语义，不能回到静态桥里的原生调用。
2. src/lib/types.ts扩展页返回nextCursor/revision/reset/bodyCoverage及日期条件。App刷新只拿首个固定页；加载更多按cursor请求、同范围/请求代际/原cursor保护、同revision才追加，reset替换而非拼接；移除累计limit与5000禁用。
3. 保留阅读正文和选择过期保护；可用内存邻居先用，否则mailNeighbor直接seek。不得将seek邻居结果混入列表流形成缺页，不从首200条重载到远距离锚点。按钮/键盘的加载与首尾反馈都需测试，拒绝较旧revision/范围/选择响应。
4. 日期界面用shadcn Calendar+Popover，起始当地午夜至结束日期后一日（DST用日历加一天），转换ISO传入dateFrom/dateBefore；正文检索说明展示known/unknown覆盖，未知不自动下载。
5. 前端两模式真实cursor交互、正在加载换范围/新消息/读状态变化、连续阅读/首尾、Pages隔离与五万封Store两模式冷/热目标；最后全量发布门槛、版本同步、合并main并清理工作分支，关键节点先远程构建下一版。

代码入口：paging.rs::mail_page/mail_neighbor/read_listing/units；接口库api.ts、App refresh/navigateReading/加载更多；原有Rust Query不变，PageRequest包装它。阶段源码以当前分支PAGING-01提交为准，接续先核对branch/status。
