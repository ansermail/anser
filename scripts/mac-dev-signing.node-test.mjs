import test from "node:test";
import assert from "node:assert/strict";
import {
  getDevelopmentSigningIdentity,
  parseSigningIdentities,
  selectSigningIdentity,
  signDevelopmentBundle,
} from "./mac-dev-signing.mjs";

const certificate = {
  hash: "A".repeat(40),
  name: "Apple Development: Example (TEAM123)",
};
const second = {
  hash: "B".repeat(40),
  name: "Apple Development: Other (TEAM456)",
};

test("only valid numbered identities are parsed, without invalid or expired entries", () => {
  assert.deepEqual(
    parseSigningIdentities(`
  1) ${certificate.hash} "${certificate.name}"
  2) ${second.hash} "${second.name}" (CSSMERR_TP_CERT_EXPIRED)
     1 valid identities found
`),
    [certificate],
  );
});

test("automatic selection requires exactly one development identity", () => {
  const distribution = {
    hash: "C".repeat(40),
    name: "Developer ID Application: Example (TEAM123)",
  };
  assert.deepEqual(
    selectSigningIdentity([distribution, certificate]),
    certificate,
  );
  assert.throws(() => selectSigningIdentity([]), /需要固定/);
  assert.throws(() => selectSigningIdentity([certificate, second]), /多个/);
});

test("explicit identity is exact, unique, and cannot downgrade to ad hoc signing", () => {
  assert.deepEqual(
    selectSigningIdentity([certificate, second], second.hash.toLowerCase()),
    second,
  );
  assert.deepEqual(
    selectSigningIdentity([certificate, second], certificate.name),
    certificate,
  );
  assert.throws(
    () => selectSigningIdentity([certificate], "-"),
    /不能使用临时签名/,
  );
  assert.throws(
    () => selectSigningIdentity([certificate], "Example"),
    /唯一有效/,
  );
  assert.throws(
    () => selectSigningIdentity([certificate, certificate], certificate.name),
    /唯一有效/,
  );
});

test("certificate discovery only lists identities and honors the explicit override", async () => {
  const identity = await getDevelopmentSigningIdentity(
    { YANXIN_DEV_SIGNING_IDENTITY: second.name },
    async (file, args) => {
      assert.equal(file, "/usr/bin/security");
      assert.deepEqual(args, ["find-identity", "-v", "-p", "codesigning"]);
      return {
        stdout: `1) ${certificate.hash} "${certificate.name}"\n2) ${second.hash} "${second.name}"`,
      };
    },
  );
  assert.deepEqual(identity, second);
});

test("sign the complete bundle with the unchanged ID and verify before launch", async () => {
  const calls = [];
  const bundle = "/tmp/path with spaces/雁信.app";
  await signDevelopmentBundle(bundle, certificate, async (...args) => {
    calls.push(args);
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
    ["/usr/bin/codesign", ["--verify", "--strict", bundle]],
  ]);
});

test("signing failure is propagated without verification or a fallback signature", async () => {
  let count = 0;
  await assert.rejects(
    signDevelopmentBundle("/tmp/雁信.app", certificate, async () => {
      count += 1;
      throw new Error("signing denied");
    }),
    /signing denied/,
  );
  assert.equal(count, 1);
});
test("Anser override takes priority while the prior environment name stays compatible", async () => {
  const identity = await getDevelopmentSigningIdentity(
    {
      ANSER_DEV_SIGNING_IDENTITY: certificate.name,
      YANXIN_DEV_SIGNING_IDENTITY: second.name,
    },
    async () => ({
      stdout: `1) ${certificate.hash} "${certificate.name}"\n2) ${second.hash} "${second.name}"`,
    }),
  );
  assert.deepEqual(identity, certificate);
});
