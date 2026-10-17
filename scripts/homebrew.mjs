import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { repository } from "./release-assets.mjs";

const caskPath = "Casks/anser.rb";
const arches = ["aarch64", "x86_64"];
const maxDmgSize = 256 * 1024 * 1024;
const execute = promisify(execFile);

async function publicDownload(url, { signal }) {
  // curl honors the host's proxy environment; no GitHub token is sent.
  // Disable user curlrc and permit only HTTPS, including CDN redirects.
  const { stdout } = await execute(
    "curl",
    [
      "--disable",
      "--fail",
      "--location",
      "--proto",
      "=https",
      "--proto-redir",
      "=https",
      "--connect-timeout",
      "15",
      "--max-time",
      "110",
      "--max-filesize",
      String(maxDmgSize),
      "--silent",
      "--show-error",
      url,
    ],
    { encoding: "buffer", maxBuffer: maxDmgSize, signal },
  );
  return { ok: true, body: [stdout] };
}

function versionParts(version) {
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  const parts = version.split(".").map(Number);
  assert(parts.every(Number.isSafeInteger), "Invalid release version");
  return parts;
}

export function selectRelease(release, tag = "") {
  assert.equal(release.draft, false, "Draft releases cannot enter Homebrew");
  assert.equal(release.prerelease, false, "Prereleases cannot enter Homebrew");
  assert(Number.isSafeInteger(release.id) && release.id > 0);
  assert(
    Number.isFinite(Date.parse(release.published_at)),
    "Release is not published",
  );
  assert.equal(typeof release.tag_name, "string");
  assert(release.tag_name.startsWith("v"));
  const version = release.tag_name.slice(1);
  versionParts(version);
  if (tag)
    assert.equal(release.tag_name, tag, "Requested release is not latest");
  const dmgs = arches.map((arch) => {
    const name = `Anser_${version}_${arch}.dmg`;
    const matches = release.assets.filter((asset) => asset.name === name);
    assert.equal(matches.length, 1, `Missing or duplicate ${name}`);
    const asset = matches[0];
    assert.equal(asset.state, "uploaded");
    assert(Number.isSafeInteger(asset.id) && asset.id > 0);
    assert(
      Number.isSafeInteger(asset.size) &&
        asset.size > 0 &&
        asset.size <= maxDmgSize,
    );
    assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      asset.browser_download_url,
      `https://github.com/${repository}/releases/download/${release.tag_name}/${name}`,
    );
    return {
      arch,
      id: asset.id,
      name,
      size: asset.size,
      digest: asset.digest,
      url: asset.browser_download_url,
    };
  });
  return { id: release.id, tag: release.tag_name, version, dmgs };
}

export function renderCask({ version, dmgs }) {
  versionParts(version);
  const digest = (arch) =>
    dmgs.find((asset) => asset.arch === arch).digest.slice(7);
  return `cask "anser" do
  arch arm: "aarch64", intel: "x86_64"

  version "${version}"
  sha256 arm:   "${digest("aarch64")}",
         intel: "${digest("x86_64")}"

  url "https://github.com/ansermail/anser/releases/download/v#{version}/Anser_#{version}_#{arch}.dmg"
  name "Anser (雁信)"
  desc "Multi-account email client with local mail archiving"
  homepage "https://github.com/ansermail/anser"

  auto_updates true
  depends_on macos: :monterey

  app "雁信.app"
end
`;
}

export async function verifyDownload(asset, fetchImpl = publicDownload) {
  // Public URLs receive no GitHub credentials; redirects may go to GitHub's CDN.
  const response = await fetchImpl(asset.url, {
    signal: AbortSignal.timeout(120_000),
  });
  assert(response.ok && response.body, `Download failed: ${asset.name}`);
  const hash = crypto.createHash("sha256");
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(
      size <= asset.size && size <= maxDmgSize,
      `Oversized download: ${asset.name}`,
    );
    hash.update(chunk);
  }
  assert.equal(size, asset.size, `Truncated download: ${asset.name}`);
  assert.equal(
    `sha256:${hash.digest("hex")}`,
    asset.digest,
    `SHA-256 mismatch: ${asset.name}`,
  );
}

export function rejectRollback(current, nextVersion) {
  const match = current.match(/^  version "([^"]+)"$/m);
  assert(match, "Existing cask version is missing");
  const previous = versionParts(match[1]);
  const next = versionParts(nextVersion);
  const different = next.findIndex((part, i) => part !== previous[i]);
  assert(
    different < 0 || next[different] > previous[different],
    "Refusing Homebrew rollback",
  );
}

export async function prepareCask(
  client,
  tag = "",
  fetchImpl = publicDownload,
) {
  const release = selectRelease(
    client.api(`repos/${repository}/releases/latest`),
    tag,
  );
  for (const asset of release.dmgs) await verifyDownload(asset, fetchImpl);
  assert.deepEqual(
    selectRelease(client.api(`repos/${repository}/releases/latest`), tag),
    release,
    "Latest release changed during verification",
  );
  return { release, content: renderCask(release) };
}

export function publishCask(client, prepared, validatedContent) {
  const { release, content } = prepared;
  assert.equal(
    content,
    validatedContent,
    "Cask differs from Homebrew-validated content",
  );
  const endpoint = `repos/${repository}/contents/${caskPath}`;
  const current = client.api(`${endpoint}?ref=main`);
  assert.equal(current.type, "file");
  assert.equal(current.encoding, "base64");
  assert.match(current.sha, /^[a-f0-9]{40}$/);
  const previous = Buffer.from(current.content, "base64").toString("utf8");
  rejectRollback(previous, release.version);
  // Recheck immediately before a single-file compare-and-swap update on main.
  assert.deepEqual(
    selectRelease(
      client.api(`repos/${repository}/releases/latest`),
      release.tag,
    ),
    release,
    "Latest release changed before commit",
  );
  if (previous === content) return null;
  if (previous.includes(`  version "${release.version}"`)) {
    for (const asset of release.dmgs)
      assert(
        previous.includes(asset.digest.slice(7)),
        "Same-version DMG digest changed",
      );
  }
  return client.api(endpoint, {
    method: "PUT",
    body: {
      message: `Update Homebrew cask to ${release.version}`,
      branch: "main",
      sha: current.sha,
      content: Buffer.from(content).toString("base64"),
    },
  }).commit.sha;
}

function client() {
  return {
    api(endpoint, options = {}) {
      const args = ["api", endpoint];
      if (options.body) args.push("--method", options.method, "--input", "-");
      try {
        return JSON.parse(
          execFileSync("gh", args, {
            encoding: "utf8",
            input: options.body && JSON.stringify(options.body),
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 30_000,
          }),
        );
      } catch {
        throw new Error(
          "GitHub request failed; Homebrew update stopped without retrying writes.",
        );
      }
    },
  };
}

async function main() {
  const mode = process.argv[2];
  assert(
    ["generate", "publish"].includes(mode),
    "Usage: homebrew.mjs generate|publish",
  );
  const github = client();
  const prepared = await prepareCask(github, process.env.RELEASE_TAG ?? "");
  if (mode === "generate") {
    rejectRollback(fs.readFileSync(caskPath, "utf8"), prepared.release.version);
    fs.writeFileSync(caskPath, prepared.content);
    console.log(
      `Verified both public DMGs; generated ${caskPath} for ${prepared.release.tag}.`,
    );
  } else {
    const sha = publishCask(
      github,
      prepared,
      fs.readFileSync(caskPath, "utf8"),
    );
    console.log(
      sha
        ? `Cask committed to ${repository}/main: ${sha}`
        : "Cask is already current; no commit needed.",
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
