import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspectRelease, updateDraft, releaseFiles } from "./release-draft.mjs";

const sha = "a".repeat(40),
  oldSha = "b".repeat(40),
  tag = "v1.2.3";
function fixture({ published = false, target = null, absent = false } = {}) {
  const calls = [];
  let release = {
    id: 123,
    tag_name: tag,
    draft: !published,
    target_commitish: oldSha,
    body: "old notes",
  };
  let exists = !absent;
  const client = {
    api(endpoint, options) {
      calls.push({ endpoint, options });
      if (endpoint === "graphql")
        return {
          data: {
            repository: {
              nameWithOwner: "ansermail/anser",
              release: exists
                ? {
                    databaseId: release.id,
                    tagName: tag,
                    isDraft: release.draft,
                  }
                : null,
              ref: target ? { target } : null,
            },
          },
        };
      if (endpoint.includes("/git/tags/"))
        return { object: { type: "commit", sha } };
      if (options?.body) {
        release = { ...release, ...options.body };
        exists = true;
      }
      return { ...release };
    },
    upload(tag, files) {
      calls.push({ upload: tag, files });
    },
  };
  return {
    client,
    calls,
    options: { tag, sha, notes: "new notes\nwith lines", files: ["first.dmg"] },
  };
}

test("existing draft source and notes update before assets, and stay unpublished", () => {
  const { client, calls, options } = fixture();
  assert.equal(updateDraft(client, options), 123);
  const patch = calls.find((call) => call.options?.method === "PATCH");
  assert.equal(patch.options.body.target_commitish, sha);
  assert.equal(patch.options.body.body, options.notes);
  assert.equal(patch.options.body.draft, true);
  assert.ok(calls.indexOf(patch) < calls.findIndex((call) => call.upload));
});

test("new release is only created as a draft for the exact source", () => {
  const { client, calls, options } = fixture({ absent: true });
  updateDraft(client, options);
  const create = calls.find((call) => call.options?.method === "POST");
  assert.equal(create.endpoint, "repos/ansermail/anser/releases");
  assert.equal(create.options.body.target_commitish, sha);
  assert.equal(create.options.body.draft, true);
});

test("published release skips build inspection and rejects every mutation", () => {
  const { client, calls, options } = fixture({ published: true });
  assert.equal(inspectRelease(client, tag, sha).published, true);
  assert.throws(() => updateDraft(client, options), /immutable/);
  assert.ok(calls.every((call) => call.endpoint === "graphql"));
});

test("conflicting lightweight tag rejects before metadata or assets change", () => {
  const { client, calls, options } = fixture({
    target: { __typename: "Commit", oid: oldSha },
  });
  assert.throws(() => updateDraft(client, options), /another source/);
  assert.equal(calls.length, 1);
});

test("annotated tag must peel to the exact source", () => {
  const { client, calls, options } = fixture({
    target: { __typename: "Tag", oid: oldSha },
  });
  updateDraft(client, options);
  assert.ok(calls.some((call) => call.endpoint.includes("/git/tags/")));
  const bad = fixture({ target: { __typename: "Tag", oid: oldSha } });
  const original = bad.client.api;
  bad.client.api = (endpoint, options) =>
    endpoint.includes("/git/tags/")
      ? { object: { type: "commit", sha: oldSha } }
      : original(endpoint, options);
  assert.throws(() => updateDraft(bad.client, bad.options), /another source/);
  assert.ok(bad.calls.every((call) => !call.options?.method && !call.upload));
});

test("API/authentication errors or incomplete lookup never become a missing release", () => {
  for (const result of [
    { errors: [{ message: "forbidden" }] },
    { data: { repository: null } },
    { data: { repository: { nameWithOwner: "ansermail/anser" } } },
  ]) {
    let uploads = 0;
    const client = { api: () => result, upload: () => uploads++ };
    assert.throws(() => updateDraft(client, fixture().options));
    assert.equal(uploads, 0);
  }
  assert.throws(
    () =>
      updateDraft(
        {
          api: () => {
            throw new Error("network failed");
          },
        },
        fixture().options,
      ),
    /network failed/,
  );
});

test("concurrent publication before upload prevents asset replacement", () => {
  const { client, calls, options } = fixture();
  const original = client.api;
  let reads = 0;
  client.api = (endpoint, options) => {
    const result = original(endpoint, options);
    if (endpoint === "graphql" && ++reads === 2)
      result.data.repository.release.isDraft = false;
    return result;
  };
  assert.throws(() => updateDraft(client, options), /changed before upload/);
  assert.ok(!calls.some((call) => call.upload));
});

test("source or note drift after metadata update prevents upload", () => {
  for (const drift of [
    { target_commitish: oldSha },
    { body: "stale notes" },
    { draft: false },
  ]) {
    const { client, calls, options } = fixture();
    const original = client.api;
    client.api = (endpoint, options) => {
      const result = original(endpoint, options);
      return endpoint.endsWith("/releases/123") && !options
        ? { ...result, ...drift }
        : result;
    };
    assert.throws(() => updateDraft(client, options));
    assert.ok(!calls.some((call) => call.upload));
  }
});

test("only seven matching assets and the source release notes can be uploaded", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anser-draft-assets-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = path.join(root, "assets");
  fs.mkdirSync(out);
  fs.mkdirSync(path.join(root, "docs/releases"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/releases/v1.2.3.md"), "new notes\n");
  const platforms = {};
  for (const arch of ["aarch64", "x86_64"]) {
    const base = `Anser_1.2.3_${arch}`;
    for (const ext of [".dmg", ".app.tar.gz", ".app.tar.gz.sig"])
      fs.writeFileSync(path.join(out, base + ext), "fixture");
    platforms[`darwin-${arch}`] = {
      url: `https://github.com/ansermail/anser/releases/download/v1.2.3/${base}.app.tar.gz`,
      signature: "fixture",
    };
  }
  const manifest = { version: "1.2.3", notes: "new notes", platforms };
  const write = () =>
    fs.writeFileSync(path.join(out, "latest.json"), JSON.stringify(manifest));
  write();
  assert.equal(releaseFiles(root, out, "1.2.3").length, 7);
  manifest.notes = "previous source";
  write();
  assert.throws(() => releaseFiles(root, out, "1.2.3"));
  manifest.notes = "new notes";
  manifest.platforms["darwin-x86_64"].signature = "old signature";
  write();
  assert.throws(() => releaseFiles(root, out, "1.2.3"));
  manifest.platforms["darwin-x86_64"].signature = "fixture";
  write();
  fs.writeFileSync(path.join(out, "unexpected.env"), "fictional");
  assert.throws(
    () => releaseFiles(root, out, "1.2.3"),
    /Unexpected or missing/,
  );
});
