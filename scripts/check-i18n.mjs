import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import ts from "typescript";
const chinese = JSON.parse(fs.readFileSync("src/locales/zh-CN.json", "utf8"));
const english = JSON.parse(fs.readFileSync("src/locales/en.json", "utf8"));
const config = JSON.parse(fs.readFileSync("src/locales/config.json", "utf8"));
assert.deepEqual(config.languages.map((item) => item.code).sort(), [
  "en",
  "zh-CN",
]);
assert.ok(
  config.languages.some((item) => item.code === config.defaultLanguage),
);
assert.ok(
  config.languages.some((item) => item.code === config.fallbackLanguage),
);
const tokens = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
assert.deepEqual(
  Object.keys(chinese).sort(),
  Object.keys(english).sort(),
  "Language keys differ",
);
for (const key of Object.keys(chinese)) {
  assert.equal(
    typeof english[key],
    "string",
    `Invalid English message: ${key}`,
  );
  assert.ok(english[key].trim(), `Empty English message: ${key}`);
  assert.deepEqual(
    tokens(chinese[key]),
    tokens(english[key]),
    `Interpolation differs: ${key}`,
  );
}
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) {
      const source = ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "t" &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          assert.ok(
            Object.hasOwn(chinese, node.arguments[0].text),
            `${file}: missing key ${node.arguments[0].text}`,
          );
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
walk("src");
console.log(
  `Internationalization check passed: ${Object.keys(chinese).length} bilingual messages, matching keys and placeholders.`,
);
