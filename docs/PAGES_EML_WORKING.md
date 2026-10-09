# 分支、Pages 与 EML 接续点

更新：2026-10-09；分支 main；功能源码提交 ed5b6b1b6dda96da186d00b0441b2c14ba0adfa7，开始提交 ef6cb2d。此前 RULES-03 分支保留不动。

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
- 已提交并推送组织 main；[Preview Pages 37938288994](https://github.com/ansermail/anser/actions/runs/37938288994) 2026-10-09 21:39（Asia/Shanghai）部署成功；[Checks 37938289003](https://github.com/ansermail/anser/actions/runs/37938289003) 21:41 成功，含 195 前端、242 Rust、39 vendored IMAP、19 脚本及 UI/格式/生产构建。
- [公开页面](https://ansermail.github.io/anser/) 已浏览器实际核验：共用三栏、图标及完整布局样式，虚构账号、示例正文阅读、最新签名/关于设置均正常；添加账号禁用、原生 IPC 不存在。预览 JS/CSS 基路径为 /anser/，不包含真实邮箱数据。
- 本阶段之后已由 GitHub 发布 0.1.6（RELEASE_016_WORKING.md）；正式包 EML 声明已核验，安装后默认打开及冷启动、大文件/供应商损坏 EML 矩阵仍待验收。不得修改用户默认应用或真实邮件做无关测试。
- 完成本轮后回 SETTINGS_NEXT_WORKING.md / codex/rules03-in-progress，先合入 main 最新改动再继续规则保存开发。
