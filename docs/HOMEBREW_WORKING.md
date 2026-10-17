# Homebrew 同仓库维护工作点（2026-10-17）

## 目标与入口

- 用户要求配方在主仓库维护，更新流水线，避免单独维护 `ansermail/homebrew-tap`。
- 起点为 `main / b2e89e1`，工作区干净，origin 为 `git@github.com:ansermail/anser.git`。当前正式版本仍为 0.1.20，本项不提升桌面版本或改写资源。
- `Casks/anser.rb` 引用已公开核验的 0.1.20 两架构 DMG；旧 Tap 历史保留，安装名称继续为 `ansermail/tap/anser`。

## 已实现

- `homebrew.yml` 在正式 Release 发布或 main 手动 dispatch 后运行，从 main 检出脚本，使用本仓库 token。
- `homebrew.mjs` 有界下载公开双架构 DMG，核对长度/摘要和 latest 身份；Homebrew 校验后再次核对，通过单文件 blob SHA 条件更新 main，重复无变化不写，旧版/同版摘要变化/并发冲突停止。
- README、USAGE、HOMEBREW、UPDATES、IMPLEMENTATION 与 AGENTS 已更新，迁移命令保留原安装身份；无需跨仓库密钥。

## 验证与下一步

- 新增脚本回归 7 项已通过，覆盖不合格版本、缺失/重复/异常资源、下载长度/散列、latest 变化、语义版本倒退、幂等提交及并发冲突。
- `npm run test:desktop` 35 项通过；`npm run format:check`、`npm run release:check`、`git diff --check` 与 workflow YAML 解析通过。`node scripts/homebrew.mjs generate` 已真实下载两架构公开 0.1.20 DMG，大小/摘要/最新版本复核通过，生成内容与初始配方一致。
- 临时本机 Tap `ansermail/cask-check` 从本工作区 Git 克隆并复制候选配方后，`brew style`、`brew audit`、Apple Silicon `brew fetch` 通过；未安装/覆盖应用。Node 直接 fetch 在本机网络超时，下载入口已统一改为有期限/容量限制、仅 HTTPS 的 curl，兼容主机代理环境；真实双架构下载已复核通过。
- 下一步提交主仓库，手动触发当前 0.1.20 的 Homebrew 专项流水线，再验证本机 Tap 切换。
- 云端运行、主仓库公开配方、本机 Tap 切换尚未验证。真实安装/原位升级与 Intel 实机仍保持独立边界。
