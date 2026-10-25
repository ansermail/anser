# 0.1.30 发布工作点

更新：2026-10-25。用户要求代发行“存在就一直展示”、发件人地址不被省略，并重新发版、删除上一版记录。0.1.29 已公开后不可改写，因此本轮以新版本 0.1.30 交付剩余修复。

## 当前状态：已正式发布，Homebrew 同步与重复检查完成

- 基线：`main` / `c81a289`，上一正式版为 `v0.1.29` / `42e5733`。
- 0.1.29 已修复在线阅读首次同步未持久化代发人/抄送/优先级，以及发件人姓名、地址、代发行被 `nowrap + ellipsis` 截断的问题。
- 本轮修复 0.1.29 安装实测发现的缺口：仅在线保存的旧索引会被 `source_available` 判定为已可用，同步时直接跳过、从不重新读取邮件头，导致 `Sender` 永远缺失。现在在线索引若 `headerMetadataKnown` 为假就重新抓取邮件头并补写；启动迁移也不再把这些记录误标为已同步。解析版本升至 7。
- 五处版本同步为 0.1.30；应用标识 `dev.maildesk.desktop`、数据存储和更新公钥不变。完整说明见 [v0.1.30](releases/v0.1.30.md)。
- 回归测试覆盖：头信息未知的在线来源必须被视为不可用、回填后可再次视为可用。

## 验证与交付

- [x] 本地完整门槛：前端 64 文件 434/434；Rust 424 通过/3 项既有条件忽略；桌面脚本 36/36；IMAP 39/39；Prettier、Rust fmt、TypeScript、UI、1,348 条双语键、生产构建、Pages 构建、`release:check` 与 diff 检查通过。
- [x] 修复提交 `4c79b89` 已推送 `main`，注释标签 `v0.1.30` 指向同一提交。
- [x] [Checks 40157210690](https://github.com/ansermail/anser/actions/runs/40157210690)、[Preview Pages 40157210657](https://github.com/ansermail/anser/actions/runs/40157210657) 与 [Release macOS 40157276511](https://github.com/ansermail/anser/actions/runs/40157276511) 全部成功。
- [x] 七资源长度与 SHA-256 和 GitHub 元信息一致；两架构更新签名经既有公钥验证，`latest.json` 版本、URL 与签名匹配，说明原文一致。
- [x] 两份 DMG 通过校验并可只读挂载，App 与对应更新归档逐文件一致；arm64/x86_64 架构、`0.1.30` 版本、`dev.maildesk.desktop` 标识、最低 macOS 12、简体中文/英文声明、EML/EMLX/MSG 关联及许可资源通过；固定证书指纹与精确 designated requirement 通过。
- [x] 正式发布为 latest，Release ID `423123805`，2026-10-25 11:29:54（Asia/Shanghai）；发布后七个资源经匿名端点重新下载，大小与 SHA-256 逐项一致，标准 latest 更新端点与审核清单逐字节相同。
- [x] [Homebrew 40158423490](https://github.com/ansermail/anser/actions/runs/40158423490) 成功，生成仅修改 `Casks/anser.rb` 的提交 [cbd7774](https://github.com/ansermail/anser/commit/cbd7774d40765ef0b844b88c84215fe255e64ecd)；本机 style/audit/Apple Silicon fetch 通过；重复运行 [40158762056](https://github.com/ansermail/anser/actions/runs/40158762056) 返回 `Cask is already current; no commit needed.`。
- [x] 用正式 0.1.30 DMG 替换 `/Applications/雁信.app`，包内可执行文件与正式 arm64 更新归档逐字节一致，启动日志显示 `雁信 0.1.30 启动完成`；旧 0.1.29 移入废纸篓 `Anser-old-apps-20261025`。
- [x] 启动迁移已把仅在线旧记录改为头信息未知（解析版本 7）；下一次同步重新读取邮件头后，目标邮件索引已写入 `senderOnBehalfOf` 且 `headerMetadataKnown=1`。真实阅读页核对通过：发件人完整地址始终显示，下一行持续显示“由 xxx 代发”，没有省略或隐藏。

## 验收边界

自动测试、云端构建和静态产物审计不证明正式安装、应用内原位升级或 Intel 实机运行。项目自签名与更新归档签名不等同于 Apple Developer ID 签名或公证。

## 七资源审计

| 资源 | 字节 | SHA-256 |
| --- | ---: | --- |
| `Anser_0.1.30_aarch64.app.tar.gz` | 12875072 | `6865d7005c12a0a5ebbd037ad05cb862cf82abde3cab7573170ee67fa70fb1f6` |
| `Anser_0.1.30_aarch64.app.tar.gz.sig` | 424 | `4175c5695adf3c47a8b529f292061f08235616b3ef69fe0053f9d629806b75b2` |
| `Anser_0.1.30_aarch64.dmg` | 13430798 | `0b061429b29361baddfa8788c8da3d62f8b440cc17a74cb9965f9196f0a7b6eb` |
| `Anser_0.1.30_x86_64.app.tar.gz` | 13497347 | `348a4d0785cde24ef220c86c73e3a7cdcb7839bd6443e0490518615ae6b11b3d` |
| `Anser_0.1.30_x86_64.app.tar.gz.sig` | 424 | `cf1feab7ac30a72074766cec53a4fa692025b8c0d0c9ed1cfaef6256b7aecc4f` |
| `Anser_0.1.30_x86_64.dmg` | 14135338 | `ce902fbc10c678f991016ed43063dcbdb6b0745cc30bae4f9c093a40a35e3665` |
| `latest.json` | 2789 | `7567c197f9dc229461987111467b01d3527f97cbccd139f86a38bb00bb61ea5f` |

本机审计脚本和日志位于桌面 `mail_video/release-0.1.30-20261025`；这些结果验证发布产物，不包含真实邮箱数据或发布私钥。
