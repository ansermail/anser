import test from "node:test";
import assert from "node:assert/strict";
import {
  fixedIdentity,
  getDevelopmentSigningIdentity,
  localBuildSigningConfig,
  parseSigningIdentities,
  selectSigningIdentity,
  signDevelopmentBundle,
  signingRequirement,
  verifyBundleSignature,
} from "./mac-dev-signing.mjs";
const certificate = { hash: fixedIdentity.sha1, name: fixedIdentity.name };
const other = {
  hash: "A".repeat(40),
  name: "Apple Development: Example (TEAM123)",
};

test("parse matching identities including untrusted self-signed certificate, excluding expired and duplicate valid section", () => {
  assert.deepEqual(
    parseSigningIdentities(
      `Policy: Code Signing\n Matching identities\n1) ${certificate.hash} "${certificate.name}" (CSSMERR_TP_NOT_TRUSTED)\n2) ${other.hash} "${other.name}" (CSSMERR_TP_CERT_EXPIRED)\n Valid identities only\n1) ${certificate.hash} "${certificate.name}"`,
    ),
    [certificate],
  );
});
test("development and local release require the exact pinned project certificate", () => {
  assert.deepEqual(selectSigningIdentity([other, certificate]), certificate);
  assert.deepEqual(JSON.parse(localBuildSigningConfig(certificate)), {
    bundle: { macOS: { signingIdentity: certificate.hash } },
  });
  for (const requested of ["-", other.name, other.hash])
    assert.throws(
      () => selectSigningIdentity([certificate, other], requested),
      /固定证书/,
    );
  assert.throws(() => selectSigningIdentity([other]), /缺少唯一/);
  assert.throws(
    () => selectSigningIdentity([certificate, certificate]),
    /缺少唯一/,
  );
  assert.deepEqual(
    selectSigningIdentity([certificate], certificate.hash.toLowerCase()),
    certificate,
  );
});
test("legacy environment overrides remain compatible only for the same pinned certificate", async () => {
  for (const name of [
    "ANSER_SIGNING_IDENTITY",
    "ANSER_DEV_SIGNING_IDENTITY",
    "YANXIN_DEV_SIGNING_IDENTITY",
  ]) {
    const identity = await getDevelopmentSigningIdentity(
      { [name]: certificate.name },
      async (file, args) => {
        assert.equal(file, "/usr/bin/security");
        assert.deepEqual(args, ["find-identity", "-p", "codesigning"]);
        return {
          stdout: `1) ${certificate.hash} "${certificate.name}" (CSSMERR_TP_NOT_TRUSTED)`,
        };
      },
    );
    assert.deepEqual(identity, certificate);
  }
});
test("sign complete bundle and verify exact stable DR before launch", async () => {
  const calls = [];
  const bundle = "/tmp/path with spaces/雁信.app";
  await signDevelopmentBundle(bundle, certificate, async (...args) => {
    calls.push(args);
    return {
      stderr: `Executable=${bundle}\ndesignated => ${signingRequirement}\n`,
    };
  });
  assert.deepEqual(calls, [
    [
      "/usr/bin/codesign",
      [
        "--force",
        "--sign",
        certificate.hash,
        "--identifier",
        "dev.maildesk.desktop",
        "--timestamp=none",
        bundle,
      ],
    ],
    [
      "/usr/bin/codesign",
      [
        "--verify",
        "--strict",
        "--deep",
        "-R",
        `=${signingRequirement}`,
        bundle,
      ],
    ],
    ["/usr/bin/codesign", ["--display", "--requirements", "-", bundle]],
  ]);
});
test("verification rejects hash-based or additional restrictions even if membership test succeeded", async () => {
  for (const dr of ['cdhash H"abc"', `${signingRequirement} and cdhash H"abc"`])
    await assert.rejects(
      verifyBundleSignature("/tmp/雁信.app", async () => ({
        stderr: `designated => ${dr}\n`,
      })),
      /designated requirement/,
    );
});
test("signing failure never falls back", async () => {
  let count = 0;
  await assert.rejects(
    signDevelopmentBundle("/tmp/雁信.app", certificate, async () => {
      count++;
      throw new Error("denied");
    }),
    /denied/,
  );
  assert.equal(count, 1);
});
