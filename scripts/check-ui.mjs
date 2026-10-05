import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const violations = [];
const primitives = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "dialog",
  "details",
  "summary",
  "datalist",
  "label",
]);
function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (filename !== path.join("src", "components", "ui")) check(filename);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      const source = ts.createSourceFile(
        filename,
        fs.readFileSync(filename, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      function visit(node) {
        if (ts.isCallExpression(node)) {
          const expr = node.expression;
          const name = ts.isIdentifier(expr)
            ? expr.text
            : ts.isPropertyAccessExpression(expr) &&
                ["window", "globalThis", "self"].includes(
                  expr.expression.getText(source),
                )
              ? expr.name.text
              : ts.isElementAccessExpression(expr) &&
                  ["window", "globalThis", "self"].includes(
                    expr.expression.getText(source),
                  ) &&
                  expr.argumentExpression &&
                  ts.isStringLiteral(expr.argumentExpression)
                ? expr.argumentExpression.text
                : "";
          if (["confirm", "prompt", "alert"].includes(name)) {
            const { line } = source.getLineAndCharacterOfPosition(
              node.getStart(source),
            );
            violations.push(
              `${filename}:${line + 1} 使用 shadcn Dialog/AlertDialog 替换原生 ${name}`,
            );
          }
        }
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText(source);
          const attributes = node.attributes.properties.filter(
            ts.isJsxAttribute,
          );
          const nativePicker =
            tag === "Input" &&
            attributes.some(
              (a) =>
                a.name.getText(source) === "type" &&
                a.initializer &&
                ts.isStringLiteral(a.initializer) &&
                [
                  "date",
                  "time",
                  "datetime-local",
                  "checkbox",
                  "radio",
                  "range",
                  "color",
                ].includes(a.initializer.text),
            );
          const simulatedButton =
            attributes.some(
              (a) =>
                a.name.getText(source) === "role" &&
                a.initializer &&
                ts.isStringLiteral(a.initializer) &&
                a.initializer.text === "button",
            ) && /^[a-z]/.test(tag);
          if (primitives.has(tag) || nativePicker || simulatedButton) {
            const { line } = source.getLineAndCharacterOfPosition(
              node.getStart(source),
            );
            violations.push(
              `${filename}:${line + 1} 使用 shadcn/ui 替换 <${tag}>`,
            );
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
}
check("src");
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else console.log("UI 铁律检查通过：业务界面使用 shadcn/ui 基础组件。");
