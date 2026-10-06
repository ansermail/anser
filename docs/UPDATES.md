# 发布与应用内更新

## 用户流程

正式应用启动后自动检查更新，之后每 6 小时再检查。只有检测到新版本才在“本地优先”前显示更新图标。设置与账号中的“关于与更新”始终提供手动检查。

点击更新图标 → 查看版本与发布说明 → 下载更新（显示进度）→ 校验签名 → 安装并重启。Tauri 更新器替换当前应用所在位置，后续无需把应用重新拖入 Applications。写信窗口打开时禁止安装；重启前等待正在进行的收取/发送完成并保存窗口状态。

开发预览允许检查，禁止下载安装覆盖开发实例。首次安装仍需使用 DMG；旧版本如果没有更新器，需要先安装含更新器的版本。当前未有 Apple Developer ID 证书，未做签名公证；Tauri 更新签名用于校验来源，不等同于 Apple 的签名公证。更换应用代码签名身份时，钥匙串可能要求重新授权。

## 已配置的流水线

- `.github/workflows/ci.yml`：main 推送和 PR 执行前端/脚本/Rust 回归及 UI 检查和生产构建。
- `.github/workflows/release.yml`：推送 `v*` tag，或 Actions 手动运行；验证版本、发布说明和测试后，分别构建 Apple Silicon 与 Intel Mac 的 DMG、app.tar.gz 与签名。
- 构建任务只产出架构独立的 artifacts；汇总任务检查两个架构文件齐全，统一生成 latest.json 并创建草稿 Release，避免并行写清单丢失架构。
- 发布后的同版本不可覆盖。草稿可重跑上传；`releases/latest/download/latest.json` 只有正式发布后才可用。用户检查不读取草稿。
- 仓库是公开的 `yn-zxj/yanxin`；客户端不包含 GitHub token。端点仅 HTTPS，签名必须有效；失败时保留当前安装，不执行重启。

## 签名密钥

本机更新密钥在 `~/.config/yanxin-release/updater.key`，权限 0600，公钥已写入 Tauri 配置。私钥已上传仓库 Secret `TAURI_SIGNING_PRIVATE_KEY`，没有提交到 Git 或写进日志。密钥没有密码，流水线明确使用空密码；应保管仓库外的密钥备份，后续版本复用同一密钥，不能重新生成替换已部署应用的公钥。

换开发机时恢复原密钥和 `.pub` 文件，然后运行 `npm run release:secrets`。脚本先验证公钥匹配和 GitHub 登录，只通过 stdin 上传密钥。

## 下次发布

1. 同步修改 package.json、package-lock.json（npm install --package-lock-only）、src-tauri/Cargo.toml、Cargo.lock 和 tauri.conf.json 的版本。
2. 写 `docs/releases/v版本.md`，运行 `npm run release:check` 和回归，提交并推送。
3. 推送对应 `v版本` tag，或者运行 `gh workflow run release.yml --ref main`。
4. 等待两架构构建和草稿生成，核验 DMG、app.tar.gz、sig、latest.json 和版本说明；再发布草稿。首次 v0.1.0 属于 Alpha，不代表开发计划全部完成。
5. 用含更新器的旧正式版检查新版本、下载安装并重启，确认账号、本地存档、窗口及新版本号。

## 验收记录

本地 120 项前端、170 项 Rust、13 项脚本回归及 UI/TypeScript/生产构建通过。前端覆盖无更新隐藏、有更新展示、下载先于安装、签名失败不安装、重复检查保护、重启失败只重启不重复安装、写信中阻止安装和开发预览保护。真实 GitHub Actions 构建和正式安装升级的结果以开发检查点记录为准，不能把模拟交互测试计为真实升级验收。
