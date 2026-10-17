import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  selectRelease,
  renderCask,
  verifyDownload,
  rejectRollback,
  prepareCask,
  publishCask,
} from "./homebrew.mjs";

const bytes = Buffer.from("synthetic DMG bytes");
function fixture(version = "0.1.21") {
  return {
    id: 42,
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    published_at: "2026-10-17T05:57:05Z",
    assets: ["aarch64", "x86_64"].map((arch, i) => ({
      id: i + 10,
      name: `Anser_${version}_${arch}.dmg`,
      browser_download_url: `https://github.com/ansermail/anser/releases/download/v${version}/Anser_${version}_${arch}.dmg`,
      state: "uploaded",
      size: bytes.length,
      digest: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
    })),
  };
}
const download = async () => new Response(bytes);
test("only published latest stable releases with both exact official DMGs qualify", () => {
  assert.equal(selectRelease(fixture(), "v0.1.21").version, "0.1.21");
  for (const mutate of [
    (r) => {
      r.draft = true;
    },
    (r) => {
      r.prerelease = true;
    },
    (r) => {
      r.published_at = null;
    },
    (r) => {
      r.tag_name = "v0.1.21\nend";
    },
    (r) => {
      r.assets.pop();
    },
    (r) => {
      r.assets.push(r.assets[0]);
    },
    (r) => {
      r.assets[0].digest = null;
    },
    (r) => {
      r.assets[0].size = 300 * 1024 * 1024;
    },
    (r) => {
      r.assets[0].browser_download_url = "https://example.com/installer";
    },
    (r) => {
      r.assets[0].state = "new";
    },
  ]) {
    const release = fixture();
    mutate(release);
    assert.throws(() => selectRelease(release));
  }
  assert.throws(() => selectRelease(fixture(), "v0.1.20"), /not latest/);
});
test("public downloads require exact byte length and SHA-256, with a deadline and no credentials", async () => {
  const asset = selectRelease(fixture()).dmgs[0];
  await verifyDownload(asset, async (url, options) => {
    assert.equal(url, asset.url);
    assert(options.signal instanceof AbortSignal);
    assert.equal(options.headers, undefined);
    return new Response(bytes);
  });
  for (const response of [
    new Response("failed", { status: 404 }),
    new Response(bytes.subarray(1)),
    new Response(Buffer.alloc(bytes.length)),
    new Response(Buffer.concat([bytes, bytes])),
  ])
    await assert.rejects(() => verifyDownload(asset, async () => response));
});
test("release changes and lookup failures stop generation", async () => {
  let reads = 0;
  await assert.rejects(
    () =>
      prepareCask(
        {
          api() {
            return fixture(++reads === 1 ? "0.1.21" : "0.1.22");
          },
        },
        "",
        download,
      ),
    /changed during verification/,
  );
  await assert.rejects(
    () =>
      prepareCask(
        {
          api() {
            throw Error("lookup failed");
          },
        },
        "",
        download,
      ),
    /lookup failed/,
  );
});
test("semantic versions prevent rollback including two-digit version components", () => {
  rejectRollback('  version "0.1.9"', "0.1.20");
  rejectRollback('  version "0.1.20"', "0.1.20");
  assert.throws(
    () => rejectRollback('  version "0.1.20"', "0.1.9"),
    /rollback/,
  );
  assert.throws(
    () => rejectRollback('  version "1.0.0"', "0.99.99"),
    /rollback/,
  );
});
function publisher(previous = "0.1.20", remote = fixture()) {
  const calls = [];
  return {
    calls,
    api(endpoint, options) {
      if (options) {
        calls.push({ endpoint, ...options });
        return { commit: { sha: "b".repeat(40) } };
      }
      if (endpoint.endsWith("/releases/latest")) return remote;
      return {
        type: "file",
        encoding: "base64",
        sha: "a".repeat(40),
        content: Buffer.from(
          renderCask(selectRelease(fixture(previous))),
        ).toString("base64"),
      };
    },
  };
}
test("publishing updates only the main cask with its existing blob SHA; repeats do not write", () => {
  const release = selectRelease(fixture());
  const content = renderCask(release);
  const client = publisher();
  assert.equal(
    publishCask(client, { release, content }, content),
    "b".repeat(40),
  );
  assert.equal(client.calls.length, 1);
  const write = client.calls[0];
  assert.equal(write.endpoint, "repos/ansermail/anser/contents/Casks/anser.rb");
  assert.equal(write.method, "PUT");
  assert.equal(write.body.branch, "main");
  assert.equal(write.body.sha, "a".repeat(40));
  assert.equal(Buffer.from(write.body.content, "base64").toString(), content);
  const repeat = publisher("0.1.21");
  assert.equal(publishCask(repeat, { release, content }, content), null);
  assert.equal(repeat.calls.length, 0);
});
test("unvalidated content, new latest, rollback and same-version digest changes cannot commit", () => {
  const release = selectRelease(fixture());
  const content = renderCask(release);
  for (const [client, validated] of [
    [publisher(), content + "changed"],
    [publisher("0.1.22"), content],
    [publisher("0.1.20", fixture("0.1.22")), content],
  ]) {
    assert.throws(() => publishCask(client, { release, content }, validated));
    assert.equal(client.calls.length, 0);
  }
  const changed = structuredClone(release);
  changed.dmgs[0].digest = "sha256:" + "f".repeat(64);
  const client = publisher("0.1.21");
  // Metadata must match on recheck, but an existing same-version cask has the old digest.
  const remote = fixture();
  remote.assets[0].digest = changed.dmgs[0].digest;
  const original = client.api;
  client.api = function (endpoint, options) {
    return endpoint.endsWith("/releases/latest")
      ? remote
      : original.call(this, endpoint, options);
  };
  assert.throws(
    () =>
      publishCask(
        client,
        { release: changed, content: renderCask(changed) },
        renderCask(changed),
      ),
    /Same-version/,
  );
  assert.equal(client.calls.length, 0);
});
test("a compare-and-swap conflict propagates without retrying a write", () => {
  const client = publisher();
  const original = client.api;
  client.api = function (endpoint, options) {
    if (options) {
      this.calls.push(options);
      throw Error("409 conflict");
    }
    return original.call(this, endpoint);
  };
  const release = selectRelease(fixture());
  const content = renderCask(release);
  assert.throws(
    () => publishCask(client, { release, content }, content),
    /409/,
  );
  assert.equal(client.calls.length, 1);
});
