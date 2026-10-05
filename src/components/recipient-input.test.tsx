// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecipientInput } from "./recipient-input";

let root: Root, host: HTMLDivElement;
const suggestions = [
  { name: "Alice", email: "alice@example.com" },
  { name: "Alex", email: "alex@example.com" },
];
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
  function Harness() {
    const [value, setValue] = useState("first@example.com, al");
    return (
      <RecipientInput
        id="recipient-test"
        value={value}
        onChange={setValue}
        suggestions={suggestions}
      />
    );
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  await act(async () =>
    (host.querySelector("input") as HTMLInputElement).focus(),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("keeps input focus and completes the active suggestion by keyboard without replacing prior recipients", async () => {
  const input = host.querySelector("input")!;
  expect(document.querySelector('[data-slot="command"]')).toBeTruthy();
  expect(
    document.getElementById(input.getAttribute("aria-controls")!),
  ).toBeTruthy();
  expect(
    document.getElementById(input.getAttribute("aria-activedescendant")!)
      ?.textContent,
  ).toContain("Alice");
  expect(document.activeElement).toBe(input);
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  expect(
    document.getElementById(input.getAttribute("aria-activedescendant")!)
      ?.textContent,
  ).toContain("Alex");
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(input.value).toBe('first@example.com, "Alex" <alex@example.com>, ');
  expect(input.getAttribute("aria-expanded")).toBe("false");
});
it("completes a pointer selection and closes the shadcn suggestion popup", async () => {
  const option = [...document.querySelectorAll("[cmdk-item]")].find((e) =>
    e.textContent?.includes("Alice"),
  )!;
  await act(async () => (option as HTMLElement).click());
  expect(host.querySelector("input")!.value).toBe(
    'first@example.com, "Alice" <alice@example.com>, ',
  );
  expect(host.querySelector("input")!.getAttribute("aria-expanded")).toBe(
    "false",
  );
});
