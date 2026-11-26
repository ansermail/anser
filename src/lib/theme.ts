import { useMemo, useSyncExternalStore } from "react";
import { normalizeThemePalette, type ThemePalette } from "./theme-palettes";

export type ThemeMode = "light" | "dark" | "system";
export type ThemeAppearance = Exclude<ThemeMode, "system">;

const storageKey = "mail-theme";
const paletteKeys = {
  light: "mail-theme-light-palette",
  dark: "mail-theme-dark-palette",
} as const;
const darkQuery = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();
let memoryMode: ThemeMode | null = null;
const memoryPalettes: Partial<Record<ThemeAppearance, ThemePalette>> = {};
let mediaQuery: MediaQueryList | null | undefined;
let restoreTransitionsFrame = 0;

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

export function applyThemeAppearance(
  appearance: ThemeAppearance,
  palette: ThemePalette,
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const changed =
    root.dataset.themeAppearance !== appearance ||
    root.dataset.themePalette !== palette;
  if (
    changed &&
    root.dataset.themeAppearance &&
    typeof requestAnimationFrame === "function"
  ) {
    root.dataset.themeChanging = "";
    cancelAnimationFrame(restoreTransitionsFrame);
    restoreTransitionsFrame = requestAnimationFrame(() => {
      restoreTransitionsFrame = requestAnimationFrame(() => {
        delete root.dataset.themeChanging;
        restoreTransitionsFrame = 0;
      });
    });
  }
  root.classList.toggle("dark", appearance === "dark");
  if (root.dataset.themeAppearance !== appearance)
    root.dataset.themeAppearance = appearance;
  if (root.dataset.themePalette !== palette)
    root.dataset.themePalette = palette;
}

function readPreference(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The in-memory preference still works when storage is unavailable.
  }
}

function readTheme() {
  return (memoryMode ??= normalizeTheme(readPreference(storageKey)));
}

function readPalette(appearance: ThemeAppearance) {
  return (memoryPalettes[appearance] ??= normalizeThemePalette(
    readPreference(paletteKeys[appearance]),
  ));
}

function systemMedia() {
  if (mediaQuery !== undefined) return mediaQuery;
  mediaQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(darkQuery)
      : null;
  return mediaQuery;
}

function readAppearance(mode: ThemeMode): ThemeAppearance {
  return resolvesToDark(mode, systemMedia()?.matches === true)
    ? "dark"
    : "light";
}

export function themeSnapshot() {
  const mode = readTheme();
  return `${mode}:${readAppearance(mode)}:${readPalette("light")}:${readPalette("dark")}`;
}

export function initializeAppearance() {
  const appearance = readAppearance(readTheme());
  applyThemeAppearance(appearance, readPalette(appearance));
}

function publish() {
  initializeAppearance();
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  const { key, storageArea } = event;
  if (storageArea && storageArea !== window.localStorage) return;
  if (
    key !== null &&
    key !== storageKey &&
    key !== paletteKeys.light &&
    key !== paletteKeys.dark
  )
    return;
  if (key === null || key === storageKey) memoryMode = null;
  if (key === null || key === paletteKeys.light) delete memoryPalettes.light;
  if (key === null || key === paletteKeys.dark) delete memoryPalettes.dark;
  publish();
}

export function subscribeToTheme(listener: () => void) {
  if (!listeners.size) {
    window.addEventListener("storage", onStorage);
    systemMedia()?.addEventListener("change", publish);
    initializeAppearance();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener("storage", onStorage);
      systemMedia()?.removeEventListener("change", publish);
    }
  };
}

export function setThemeMode(mode: ThemeMode, persist = true) {
  memoryMode = mode;
  if (persist) savePreference(storageKey, mode);
  publish();
}

export function setThemePalette(
  appearance: ThemeAppearance,
  palette: ThemePalette,
) {
  memoryPalettes[appearance] = palette;
  savePreference(paletteKeys[appearance], palette);
  publish();
}

/** Test-only reset for the module-level durable preference cache. */
export function resetThemeForTest() {
  memoryMode = null;
  delete memoryPalettes.light;
  delete memoryPalettes.dark;
  if (typeof window !== "undefined") {
    window.removeEventListener("storage", onStorage);
    mediaQuery?.removeEventListener("change", publish);
    if (restoreTransitionsFrame) cancelAnimationFrame(restoreTransitionsFrame);
    restoreTransitionsFrame = 0;
    delete document.documentElement.dataset.themeChanging;
  }
  mediaQuery = undefined;
  listeners.clear();
}

export function useTheme() {
  const value = useSyncExternalStore(
    subscribeToTheme,
    themeSnapshot,
    () => "light:light:pine:pine",
  );
  const [storedMode, resolvedAppearance, light, dark] = value.split(":");
  const mode = normalizeTheme(storedMode);
  const appearance: ThemeAppearance =
    resolvedAppearance === "dark" ? "dark" : "light";
  const lightPalette = normalizeThemePalette(light);
  const darkPalette = normalizeThemePalette(dark);
  return useMemo(
    () => ({
      mode,
      appearance,
      dark: appearance === "dark",
      palette: appearance === "dark" ? darkPalette : lightPalette,
      palettes: { light: lightPalette, dark: darkPalette },
      setMode: setThemeMode,
      setPalette: setThemePalette,
      cycleMode: () => setThemeMode(nextTheme(readTheme())),
    }),
    [appearance, darkPalette, lightPalette, mode],
  );
}
