import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
const repository = "ansermail/anser";
const key = path.join(os.homedir(), ".config/yanxin-release/updater.key");
const publicKey = fs.readFileSync(key + ".pub", "utf8").trim();
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
if (config.plugins.updater.pubkey !== publicKey)
  throw new Error("本机发布密钥与应用公钥不匹配；禁止覆盖已有发布密钥。");
const status = spawnSync("gh", ["auth", "status"], { stdio: "ignore" });
if (status.status !== 0)
  throw new Error("GitHub CLI 尚未登录，请先运行 gh auth login。");
const result = spawnSync(
  "gh",
  ["secret", "set", "TAURI_SIGNING_PRIVATE_KEY", "--repo", repository],
  { input: fs.readFileSync(key), stdio: ["pipe", "inherit", "inherit"] },
);
if (result.status !== 0) throw new Error("配置 GitHub 发布密钥失败。");
console.log("已配置 GitHub Actions 更新签名密钥，私钥没有写入仓库或日志。");
