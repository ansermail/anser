# 0.1.8 云端构建工作点

2026-10-10，main。本轮阶段：SYNC-02B2 在途只读 FETCH 中断、新 Google OAuth 构建配置、个人使用许可及 App 资源。0.1.7 来源 1de47d7 的已发布标签/资源不改写。

## 已完成

- 同账号 INBOX 只读下载 socket 中断、注册竞态/展开清理、残缺响应不发布、旧来源/原件保留、失步连接退出及新轮次优先。SMTP/COPY/MOVE 与其他账号/目录不受影响。
- 五处版本同步到 0.1.8，新版本说明 v0.1.8.md 完成；Google 仓库 Secrets 与原生双架构构建接线已有 fe22226，原更新密钥与存储 ID 保持。
- 发布门槛：207 前端、275 Rust、19 桌面脚本、39 vendor IMAP 通过；UI、TypeScript、生产/Pages 构建、格式、cargo fmt、release:check 及 diff 检查通过。日志 /tmp/anser018-{frontend,rust,scripts,vendor,build,preview,format}.log 仅作本轮辅助，继续以记录与云端状态核对。
- 原生开发预览显示 0.1.8，两授权邮箱 IDLE 连接后收件箱补查成功，5478 存档保留，新“本轮结束”日志可见；已恢复收件箱界面。没有新发信、修改范围、移动或删除邮件。QQ/企业邮旧异常容器仍被隔离，不把这个全目录错误当作收件箱失败。该启动补查不算新实时到达/在途大附件真实验收。

## 发布步骤

- [x] 提交并推送 main：`f118cf34dbb0a1a4c2f978b76a22360b2ab2625e`。
- [x] 远程触发 [Release macOS 38033190031](https://github.com/ansermail/anser/actions/runs/38033190031)，workflow_dispatch，固定源 f118cf3；云端 check / 两架构 / draft 全部成功，不另开重复运行。
- [x] check / 两架构构建 / draft 全部 success，固定源码 f118cf3。
- [x] 七项资源 SHA256/大小与 GitHub 元数据匹配；清单/两更新签名通过，App 版本/架构/标识/EML/完整 codesign 与四许可资源通过。两架构新 Google ID/Secret 在后端编译配置一致且前端资源不含值；Intel 短 Secret 被 LLVM 分段立即数写入，按 exchange 的分段内存写入重建后逐字节匹配，不把简单字符串扫描未命中误当缺配置。
- [x] 两 DMG 校验和通过；只读挂载核对 App 二进制/Info.plist/CodeResources 与更新归档逐字节一致，deep codesign 通过，挂载均已退出。2026-10-10 15:22:16（Asia/Shanghai）发布 [0.1.8](https://github.com/ansermail/anser/releases/tag/v0.1.8) 为 latest；标签指向固定源，匿名 latest.json 与核验清单逐字节一致，两个更新 URL 均 HTTP200。

## 仍未验证及接续

真实大附件繁忙到达、网络/睡眠恢复和其他服务商矩阵；新 Google Client 真实授权/长期刷新；正式安装/原位升级/默认 EML/多 Mac，以及 Developer ID/公证仍未完成。Microsoft Client 注册有独立本机待办，本轮不声明接入。云端包完成后继续 SYNC_02B2_WORKING.md 的真实矩阵，再推进搜索/后端分页。


## 真实授权小邮件回归与新发现

后端保持稳定在 0.1.8，没有重启或主动收取来补收。两封都仅在已授权企业邮/QQ 之间发送，无抄送/密送、附件、引用或签名：

- A：主题 `雁信联调 20261010-SYNC-02B2-A`，企业邮→QQ，15:11:43 发送记录 SMTP 已确认；QQ 服务器实时通知 15:11:45.572（Asia/Shanghai），本轮 3307ms / 从触发到结束 3321ms，新收 1 封。原生列表出现 A。企业邮已发送副本核对成功。
- B：主题 `雁信联调 20261010-SYNC-02B2-B`，QQ→企业邮，15:22:05 SMTP 已确认；当前证据只证明 15:26:29 定时补查收取 1 封，随后 15:27:34 才有该账号新的实时通知。不能把 B 记为即时 IDLE 验收通过，也不能仅此推断服务端何时实际投递。
- 两个 INBOX 活动来源已在稳定文件快照的只读查询中确认；在线账号的正文未缓存，本轮完整正文渲染验收未取得可靠结果。原始数据库只读打开受当前环境限制，临时复制主库/WAL前后核对大小/mtime未变化，在仓库外 0700 临时目录查询后立即删除，没有修改原库。
- 本地存档 5478→5480 是两次本机 SMTP 原件，不是把 QQ/企业邮在线收取改成完整保存；真实存档路径/默认范围未变。没有移动/删除真实邮件，没有提交真实截图/MIME/数据库。
- B 的 QQ 已发送上传被服务端在 literal 前明确拒绝：`Mail has saved by smtp!`；应用仍显示需处理。下一步先只读核对已有副本与服务端 Message-ID 变化，不重新发 SMTP、不盲目再 APPEND。

这一真实回归补充了接续优先级：先核查企业邮通知/定时补查时间差与 QQ 自动已发送副本核对，再完善繁忙/网络睡眠矩阵；搜索/分页入口见 SEARCH_SCALE_WORKING.md。0.1.8 发布完成不等于上述真实矩阵完成；正式安装/原位升级尚未执行。
