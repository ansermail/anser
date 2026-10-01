import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
let runnerDirectory;
if (process.platform === "darwin") {
  // Cargo still builds an ASCII executable; launch it inside a named app bundle.
  // A single runner path also works when the checkout or Node path has spaces.
  runnerDirectory = await mkdtemp(join(tmpdir(), "yanxin-runner-"));
  const runner = join(runnerDirectory, "run.mjs");
  await writeFile(
    runner,
    `#!/usr/bin/env node\nawait import(${JSON.stringify(new URL("mac-dev-runner.mjs", import.meta.url).href)});\n`,
  );
  await chmod(runner, 0o755);
  env.CARGO_TARGET_AARCH64_APPLE_DARWIN_RUNNER = runner;
  env.CARGO_TARGET_X86_64_APPLE_DARWIN_RUNNER = runner;
}
const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
const child = spawn(process.execPath, [cli, "dev", ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", async (code) => {
  if (runnerDirectory)
    await rm(runnerDirectory, { recursive: true, force: true });
  process.exitCode = code ?? 1;
});
