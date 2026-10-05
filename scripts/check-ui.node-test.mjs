import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
const script = path.resolve("scripts/check-ui.mjs");
function check(code) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yanxin-ui-guard-"));
  try {
    fs.mkdirSync(path.join(temp, "src"));
    fs.writeFileSync(path.join(temp, "src", "page.tsx"), code);
    return spawnSync(process.execPath, [script], {
      cwd: temp,
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
for (const expression of [
  "window.confirm('remove')",
  "globalThis.prompt('url')",
  "self['alert']('error')",
  "confirm('remove')",
])
  test(`rejects native dialog ${expression}`, () => {
    const result = check(expression);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /shadcn Dialog\/AlertDialog/);
  });
test("allows business composition with shadcn controls", () => {
  assert.equal(
    check(
      "export const Page = () => <Dialog><DialogTitle>提示</DialogTitle><Button>继续</Button></Dialog>;",
    ).status,
    0,
  );
});
