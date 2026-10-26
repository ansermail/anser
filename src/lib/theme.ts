import { useMemo, useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";

const storageKey = "mail-theme";
const darkQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();
let memoryMode: ThemeMode | null = null;
let mediaQuery: MediaQueryList | null | undefined;
let mediaListener: (() => void) | null = null;

export function normalizeTheme(value: unknown): ThemeMode {
  return value === "dark" || value === "system" ? value : "light";
}

export function nextTheme(mode: ThemeMode): ThemeMode {
  if (mode === "light") return "dark";
  if (mode === "dark") return "system";
  return "light";
}

export function resolvesToDark(mode: ThemeMode, systemDark: boolean) {
  return mode === "dark" || (mode === "system" && systemDark);
}

/** Apply the resolved appearance before anything reads theme CSS variables. */
export function applyThemeClass(dark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", dark);
}

function readTheme(): ThemeMode {
  if (memoryMode) return memoryMode;
  try {
    const value = localStorage.getItem(storageKey);
    memoryMode = normalizeTheme(value);
  } catch {
    memoryMode = "light";
  }
  return memoryMode;
}

function systemMedia() {
  if (mediaQuery !== undefined) return mediaQuery;
  mediaQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(darkQuery)
      : null;
  return mediaQuery;
}

function systemTheme(): "light" | "dark" {
  return systemMedia()?.matches ? "dark" : "light";
}

export function themeSnapshot() {
  return `${readTheme()}:${systemTheme()}`;
}

function publish() {
  listeners.forEach((listener) => listener());
}

export function subscribeToTheme(listener: () => void) {
  listeners.add(listener);
  const media = systemMedia();
  const storage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    memoryMode = null;
    publish();
  };
  const system = () => publish();
  window.addEventListener("storage", storage);
  if (media && !mediaListener) {
    mediaListener = system;
    media.addEventListener("change", mediaListener);
  }
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", storage);
    if (media && mediaListener && listeners.size === 0) {
      media.removeEventListener("change", mediaListener);
      mediaListener = null;
    }
  };
}

export function setThemeMode(mode: ThemeMode) {
  memoryMode = mode;
  try {
    localStorage.setItem(storageKey, mode);
  } catch {
    // The in-memory preference still works when storage is unavailable.
  }
  // The body iframe reads --background in a layout effect, which runs before a
  // parent effect would add the class; apply it here so the same render pass
  // already sees the new colors instead of keeping the previous scheme until
  // the mail is reopened.
  applyThemeClass(resolvesToDark(mode, systemTheme() === "dark"));
  publish();
}

/** Test-only reset for the module-level durable preference cache. */
export function resetThemeForTest() {
  memoryMode = null;
  mediaQuery = undefined;
  mediaListener = null;
  listeners.clear();
}

export function useTheme() {
  const value = useSyncExternalStore(
    subscribeToTheme,
    themeSnapshot,
    () => "light:light",
  );
  const separator = value.indexOf(":");
  const mode = normalizeTheme(value.slice(0, separator));
  const dark = resolvesToDark(mode, value.slice(separator + 1) === "dark");
  return useMemo(
    () => ({
      mode,
      dark,
      setMode: setThemeMode,
      cycleMode: () => setThemeMode(nextTheme(readTheme())),
    }),
    [dark, mode],
  );
}
