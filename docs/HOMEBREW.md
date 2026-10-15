# Homebrew 分发与维护

雁信使用组织自有的 [ansermail/homebrew-tap](https://github.com/ansermail/homebrew-tap) 分发。配方位于 `Casks/anser.rb`，引用 [ansermail/anser 的正式 Release](https://github.com/ansermail/anser/releases)，支持 Apple Silicon 与 Intel，最低 macOS 12。

## 安装与更新

```sh
brew install --cask ansermail/tap/anser
brew upgrade --cask ansermail/tap/anser
```

安装命令会自动添加 Tap，选择当前 Mac 架构的 DMG 并核对 SHA-256。应用内更新仍可使用。若已有手动安装的「雁信」，先退出并备份或移走旧应用包，再交给 Homebrew 安装；不需要删除邮箱账号或存档。

当前公开应用未使用 Apple Developer ID 签名或 Apple 公证，首次打开仍可能需要在 macOS「系统设置 → 隐私与安全性」中确认。配方保留 Homebrew 的 quarantine 行为，不自动更改系统安全设置。

普通 `brew uninstall --cask ansermail/tap/anser` 只移除该配方安装的应用；配方没有 `zap` 或用户数据清理动作。邮件数据仍由应用的本地数据与存档设置管理。

## 后续版本维护

当前采用人工同步配方，没有接入跨仓库自动发布：

1. 先按 [发布流程](UPDATES.md) 完成新的桌面正式版本、两架构 DMG、签名与公开资源核验。Tap 更新不能把草稿或未核验版本提前分发。
2. 在 Tap 仓库修改 `Casks/anser.rb` 的 `version` 及 `sha256 arm:` / `intel:`。使用固定版本的 Release 下载地址，按实际文件计算 SHA-256，不使用 `sha256 :no_check`。
3. 执行 `brew style --cask ansermail/tap/anser`、`brew audit --cask ansermail/tap/anser` 和 `brew fetch --cask ansermail/tap/anser`；分别核对两架构下载链接、文件校验值及 DMG 内的 `雁信.app`。
4. 将配方提交推送到 Tap 的 `main`，重新核对公开配方。需要安装回归时使用独立 `--appdir`，不要覆盖正在测试的正式应用；记录执行架构、安装、卸载及首次打开的各自结果。
5. 在本仓库开发记录中记下 Tap 提交和验证结果。只有新增分发渠道时不提升桌面版本，也不改写已发布标签、资源、原发布说明或 `latest.json`。

## 当前配方：0.1.17（2026-10-15）

桌面正式发布和七资源公开核验后，Tap 提交 [`6f4bb79`](https://github.com/ansermail/homebrew-tap/commit/6f4bb790b3e0d5d199498d69853241205725b240) 已推送 main；远端 SHA 与匿名公开配方均核对一致。

| 架构 | DMG | SHA-256 |
| --- | --- | --- |
| Apple Silicon | `Anser_0.1.17_aarch64.dmg` | `5667493345306b36087789e88ac443f3e614a0c29531fe4ab644f4278c55761b` |
| Intel | `Anser_0.1.17_x86_64.dmg` | `225f73d89f3c8aa16ffe8f3944e34d0aa25b4508ad2bbc214a2b22b4de545061` |

`brew style`、`brew audit`、Apple Silicon 的 `brew fetch` 通过，两架构公开 DMG 均核对大小/摘要、包内版本与代码签名，并与更新归档逐文件匹配。本轮未安装或覆盖现有应用，0.1.17 Homebrew 安装/升级及 Intel 实机运行尚未验证；首次 0.1.16 的临时目录安装记录如下，不沿用为新版本验收。

## 首次发布与实际验证

2026-10-14 创建公开仓库并推送配方，提交 [ea1418f](https://github.com/ansermail/homebrew-tap/commit/ea1418ffd9a4f9b95eefac4a90ebef53d0d95f6b)。首个版本为既有的 **0.1.16**：

| 架构 | DMG | SHA-256 |
| --- | --- | --- |
| Apple Silicon | `Anser_0.1.16_aarch64.dmg` | `d90c4fcc77b74a1b613c212f732daa7a41f5e59d4fb66af4575cd895115a69b8` |
| Intel | `Anser_0.1.16_x86_64.dmg` | `5f315662c31bc27bf9de2e7766b1f762a588cadddb4aed7bbf616f8917b15a51` |

- `brew style` 与 `brew audit` 通过；Apple Silicon 的 `brew fetch` 通过，Intel DMG 公开下载并核对 SHA-256 通过。
- 2026-10-15 在 Apple Silicon Mac / Homebrew 7.0.9 上，从公开仓库重新 `brew tap ansermail/tap`，随后执行 `brew install --cask --appdir=/tmp/anser-homebrew-install-20261015 ansermail/tap/anser`，实际安装成功。
- 安装副本版本为 0.1.16、标识为 `dev.maildesk.desktop`，`codesign --verify --deep --strict` 通过。严格代码签名通过不等于 Gatekeeper 认可或公证通过。
- 普通 `brew uninstall --cask ansermail/tap/anser` 成功清理临时安装；原 `/Applications/雁信.app` 二进制 SHA-256 前后相同。未启动测试副本或操作真实邮件。
- Intel 实机安装、首次 Gatekeeper 确认和未来版本的 Homebrew 升级尚未验证。首次验证时，打印面板中文修复是本机未提交工作，不在该 0.1.16 公开安装包中；此修复现已随 0.1.17 发布。
