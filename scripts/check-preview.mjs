import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
const root = "dist-preview";
const files = await readdir(join(root, "assets"));
const css = (
  await Promise.all(
    files
      .filter((x) => x.endsWith(".css"))
      .map((x) => readFile(join(root, "assets", x), "utf8")),
  )
).join("\n");
// These utilities belong to shared desktop components, outside Vite's preview root.
for (const utility of [".flex{", ".flex-col{", ".grid{", ".gap-6{"])
  assert.ok(css.includes(utility), `Pages 缺少布局样式 ${utility}`);
const js = (
  await Promise.all(
    files
      .filter((x) => x.endsWith(".js"))
      .map((x) => readFile(join(root, "assets", x), "utf8")),
  )
).join("\n");
assert.ok(!js.includes("__TAURI_INTERNALS__"), "Pages 不得包含原生 IPC 实现");
assert.ok(js.includes("页面预览 · 虚构数据"), "必须明确标记示例数据");
assert.ok(js.includes("页面预览不连接邮箱"), "缺少桌面操作禁用边界");
const html = await readFile(join(root, "index.html"), "utf8");
assert.match(html, /\/anser\/assets\//);
console.log(
  "Pages 检查通过：共用界面布局样式、虚构数据、原生桥隔离及发布路径。",
);
const demoHtml = await readFile(join(root, "demo/index.html"), "utf8");
assert.match(demoHtml, /\/anser\/assets\//);
assert.match(html, /重要的邮件，留在自己手里/);
assert.ok(js.includes("demo/"), "官网必须提供 Web 演示入口");
assert.ok(js.includes("demo-home-link"), "演示页必须能返回官网");
const zhSite = JSON.parse(
  await readFile("src/locales/site.zh-CN.json", "utf8"),
);
const enSite = JSON.parse(await readFile("src/locales/site.en.json", "utf8"));
assert.deepEqual(Object.keys(zhSite).sort(), Object.keys(enSite).sort());
for (const key of Object.keys(zhSite))
  assert.ok(enSite[key]?.trim(), `Missing website translation: ${key}`);
for (const image of [
  "inbox-dark.png",
  "archive.png",
  "rules.png",
  "compose.png",
]) {
  const filename = files.find(
    (file) =>
      file.startsWith(image.replace(".png", "-")) && file.endsWith(".png"),
  );
  assert.ok(filename, `Missing website image: ${image}`);
  const bytes = await readFile(join(root, "assets", filename));
  assert.ok(bytes.readUInt32BE(16) >= 2880, `${image} must use Retina source`);
}
console.log(
  "Website checks passed: home/demo entries, return navigation, bilingual resources and Retina screenshots.",
);
