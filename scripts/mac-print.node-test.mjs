import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("reader windows permit native WebView printing", () => {
  for (const file of ["main.json", "external-mail.json"]) {
    const capability = JSON.parse(
      readFileSync(
        new URL(`../src-tauri/capabilities/${file}`, import.meta.url),
      ),
    );
    assert.ok(
      capability.windows.includes(
        file === "main.json" ? "main" : "external-mail-*",
      ),
    );
    assert.ok(capability.permissions.includes("core:webview:allow-print"));
  }
});
