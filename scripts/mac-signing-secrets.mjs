// Publisher-only: restore the existing project identity, never generate a new one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { fixedIdentity } from "./mac-dev-signing.mjs";
const directory = path.join(os.homedir(), ".config/anser-signing");
const p12 = path.join(directory, "identity.p12");
const password = fs.readFileSync(path.join(directory, "p12-password"), "utf8");
let certificate;
try {
  certificate = execFileSync(
    "openssl",
    ["pkcs12", "-in", p12, "-passin", "env:ANSER_P12_PASSWORD", "-nokeys"],
    {
      env: { ...process.env, ANSER_P12_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    },
  );
} catch {
  throw new Error("无法读取加密签名备份，未修改 GitHub Secrets。");
}
if (
  new X509Certificate(certificate).fingerprint.replaceAll(":", "") !==
  fixedIdentity.sha1
)
  throw new Error("签名备份与固定公开指纹不一致，禁止上传。");
for (const [name, value] of [
  ["ANSER_CODESIGN_P12_BASE64", fs.readFileSync(p12).toString("base64")],
  ["ANSER_CODESIGN_P12_PASSWORD", password],
]) {
  const result = spawnSync(
    "gh",
    ["secret", "set", name, "--repo", "ansermail/anser"],
    { input: value, stdio: ["pipe", "ignore", "pipe"] },
  );
  if (result.status !== 0)
    throw new Error(`配置 ${name} 失败，敏感参数未输出。`);
  console.log(`Configured GitHub Actions secret ${name}`);
}
