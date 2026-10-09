# 分支、Pages 与 EML 接续点

更新：2026-10-09；分支 main，开始提交 ef6cb2d。此前 RULES-03 分支保留不动。

## 已完成

- 归档旧发布工作树并删除已合入 main 的 codex/release-0.1.3；保留 rules03 WIP。
- Tailwind 明确 src 扫描、Pages 复用 App，删除独立 PreviewApp；构建时替换原生模块，内存示例数据隔离、连接/收发/本机操作禁用、构建检查脚本。
- EML 只读解析/正文/原始日期/附件预览和另存、64 MB 上限、令牌及原件覆盖保护；系统 Opened/启动参数及排队，正式/开发包共用文件关联配置。
- 本地浏览器预览视觉及三栏几何检查；开发包运行中系统打开样例，正文/日期和 TextEdit 附件预览通过。

## 验证与待办

- `cargo test --manifest-path src-tauri/Cargo.toml`：242 项通过；追加原件覆盖保护后 EML 4 项复验通过。
- `npm test`：192 项曾通过，追加 EML 3 项专项通过，最终 195 项全量通过。
- `npm run test:desktop`：19 项通过。
- `npm run build`、`npm run build:preview`（含样式/IPC 检查）、`npm run format:check`、UI 检查通过；提交前 diff/fmt 核对通过。
- 待提交并推送组织 main，核验 Preview Pages 与 Checks，记录提交/流水线地址；公开页面需实际刷新检查共享界面和布局。
- 未发新桌面包；安装后默认打开及冷启动、大文件/供应商损坏 EML 矩阵待验收。不得修改用户默认应用或真实邮件做无关测试。
- 完成本轮后回 SETTINGS_NEXT_WORKING.md / codex/rules03-in-progress，先合入 main 最新改动再继续规则保存开发。
