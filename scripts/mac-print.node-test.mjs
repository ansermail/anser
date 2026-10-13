import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("main window permits native WebView printing", () => {
  const capability = JSON.parse(
    readFileSync(
      new URL("../src-tauri/capabilities/main.json", import.meta.url),
    ),
  );
  assert.ok(capability.windows.includes("main"));
  assert.ok(capability.permissions.includes("core:webview:allow-print"));
});
