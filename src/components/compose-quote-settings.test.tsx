// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposeQuoteSettings } from "./compose-quote-settings";
import { call, enterDemo, leaveDemo } from "../lib/api";
import type { Preferences } from "../lib/types";

let root: Root, host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  enterDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.restoreAllMocks();
});

it("defaults English reply/forward quote headers to off and toggles via the switch", async () => {
  const defaults = await call<Preferences>("get_preferences");
  expect(defaults.englishQuoteHeader).toBe(false);

  const onChange = vi.fn();
  await act(async () =>
    root.render(
      <ComposeQuoteSettings
        englishQuoteHeader={false}
        ready
        saving={false}
        onChange={onChange}
      />,
    ),
  );
  const toggle = host.querySelector<HTMLButtonElement>(
    "#english-quote-header",
  )!;
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  await act(async () => toggle.click());
  expect(onChange).toHaveBeenCalledWith(true);
});
