import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
export const fixedIdentity = JSON.parse(
  await readFile(new URL("signing/identity.json", import.meta.url), "utf8"),
);
export const bundleIdentifier = fixedIdentity.bundleIdentifier;
export const signingRequirement = `identifier "${bundleIdentifier}" and certificate root = H"${fixedIdentity.sha1.toLowerCase()}"`;

export function parseSigningIdentities(output) {
  // Self-signed identities need not be trusted roots to create/verify signatures.
  // Read the matching section only (the valid section repeats trusted identities).
  return [
    ...output
      .split("Valid identities only")[0]
      .matchAll(
        /^\s*\d+\)\s+([a-f\d]{40})\s+"([^"]+)"(?: \(CSSMERR_TP_NOT_TRUSTED\))?\s*$/gim,
      ),
  ].map(([, hash, name]) => ({ hash: hash.toUpperCase(), name }));
}

export function selectSigningIdentity(identities, requested = "") {
  if (
    requested &&
    requested.toUpperCase() !== fixedIdentity.sha1 &&
    requested !== fixedIdentity.name
  )
    throw new Error(
      "签名配置必须使用项目固定证书；不能切换 Apple Development 或临时签名。",
    );
  const matches = identities.filter((x) => x.hash === fixedIdentity.sha1);
  if (matches.length !== 1)
    throw new Error(
      "缺少唯一的 Anser 固定代码签名证书，请恢复私有签名备份；禁止自动创建新身份或临时签名。",
    );
  return matches[0];
}

export async function unlockLocalSigningKeychain() {
  if (process.env.CI) return;
  const directory = join(homedir(), ".config/anser-signing");
  const keychain = join(directory, "anser-signing.keychain-db");
  try {
    await access(keychain);
  } catch {
    return;
  }
  try {
    const password = await readFile(
      join(directory, "keychain-password"),
      "utf8",
    );
    await run("/usr/bin/security", [
      "unlock-keychain",
      "-p",
      password,
      keychain,
    ]);
  } catch {
    // execFile errors can contain secret command arguments; never forward them.
    throw new Error("无法解锁项目签名钥匙串，请恢复本机签名配置。");
  }
}

export async function getDevelopmentSigningIdentity(
  env = process.env,
  execute = run,
) {
  if (execute === run) await unlockLocalSigningKeychain();
  const { stdout } = await execute("/usr/bin/security", [
    "find-identity",
    "-p",
    "codesigning",
  ]);
  return selectSigningIdentity(
    parseSigningIdentities(stdout),
    env.ANSER_SIGNING_IDENTITY ||
      env.ANSER_DEV_SIGNING_IDENTITY ||
      env.YANXIN_DEV_SIGNING_IDENTITY,
  );
}

export async function verifyBundleSignature(bundle, execute = run) {
  await execute("/usr/bin/codesign", [
    "--verify",
    "--strict",
    "--deep",
    "-R",
    `=${signingRequirement}`,
    bundle,
  ]);
  const { stderr = "", stdout = "" } = await execute("/usr/bin/codesign", [
    "--display",
    "--requirements",
    "-",
    bundle,
  ]);
  // Both launch paths must have the same DR, rather than only satisfy a weaker
  // membership test while carrying an extra binary-hash restriction.
  const expected = `designated => ${signingRequirement}`;
  if (!(stderr + stdout).split("\n").some((line) => line.trim() === expected))
    throw new Error("应用 designated requirement 与固定身份不一致，停止交付。");
}

export async function signDevelopmentBundle(bundle, identity, execute = run) {
  selectSigningIdentity([identity]);
  await execute("/usr/bin/codesign", [
    "--force",
    "--sign",
    identity.hash,
    "--identifier",
    bundleIdentifier,
    "--timestamp=none",
    bundle,
  ]);
  await verifyBundleSignature(bundle, execute);
}

export function localBuildSigningConfig(identity) {
  selectSigningIdentity([identity]);
  return JSON.stringify({
    bundle: { macOS: { signingIdentity: identity.hash } },
  });
}
