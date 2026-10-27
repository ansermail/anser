import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  repository,
  targets,
  targetAssets,
  validateVersion,
} from "./release-assets.mjs";

const query = `query($tag:String!, $ref:String!) {
  repository(owner:"ansermail",name:"anser") {
    nameWithOwner
    release(tagName:$tag) { databaseId isDraft tagName }
    ref(qualifiedName:$ref) { target { __typename oid } }
  }
}`;

function command(bin, args, input) {
  try {
    return execFileSync(bin, args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // A failed lookup is not evidence that a release/tag does not exist.
    throw new Error(`${bin} ${args[0]} failed; release operation stopped.`);
  }
}

export function releaseClient() {
  return {
    api(endpoint, options = {}) {
      const args = ["api", endpoint];
      if (options.body)
        args.push("--method", options.method ?? "POST", "--input", "-");
      return JSON.parse(
        command("gh", args, options.body && JSON.stringify(options.body)),
      );
    },
    upload(tag, files) {
      command("gh", [
        "release",
        "upload",
        tag,
        "--repo",
        repository,
        ...files,
        "--clobber",
      ]);
    },
  };
}

export function inspectRelease(client, tag, sha) {
  assert.match(
    sha,
    /^[a-f0-9]{40}$/,
    "Release source must be a full commit SHA",
  );
  const result = client.api("graphql", {
    body: { query, variables: { tag, ref: `refs/tags/${tag}` } },
  });
  assert.ok(!result.errors, "GitHub lookup failed; refusing release mutation");
  const repo = result.data?.repository;
  assert.equal(
    repo?.nameWithOwner,
    repository,
    "Release repository could not be verified",
  );
  assert.ok(
    Object.hasOwn(repo, "release") && Object.hasOwn(repo, "ref"),
    "Incomplete GitHub lookup",
  );
  const release = repo.release;
  if (release) {
    assert.equal(release.tagName, tag);
    assert.equal(typeof release.isDraft, "boolean");
    assert.ok(
      Number.isSafeInteger(release.databaseId) && release.databaseId > 0,
    );
    if (!release.isDraft) return { published: true, release };
  }
  let target = repo.ref?.target;
  const seen = new Set();
  while (target?.__typename === "Tag") {
    assert.match(target.oid, /^[a-f0-9]{40}$/);
    assert.ok(
      !seen.has(target.oid) && seen.size < 16,
      "Invalid annotated tag chain",
    );
    seen.add(target.oid);
    const object = client.api(
      `repos/${repository}/git/tags/${target.oid}`,
    ).object;
    assert.ok(
      object && ["tag", "commit"].includes(object.type),
      "Release tag must resolve to a commit",
    );
    target = {
      __typename: object.type === "tag" ? "Tag" : "Commit",
      oid: object.sha,
    };
  }
  if (repo.ref) {
    assert.equal(
      target?.__typename,
      "Commit",
      "Release tag must resolve to a commit",
    );
    assert.equal(
      target.oid,
      sha,
      "Existing tag points to another source; bump the version instead",
    );
  }
  return { published: false, release };
}

function verifyDraft(release, tag, sha, notes) {
  assert.ok(
    Number.isSafeInteger(release.id) && release.id > 0,
    "Invalid release identity",
  );
  assert.equal(release.tag_name, tag);
  assert.equal(
    release.draft,
    true,
    "Published releases are immutable; bump the version",
  );
  assert.equal(
    release.target_commitish,
    sha,
    "Draft source differs from build source",
  );
  assert.equal(
    release.body,
    notes,
    "Draft notes differ from checked-out notes",
  );
}

export function updateDraft(client, { tag, sha, notes, files }) {
  assert.ok(notes.trim(), "Release notes are required");
  assert.ok(files.length > 0, "Release assets are required");
  const state = inspectRelease(client, tag, sha);
  assert.ok(
    !state.published,
    "Published releases are immutable; bump the version",
  );
  const body = {
    tag_name: tag,
    target_commitish: sha,
    name: `Anser - 雁信 ${tag.slice(1)}`,
    body: notes,
    draft: true,
  };
  const release = client.api(
    `repos/${repository}/releases${state.release ? `/${state.release.databaseId}` : ""}`,
    { method: state.release ? "PATCH" : "POST", body },
  );
  verifyDraft(release, tag, sha, notes);
  // Recheck immutable state and tags immediately before replacing assets.
  const current = inspectRelease(client, tag, sha);
  assert.ok(
    !current.published && current.release?.databaseId === release.id,
    "Draft changed before upload",
  );
  verifyDraft(
    client.api(`repos/${repository}/releases/${release.id}`),
    tag,
    sha,
    notes,
  );
  client.upload(tag, files);
  verifyDraft(
    client.api(`repos/${repository}/releases/${release.id}`),
    tag,
    sha,
    notes,
  );
  return release.id;
}

export function releaseFiles(root, output, version) {
  const names = targets.flatMap(
    (target) => targetAssets(target, version).files,
  );
  names.push("latest.json");
  assert.deepEqual(
    fs.readdirSync(output).sort(),
    [...names].sort(),
    "Unexpected or missing release assets",
  );
  for (const name of names)
    assert.ok(
      fs.lstatSync(path.join(output, name)).isFile() &&
        fs.statSync(path.join(output, name)).size > 0,
    );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(output, "latest.json")),
  );
  assert.equal(manifest.version, version);
  assert.deepEqual(
    Object.keys(manifest.platforms).sort(),
    targets.map((target) => targetAssets(target, version).platform).sort(),
  );
  for (const target of targets) {
    const { updater: name, platform } = targetAssets(target, version);
    assert.equal(
      manifest.platforms[platform].url,
      `https://github.com/${repository}/releases/download/v${version}/${name}`,
    );
    assert.equal(
      manifest.platforms[platform].signature,
      fs.readFileSync(path.join(output, name + ".sig"), "utf8").trim(),
    );
  }
  assert.equal(
    manifest.notes,
    fs.readFileSync(path.join(root, `docs/releases/v${version}.md`), "utf8"),
  );
  return names.map((name) => path.resolve(output, name));
}

function main() {
  const mode = process.argv[2];
  assert.ok(
    ["check", "upload"].includes(mode),
    "Usage: release-draft.mjs check|upload [assets]",
  );
  const version = validateVersion(),
    tag = `v${version}`;
  const sha = command("git", ["rev-parse", "HEAD"]).trim();
  assert.equal(
    sha,
    process.env.GITHUB_SHA,
    "Checkout must match the workflow source",
  );
  const client = releaseClient();
  if (mode === "check") {
    const { published } = inspectRelease(client, tag, sha);
    assert.ok(process.env.GITHUB_OUTPUT, "Missing workflow output file");
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `build_required=${!published}\n`,
    );
    console.log(
      published
        ? `${tag} is already published; skipping without replacing assets.`
        : `${tag} source verified; build required.`,
    );
  } else {
    const files = releaseFiles(
      ".",
      process.argv[3] ?? "release-assets",
      version,
    );
    const notes = fs.readFileSync(`docs/releases/${tag}.md`, "utf8");
    const id = updateDraft(client, { tag, sha, notes, files });
    console.log(`Draft ${id} updated from ${sha}; not published.`);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
