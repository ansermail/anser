import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [binary, ...args] = process.argv.slice(2);
if (!binary) throw new Error("缺少开发版可执行文件");
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = join(dirname(resolve(binary)), "dev-app", "雁信.app");
const contents = join(bundle, "Contents");
await mkdir(join(contents, "MacOS"), { recursive: true });
await mkdir(join(contents, "Resources"), { recursive: true });
const executable = join(contents, "MacOS", "yanxin");
await rm(executable, { force: true });
await copyFile(resolve(binary), executable);
await copyFile(
  join(root, "src-tauri/icons/icon.icns"),
  join(contents, "Resources/icon.icns"),
);
await writeFile(
  join(contents, "Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>雁信</string>
<key>CFBundleDisplayName</key><string>雁信</string>
<key>CFBundleExecutable</key><string>yanxin</string>
<key>CFBundleIdentifier</key><string>dev.maildesk.desktop</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`,
);
const child = spawn(executable, args, { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
