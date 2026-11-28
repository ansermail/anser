// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

it("reveals the sidebar scrollbar only on hover or keyboard focus", () => {
  expect(css).toMatch(/[^.]*\.sidebar \{[^}]*scrollbar-width: none;/s);
  expect(css).toMatch(
    /\.sidebar:hover,\s*\.sidebar:focus-within \{[^}]*scrollbar-width: thin;/s,
  );
  expect(css).toMatch(
    /\.sidebar:hover::-webkit-scrollbar-thumb,\s*\.sidebar:focus-within::-webkit-scrollbar-thumb \{[^}]*background: var\(--secondary\)/s,
  );
});

it("lets the send-history table fill the workspace instead of capping its height", () => {
  expect(css).toMatch(
    /\.workspace-panel:has\(> \.task-data-table\) \[data-slot="scroll-area-viewport"\] \{[^}]*max-block-size: none;/s,
  );
  expect(css).toMatch(
    /\.workspace-panel:has\(> \.task-data-table\) > \.task-data-table \{[^}]*flex: 1;/s,
  );
});
