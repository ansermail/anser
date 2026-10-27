import { spawn } from "node:child_process";
import path from "node:path";
import { loadOAuthEnvironment } from "./oauth-env.mjs";

if (process.platform !== "win32") throw new Error("Run this build on Windows.");
const env = await loadOAuthEnvironment(process.cwd());
if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
  for (const key of [
    "MAIL_GOOGLE_CLIENT_ID",
    "MAIL_GOOGLE_CLIENT_SECRET",
    "MAIL_MICROSOFT_CLIENT_ID",
  ])
    if (!env[key])
      throw new Error(`Missing desktop OAuth configuration: ${key}`);
}
// This is a validation installer, not a published update. Release builds use
// the shared signing key and release workflow instead.
const child = spawn(
  process.execPath,
  [
    path.resolve("node_modules/@tauri-apps/cli/tauri.js"),
    "build",
    "--target",
    "x86_64-pc-windows-msvc",
    "--bundles",
    "nsis",
    "--config",
    JSON.stringify({
      build: { beforeBuildCommand: "" },
      bundle: { createUpdaterArtifacts: false },
    }),
  ],
  { env, stdio: "inherit" },
);
child.on("error", () => {
  console.error("Windows build could not start.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
