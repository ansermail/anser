# Homebrew 同仓库维护工作点（2026-10-17）

## 当前状态：0.1.23 自动同步验证通过（2026-10-20）

- [Homebrew 运行 39363711322](https://github.com/ansermail/anser/actions/runs/39363711322) 成功，主仓库 [配方提交 43b96d6](https://github.com/ansermail/anser/commit/43b96d67dd1578401e9065674fec116b23c6e93d) 仅更新 Casks/anser.rb；重复核验 [39363835908](https://github.com/ansermail/anser/actions/runs/39363835908) 成功并返回 `Cask is already current; no commit needed.`。配方与两架构公开 DMG 摘要一致，本机 brew style/audit/Apple Silicon fetch 通过；未覆盖安装本机应用。

- 0.1.21 于 2026-10-18 11:14:23（Asia/Shanghai）发布后，`release.published` 自动触发 [Homebrew 流水线 39092910712](https://github.com/ansermail/anser/actions/runs/39092910712)，脚本回归、两架构 DMG 下载/摘要、style/audit/fetch 与提交前复核全部成功，主仓库提交 [1c85297](https://github.com/ansermail/anser/commit/1c852970a9c1686a72b0daca8caf1fb30f4c5f6a) 仅更新 `Casks/anser.rb`。
- 手动复核 [39092992802](https://github.com/ansermail/anser/actions/runs/39092992802) 成功并返回 `Cask is already current; no commit needed.`；本机更新 Tap 后对 0.1.21 执行 `brew style`、`brew audit`、Apple Silicon `brew fetch` 再次通过，未安装或覆盖应用。
- 功能提交 `c6f3426247ad76a965123832fbadc04f3b8b71e0` 已推送组织 main，主仓库公开配方 blob 为 `16178275f2ac2172291a01d217bdd85832804a71`。
- [Update Homebrew Cask 39009167177](https://github.com/ansermail/anser/actions/runs/39009167177) 对现有 0.1.20 执行成功（50 秒）：脚本回归、两架构公开 DMG 校验、style/audit/Apple Silicon fetch 和提交前复核均通过。配方已一致，日志确认 `Cask is already current; no commit needed.`，没有制造自动提交。
- 本机既有 `ansermail/tap` 从旧仓库成功切到 `https://github.com/ansermail/anser`；按文档执行限定该 Tap 路径的 update-reset 后，`brew info` 确认完整 token 仍为 `ansermail/tap/anser`，版本 0.1.20、架构 URL 和 SHA-256 正确。操作前 Tap 工作区干净，未安装或覆盖应用。
- 迁移后本机原 Tap 的 `brew style`、`brew audit` 与 Apple Silicon `brew fetch` 再次全部通过，临时验证 Tap 已清理。
- 自动化首次真实写入新版本的路径已由 0.1.21 验证；单文件写入、blob SHA 条件、幂等、旧版本与同版本摘要保护均有专项运行或回归覆盖。未重建/改写已发布 Release、标签或七资源，未操作旧远端仓库。

## 目标与入口

- 用户要求配方在主仓库维护，更新流水线，避免单独维护 `ansermail/homebrew-tap`。
- 起点为 `main / b2e89e1`，工作区干净，origin 为 `git@github.com:ansermail/anser.git`。当前正式版本为 0.1.23；配方自动化不自行提升桌面版本或改写已发布资源。
- `Casks/anser.rb` 引用已公开核验的 0.1.23 两架构 DMG；旧 Tap 历史保留，安装名称继续为 `ansermail/tap/anser`。

## 已实现

- `homebrew.yml` 在正式 Release 发布或 main 手动 dispatch 后运行，从 main 检出脚本，使用本仓库 token。
- `homebrew.mjs` 有界下载公开双架构 DMG，核对长度/摘要和 latest 身份；Homebrew 校验后再次核对，通过单文件 blob SHA 条件更新 main，重复无变化不写，旧版/同版摘要变化/并发冲突停止。
- README、USAGE、HOMEBREW、UPDATES、IMPLEMENTATION 与 AGENTS 已更新，迁移命令保留原安装身份；无需跨仓库密钥。

## 验证与下一步

- 新增脚本回归 7 项已通过，覆盖不合格版本、缺失/重复/异常资源、下载长度/散列、latest 变化、语义版本倒退、幂等提交及并发冲突。
- `npm run test:desktop` 35 项通过；`npm run format:check`、`npm run release:check`、`git diff --check` 与 workflow YAML 解析通过。`node scripts/homebrew.mjs generate` 已真实下载两架构公开 0.1.20 DMG，大小/摘要/最新版本复核通过，生成内容与初始配方一致。
- 临时本机 Tap `ansermail/cask-check` 从本工作区 Git 克隆并复制候选配方后，`brew style`、`brew audit`、Apple Silicon `brew fetch` 通过；未安装/覆盖应用。Node 直接 fetch 在本机网络超时，下载入口已统一改为有期限/容量限制、仅 HTTPS 的 curl，兼容主机代理环境；真实双架构下载已复核通过。
- 功能源码完整 [Checks 39009166252](https://github.com/ansermail/anser/actions/runs/39009166252) 已全部成功（4 分 39 秒），覆盖格式、前端、脚本、生产构建、Rust 与 IMAP vendor；专项与迁移结果见顶部。0.1.21 已核对 release 事件自动更新配方；如使用 `GITHUB_TOKEN` 发布 Release 或事件未衔接，仍须显式 dispatch。
- 真实安装/原位升级与 Intel 实机仍保持独立边界。
