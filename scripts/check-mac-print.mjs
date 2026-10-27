import { build } from "vite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("Requires macOS WebKit");
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(path.join(tmpdir(), "anser-print-regression-"));
const assets = path.join(root, "dist/assets");
const css = readdirSync(assets)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(path.join(assets, name), "utf8"))
  .join("\n");
const paragraphs = Array.from(
  { length: 60 },
  (_, index) =>
    `PARAGRAPH-${String(index + 1).padStart(3, "0")}: Fictional validation content. Original spacing, normal font size, complete pagination and the final paragraph must survive printing.`,
);
const entry = path.join(temporary, "entry.ts");
writeFileSync(
  entry,
  `import { printableMail } from ${JSON.stringify(path.join(root, "src/lib/mail-print.ts"))};
const paragraphs = ${JSON.stringify(paragraphs)};
const html = '<html><head><style>body{font:16px/1.6 Georgia;color:#111}h1{color:#3278ff}p{margin:18px 0}.card{padding:30px;border-top:12px solid #3278ff}</style></head><body><div class="card"><h1>Fictional mail</h1>' + paragraphs.map(p => '<p>' + p + '</p>').join('') + '<p>DOCUMENT-END-060</p></div></body></html>';
const plain = new URLSearchParams(location.search).has('plain');
document.body.append(printableMail({mail:{subject:'Anser native print regression',sender:'Anser QA <qa@example.com>',recipients:'Reader <reader@example.com>',date:'2026-10-27T12:00:00Z',body:paragraphs.join('\\n\\n')+'\\nDOCUMENT-END-060'},html:plain?'':html,attachments:[{index:0,name:'draft-validation.txt',size:42,mime:'text/plain'}]}));`,
);
const bundle = await build({
  root,
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  logLevel: "error",
  build: {
    write: false,
    minify: false,
    lib: { entry, name: "AnserPrintProbe", formats: ["iife"] },
  },
});
const output = Array.isArray(bundle) ? bundle[0] : bundle;
const script = output.output.find((item) => item.type === "chunk").code;
const executable = path.join(temporary, "probe");
execFileSync(
  "clang",
  [
    "-fobjc-arc",
    "-fblocks",
    "-framework",
    "AppKit",
    "-framework",
    "WebKit",
    "-framework",
    "PDFKit",
    path.join(root, "scripts/mac-print-probe.m"),
    "-o",
    executable,
  ],
  { stdio: "inherit" },
);
for (const external of [false, true]) {
  for (const plain of [false, true]) {
    const name = `${external ? "external" : "main"}-${plain ? "plain" : "html"}`;
    const html = path.join(temporary, `${name}.html`);
    // Plain fixture selection is baked into the page so loadFileURL stays local.
    writeFileSync(
      html,
      `<!doctype html><html${external ? ' class="external-mail-document"' : ""}><head><meta charset="UTF-8"><style>${css}</style></head><body><div id="root">Application UI must not print</div><script>window.onerror=(message)=>{window.probeError=message;};${plain ? "history.replaceState(null,'','?plain');" : ""}${script}</script></body></html>`,
    );
    console.log(name);
    execFileSync(executable, [html, path.join(temporary, `${name}.pdf`)], {
      stdio: "inherit",
      timeout: 40_000,
    });
  }
}
console.log(`Native PDF evidence: ${temporary}`);
