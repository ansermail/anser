import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const identityVariable = "ANSER_DEV_SIGNING_IDENTITY";
export const bundleIdentifier = "dev.maildesk.desktop";

export function parseSigningIdentities(output) {
  return [
    ...output.matchAll(/^\s*\d+\)\s+([a-f\d]{40})\s+"([^"]+)"\s*$/gim),
  ].map(([, hash, name]) => ({ hash: hash.toUpperCase(), name }));
}

export function selectSigningIdentity(identities, requested = "") {
  if (requested) {
    const matches = identities.filter(
      (identity) =>
        identity.hash === requested.toUpperCase() ||
        identity.name === requested,
    );
    if (matches.length !== 1)
      throw new Error(
        `${identityVariable} 必须指定唯一有效的代码签名证书名称或 SHA-1；不能使用临时签名。`,
      );
    return matches[0];
  }
  const development = identities.filter((identity) =>
    identity.name.startsWith("Apple Development:"),
  );
  if (development.length !== 1)
    throw new Error(
      development.length === 0
        ? `开发预览需要固定的代码签名证书，以避免每次重建再次请求钥匙串密码。请在 Xcode 中创建 Apple Development 证书，或通过 ${identityVariable} 指定已有证书。`
        : `找到多个 Apple Development 证书，请通过 ${identityVariable} 指定证书名称或 SHA-1。`,
    );
  return development[0];
}

export async function getDevelopmentSigningIdentity(
  env = process.env,
  execute = run,
) {
  const { stdout } = await execute("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  return selectSigningIdentity(
    parseSigningIdentities(stdout),
    env[identityVariable] || env.YANXIN_DEV_SIGNING_IDENTITY,
  );
}

export async function signDevelopmentBundle(bundle, identity, execute = run) {
  // The linker signature uses the executable hash as its requirement, which
  // changes on rebuild. A certificate + bundle ID keeps Keychain's app identity
  // stable. Never change credential ACLs or fall back to ad hoc signing.
  await execute("/usr/bin/codesign", [
    "--force",
    "--sign",
    identity.hash,
    "--identifier",
    bundleIdentifier,
    "--timestamp=none",
    bundle,
  ]);
  await execute("/usr/bin/codesign", ["--verify", "--strict", bundle]);
}
