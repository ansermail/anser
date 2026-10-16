# 钥匙串凭据与项目固定签名

## 使用方式

邮箱密码/OAuth 令牌、全局代理密码和模型 API Key 共用 `dev.maildesk.desktop` 服务下的 `anser-credentials-v1` 钥匙串条目。一次应用进程最多进行一次可交互的读取；成功后共用内存快照，保存、清理及旧记录迁移均不再主动弹出系统授权。若出现该条目的系统授权，建议选择“始终允许”，只信任当前雁信身份。系统密码仍只输入系统窗口，不交给应用。

拒绝授权后，后台任务不会逐账号重新弹窗。解锁登录钥匙串后退出并重新打开雁信即可重试。如果会话期间系统重新锁定，读取已载入快照仍可用，但保存可能失败；失败会反馈，不把未保存凭据当作已保存。新凭据库创建也不触发第二次系统授权；系统登录钥匙串仍锁定时请先在系统中解锁。

旧版每个账号有独立条目和访问控制。升级只尝试无弹窗读取，成功后持久化到统一库，旧记录保留。系统不允许新身份访问某个旧条目时，需在现有账号设置重新授权/填写密码（代理/模型在对应设置重新填写），无需删除账号或存档；应用不会为每个旧条目重复要求 macOS 密码。此限制来自已有条目的独立授权，不能通过一次密码直接更改所有条目的权限。

## 存储与迁移

- 单个版本化 JSON 保存在系统钥匙串内，包含按稳定账号 ID/功能 ID 区分的值，完全不进入 SQLite、明文文件、邮件原件、日志或应用备份。总容量上限 2 MiB，超限保留旧值并报错。
- 使用进程内互斥锁串行初始化与修改，持久化成功后才发布缓存。初始化失败也缓存错误，阻止后台授权风暴；原生 Keychain 的无交互标志在操作后恢复。
- 已删除/已确认缺失的项保留墓碑，不回退读取旧版凭据；有新令牌/密钥后，旧条目不能覆盖新值。格式损坏或未知版本拒绝读取和覆盖。
- 模型服务更换不沿用旧 Key，数据库设置保存失败按凭据检查点回滚，区分“从未迁移”与“主动删除”。全局代理凭据读取失败不能静默当作空密码连接。
- 正常运行沿用单实例保护。迁移工具必须在所有正式/开发实例完全退出后使用，不能与应用并发写入统一库。新版本后不要继续运行旧版应用刷新旧条目的令牌。

### 可选旧签名迁移桥（维护者恢复工具）

本机仍有原稳定开发证书时，可以在切换签名前运行 `src-tauri/examples/keychain-migrate.rs`，只读本机索引中的账号 ID，使用既有授权无弹窗迁移，并仅打印计数。先 `cargo build --manifest-path src-tauri/Cargo.toml --example keychain-migrate`，再用**与旧 App 完全相同的证书/标识/DR**签名该单独工具，退出所有雁信实例，传入既有 `mail.sqlite3` 路径运行。随后使用新固定身份打开应用，至多为统一条目授权一次。

工具不会输出凭据或删除旧条目。没有原稳定身份时不要伪造、改宽 ACL 或回退 ad hoc；使用应用里的重新连接流程。本工具不进入发布资源，也不把旧开发证书上传 GitHub。

## 免费固定项目证书

公开证书：`scripts/signing/anser-codesign.crt`，固定信息：`scripts/signing/identity.json`。

- 名称：Anser Project Code Signing
- SHA-1：`9BDB640CFD84667D5EA3EDEB37859C316ABB4109`
- 标识：`dev.maildesk.desktop`
- DR：`identifier "dev.maildesk.desktop" and certificate root = H"9bdb640cfd84667d5ea3edeb37859c316abb4109"`

此证书无需付费，也无需加入系统受信任根。本地开发、`npm run desktop:build` 及 GitHub 双架构构建使用同一个私钥；构建前核对指纹，签名后严格验证并精确核对 DR。找不到原身份时失败，不生成替代证书，不回退 Apple Development/ad hoc。兼容的 `ANSER_SIGNING_IDENTITY`、`ANSER_DEV_SIGNING_IDENTITY`、`YANXIN_DEV_SIGNING_IDENTITY` 只能指定该证书。

维护者私有备份位于 `~/.config/anser-signing/`，目录权限 0700、文件 0600：加密 `identity.p12`、`p12-password`、专用 `anser-signing.keychain-db` 与 `keychain-password`。请在安全位置备份原 P12 和密码；丢失后无法靠相同证书名称重建身份。恢复时导入同一 P12 到专用钥匙串，仅允许 codesign 使用私钥，加入用户搜索列表，不改变默认登录钥匙串，不增加系统根信任。

`node scripts/mac-signing-secrets.mjs` 核对 P12 指纹后，通过标准输入配置组织仓库 Secrets `ANSER_CODESIGN_P12_BASE64` 与 `ANSER_CODESIGN_P12_PASSWORD`。不能输出或提交其值；既有 Tauri 更新密钥不受影响。

CI 通过 `scripts/mac-ci-signing.mjs` 导入临时钥匙串、固定 Tauri 签名配置、核对产物 DR，并在 `always()` 步骤恢复原搜索列表及删除临时钥匙串/P12。`Verify macOS signing` 只构建双架构验证 App，不创建标签或 Release；正式发布继续走独立 Release macOS 流水线。

项目自签身份用于跨构建保持应用身份，**不等于 Apple Developer ID、Apple 公证或 Gatekeeper 认可**；首次打开限制不变。应用代码签名、Tauri 更新归档签名、实际升级/钥匙串验收须分别记录。
