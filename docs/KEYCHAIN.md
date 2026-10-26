# 本地加密凭据库与项目固定签名

## 存储方式

邮箱密码/OAuth 令牌、全局代理密码和模型 API Key 共用一份 AES-256-GCM 加密的本地凭据库 `credentials.vault`，位于应用数据目录根部（Tauri `app_data_dir()`），权限 0600，写入采用临时文件 + fsync + 原子替换。32 字节密钥以 64 位十六进制文本保存在登录钥匙串 `dev.maildesk.desktop` 服务的 `anser-credentials-key-v2` 条目；凭据值、密钥内容都不进入 SQLite、明文文件、邮件原件、日志、备份或导出。

该钥匙串条目只由 `/usr/bin/security` 创建和读取，雁信进程不直接访问它。原因：macOS 把条目访问控制绑定到创建二进制的 CDHash，同一固定自签证书重新编译后，即使条目 ACL 允许任意应用，进程内读取仍会被拒绝（实测 `errSecAuthFailed`），而修改已有条目 ACL 需要登录密码。`security` 是稳定的系统程序身份，重新构建、升级和重启后仍可无弹窗读取同一密钥，因此升级不再要求输入登录钥匙串密码。

代价：凭据库文件本身的保护来自登录钥匙串密钥和文件权限；同一登录用户下的其他本机应用或脚本在知道路径时也能解密。这是“免授权”的明确取舍，凭据不再有逐应用的钥匙串访问控制。

## 运行行为

- 启动后首次访问凭据时读取密钥并解密，不弹出系统授权；进程内互斥锁串行初始化与修改，持久化成功后才发布内存缓存。
- 登录钥匙串保持锁定（例如未用登录密码自动解锁）时无法解密：应用停止读取和写入并提示解锁后重新打开，不在后台反复要求授权。
- 凭据库文件损坏、无法解密或版本未知时拒绝读取和覆盖，保留原文件并提示备份后移走；不会自动重建。
- 钥匙串服务名、密钥条目名和 `credentials.vault` 文件名都是持久身份，不能随版本修改；应用不得自行删除密钥条目。
- 已删除/已确认缺失的项保留墓碑，不回退读取旧版凭据；有新令牌/密钥后旧条目不能覆盖新值。
- 总容量上限 2 MiB，超限保留旧值并报错。
- 模型服务更换不沿用旧 Key，数据库设置保存失败按凭据检查点回滚，区分“从未迁移”与“主动删除”。全局代理凭据读取失败不能静默当作空密码连接。

## 从旧版凭据库迁移

旧版把全部凭据放在单一钥匙串条目 `anser-credentials-v1` 中。新版首次启动且本地凭据库不存在时，会尝试读取该条目一次——这是升级后唯一可能出现的系统授权。

- 读取成功：按同一 JSON 格式导入新的加密凭据库并校验可读，之后不再访问旧条目；旧条目保留，便于回退或人工核对。
- 读取被拒绝或不可读：不阻塞应用，创建空的加密凭据库并继续启动，旧条目保持原样。此时旧账号凭据不再自动可用，需要在账号设置重新连接或填写密码/密钥（代理、模型在对应设置重新填写）。如需再试迁移，先退出雁信，备份并移走 `credentials.vault` 再重新打开。
- 旧版每个账号的独立条目仍按无弹窗方式尝试；系统拒绝时提示重新连接，不逐项弹出 macOS 授权。

正常运行沿用单实例保护。迁移工具必须在所有正式/开发实例完全退出后使用，不能与应用并发写入凭据库。新版开始使用加密凭据库后，不要继续用旧版应用刷新旧条目的令牌：旧版不会读取 `credentials.vault`，两处令牌可能不一致。

### 可选旧签名迁移桥（维护者恢复工具）

本机仍有原稳定开发证书时，可以在切换签名前运行 `src-tauri/examples/keychain-migrate.rs`，只读本机索引中的账号 ID，使用既有授权迁移到加密凭据库，并仅打印计数。先 `cargo build --manifest-path src-tauri/Cargo.toml --example keychain-migrate`，再用**与旧 App 完全相同的证书/标识/DR**签名该单独工具，退出所有雁信实例，传入既有 `mail.sqlite3` 路径运行。工具会把数据库路径的上级目录作为凭据库根目录。

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
