// Import the same encrypted certificate used locally. No Apple trust changes.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  fixedIdentity,
  getDevelopmentSigningIdentity,
  localBuildSigningConfig,
  verifyBundleSignature,
} from "./mac-dev-signing.mjs";

function security(args) {
  try {
    return execFileSync("/usr/bin/security", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(`签名钥匙串操作失败：${args[0]}（诊断已隐藏敏感参数）`);
  }
}
const directory = process.env.RUNNER_TEMP;
if (!process.env.CI || !directory)
  throw new Error("仅供隔离的 CI runner 使用。");
const keychain = path.join(directory, "anser-signing.keychain-db");
const searchBackup = path.join(directory, "anser-signing-search.json");
const p12 = path.join(directory, "anser-identity.p12");
const mode = process.argv[2];
if (mode === "cleanup") {
  if (fs.existsSync(searchBackup)) {
    security([
      "list-keychains",
      "-d",
      "user",
      "-s",
      ...JSON.parse(fs.readFileSync(searchBackup, "utf8")),
    ]);
    fs.rmSync(searchBackup);
  }
  if (fs.existsSync(keychain)) security(["delete-keychain", keychain]);
  fs.rmSync(p12, { force: true });
} else if (mode === "verify") {
  await verifyBundleSignature(process.argv[3]);
  console.log(
    `App signature / DR matches pinned certificate ${fixedIdentity.sha1}`,
  );
} else if (mode === "import") {
  const encoded = process.env.ANSER_CODESIGN_P12_BASE64;
  const password = process.env.ANSER_CODESIGN_P12_PASSWORD;
  if (!encoded || !password)
    throw new Error("缺少固定项目签名证书 Secrets；禁止回退临时签名。");
  const search = [
    ...security(["list-keychains", "-d", "user"]).matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
  fs.writeFileSync(searchBackup, JSON.stringify(search), { mode: 0o600 });
  const keyPassword = randomBytes(32).toString("hex");
  fs.writeFileSync(p12, Buffer.from(encoded, "base64"), { mode: 0o600 });
  try {
    security(["create-keychain", "-p", keyPassword, keychain]);
    security(["set-keychain-settings", "-lut", "21600", keychain]);
    security(["unlock-keychain", "-p", keyPassword, keychain]);
    security([
      "import",
      p12,
      "-k",
      keychain,
      "-P",
      password,
      "-T",
      "/usr/bin/codesign",
    ]);
    security([
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:",
      "-s",
      "-k",
      keyPassword,
      keychain,
    ]);
    security(["list-keychains", "-d", "user", "-s", ...search, keychain]);
    const identity = await getDevelopmentSigningIdentity();
    // Pin the certificate itself as well as the private-key identity.
    const cert = execFileSync(
      "openssl",
      [
        "x509",
        "-in",
        "scripts/signing/anser-codesign.crt",
        "-noout",
        "-fingerprint",
        "-sha1",
      ],
      { encoding: "utf8" },
    );
    if (
      cert.trim().split("=")[1].replaceAll(":", "").toUpperCase() !==
      identity.hash
    )
      throw new Error("仓库证书与 CI 私钥指纹不匹配。");
    fs.appendFileSync(
      process.env.GITHUB_ENV,
      `APPLE_SIGNING_IDENTITY=${identity.hash}\n`,
    );
    fs.writeFileSync(
      "anser-signing.config.json",
      localBuildSigningConfig(identity),
    );
    console.log(`Imported fixed Anser signing identity: ${identity.hash}`);
  } finally {
    fs.rmSync(p12, { force: true });
  }
} else throw new Error("Unknown signing action");
