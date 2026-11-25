# Anser（雁信）Agent 开发指南

本文件保存项目核心定位、不可违背的工程红线与按需加载的专题规范索引。每次开始开发先阅读本文件，再按改动领域读取对应专题规范；用户的新要求优先，确认适用后将长期约定同步维护到对应规范文档（涉及核心红线或索引变化时同步更新本文件）。具体进度、版本与验收结果写入开发记录，不在此堆积易过期状态。

## 项目概览

- **名称与技术栈**：中文名 **雁信**、英文名 **Anser**；技术栈为 **React 19 / TypeScript / shadcn/ui / Tauri 2 / Rust / SQLite**，客户端支持 **macOS（Apple Silicon / Intel）** 与 **Windows 10/11 x64（WebView2）**，共用界面、邮件协议与原始 MIME 存档格式。
- **唯一仓库地址**：代码、Issues、Actions、Release 与应用内链接统一使用 **https://github.com/ansermail/anser**，`origin` 为 `git@github.com:ansermail/anser.git`（个人旧仓库已放弃，但旧客户端未完成迁移前勿删除旧仓）。
- **许可方向**：个人自用免费（含处理个人工作邮件），企业统一部署、商业集成或销售需书面授权；对外称“源码公开”，严禁宣称 MIT / Apache / GPL，以根目录 [LICENSE](LICENSE) 与 [docs/LICENSING.md](docs/LICENSING.md) 为准。
- **代码目录**：
  - `src/components/`：业务界面组件；`src/components/ui/`：shadcn/ui 官方基础组件；`src/lib/`：前端数据与格式逻辑；`src/locales/`：中英文国际化配置
  - `src-tauri/src/`：邮件协议、SQLite 索引、MIME 存档、凭据库与后台任务
  - `scripts/`：构建、签名、UI/i18n 检查与发版脚本；`.github/workflows/`：CI、Windows 验证、发布、Homebrew 与 Pages 流水线
  - `docs/`：长期文档、工程规范（`docs/guidelines/`）、设计方案（`docs/plans/`）、发布说明（`docs/releases/`）与阶段工作点（`docs/working/`），结构见 [docs/README.md](docs/README.md)

## 核心硬性约束（全局必守）

1. **开工检查与持续记录**：
   - 先检查 `git status`、当前分支及 `origin`（保留已有未提交工作）；先读 [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) 当前执行检查点及对应 `docs/working/` 下的 `*_WORKING.md`。
   - 阶段完成、方向调整、阻塞或中断前更新 `docs/DEVELOPMENT_STATUS.md`（及对应工作点、`USAGE.md` / `IMPLEMENTATION.md` / `UPDATES.md`）。
   - **代码完成、自动测试通过、真实场景验收、云端构建、正式发布**五阶段必须分别记录，未执行项明确写“未验证”，禁止沿用旧结果。阶段提交对应实际范围，未验收分支不混入正式发布。
2. **UI 铁律（用户明确要求）**：
   - **所有界面组件统一使用 shadcn/ui（`new-york` / Radix），禁止自行实现基础 UI 组件或混入其他组件体系**（写信「AI 助手」对话区使用 `assistant-ui` 官方 React primitives + shadcn 外壳）。
   - 新增、调整或走查 UI 时，先读 [docs/UI_DESIGN_GUIDELINES.md](docs/UI_DESIGN_GUIDELINES.md)（基于 Topinspo Design Vocabulary 的排版/留白/层级/对比度/组件/验收通用基线），再遵循 [docs/guidelines/ui-design.md](docs/guidelines/ui-design.md) 的页面与组件专项约定。
   - 禁用业务界面的原生 `date`/`time`/`datetime-local`、`datalist`、`confirm`/`prompt`/`alert`，以及 24/60 项小时/分钟长下拉菜单。
3. **国际化（i18n）**：
   - 所有固定文案集中维护在 `src/locales/` 简体中文与 English JSON 中，新增或修改同步双语键与插值参数并运行 `pnpm check:i18n`；不翻译用户邮件内容、服务器路径、协议身份、原件或历史日志。
4. **数据、存档、协议与隐私红线**：
   - 完整原始 MIME 原件不可变，附件保留原字节；解析/显示修复仅改派生索引。
   - 应用持久身份 `dev.maildesk.desktop`、`credentials.vault` 与钥匙串条目 `anser-credentials-key-v2` 不可更改；密码、令牌、密钥、OAuth 私密配置、更新私钥与真实邮件严禁进入 Git、发布包、截图、公开日志或备份。
   - 严禁伪造 IMAP `UID/UIDVALIDITY`、复用失步连接、对结果不明的发件自动重发、修改 Windows `UserChoice` 绕过默认应用确认，或实现已明确取消的 IMAP 服务器导入。
   - 开发预览（`pnpm desktop`）与本地/云端打包沿用免费项目固定自签身份，不回退临时签名；Rust 重编译期间待 Tauri 输出 `Running` 后再操作原生 UI。
