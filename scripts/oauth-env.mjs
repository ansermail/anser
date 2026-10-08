import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

const keys = [
  "MAIL_GOOGLE_CLIENT_ID",
  "MAIL_GOOGLE_CLIENT_SECRET",
  "MAIL_MICROSOFT_CLIENT_ID",
];

// Only backend OAuth settings are loaded. Never expose them via VITE_* or
// allow a local config file to replace signing keys and executable paths.
export async function loadOAuthEnvironment(root, inherited = process.env) {
  const env = { ...inherited };
  let config;
  try {
    config = parseEnv(await readFile(join(root, ".env.local"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return env;
    throw new Error(
      "无法读取本地 OAuth 配置 .env.local，请检查文件权限和格式。",
    );
  }
  for (const key of keys) {
    if (env[key] === undefined && config[key] !== undefined)
      env[key] = config[key];
  }
  return env;
}
