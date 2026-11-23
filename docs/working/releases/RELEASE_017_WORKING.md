# 0.1.7 云端构建工作点

2026-10-10，main，功能基线 4b39149 + SAVE-01B2 预算阶段。用户持续目标要求关键节点先远程触发流水线构建新版 App。

## 范围

包含已合并 RULES-03、移除 EML 顶部按钮，以及按保存范围的只读服务器数量/磁盘预算检查。不以本次预算功能等同 SAVE-01B2 全部真实连接/范围下载验收。沿用组织仓库、应用标识、原更新密钥；不本地构建桌面发布包，不覆盖旧版本。

## 进度

- [x] 最终207前端/272Rust/19脚本/39IMAP，以及 UI/格式/生产与 Pages 构建、release:check、diff/fmt通过；最终追加协议边界测试单独复验。
- [x] 稳定开发预览 QQ 收件箱只读检查：3451 位置，0 未缓存，预计31待保存/981 KB，预留129.1 MB；实际磁盘可用空间返回。表单取消未保存，不下载/移动/删除真实邮件，原5478存档保留。
- [x] 五处版本同步0.1.7，发布说明已写。
- [x] 最终发布门槛；源码提交/推送和工作流触发记录随后追加。
- [x] 源码 1de47d790c2eaabeaa8b4422e0c7a6c5fdad73cf 已提交并推送 main；已远程 workflow_dispatch 触发 [Release macOS 38017514986](https://github.com/ansermail/anser/actions/runs/38017514986)，headSha 与上述提交一致，已确认 check 作业运行中。
- [x] 双架构云端构建/草稿及七份资源核验。
- [x] 正式发布/公开清单；真实正式安装/原位更新另列待验收。

## 构建当时的接续（已完成）

按 docs/UPDATES.md 的全量门槛完成后提交推送并使用 `gh workflow run release.yml --repo ansermail/anser --ref main`；记录确切 run ID 后等待相同运行，不能因暂时查询失败重复触发。云端作业进行中可继续准备下一阶段工作点，发布验收分别记录。不把草稿构建等同正式发布。

构建已触发，后续仅查询 38017514986，完成后检查草稿和七份资源。继续开发 SYNC-02 不改变本次构建的源码 SHA；该阶段后续改动不能计入 0.1.7。

构建期间曾确认：check 作业成功，两架构 build 作业均正在执行“Build signed update and first-install DMG”。Checks 成功不等于安装包完成；继续查询同一运行，不能重触发。

## 完成结论（2026-10-10）

运行38017514986全部作业成功，构建source1de47d790c2eaabeaa8b4422e0c7a6c5fdad73cf，独立Checks38017513798成功。2026-10-10 10:59:30（Asia/Shanghai）正式发布为latest；Release及tag均指向上述源码。[发布地址](https://github.com/ansermail/anser/releases/tag/v0.1.7)。

七个资源名称/大小/远端SHA-256全部匹配，manifest两平台URL与独立sig一致；使用与Tauri更新器同库/同参数的minisign-verify 0.2.5和既有公钥验证两份更新归档成功。两个App版本0.1.7、id为dev.maildesk.desktop，架构arm64/x86_64，EML Viewer/Alternate声明正确；CodeResources及codesign深度严格验证通过，DMG校验通过。只读挂载后DMG与更新归档的二进制分别完全一致，已卸载镜像。未安装或运行分发包，没有把归档检查当真实冷启动/原位更新通过。

公开匿名canonical latest.json逐字节匹配已核验清单，版本0.1.7、两平台链接正确且HTTP200。不改写其他已发布标签/资源，没有换更新密钥；没有Apple Developer ID/公证，本机OAuth配置未进入CI包。

核验用目录在仓库外 `/tmp/anser-release017-audit`，含下载资源/API元数据与独立签名验证器；公开结果已沉淀本文件，不依赖临时目录接续。tag路由在草稿时404，改用releases列表取得同一草稿元数据后验证；没有重跑构建。e2f7cf6的后续SYNC改动不在0.1.7。

此发布节点已完成，后续按SYNC_02B2_WORKING.md继续；整体开发目标未完成。
