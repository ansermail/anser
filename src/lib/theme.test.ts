// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  initializeAppearance,
  nextTheme,
  normalizeTheme,
  resetThemeForTest,
  resolvesToDark,
  setThemeMode,
  setThemePalette,
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
  setThemePalette("light", "github");
  setThemePalette("dark", "dracula");
  setThemeMode("system");
  expect(themeSnapshot()).toBe("system:light:github:dracula");
  expect(document.documentElement.dataset.themePalette).toBe("github");
  matches = true;
  changed?.();
  expect(notify).toHaveBeenCalled();
  expect(themeSnapshot()).toBe("system:dark:github:dracula");
  expect(document.documentElement.dataset.themePalette).toBe("dracula");
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

it("restores the two preferences separately and falls back for an unknown preset", () => {
  localStorage.setItem("mail-theme", "dark");
  localStorage.setItem("mail-theme-light-palette", "removed-preset");
  localStorage.setItem("mail-theme-dark-palette", "nord");
  initializeAppearance();
  const root = document.documentElement;
  expect(root.dataset.themePalette).toBe("nord");
  expect(root.dataset.themeAppearance).toBe("dark");
  setThemeMode("light");
  expect(root.dataset.themePalette).toBe("pine");
  setThemePalette("dark", "dracula");
  expect(root.dataset.themePalette).toBe("pine");
  expect(localStorage.getItem("mail-theme-dark-palette")).toBe("dracula");
  setThemeMode("dark");
  expect(root.dataset.themePalette).toBe("dracula");
});

it("applies a dark palette change from another window before notifying subscribers", () => {
  setThemeMode("dark");
  const observed = vi.fn(() => document.documentElement.dataset.themePalette);
  const stop = subscribeToTheme(observed);
  localStorage.setItem("mail-theme-dark-palette", "tokyo");
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "mail-theme-dark-palette",
      newValue: "tokyo",
      storageArea: localStorage,
    }),
  );
  expect(observed).toHaveReturnedWith("tokyo");
  expect(themeSnapshot()).toBe("dark:dark:pine:tokyo");
  stop();
});
