import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDevelopmentSigningIdentity,
  signDevelopmentBundle,
} from "./mac-dev-signing.mjs";

const [binary, ...args] = process.argv.slice(2);
if (!binary) throw new Error("缺少开发版可执行文件");
if (typeof process.execve !== "function")
  throw new Error(
    "macOS 开发预览需要 Node.js 22.15 或更新版本，以正确管理应用重启。",
  );
const signingIdentity = await getDevelopmentSigningIdentity();
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
await signDevelopmentBundle(bundle, signingIdentity);
// Replace the Cargo runner in place. Tauri owns this exact PID and can stop
// it during Rust rebuilds, including SIGKILL; spawning a child orphaned the
// app and left another Dock icon after every rebuild.
process.execve(executable, [executable, ...args], process.env);
