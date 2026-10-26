# 0.1.33 发布工作点

更新：2026-10-26。用户报告正文下半部分抖动、切换主题后正文不变色、图片失败时缺少可查询的诊断，并要求列表右键菜单补齐阅读面板的操作；确认后要求提交并发版。0.1.32 因检查阶段超时未发布，本版沿用同一批修复并单独放宽两条大列表跨页导航用例的期限。

## 当前状态：已正式发布

- 基线：`main` / `c188549`，上一正式版为 `v0.1.31` / `96528ae`。0.1.32 的标签 `6792621` 未产出任何资源，不移动该标签。
- 正文抖动：正文框初始高度 64px，测量时先出现内部竖向滚动条，占用约 15px 宽度导致重新折行；拉高后滚动条消失又折回。窗口宽度接近换行临界点时两套排版来回切换。修复为测量期间禁止正文框内部竖向滚动条（`overflow-y: hidden`），横向仍可滚动并在高度中补偿。
- 主题切换：`.dark` 类原先在 App 的普通 effect 中应用，正文组件的 layout effect 更早读取 `--background`，拿到上一主题的背景值。新增 `applyThemeClass()`，在主题变更与正文读取前同步应用根类。
- 图片诊断：失败与超时图片各打印一次 `console.warn`，地址、`srcset`、替代文字全部 URL 编码，`data:` 只记录长度。
- 列表右键菜单：按状态提供标记已读/未读、星标/取消星标、完整保存、导出原始邮件、打印、归入本地文件夹、移到废纸篓或恢复、回复、全部回复、转发。
- 五处版本同步为 0.1.33；应用标识 `dev.maildesk.desktop`、数据存储和更新公钥不变。完整说明见 [v0.1.33](releases/v0.1.33.md)。
- 测试期限：两条需要 7 次跨页导航的 205 封用例单独使用 30 秒，其余用例保持 15 秒。共享 runner 上同一提交实测在 13–17 秒波动，0.1.31 与 0.1.32 两轮均在 15 秒边界超时且断言全部通过。

## 验证与交付

- [x] 根因复现：用该邮件的真实 HTML 在 WebKit 中扫描 700–1200px 宽度，修复前 700px 首帧宽度为 683px、随后变为 700px；修复后各宽度首帧即稳定。
- [x] 开发预览实测：同一封邮件连续抓帧 14 张，下半段不再重排跳动；切换浅色与深色后正文背景与文字立即跟随，无需重开邮件；右键菜单显示 10 项及快捷键，星标切换后菜单即时变为“取消星标”，测试后已恢复原状态。
- [x] 本地完整门槛。
- [x] 发布提交 `4ae0679` 已推送 `main`，注释标签 `v0.1.33` 指向同一提交。
- [x] [Checks 40349698910](https://github.com/ansermail/anser/actions/runs/40349698910)、[Preview Pages 40349698920](https://github.com/ansermail/anser/actions/runs/40349698920) 与 [Release macOS 40349710839](https://github.com/ansermail/anser/actions/runs/40349710839) 全部成功；单独定界后两条 205 封跨页导航用例通过检查阶段。
- [x] 七资源大小与 SHA-256 和 GitHub 元信息一致；两架构更新签名经既有公钥验证，`latest.json` 版本、URL、签名与说明原文一致；两份 DMG 通过校验并可只读挂载，包内应用与更新归档逐文件一致；arm64/x86_64 架构、0.1.33 版本、`dev.maildesk.desktop` 标识、最低 macOS 12、简体中文/英文声明、EML/EMLX/MSG 关联、许可资源、固定证书指纹与精确 designated requirement 通过。
- [x] 正式发布为 latest，Release ID `424441891`，2026-10-27 00:24:05（Asia/Shanghai）。发布后七个资源经匿名端点重新下载，大小与 SHA-256 逐项一致；标准 `latest/download/latest.json` 与审核清单逐字节相同。
- [x] [Homebrew 40358757447](https://github.com/ansermail/anser/actions/runs/40358757447) 成功，生成仅修改 `Casks/anser.rb` 的提交 [d7afe95](https://github.com/ansermail/anser/commit/d7afe95dd1b04fc44e5676fe5dc0e3a8edd2c99e)，双架构 SHA-256 与审计一致；重复运行 [40361022536](https://github.com/ansermail/anser/actions/runs/40361022536) 返回 `Cask is already current; no commit needed.`。
- [x] 用正式 0.1.33 DMG 替换 `/Applications/雁信.app`（旧 0.1.32 前的 0.1.31 移入废纸篓 `Anser-old-apps-20261027`），包内签名与固定身份一致；启动后无 SecurityAgent 授权弹窗，凭据库保持 0600 且未被改写，腾讯企业邮、QQ 与 Gmail 均从凭据库完成 IMAP IDLE 连接。

## 验收边界

自动测试、云端构建和静态产物审计不证明正式安装、应用内原位升级或 Intel 实机运行。项目自签名与更新归档签名不等同于 Apple Developer ID 签名或公证。

## 七资源审计

| 资源 | 字节 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.33_aarch64.app.tar.gz` | 12899829 | `12350947fd46af814445b45924087d8e663bc0349367974e057d7a486faacd03` |
| `Anser_0.1.33_aarch64.app.tar.gz.sig` | 424 | `74a33649936f25bd620cb112bd1e89ef118fa92c40ee7bc815e088fcba9ea26a` |
| `Anser_0.1.33_aarch64.dmg` | 13458491 | `9359ca8a4bfa47ac034213f98825efc9fd2b771319e483a01950b1f4c1eaf32e` |
| `Anser_0.1.33_x86_64.app.tar.gz` | 13526858 | `fdd3539923a1154b24b63e41a60c4f1eab93bc4f2ee8d9923950d1e1c9588f1e` |
| `Anser_0.1.33_x86_64.app.tar.gz.sig` | 424 | `833e75b2523e8006b4f46bb1975aac8669662e429663dbb15969b7a629a013ba` |
| `Anser_0.1.33_x86_64.dmg` | 14172444 | `f8937a21ce58bfd3e7009d078d04db9501359df6a68271f36789805f8baee404` |
| `latest.json` | 3884 | `60eac5a7f352c9c0f6d0f4a6b3297daa05ca7570f286ee242341efa8461e0d3e` |

审计脚本与日志位于桌面 `mail_video/release-0.1.33-20261026`；不含真实邮箱数据或发布私钥。
