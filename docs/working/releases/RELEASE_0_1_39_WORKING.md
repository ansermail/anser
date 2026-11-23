# 0.1.39 发布工作点

更新：2026-11-07（Asia/Shanghai）。用户授权提交并正式发布；交付后恢复本地开发预览，正式安装更新由用户自行完成。

## 当前状态：正式发布与分发完成

- 固定源码 `2f46fc6b9ac08f0e68ab8ecf0820699764aa7c3d`，标签 `v0.1.39`；Release `436671297` 于 2026-11-06T15:40:16Z 公开为 latest：[正式版本](https://github.com/ansermail/anser/releases/tag/v0.1.39)。
- 本版包含阅读头部即时显示、独立可过期在线阅读缓存、阅读缓存设置卡片及跨偏好卡片保存保护。
- 官网自动部署在推送前暂停，安装器公开后恢复并部署；Pages `42245382706` 成功，线上模块核对为 0.1.39，双 DMG 和 Windows EXE 链接 HTTP 200。
- 不替换 `/Applications/雁信.app`，不在本轮执行本机正式安装或原位升级。
- GitHub Actions 的 macOS 14 镜像已于 2026-11-02 退役；首次推送后 Checks 与 Release desktop 在启动前被取消。改用 `macos-15` 后两条较重的固定页刷新用例超过原 5 秒边界，Intel runner 更慢；最终在 Arm64 `macos-15` 上仅为这两条设置 CI 30 秒边界，其他固定页用例和本地保留 5 秒。所有标签调整均在该版本生成资源和公开之前完成。

## 云端与资源审计

- [Checks 42238506819](https://github.com/ansermail/anser/actions/runs/42238506819)、[Windows validation 42238506771](https://github.com/ansermail/anser/actions/runs/42238506771)、[Release desktop 42238531277](https://github.com/ansermail/anser/actions/runs/42238531277) 均成功。
- Windows 正式安装冒烟通过 GUI 子系统、主/外部窗口无原生菜单、自定义窗口操作、真实托盘恢复、外链及关联保护。Intel/Windows 用户实机验收仍单独保留。
- 三个更新包以应用内更新公钥及 minisign 验签通过；Mac 双架构版本、架构、标识 `dev.maildesk.desktop`、中文本地化、邮件格式 Alternate 声明、固定代码签名/精确 DR 和许可资源通过。
- 双架构 DMG 只读挂载检查后已卸载，包内文件及符号链接与更新归档一致。Release body、清单 notes 与源码发布说明原文一致（2016 字节）。九个公开资源匿名下载逐字节匹配草稿，标准 latest 更新端点一致。

| 资源                                  |     字节 | SHA-256                                                            |
| ------------------------------------- | -------: | ------------------------------------------------------------------ |
| `Anser_0.1.39_aarch64.app.tar.gz`     | 13074734 | `50f0eb2d66398214fb310fb38af21eff950fbd5642a16290078ad09e7bdedd9f` |
| `Anser_0.1.39_aarch64.app.tar.gz.sig` |      424 | `d57f3793dda7418b25e6dbf2be4d1551bfb9e6cf9bb0d972b6182f2c6e313bbc` |
| `Anser_0.1.39_aarch64.dmg`            | 13646110 | `2796479fd78959caa49444ed581eded89f05af7991a82c1ca70614deb5bab6ad` |
| `Anser_0.1.39_x86_64-setup.exe`       | 10281517 | `28aade9e2fd917c015444f1c18e43916d3b0b043690453e568a00b81a0ef53b9` |
| `Anser_0.1.39_x86_64-setup.exe.sig`   |      436 | `e770b3825cda4b788b96d0e9459235234de30a138ad3a5b706590472c9559c7a` |
| `Anser_0.1.39_x86_64.app.tar.gz`      | 13695173 | `31f1983924e435c73d47e8e3914eeecce3df7e24830108908c7bb4e8be49d019` |
| `Anser_0.1.39_x86_64.app.tar.gz.sig`  |      424 | `96d15eba19d6f52c4f4c7dca2c01a88342e0097ecbb2ec44fef3e91faedfe129` |
| `Anser_0.1.39_x86_64.dmg`             | 14343963 | `9d4755546fce2b65af37c3d4aec964a3ada757d3f9251f178867dd4868bd07d7` |
| `latest.json`                         |     3899 | `e9b948c41615c123bcecf504d4d154e3529eca488355fe2fa06b08868d572346` |

## Homebrew 修复（2026-11-07）

- 首次 `42245205999` 排队 15 分钟后取消，未执行校验。第二次 `42247684016` 已通过脚本 7 项回归、双 DMG 大小/SHA-256 与 style，audit 因 `Refusing to load cask ... from untrusted tap` 失败，配方尚未提交。
- 修复提交 `49cad20` 在复制生成配方后执行 `brew trust --cask ansermail/tap/anser`，只信任单个 cask，继续保留 audit/fetch 和所有资源保护。官方依据：[Tap Trust](https://docs.brew.sh/Tap-Trust)。
- 本地显式信任后，启用 `HOMEBREW_REQUIRE_TAP_TRUST=1` 的 audit、style、Apple Silicon fetch、7 项脚本回归、工作流 Prettier 与 diff 检查均通过。
- [Homebrew 42327996645](https://github.com/ansermail/anser/actions/runs/42327996645) 完整成功，脚本/双 DMG/style/audit/fetch 均通过；自动提交 `c2adfda6985dc313395997777c9005afae6ba19c` 仅更新 Casks/anser.rb。拉取前逐字节比对本地已验证配方，随后 fast-forward；版本为 0.1.39，双 DMG 哈希与资源表一致。

## 本轮本地门槛

环境：本机 macOS / Apple Silicon，Rust 1.91.1；日志保存在仓库外 `/tmp/anser-release-0.1.39-*.log`。

- `npm run test:ci`：非 App 68 文件 391 项 + App 86 项，共 477 项通过。
- `npm run test:rust`：Rust 库 454 项通过、5 项条件忽略；二进制与文档测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --example keychain-migrate`：16 项通过、2 项既有忽略。
- `npm run test:desktop`：37 项通过。
- `cargo test --manifest-path src-tauri/vendor/imap-proto/Cargo.toml`：39 项通过。
- `npm run build`、`npm run build:preview`、`npm run release:check`、UI 铁律、i18n 1439 条双语键、Prettier、Rust fmt 与 diff 检查通过；仅有既有 Vite 分包/体积提示。
- 五处版本核对为 0.1.39：`package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json`。

## 原生开发验收

- 退出后台正式版后启动开发预览，确认 Tauri 输出 `Running` 且开发 App 为新进程。
- 打开 Gmail 与 QQ 在线阅读邮件时，发件人、收件人、主题、时间与操作栏先显示，正文区域单独显示骨架，随后正文加载完成。
- 两封在线邮件生成 `reading_cache` 记录与 `read-cache/*.eml` 文件（0600）；切走再返回第一封时正文直接显示，`last_used_at` 从 22:08:35 更新到 22:08:53。
- 设置页显示“2 封 · 68 KB”、30 天保留、1 GB 容量和清除入口；验收后停止开发预览并重新启动正式 0.1.38。
- 未发送邮件、未删除真实邮件、未执行清除缓存或完整保存，未替换正式安装包。

## 发布后开发预览恢复（2026-11-07）

- 正常退出本机后台正式应用，使用 `npm run desktop` 稳定启动器恢复预览。Tauri 编译完成并输出 `Running` 后核对开发 App PID `9617`、父进程 Tauri PID `9367`；原生窗口位于 `localhost:1420/`，三账号、邮件列表与 5,499 封本地存档正常显示。
- 正式应用收尾时已为 0.1.39，本轮未安装或替换；可执行文件 SHA-256 前后均为 `9bf31ab2d96760c5813242f5e10db27605ad4db702d693e3b26be12b5ec16047`。正式升级过程由用户完成，未旁观验收。

## 尚未验证的真实场景

- 原生缓存过期/关闭后重新拉取、完整保存后缓存移除、设置保存及清除确认仍需真实操作补验。
- 断网、磁盘不足、大附件、跨服务商长正文、Intel Mac、Windows 实机与正式包原位升级未在本轮验证。

## 下一步

1. 发布、官网与配方分发已完成；正式安装由用户自行升级，收尾时检测到安装版本已为 0.1.39，升级过程未旁观验收。
2. 继续补验尚未验证的原生缓存与真实场景路径。