5. **真实收发测试授权边界**：
   - 仅允许使用当前已登录的**腾讯企业邮箱 ↔ QQ 邮箱**互发“雁信联调”无敏感数据测试邮件；收件人/抄送/密送严禁包含其他地址（Gmail 已登录不扩大发信授权）；测试修改及时恢复，不顺手迁移、移动或删除真实存档。

## 按需加载规范索引

改动涉及对应领域时，**必须先读取**下表对应文档，严格遵守其中的细则与防回归约束：

| 任务领域 | 必读规范文档 | 复用 / 关联文档 |
| --- | --- | --- |
| **UI 设计与交互**（Topinspo 视觉基线/间距留白/层级圆角/对比度、shadcn 组件选型、主题选区、设置页、TanStack 表格、阅读/写信/工作台布局、菜单栏） | [docs/UI_DESIGN_GUIDELINES.md](docs/UI_DESIGN_GUIDELINES.md)、[docs/guidelines/ui-design.md](docs/guidelines/ui-design.md) | `scripts/check-ui.mjs` |
| **前端开发**（i18n、正文隔离 iframe/深色/外链、单封打印、Tiptap/Markdown 写信与草稿、快捷键、`/demo/` 预览） | [docs/guidelines/frontend.md](docs/guidelines/frontend.md) | [写信编辑器方案](docs/plans/COMPOSE_EDITOR_PLAN.md)、[docs/USAGE.md](docs/USAGE.md) |
| **Rust 后端与协议**（MIME 存档、附加外置分层、SQLite、IMAP/IDLE/SMTP、代理、规则引擎、本地导入、外部 EML 窗口、`mailto:`） | [docs/guidelines/rust-backend.md](docs/guidelines/rust-backend.md) | [EML 导入方案](docs/plans/EML_IMPORT_PLAN.md)、[docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) |
| **AI 功能与 Agent 协作**（写信 AI 助手、双语翻译/摘要/工作报告协议，开发记录维护、开发预览时序、截图脱敏） | [docs/guidelines/ai-and-agent.md](docs/guidelines/ai-and-agent.md) | [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md)、[docs/screenshots/README.md](docs/screenshots/README.md) |
| **架构、平台与安全**（跨平台架构、官网与 Pages、持久身份与固定签名、凭据库、OAuth 装包核对、许可边界） | [docs/guidelines/architecture-and-security.md](docs/guidelines/architecture-and-security.md) | [docs/WINDOWS.md](docs/WINDOWS.md)、[docs/KEYCHAIN.md](docs/KEYCHAIN.md)、[docs/HOMEBREW.md](docs/HOMEBREW.md)、[docs/LICENSING.md](docs/LICENSING.md) |
| **性能优化**（短事务与锁边界、SQLite 分页/游标/WAL 快照、FTS 候选检索、正文防抖与统计像素过滤） | [docs/guidelines/performance.md](docs/guidelines/performance.md) | [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) |
| **测试、验收与发布**（分层门禁、jsdom 超时定界、真实收发范围、原生实机验收、四文件版本核对、九资源发版与更新中心） | [docs/guidelines/testing-and-release.md](docs/guidelines/testing-and-release.md) | [docs/UPDATES.md](docs/UPDATES.md)、[docs/WINDOWS.md](docs/WINDOWS.md)、[docs/HOMEBREW.md](docs/HOMEBREW.md) |

## 常用验证命令速查

```sh
# 日常按改动范围执行
pnpm check:ui && pnpm check:i18n && pnpm format:check
pnpm test:changed                             # 或 pnpm test:related -- <file>
pnpm build                                    # 生产构建（含 check:ui / check:i18n / tsc）
pnpm build:preview                            # 官网与 /demo/ 预览隔离构建检查
pnpm test:desktop                             # 桌面/发布脚本测试
pnpm test:mac-print                           # macOS 打印布局验证（需先 pnpm build）
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
pnpm test:rust                                # Rust 后端回归
git diff --check

# 发布前完整门槛（同时参照 .github/workflows/ci.yml）
pnpm release:check && pnpm test:ci && pnpm test:desktop && pnpm build && pnpm test:rust
cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml
```
