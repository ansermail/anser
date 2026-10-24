# 0.1.28 发布工作点

更新：2026-10-24。用户要求将最新版尚未包含的新修改和修复正式发版，授权版本同步、提交推送、双架构流水线、资源核验、正式发布与 Homebrew 同步。

## 当前状态：已正式发布，Homebrew 同步与重复检查完成

- 基线：官网 `cdb357c` + `codex/eml-filechanged` 的未提交功能改动（源基线 `38fe9b7`），无冲突合并到 `codex/release-0128`。
- 原开发工作区和 `/Volumes/Others/mail` 的既有文档改动保持原状。
- 范围：macOS 扩展属性触发的 `fileChanged` 误判、收件人分行与原始 Bcc 展示、地址右键操作、本地联系人去重、紧凑通讯录；保留新版官网与测试数据演示。
- 五处版本为 0.1.28；应用标识、存储与更新公钥不变。完整说明见 [v0.1.28](releases/v0.1.28.md)。

## 验证与交付

- [x] 本地前端 64 文件 432 项、Rust 422 通过/3 既有条件忽略、桌面脚本 36 项、IMAP 39 项；Prettier、Rust fmt、TypeScript、UI、1,346 条双语键、生产构建、Pages 隔离/官网检查、发布资源与 diff 检查均通过。
- [x] 合并后的浏览器演示仅有虚构账号且无原生桥：地址悬停高亮、Shift+F10 菜单、添加本地联系人通过；1440×900 下通讯录为三列约 368px、卡片高 60px，无横向溢出。原开发工作区逐文件散列未变，桌面生产构建不含官网宣传视频。
- [x] 暂存对象及固定提交五处版本核对通过；源码 `dd2fe9be5357942a82794f2acc543d901f075d1c` 已推送 main，注释标签 `v0.1.28` 指向同一提交。
- [x] [Pages 40068379953](https://github.com/ansermail/anser/actions/runs/40068379953) 成功，公开 demo 的收件人/抄送分行对齐及无原生桥通过，官网展示 0.1.28 双架构入口。
- [x] [Checks 40068379904](https://github.com/ansermail/anser/actions/runs/40068379904) 全部成功。
- [x] [Release macOS 40068386396](https://github.com/ansermail/anser/actions/runs/40068386396) 的 check、双架构 build、draft 全部成功。
- [x] 七资源大小/SHA-256 与 GitHub 元信息一致，双架构更新签名经既有公钥验证；固定代码签名及精确 DR、版本/架构/应用标识/最低 macOS 12/本地化/EML·EMLX·MSG 关联/许可资源均通过，DMG 与对应更新归档逐文件一致。发布说明与 latest.json 保留相同原文（含末尾换行）。
- [x] Release ID `422553971`，2026-10-24 14:14:49（Asia/Shanghai）正式公开为 latest；发布前后标签、源码与资源 ID/大小/摘要不变。匿名重新下载七资源与审计文件逐字节一致；不加查询参数的标准 latest.json 端点与审核文件一致。
- [x] [Homebrew 40069438215](https://github.com/ansermail/anser/actions/runs/40069438215) 成功，执行脚本回归、公开双架构摘要验证、brew style/audit/fetch；提交 [78bf04c](https://github.com/ansermail/anser/commit/78bf04c3515966adb99359704ee6077e3ead9a0f) 仅修改主仓库 Casks/anser.rb，两架构摘要与独立审计一致。
- [x] 重复运行 [40069519888](https://github.com/ansermail/anser/actions/runs/40069519888) 成功，返回 `Cask is already current; no commit needed.`，无多余提交。

## 验收边界

本轮仅使用虚构测试数据。正式安装后的默认打开/冷启动、应用内原位升级、系统剪贴板、Intel 实机与真实邮箱收发不作为自动测试或资源审计的推论；未执行项继续标明。项目自签名不是 Apple Developer ID 签名或公证。

## 七资源审计

| 资源 | 字节 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.28_aarch64.app.tar.gz` | 12874703 | `860c5cb868cece14f61ad5752f0958efab419abf1ab9bce7dc1175a2143345fa` |
| `Anser_0.1.28_aarch64.app.tar.gz.sig` | 424 | `a703b1815e1af665d63ec2ffbbaf4384514d112b39f2aeb9bf9e04c2b38e1a35` |
| `Anser_0.1.28_aarch64.dmg` | 13430589 | `1bcacf370a44010bf09bacc760ad2e253be7accb40ccd1dbe34bc1e1d95c280e` |
| `Anser_0.1.28_x86_64.app.tar.gz` | 13472044 | `94292739979bf7b0c5d30105099d9cae8db73fa275d511c80869c7c5e22fab3f` |
| `Anser_0.1.28_x86_64.app.tar.gz.sig` | 424 | `f33c6d96a038e96d8aefa64ba7a20c3b441b27b528ea5955c41b8618368b1cdc` |
| `Anser_0.1.28_x86_64.dmg` | 14112641 | `b940744fb425754a748d5b90c51e18b7795bbe50b8c05c7ce00c560fe0087fcd` |
| `latest.json` | 3317 | `08fe3484030b9176450f9ed70f1cd5134bd7d18a0d72d84efa3e979e1c3cfdaa` |

本机审计脚本和日志位于桌面 `mail_video/release-0.1.28`；这些结果验证发布产物，不包含真实邮箱数据或发布私钥。原本地开发工作区仍保留其未提交副本，已通过本轮固定提交发布，未清理或重置原工作区。
