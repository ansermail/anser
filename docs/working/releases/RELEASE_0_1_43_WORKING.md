# 0.1.43 发布工作点

更新于 2026-11-18，时区 Asia/Shanghai。

## 已公开并完成分发

- 固定源码为 `a5c6545dce7f110ec3b45383361558a65c3787ba`，注释标签为 `v0.1.43`。暂存对象及固定提交的五处版本均独立核对通过。
- Release ID 为 `449495466`，于 2026-11-18 11:43:45 公开为 latest。[正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.43)
- 本版包含工作台日历、四象限、看板、报告、编辑抽屉改进和各视图右键删除。[完整发布说明](../../releases/v0.1.43.md)
- [Release desktop 44227978366](https://github.com/ansermail/anser/actions/runs/44227978366) 的检查、macOS arm64、macOS x86_64、Windows x64 与草稿汇总全部成功。Windows 正式安装、启动、GUI 子系统和真实托盘恢复冒烟通过。
- [Checks 44227978627](https://github.com/ansermail/anser/actions/runs/44227978627) 与 [Windows validation 44227978477](https://github.com/ansermail/anser/actions/runs/44227978477) 全部成功。
- 九份正式资源大小与 SHA-256、说明原文及末尾换行、三平台更新签名、Mac 双架构元数据/固定签名/精确 designated requirement/语言/文件关联/许可、DMG 与更新归档内容一致性均已核验。八份安装/更新文件及签名与独立下载的 Actions 产物逐字节一致。
- 九份资源已通过匿名下载并与草稿内容逐字节比较，标准公开 latest.json 与审计清单一致。三个安装器公开访问均返回 HTTP 200。
- [Homebrew 44232434715](https://github.com/ansermail/anser/actions/runs/44232434715) 的 style/audit/fetch 成功，配方提交 `a97510d` 仅修改 `Casks/anser.rb`，版本与双 DMG SHA-256 均已独立核对。
- Chromium 在线核对首页显示 0.1.43，macOS 的两个 DMG 与切换到 Windows 后的 EXE 链接均指向公开的 0.1.43。
- 发布前暂缓 Preview Pages，安装器公开可下载后重新启用并触发。[Preview Pages 44232543903](https://github.com/ansermail/anser/actions/runs/44232543903) 的构建与部署成功。

## 本地发布门槛

- 完整前端初次执行为 570 通过、3 失败。既有签名组件测试桩缺少 `publicPreview` 导出，补齐 `false` 后按 CI 分组执行 `npm run test:ci`，73 文件 482 项及 App 单文件 91 项全部通过，共 74 文件 573 项。
- Rust 472 项通过、5 项条件忽略。桌面脚本 37 项、vendored IMAP 39 项通过。钥匙串迁移示例 16 项通过、2 项条件忽略。
- 生产构建、Pages 构建、UI 铁律、1800 条双语键、Prettier、Rust fmt、发布资源配置及 diff 检查通过。
- 用户原有未跟踪文件 `Gemini 4 Argon-High-蝴蝶标本.html` 保留本地，本次提交范围为客户端、测试和相关文档。

## 本机恢复与验收范围

复核时本机运行的是 `/Applications/雁信.app/Contents/MacOS/anser`，版本为 0.1.42，严格签名和固定 designated requirement 有效。开发进程已退出，1420 开发端口已释放。0.1.43 的本机升级由用户自行执行，尚未旁观验收。

工作台原生菜单、取消删除及红线显示已在 macOS 开发版核对。Windows/Intel 实机使用和原位升级仍待验收，相关入口保留在 [工作台记录](../features/WORKBENCH_WORKING.md)。

## 正式资源

| 资源 | 字节 | SHA-256 |
|---|---:|---|
| `Anser_0.1.43_aarch64.app.tar.gz` | 13421773 | `b8945ae5cb023557cb8bb0992c3a9c3549749e31373038261c6f52f471746f66` |
| `Anser_0.1.43_aarch64.app.tar.gz.sig` | 424 | `1bdad22562e341046ecc0f52464ee90bd187b8b8a7d4462d8f6f9f09c073f2f6` |
| `Anser_0.1.43_aarch64.dmg` | 13958555 | `047062245fe3b0b408cf05c5e4acbd91c47a1a8f3e0c122eae7a05979435e962` |
| `Anser_0.1.43_x86_64-setup.exe` | 10582973 | `ca539692565941d9205a7875e85804f8ed55601ca0888722845f326b6b5ad79d` |
| `Anser_0.1.43_x86_64-setup.exe.sig` | 436 | `860d19f8e3af57ad4101905a2bfa3a6d420abd26476d229312513fab20883168` |
| `Anser_0.1.43_x86_64.app.tar.gz` | 14046553 | `9b6ce0a3e4e2180fa85ada6936086d04bd49379c6daffc667825a6ed13221df9` |
| `Anser_0.1.43_x86_64.app.tar.gz.sig` | 424 | `f8f79305109ca5242ee9ad9fa7548972a5efebc1c9ff5b920cb26701c1c6c52f` |
| `Anser_0.1.43_x86_64.dmg` | 14700310 | `abb3def400cca242cbedef46f4f1319570c897c3253fbcc25847a4befb7f0e54` |
| `latest.json` | 3049 | `5038f0dd65fba698d5e8d08f1e0f8802d6120c29887985d22cbf2283e3ccf335` |
