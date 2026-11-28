import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tauri = new URL("../src-tauri/", import.meta.url);
const { bundle } = JSON.parse(
  readFileSync(new URL("tauri.windows.conf.json", tauri), "utf8"),
);
const { nsis } = bundle.windows;

test("Windows setup uses the application ICO and the optional association hooks", () => {
  assert.deepEqual(bundle.targets, ["nsis"]);
  assert.deepEqual(bundle.fileAssociations, []);
  assert.equal(nsis.installMode, "currentUser");
  assert.equal(nsis.installerHooks, "nsis/hooks.nsh");
  assert.equal(nsis.installerIcon, "icons/icon.ico");
  assert.ok(bundle.icon.includes(nsis.installerIcon));
  const icon = readFileSync(new URL(nsis.installerIcon, tauri));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.ok(icon.readUInt16LE(4) > 0);
});

test("Windows setup keeps the vendored template’s MIT notice in the bundle", () => {
  const license = "nsis/LICENSE-tauri-bundler-MIT.md";
  assert.equal(bundle.resources[license], "licenses/tauri-bundler-MIT.md");
  assert.match(
    readFileSync(new URL(license, tauri), "utf8"),
    /Tauri Apps Contributors/,
  );
});

test("the in-place branch runs before normal NSIS maintenance", () => {
  const template = readFileSync(new URL(nsis.template, tauri), "utf8");
  const maintenancePage = template.slice(
    template.indexOf("Function PageReinstall\n"),
    template.indexOf("Function PageReinstallUpdateSelection\n"),
  );
  assert.match(maintenancePage, /Goto compare_version[\s\S]*Pop \$R0/);
  assert.match(
    maintenancePage,
    /\$WixMode <> 1[\s\S]*\$PassiveMode <> 1[\s\S]*\$UpdateMode <> 1[\s\S]*\$R0 >= 0[\s\S]*StrCpy \$ManualInPlace 1\s+Abort[\s\S]*\$R0 = -1/,
  );
  assert.match(
    template,
    /!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassiveOrManualInPlace\n!insertmacro MUI_PAGE_DIRECTORY/,
  );
});

test("forward NSIS maintenance preselects and focuses the in-place option", () => {
  const template = readFileSync(new URL(nsis.template, tauri), "utf8");
  const upgradePage = template.slice(
    template.indexOf("  ; Upgrading\n"),
    template.indexOf("  ; Downgrading\n"),
  );
  assert.match(
    upgradePage,
    /\$WixMode <> 1\s+StrCpy \$R3 "\$\(AnserInstallInPlace\)"[\s\S]*\$ReinstallPageCheck == ""\s+StrCpy \$ReinstallPageCheck 2/,
  );
  assert.match(
    template,
    /SendMessage \$R3 \$\{BM_SETCHECK\} \$\{BST_CHECKED\} 0\s+\$\{NSD_SetFocus\} \$R3/,
  );
  assert.match(
    template,
    /\$R0 = 1 ; Upgrading[\s\S]*?\$\{Else\}\s+Goto reinst_done/,
  );
});
