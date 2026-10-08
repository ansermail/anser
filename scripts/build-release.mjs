import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { loadOAuthEnvironment } from "./oauth-env.mjs";
const config = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const key = path.join(os.homedir(), ".config/yanxin-release/updater.key");
const env = await loadOAuthEnvironment(process.cwd());
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  if (!fs.existsSync(key))
    throw new Error(
      "缺少更新签名密钥。发布者请恢复 ~/.config/yanxin-release/updater.key；仅本地构建可使用 tauri build --config 覆盖 createUpdaterArtifacts=false。",
    );
  if (
    fs.readFileSync(key + ".pub", "utf8").trim() !==
    config.plugins.updater.pubkey
  )
    throw new Error("本机密钥与应用公钥不匹配，停止构建。");
  env.TAURI_SIGNING_PRIVATE_KEY = key;
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
}
const child = spawn(
  path.resolve("node_modules/.bin/tauri"),
  ["build", "--bundles", "app", ...process.argv.slice(2)],
  { env, stdio: "inherit" },
);
child.on("error", (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
