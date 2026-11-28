# OpenPGP 端到端加密与数字签名设计方案

> 状态：设计定稿，准备分阶段实施（基于 0.1.48 之后 `ab617d8`）
> 目标平台：macOS（Apple Silicon / Intel）与 Windows 10/11 x64（WebView2）

## 1. 目标与已确认范围

根据用户确认，一期实现完整的 OpenPGP 日常闭环：

1. **密钥管理**：
   - 生成密钥对（默认 `Ed25519 / Curve25519`，可选 `RSA 4096`，支持可选密码短语与有效期），自动绑定邮箱账号。
   - 导入 / 导出 ASCII-armored 公钥与私钥（支持 `.asc` / `.gpg` 文件与文本粘贴，支持从收到的 `.asc` / `application/pgp-keys` 附件一键导入公钥）。
   - 联系人公钥管理：与本地通讯录联动，按邮箱（大小写不敏感）索引公钥并展示指纹与状态。
2. **协议格式**：
   - **发信**：统一生成标准 **PGP/MIME（RFC 3156）**，支持仅签名（`multipart/signed`）、仅加密（`multipart/encrypted`）、签名并加密（RFC 3156 §4 / §6.2 合并包），可选附带本人公钥（`.asc`）。
   - **收信 / 阅读**：完整支持 **PGP/MIME（RFC 3156）** 解密与验签，同时兼容 **Inline PGP**（`BEGIN PGP MESSAGE` / `BEGIN PGP SIGNED MESSAGE`）解密与验签。
3. **明文与隐私红线**：
   - **原始 MIME 不可变**：加密/签名邮件的原始密文与签名附件字节原样存档，绝不改写原件。
   - **仅内存按需解密**：解密只在阅读详情、附件读取/保存/预览、转发附件准备时于内存中完成，**严禁将解密后的正文或附件写入 SQLite、全文搜索索引（FTS）或普通缓存文件**。
   - **AI 隔离**：已加密邮件在阅读页默认禁用 AI 翻译与 AI 摘要；写信开启加密时默认禁用写信 AI 助手，避免敏感明文外发至第三方模型接口。
   - **私钥零落盘明文**：私钥材料与可选密码短语仅存入既有 AES-256-GCM 加密的 `credentials.vault`（钥匙串主密钥 `anser-credentials-key-v2` 与 `dev.maildesk.desktop` 身份不变），不写入 SQLite、备份文件、日志或前端持久存储。

---

## 2. 技术选型（Rust 后端）

- **核心库**：`pgp = "0.21"`（rPGP，MIT / Apache-2.0 许可，MSRV 1.88，当前本机与 CI 均为 Rust 1.91.1；纯 Rust 加密内核，无 OpenSSL / Nettle / GnuPG 外部运行时依赖，macOS 双架构与 Windows MSVC 均可直接编译）。
- **MIME 编解码**：复用 `mailparse = "0.16"` 解析外层与解密后的内层 MIME；复用 `lettre = "0.11"` 构造内层邮件实体与外层 RFC 3156 `multipart/signed` / `multipart/encrypted` 报文。
- **密钥托管**：
  - SQLite 新增表 `pgp_keys`（仅存公钥元信息与 `armored_public`，绝不存私钥）：
    - `fingerprint`（主键，大写十六进制）、`key_id`（后 16 位）、`email`（小写主邮箱）、`emails_json`、`user_ids_json`、`account_id`（自有密钥绑定账号）、`is_secret`、`algorithm`、`created_at`、`expires_at`、`revoked`、`armored_public`、`source`、`updated_at`。
  - `credentials.vault` 新增条目 `pgp-secret-<FINGERPRINT>`，JSON 存 `{ "armoredSecret": "...", "passphrase": Option<String> }`。
  - 进程内内存密码短语缓存 `PgpSessionCache`（`Mutex<HashMap<String, String>>`），用于用户不保存密码短语时的单会话解锁，退出应用或手动锁定时清空。

---

## 3. 核心协议与数据流

### 3.1 阅读解密与验签（`store.detail` 与外部 EML 窗口共用）

`Detail` 新增可选字段 `pgp: Option<PgpMessageInfo>`：

- `encrypted: bool`、`encryptionState: "none" | "decrypted" | "missingKey" | "passphraseRequired" | "failed"`
- `format: "none" | "pgpMime" | "inlinePgp"`
- `decryptionKeyFingerprint: String`、`recipientKeyIds: Vec<String>`、`encryptionError: String`
- `signed: bool`、`signatureState: "none" | "valid" | "invalid" | "missingKey" | "expiredKey" | "revokedKey" | "error"`
- `signerFingerprint: String`、`signerKeyId: String`、`signerUserId: String`、`senderMatchesSigner: bool`、`signatureError: String`
- `hasAttachedPublicKey: bool`（附件中检测到 `.asc` / `application/pgp-keys` 时提示一键导入）

处理流程：
1. **PGP/MIME 加密**（`multipart/encrypted; protocol="application/pgp-encrypted"`）：
   - 校验版本段 `application/pgp-encrypted`（`Version: 1`），读取加密负载段。
   - 在内存中查找匹配私钥并解密（先试免密/凭据库密码/会话缓存密码；需密码时返回 `passphraseRequired`）。
   - 解密得到内层原始 MIME 字节后：若内层本身带嵌入式签名或为 `multipart/signed`，一并验签；用内存内层 MIME 解析正文、`html` 与附件列表，供前端渲染。
   - `save_attachment` / `attachment_thumbnail` / `open_attachment_preview` / `prepare_forward_files` 遇到加密邮件时复用同一内存解密入口按索引提取内层附件字节。
