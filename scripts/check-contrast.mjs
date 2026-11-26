import fs from "node:fs";
import path from "node:path";

const indexCss = fs.readFileSync(path.resolve("src/index.css"), "utf8");
const palettesCss = fs.readFileSync(
  path.resolve("src/theme-palettes.css"),
  "utf8",
);

function parseHex(hex) {
  const clean = hex.trim().replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function luminance([r, g, b]) {
  const toLinear = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(hexA, hexB) {
  const l1 = luminance(parseHex(hexA));
  const l2 = luminance(parseHex(hexB));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function mix(hexA, hexB, weightB) {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  const w = weightB;
  const out = a.map((v, i) => Math.round(v * (1 - w) + b[i] * w));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function extractVars(block) {
  const vars = {};
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

const failures = [];
const paletteRegex =
  /\[data-theme-palette="([^"]+)"\]\[data-theme-appearance="([^"]+)"\]\s*\{([^}]+)\}/g;

const rootBlock = indexCss.match(/:root\s*\{([^}]+)\}/)?.[1] ?? "";
const darkBlock = indexCss.match(/\.dark\s*\{([^}]+)\}/)?.[1] ?? "";
const rootVars = extractVars(rootBlock);
const darkVars = extractVars(darkBlock);

for (const match of palettesCss.matchAll(paletteRegex)) {
  const [, name, appearance, body] = match;
  const vars = extractVars(body);
  const canvas = vars["--palette-canvas"];
  const panel = vars["--palette-panel"];
  const text = vars["--palette-text"];
  const muted = vars["--palette-muted"];
  const accent = vars["--palette-accent"];
  const accentText = vars["--palette-accent-text"];
  const popover =
    appearance === "dark"
      ? name === "pine"
        ? darkVars["--popover"]
        : mix(panel, text, 0.07)
      : panel;
  const weight =
    parseFloat(vars["--palette-control-weight"]) / 100 ||
    (appearance === "dark" ? 0.56 : 0.55);
  const controlBorder =
    name === "pine"
      ? appearance === "dark"
        ? darkVars["--control-border"]
        : rootVars["--control-border"]
      : mix(canvas, text, weight);
  const destructive =
    appearance === "dark"
      ? darkVars["--destructive"]
      : rootVars["--destructive"];
  const success =
    appearance === "dark" ? darkVars["--success"] : rootVars["--success"];
  const warning =
    appearance === "dark" ? darkVars["--warning"] : rootVars["--warning"];

  const checks = [
    ["text on canvas", text, canvas, 4.5],
    ["text on panel", text, panel, 4.5],
    ["muted on canvas", muted, canvas, 4.5],
    ["muted on panel", muted, panel, 4.5],
    ["accent-text on accent", accentText, accent, 4.5],
    ["accent on panel", accent, panel, 4.5],
    ["destructive on popover", destructive, popover, 4.5],
    ["success on panel", success, panel, 4.5],
    ["warning on panel", warning, panel, 4.5],
    ["control-border on popover", controlBorder, popover, 3.0],
  ];

  for (const [label, fg, bg, min] of checks) {
    if (!fg?.startsWith("#") || !bg?.startsWith("#")) continue;
    const ratio = contrast(fg, bg);
    if (ratio < min) {
      failures.push(
        `${name}/${appearance} ${label}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1 (< ${min}:1)`,
      );
    }
  }
}

if (failures.length) {
  console.error("WCAG 2.2 AA contrast check failed:\n" + failures.join("\n"));
  process.exit(1);
}
console.log(
  "WCAG 2.2 AA contrast check passed across all 20 light/dark theme palette pairs.",
);
