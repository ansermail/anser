import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { manifest, validateVersion, collect } from "./release-assets.mjs";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "anser-release-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src-tauri"));
  fs.mkdirSync(path.join(root, "docs/releases"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({
      version: "1.2.3",
      identifier: "dev.maildesk.desktop",
      plugins: {
        updater: {
          pubkey: "test-public-key",
          endpoints: [
            "https://github.com/ansermail/anser/releases/latest/download/latest.json",
          ],
        },
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "anser", version: "1.2.3" }),
  );
  fs.writeFileSync(
    path.join(root, "src-tauri/Cargo.toml"),
    '[package]\nname = "anser"\nversion = "1.2.3"\n',
  );
  fs.writeFileSync(path.join(root, "docs/releases/v1.2.3.md"), "Release notes");
  return root;
}
test("release fails when version sources disagree", (t) => {
  const root = fixture(t);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "1.2.4" }),
  );
  assert.throws(() => validateVersion(root), /versions must match/);
});
test("manifest requires both Mac architectures and the signed Windows installer", (t) => {
  const root = fixture(t),
    out = path.join(root, "assets");
  fs.mkdirSync(out);
  assert.throws(() => manifest(out, root));
  for (const arch of ["aarch64", "x86_64"]) {
    fs.writeFileSync(
      path.join(out, `Anser_1.2.3_${arch}.app.tar.gz`),
      "archive",
    );
    fs.writeFileSync(path.join(out, `Anser_1.2.3_${arch}.dmg`), "installer");
    fs.writeFileSync(
      path.join(out, `Anser_1.2.3_${arch}.app.tar.gz.sig`),
      `signature-${arch}`,
    );
  }
  assert.throws(() => manifest(out, root));
  fs.writeFileSync(
    path.join(out, "Anser_1.2.3_x86_64-setup.exe"),
    "windows installer",
  );
  assert.throws(() => manifest(out, root));
  fs.writeFileSync(
    path.join(out, "Anser_1.2.3_x86_64-setup.exe.sig"),
    "windows signature",
  );
  const m = manifest(out, root);
  assert.deepEqual(Object.keys(m.platforms), [
    "darwin-aarch64",
    "darwin-x86_64",
    "windows-x86_64",
  ]);
  assert.equal(m.platforms["windows-x86_64"].signature, "windows signature");
  assert.match(
    m.platforms["windows-x86_64"].url,
    /Anser_1\.2\.3_x86_64-setup\.exe$/,
  );
  assert.equal(m.platforms["darwin-aarch64"].signature, "signature-aarch64");
  assert.match(
    m.platforms["darwin-x86_64"].url,
    /releases\/download\/v1.2.3\/Anser_1.2.3_x86_64.app.tar.gz$/,
  );
});
test("collects the Windows executable and its matching updater signature without renaming bytes", (t) => {
  const root = fixture(t),
    target = "x86_64-pc-windows-msvc",
    out = path.join(root, "assets");
  const folder = path.join(
    root,
    "src-tauri/target",
    target,
    "release/bundle/nsis",
  );
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "original-setup.exe"),
    Buffer.from([77, 90, 0, 1, 2]),
  );
  assert.throws(() => collect(target, out, root));
  fs.writeFileSync(
    path.join(folder, "original-setup.exe.sig"),
    "matching signature",
  );
  collect(target, out, root);
  assert.deepEqual(
    fs.readFileSync(path.join(out, "Anser_1.2.3_x86_64-setup.exe")),
    Buffer.from([77, 90, 0, 1, 2]),
  );
  assert.equal(
    fs.readFileSync(path.join(out, "Anser_1.2.3_x86_64-setup.exe.sig"), "utf8"),
    "matching signature",
  );
  fs.writeFileSync(path.join(folder, "extra.exe"), "other version");
  assert.throws(() => collect(target, out, root), /one Windows installer/);
});
test("release cannot silently ship the legacy repository update endpoint", (t) => {
  const root = fixture(t);
  const file = path.join(root, "src-tauri/tauri.conf.json");
  const config = JSON.parse(fs.readFileSync(file));
  config.plugins.updater.endpoints = [
    "https://github.com/yn-zxj/yanxin/releases/latest/download/latest.json",
  ];
  fs.writeFileSync(file, JSON.stringify(config));
  assert.throws(() => validateVersion(root), /organization repository/);
});