2. **PGP/MIME 签名**（`multipart/signed; protocol="application/pgp-signature"`）：
   - 精确切出第一部分原始字节（保留原始内容并按 RFC 3156 规范化 CRLF），用第二部分 `application/pgp-signature` 校验签名。
   - 核对签名密钥的 UID 邮箱是否匹配外层 `From` 邮箱（`senderMatchesSigner`），防止公钥库中其他有效密钥冒充发件人。
   - 隐藏 `signature.asc` 脱离普通附件列表，减少视觉干扰。
3. **Inline PGP**：
   - `text/plain` 含 `-----BEGIN PGP MESSAGE-----`：内存解密并检测内嵌签名，替换展示正文并标记 `encrypted = true`。
   - `text/plain` 含 `-----BEGIN PGP SIGNED MESSAGE-----`：按 RFC 4880 验签并展示还原后的签名正文。

### 3.2 写信签名与加密（`network::build_prepared_message`）

`Compose` 新增 `#[serde(default)]` 字段：
- `pgpSign: bool`
- `pgpEncrypt: bool`
- `pgpAttachPublicKey: bool`

发信管线：
1. 先按现有逻辑构建普通内层 MIME（纯文本 + HTML + 内嵌图 + 普通附件 + 转发附件 + 可选本人公钥 `.asc`）。
2. **仅签名**：将内层 MIME 规范为 CRLF，使用发件账号绑定私钥（SHA-256）生成分离签名，包装为 `multipart/signed; protocol="application/pgp-signature"; micalg="pgp-sha256"`。
3. **加密 / 签名并加密**：
   - 收集 `To + Cc + Bcc` 全部收件人邮箱对应的有效公钥；任一收件人缺失公钥则明确列出缺失地址并阻止发送。
   - **同时加密给发件人自己的公钥**，确保“已发送”本地与服务器副本可由本人解密阅读。
   - 若勾选签名，执行单层签名并加密（Sign-then-Encrypt），再包装为 `multipart/encrypted; protocol="application/pgp-encrypted"`。
4. 最终写入 `outbox`、提交 SMTP 与归档至 `Sent` 的均为标准 RFC 3156 密文/签名报文。

---

## 4. 界面与交互设计（统一使用 shadcn/ui）

1. **设置 → 阅读与写信 →「OpenPGP 加密与密钥」卡片（`src/components/openpgp-settings.tsx`）**：
   - 我的密钥区（按邮箱账号）：展示已绑定密钥指纹、算法、有效期与状态，支持「生成密钥」「导入密钥」「复制公钥」「导出公钥」「备份私钥（带危险确认弹窗）」「删除密钥」。
   - 联系人公钥区：展示全部已导入外部公钥，支持「导入 `.asc` 文件 / 粘贴公钥」「查看指纹」「导出」「删除」。
2. **通讯录集成（`src/components/contacts-panel.tsx`）**：
   - 联系人卡片若匹配到 OpenPGP 公钥，显示紧凑密钥状态图标徽章。
   - 联系人编辑弹窗中展示关联公钥指纹，提供直接导入/替换/移除公钥入口。
3. **阅读页与外部 EML 窗口（`src/components/openpgp-banner.tsx`）**：
   - 普通明文邮件不展示任何额外横幅。
   - 加密/签名邮件在正文上方展示紧凑状态栏（已加密解密、已验签、签名无效/发件人不匹配警告、缺少密钥提示、需密码短语解锁内联输入），点击可展开完整指纹与签名详情。
   - 检测到 `.asc` 公钥附件时提供一键「导入公钥」。
   - 加密邮件自动禁用 `TranslatableMailBody` 的 AI 翻译与 AI 摘要按钮并显示隐私原因提示。
4. **写信窗口（`src/components/compose-dialog.tsx`）**：
   - 底部操作栏增加紧凑 OpenPGP 弹窗触发器（显示当前签名/加密状态图标），弹出 shadcn `Popover` 控制「数字签名」「端到端加密」「附带我的公钥」，实时列出各收件人公钥就绪状态与缺失地址快捷导入入口。
   - 开启加密时禁用写信 AI 助手并提示原因。

---

## 5. 分阶段实施与验证计划

1. **阶段 1（Rust 核心引擎与存储）**：接入 `pgp = "0.21"`，实现 `src-tauri/src/openpgp.rs`（密钥生成/解析/导入导出/凭据库私钥托管、RFC 3156 签名/验签/加解密、Inline PGP 解密/验签、会话密码缓存）、SQLite `pgp_keys` 迁移与完整 Rust 单测。
2. **阶段 2（收发管线与 Tauri 命令）**：接入 `store::detail`、附件读取/预览/转发准备、`eml_files`、`network::build_prepared_message` 与全套 Tauri IPC 命令（及 `src/lib/api.ts` 演示模式桩）。
3. **阶段 3（前端 UI 与双语文案）**：实现设置页密钥管理、通讯录公钥集成、阅读页安全横幅与解锁交互、写信窗口加签加密控制、AI 隔离禁用逻辑与 `zh-CN` / `en` 双语词条。
4. **阶段 4（全量门禁与实机验收）**：通过 `pnpm check:ui`、`pnpm check:i18n`、`pnpm format:check`、`pnpm test:ci`、`pnpm build`、`pnpm build:preview`、`cargo fmt --check`、`pnpm test:rust`，并记录五阶段验收状态到 `docs/DEVELOPMENT_STATUS.md`。
