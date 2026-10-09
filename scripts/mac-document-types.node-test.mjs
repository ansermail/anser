import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { documentTypes } from "./mac-document-types.mjs";
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
