import { useSyncExternalStore } from "react";
import { enUS, zhCN } from "date-fns/locale";
import chinese from "../locales/zh-CN.json";
import english from "../locales/en.json";
import config from "../locales/config.json";

export type InterfaceLanguage = "zh-CN" | "en";
const catalogs: Record<InterfaceLanguage, Record<string, string>> = {
  "zh-CN": chinese,
  en: english,
};
const cacheKey = "anser-interface-language";
const preview = import.meta.env.MODE === "preview";
export const languageOptions = config.languages;
let language = config.defaultLanguage as InterfaceLanguage;
try {
  const stored = preview ? null : localStorage.getItem(cacheKey);
  if (stored === "en" || stored === "zh-CN") language = stored;
} catch {
  // Persisted native preferences remain authoritative if browser storage fails.
}
const listeners = new Set<() => void>();
let revision = 0;
export const interfaceLanguageRevision = () => revision;
export const interfaceLanguage = () => language;
export const dateLocale = () =>
  config.languages.find((item) => item.code === language)!.dateLocale;
export const calendarLocale = () => (language === "en" ? enUS : zhCN);
export function formatMailTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("Unknown date");
  if (dateLocale() === "en-US") return date.toLocaleString(dateLocale());
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function setInterfaceLanguage(next: InterfaceLanguage) {
  if (next !== "en" && next !== "zh-CN") throw new Error("Invalid language");
  language = next;
  revision++;
  if (typeof document !== "undefined") {
    document.documentElement.lang = dateLocale();
    document.title = next === "en" ? "Anser" : "雁信";
  }
  try {
    if (!preview) localStorage.setItem(cacheKey, next);
  } catch {
    // The backend stores the preference before this in-memory publication.
  }
  listeners.forEach((listener) => listener());
}

export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    interfaceLanguage,
    () => config.defaultLanguage as InterfaceLanguage,
  );
}

export function t(key: string, values: Record<string, unknown> = {}) {
  const current = catalogs[language];
  const fallback = catalogs[config.fallbackLanguage as InterfaceLanguage];
  const template = Object.hasOwn(current, key)
    ? current[key]
    : Object.hasOwn(fallback, key)
      ? fallback[key]
      : key;
  // Replace only the template's tokens; interpolated user text is never parsed.
  return template.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
