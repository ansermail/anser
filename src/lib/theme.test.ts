// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  nextTheme,
  normalizeTheme,
  resetThemeForTest,
  resolvesToDark,
  setThemeMode,
  subscribeToTheme,
  themeSnapshot,
} from "./theme";

afterEach(() => {
  resetThemeForTest();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it("normalizes legacy values and cycles through all three theme modes", () => {
  expect(normalizeTheme("dark")).toBe("dark");
  expect(normalizeTheme("system")).toBe("system");
  expect(normalizeTheme("unexpected")).toBe("light");
  expect(nextTheme("light")).toBe("dark");
  expect(nextTheme("dark")).toBe("system");
  expect(nextTheme("system")).toBe("light");
  expect(resolvesToDark("light", true)).toBe(false);
  expect(resolvesToDark("dark", false)).toBe(true);
  expect(resolvesToDark("system", false)).toBe(false);
  expect(resolvesToDark("system", true)).toBe(true);
});

it("resolves system mode through the native appearance and follows live changes", () => {
  let matches = false;
  let changed: (() => void) | undefined;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addListener: vi.fn(),
      removeListener: vi.fn(),
      get matches() {
        return matches;
      },
      media: "(prefers-color-scheme: dark)",
      addEventListener: (_type: string, listener: () => void) => {
        changed = listener;
      },
      removeEventListener: vi.fn(),
    })),
  );
  const notify = vi.fn();
  const stop = subscribeToTheme(notify);
  setThemeMode("system");
  expect(themeSnapshot()).toBe("system:light");
  matches = true;
  changed?.();
  expect(notify).toHaveBeenCalled();
  expect(themeSnapshot()).toBe("system:dark");
  stop();
});

it("applies the resolved appearance before subscribers render", () => {
  document.documentElement.classList.remove("dark");
  let observed = "";
  const stop = subscribeToTheme(() => {
    observed = document.documentElement.className;
  });
  setThemeMode("dark");
  // A layout effect reading --background during the same pass must already see
  // the dark root class, not wait for a later parent effect.
  expect(observed).toContain("dark");
  setThemeMode("light");
  expect(observed).not.toContain("dark");
  stop();
});
