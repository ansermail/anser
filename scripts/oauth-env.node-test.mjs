import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOAuthEnvironment } from "./oauth-env.mjs";

test("OAuth config stays backend-only and explicit environment takes precedence", async () => {
  const root = await mkdtemp(join(tmpdir(), "yanxin-oauth-env-"));
  try {
    const inherited = {
      MAIL_GOOGLE_CLIENT_ID: "explicit-client",
      PATH: "safe",
    };
    assert.deepEqual(await loadOAuthEnvironment(root, inherited), inherited);
    await writeFile(
      join(root, ".env.local"),
      [
        'MAIL_GOOGLE_CLIENT_ID="local-client"',
        'MAIL_GOOGLE_CLIENT_SECRET="synthetic-secret"',
        'MAIL_MICROSOFT_CLIENT_ID="microsoft-client"',
        'VITE_GOOGLE_CLIENT_SECRET="must-not-load"',
        'TAURI_SIGNING_PRIVATE_KEY="must-not-load"',
        'PATH="must-not-load"',
      ].join("\n"),
    );
    assert.deepEqual(await loadOAuthEnvironment(root, inherited), {
      ...inherited,
      MAIL_GOOGLE_CLIENT_SECRET: "synthetic-secret",
      MAIL_MICROSOFT_CLIENT_ID: "microsoft-client",
    });
    assert.equal(inherited.MAIL_GOOGLE_CLIENT_SECRET, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read failures never include config contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "yanxin-oauth-env-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, ".env.local"));
    await assert.rejects(
      loadOAuthEnvironment(root, {}),
      /无法读取本地 OAuth 配置/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
