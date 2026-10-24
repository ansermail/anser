import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentTypes, importedTypes } from "./mac-document-types.mjs";
test("development EML association matches formal bundle and uses viewer rank", async () => {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
  );
  const plist = documentTypes(config.bundle.fileAssociations);
  assert.match(plist, /<string>eml<\/string>/);
  assert.match(plist, /<string>Viewer<\/string>/);
  assert.match(plist, /<string>Alternate<\/string>/);
  assert.match(plist, /<string>com.apple.mail.email<\/string>/);
});
test("plist names are escaped and empty associations produce no key", () => {
  assert.equal(documentTypes(), "");
  assert.match(
    documentTypes([{ ext: ["eml"], name: "A < B & C" }]),
    /A &lt; B &amp; C/,
  );
});

test("EMLX and MSG viewers share formal imported-type declarations in development", async () => {
  const config = JSON.parse(
    await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url)),
  );
  const info = await readFile(
    new URL("../src-tauri/Info.plist", import.meta.url),
    "utf8",
  );
  const declarations = importedTypes(info);
  const types = documentTypes(config.bundle.fileAssociations);
  for (const ext of ["eml", "emlx", "msg"])
    assert.ok(
      config.bundle.fileAssociations.some(
        (a) =>
          a.ext.includes(ext) && a.role === "Viewer" && a.rank === "Alternate",
      ),
    );
  assert.match(types, /org.ansermail.outlook-message/);
  assert.match(declarations, /org.ansermail.outlook-message/);
  assert.match(declarations, /public.filename-extension/);
  assert.match(declarations, /<string>msg<\/string>/);
  assert.match(declarations, /application\/vnd.ms-outlook/);
  assert.throws(() => importedTypes("<plist><dict/></plist>"));
});
