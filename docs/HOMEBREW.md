# Homebrew 分发与维护

配方直接位于主仓库 [ansermail/anser](https://github.com/ansermail/anser) 的 `Casks/anser.rb`，与源码、测试和流水线一起维护。安装名称继续使用 `ansermail/tap/anser`；显式 URL 让 Homebrew 读取主仓库，无需额外的 `homebrew-*` 仓库。支持 Apple Silicon 与 Intel，最低 macOS 12。

## 安装与更新

```sh
brew tap --custom-remote ansermail/tap https://github.com/ansermail/anser
brew install --cask ansermail/tap/anser
```

后续更新：

```sh
brew update
brew upgrade --cask ansermail/tap/anser
```

安装命令会自动添加 Tap，选择当前 Mac 架构的 DMG 并核对 SHA-256。应用内更新仍可使用。若已有手动安装的「雁信」，先退出并备份或移走旧应用包，再交给 Homebrew 安装；不需要删除邮箱账号或存档。

当前公开应用未使用 Apple Developer ID 签名或 Apple 公证，首次打开仍可能需要在 macOS「系统设置 → 隐私与安全性」中确认。配方保留 Homebrew 的 quarantine 行为，不自动更改系统安全设置。

普通 `brew uninstall --cask ansermail/tap/anser` 只移除该配方安装的应用；配方没有 `zap` 或用户数据清理动作。邮件数据仍由应用的本地数据与存档设置管理。

## 已有旧 Tap 的迁移

原 `ansermail/homebrew-tap` 的历史记录保留，后续配方在主仓库更新。已添加旧 Tap 的用户执行一次：

```sh
brew tap --custom-remote ansermail/tap https://github.com/ansermail/anser
brew update-reset "$(brew --repository ansermail/tap)"
```

第二条命令仅将这个 Tap 的 Git 检出切到新仓库的默认分支；若手工修改过 Tap 配方或提交过本地改动，先备份这些改动。保留 Tap 名称和 cask token，因此无需卸载或重装已有应用；此步骤不启动应用、不修改账号与存档。随后照常更新。

## 正式发布后的自动更新

1. `release.yml` 继续完成测试、双架构构建、签名和七资源草稿；按既有流程独立审计后公开为 latest。
2. `homebrew.yml` 响应 `release.published`，从 `main` 读取脚本，只接受组织仓库当前 latest 的正式稳定版本；下载两架构公开 DMG，核对大小和 GitHub SHA-256，再生成配方。
3. 运行脚本回归、`brew style`、`brew audit` 和当前 runner 架构的 `brew fetch`。再次核对公开资源与 latest 后，以配方 blob SHA 为条件，仅向 `main` 提交 `Casks/anser.rb`。旧版本、同版本摘要变化、资源不完整和并发冲突均停止；内容相同不会提交。
4. 使用本仓库 `GITHUB_TOKEN` 的 `contents: write`，无需 PAT 或跨仓库 Secret。自动提交不触发新的桌面发版，不改版本号、标签、Release 资源或更新清单。默认 token 创建的提交不会再次触发普通 push 流水线，Homebrew 专项校验已在提交前完成。

对已经发布但尚未同步的版本，可以手动运行（不重建桌面包）：

```sh
gh workflow run homebrew.yml --repo ansermail/anser --ref main -f tag=v0.1.20
```

省略 `tag` 则选择当前 latest。通过 `GITHUB_TOKEN` 发布 Release 不会再触发 `release.published`，此时应显式 dispatch；本地 `gh release edit` 或人工发布可触发事件。发布自动化若改变，须保留这条衔接。

本地只生成和核对配方：`node scripts/homebrew.mjs generate`，不会写远端。测试入口为 `npm run test:desktop`。实际安装、原位升级与 Intel 实机运行仍单独验收，不能用配方和下载校验代替。

## 迁移前发布记录

以下 Tap 提交均为当时的发布证据；迁移后的验证另见 [工作点](HOMEBREW_WORKING.md)。

## 0.1.20 配方初次发布（2026-10-17）

[Tap 4db8165](https://github.com/ansermail/homebrew-tap/commit/4db8165d2a553080365b4f8cacb80c8912137c25) 已公开，配方、公开两架构 DMG 摘要及 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。 本版 Homebrew 安装/升级与 Intel 实机未验证；不沿用旧版首次安装验收。

| 架构 | DMG | SHA-256 |
| --- | --- | --- |
| Apple Silicon | `Anser_0.1.20_aarch64.dmg` | `a261a9f63ddc2e9db911fef010fb64b60529802a054dcd7d25f37a313b081d98` |
| Intel | `Anser_0.1.20_x86_64.dmg` | `b2ffcde117e960ed5bb5147a7fa310501c377a1adc6f0043cf1ecd584e81def4` |

## 前一配方：0.1.19（2026-10-16）

[Tap 18a6820](https://github.com/ansermail/homebrew-tap/commit/18a6820f2385e340ce094b202b172ddf1e5fa7f0) 已公开，配方/公开两架构 DMG 摘要及 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。 本版 Homebrew 安装/升级与 Intel 实机未验证；不沿用旧版首次安装验收。

| 架构 | DMG | SHA-256 |
| --- | --- | --- |
| Apple Silicon | `Anser_0.1.19_aarch64.dmg` | `752fbc733a5d8fe9beac0e9eb2fdfb69a464cc935340c429eacc164f7d69afa0` |
| Intel | `Anser_0.1.19_x86_64.dmg` | `5586549faca22cf78d0620572f83d1bd48dfae0ac67f79a1fa3a6a2deac0d7b3` |

## 前一配方：0.1.18（2026-10-16）

正式资源公开核验后，Tap 提交 [870f4b4](https://github.com/ansermail/homebrew-tap/commit/870f4b43a48e9fc9cbd31ec9da51ed15a2147406) 已推送并核对远端 SHA 及匿名公开配方。brew style、brew audit、Apple Silicon brew fetch 通过，两架构公开 DMG 核对大小/摘要及包内版本/签名/内容一致性。未执行 0.1.18 Homebrew 安装/升级或 Intel 实机运行，首次安装记录仅对应旧版本。

| 架构 | DMG | SHA-256 |
| --- | --- | --- |
| Apple Silicon | `Anser_0.1.18_aarch64.dmg` | `c522ed9a0536ca0296a01da94f1b674afa7f9ed34a94fb070932e339fb531ce7` |
| Intel | `Anser_0.1.18_x86_64.dmg` | `c21a446ba32f7e518d44a8604cd6c3f7e8c4beb1272a8bd9bf30421481133471` |

## 前一配方：0.1.17（2026-10-15）

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
