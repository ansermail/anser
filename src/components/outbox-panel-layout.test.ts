// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

it("reveals the sidebar scrollbar only on hover or keyboard focus", () => {
  expect(css).toMatch(/[^.]*\.sidebar \{[^}]*scrollbar-gutter: stable;/s);
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

it("hides global native scrollbars until hover or focus and keeps them narrow", () => {
  expect(css).toMatch(
    /\*,\s*\*::before,\s*\*::after \{[^}]*scrollbar-width: none;/s,
  );
  expect(css).toMatch(
    /\*:hover,\s*\*:focus-within \{[^}]*scrollbar-width: thin;/s,
  );
  expect(css).toMatch(
    /::-webkit-scrollbar \{[^}]*width: 4px;[^}]*height: 4px;/s,
  );
  expect(css).toMatch(
    /\*:hover::-webkit-scrollbar-thumb,\s*\*:focus-within::-webkit-scrollbar-thumb/s,
  );
  expect(css).toMatch(
    /\*:hover,\s*\*:focus-within \{[^}]*scrollbar-color: var\(--secondary\)/s,
  );
  expect(css).toMatch(
    /\*:hover::-webkit-scrollbar-thumb,\s*\*:focus-within::-webkit-scrollbar-thumb \{[^}]*background: var\(--secondary\)/s,
  );
  expect(css).not.toMatch(
    /\*:hover::-webkit-scrollbar-thumb[^}]*var\(--muted-foreground\)/s,
  );
});

it("hides shadcn scroll-area bars until hover or focus", () => {
  expect(css).toMatch(
    /\[data-slot="scroll-area"\]:not\(:hover\):not\(:focus-within\)/s,
  );
  expect(css).toMatch(
    /\[data-slot="scroll-area"\]:is\(:hover, :focus-within\)/s,
  );
  const component = readFileSync(
    resolve(process.cwd(), "src/components/ui/scroll-area.tsx"),
    "utf8",
  );
  expect(component).toContain("h-full w-1.5");
  expect(component).toContain('"h-1 flex-col border-t-0 p-0"');
  expect(component).toContain("bg-secondary");
  expect(component).not.toContain("bg-muted-foreground/45");
});
