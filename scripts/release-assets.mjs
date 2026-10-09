import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
export const repository = "ansermail/anser";
export const targets = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
export function validateVersion(root = ".") {
  const config = JSON.parse(
    fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json")),
  );
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  const cargo = fs.readFileSync(
    path.join(root, "src-tauri/Cargo.toml"),
    "utf8",
  );
  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  assert.equal(
    pkg.version,
    config.version,
    "npm and Tauri versions must match",
  );
  assert.equal(
    cargo.match(/^version = "([^"]+)"/m)?.[1],
    config.version,
    "Rust and Tauri versions must match",
  );
  assert.equal(config.identifier, "dev.maildesk.desktop");
  assert.equal(pkg.name, "anser", "npm project name must be anser");
  assert.equal(
    cargo.match(/^name = "([^"]+)"/m)?.[1],
    "anser",
    "Rust project name must be anser",
  );
  assert.deepEqual(
    config.plugins.updater.endpoints,
    [`https://github.com/${repository}/releases/latest/download/latest.json`],
    "Updater must use the organization repository",
  );
  assert.ok(config.plugins.updater.pubkey);
  assert.ok(
    fs
      .readFileSync(
        path.join(root, `docs/releases/v${config.version}.md`),
        "utf8",
      )
      .trim(),
  );
  return config.version;
}
export function collect(target, output, root = ".") {
  assert.ok(targets.includes(target));
  const version = validateVersion(root),
    arch = target.split("-")[0];
  const bundles = path.join(root, "src-tauri/target", target, "release/bundle");
  const archive = path.join(bundles, "macos/雁信.app.tar.gz");
  const signature = fs.readFileSync(archive + ".sig", "utf8").trim();
  assert.ok(signature, "Missing update signature");
  fs.mkdirSync(output, { recursive: true });
  const name = `Anser_${version}_${arch}.app.tar.gz`;
  fs.copyFileSync(archive, path.join(output, name));
  fs.copyFileSync(archive + ".sig", path.join(output, name + ".sig"));
  const dmgs = fs
    .readdirSync(path.join(bundles, "dmg"))
    .filter((f) => f.endsWith(".dmg"));
  assert.equal(dmgs.length, 1);
  fs.copyFileSync(
    path.join(bundles, "dmg", dmgs[0]),
    path.join(output, `Anser_${version}_${arch}.dmg`),
  );
}
export function manifest(output, root = ".") {
  const version = validateVersion(root),
    platforms = {};
  for (const target of targets) {
    const arch = target.split("-")[0],
      name = `Anser_${version}_${arch}.app.tar.gz`;
    assert.ok(fs.statSync(path.join(output, name)).size > 0);
    assert.ok(
      fs.statSync(path.join(output, `Anser_${version}_${arch}.dmg`)).size > 0,
    );
    const signature = fs
      .readFileSync(path.join(output, name + ".sig"), "utf8")
      .trim();
    assert.ok(signature);
    platforms[`darwin-${arch}`] = {
      url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
      signature,
    };
  }
  const data = {
    version,
    notes: fs.readFileSync(
      path.join(root, `docs/releases/v${version}.md`),
      "utf8",
    ),
    pub_date: new Date().toISOString(),
    platforms,
  };
  fs.writeFileSync(
    path.join(output, "latest.json"),
    JSON.stringify(data, null, 2) + "\n",
  );
  return data;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, arg, out] = process.argv.slice(2);
  if (command === "verify") {
    const version = validateVersion();
    if (process.env.GITHUB_REF_TYPE === "tag")
      assert.equal(
        process.env.GITHUB_REF_NAME,
        `v${version}`,
        "Tag must match app version",
      );
  } else if (command === "collect") collect(arg, out);
  else if (command === "manifest") manifest(arg);
  else
    throw new Error(
      "Usage: release-assets.mjs verify | collect <target> <directory> | manifest <directory>",
    );
}
