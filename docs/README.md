# 雁信（Anser）项目文档索引

本目录按“长期入口文档 / 设计方案 / 发布说明 / 阶段工作点 / 辅助资源”分类维护，保持根目录精简并保证外部链接与构建脚本路径稳定。

## 目录结构

```text
docs/
├── README.md               # 本索引与文档归类约定
├── USAGE.md                # 功能与使用说明
├── DEVELOPMENT_STATUS.md   # 开发计划与继续检查点
├── IMPLEMENTATION.md       # 架构实施与验收状态
├── UPDATES.md              # 发布与应用内更新流程
├── HOMEBREW.md             # Homebrew 分发与维护
├── KEYCHAIN.md             # 本地加密凭据库与项目固定签名
├── WINDOWS.md              # Windows 客户端说明与验收清单
├── LICENSING.md            # 使用许可与商业授权说明
├── plans/                  # 功能设计与实施方案
├── releases/               # 面向用户的正式版本发布说明（v0.1.x）
├── working/                # 阶段性开发、走查、排查与发版工作点
│   ├── features/           # 功能开发、UI/UX 走查与问题排查工作点
│   └── releases/           # 各版本构建、签名与发版审计工作点
├── experiments/            # 独立实验脚本与性能探针
├── licenses/               # 第三方开源许可原件
└── screenshots/            # 文档展示与视觉基线截图
```

## 核心长期文档

| 文档 | 用途 |
| --- | --- |
| [USAGE.md](USAGE.md) | 面向用户与开发者的功能说明、数据行为、邮箱配置及本地开发运行方式 |
| [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) | 当前开发执行检查点、验收记录、剩余限制与下一步入口 |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | 架构设计、协议/存储实现细节与阶段验收状态 |
| [UPDATES.md](UPDATES.md) | 版本构建、代码签名、发布流水线与应用内更新说明 |
| [HOMEBREW.md](HOMEBREW.md) | Homebrew Cask 同仓库分发、迁移与校验维护流程 |
| [KEYCHAIN.md](KEYCHAIN.md) | `credentials.vault` 加密凭据库与项目固定签名设计 |
| [WINDOWS.md](WINDOWS.md) | Windows 10/11 客户端适配边界与真实桌面验收清单 |
| [LICENSING.md](LICENSING.md) | 个人自用许可边界与商业授权说明（同时随安装包分发） |

## 分类目录

- **设计方案（[`plans/`](plans/)）**：专项功能的架构与交互设计方案（`*_PLAN.md`），当前包含 [写信编辑器升级方案](plans/COMPOSE_EDITOR_PLAN.md) 与 [EML 邮件导入方案](plans/EML_IMPORT_PLAN.md)。
- **正式发布说明（[`releases/`](releases/)）**：按版本号 `v<主>.<次>.<修订>.md` 归档，由 `scripts/release-assets.mjs` 与 `scripts/release-draft.mjs` 读取并同步至更新清单和 GitHub Release。
- **阶段工作点（[`working/`](working/)）**：
  - [`working/features/`](working/features/)：功能开发、联调、UI/UX 走查与故障排查的过程工作点（`*_WORKING.md`）。
  - [`working/releases/`](working/releases/)：各版本云端构建、产物审计与分发核验工作点（`RELEASE_*_WORKING.md` 等）。
- **辅助资源**：
  - [`screenshots/`](screenshots/)：README 与设计文档引用的演示截图及视觉基线，详见 [screenshots/README.md](screenshots/README.md)。
  - [`experiments/`](experiments/)：不接入主工程的独立性能/规模实验代码。
  - [`licenses/`](licenses/)：随包分发的第三方许可原文。

## 新增文档约定

- **长期有效、面向用户或发布流水线直接引用的核心文档**：继续维护在 `docs/` 根目录，避免破坏官网、README、许可声明或打包脚本的固定路径。
- **新功能设计/评审方案**：放入 `docs/plans/`，命名为 `<TOPIC>_PLAN.md`。
- **新功能开发、走查或故障排查工作点**：放入 `docs/working/features/`，命名为 `<TOPIC>_WORKING.md`。
- **新版本发版审计工作点**：放入 `docs/working/releases/`，命名为 `RELEASE_<主>_<次>_<修订>_WORKING.md`；面向用户的正式发版说明继续放在 `docs/releases/v<版本>.md`。
- **文档截图与图片素材**：统一放入 `docs/screenshots/` 并在 `docs/screenshots/README.md` 记录来源与脱敏情况。
