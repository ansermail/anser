// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  calendarLocale,
  dateLocale,
  interfaceLanguage,
  formatMailListTime,
  formatMailTime,
  setInterfaceLanguage,
  t,
} from "./i18n";
import { localizedFolderLabel } from "./remote-folders";
import type { RemoteFolder } from "./types";

afterEach(() => {
  setInterfaceLanguage("zh-CN");
  localStorage.clear();
});
it("keeps list dates compact in local calendar time and full timestamps available", () => {
  const now = new Date(2026, 10, 8, 12);
  const today = new Date(2026, 10, 8, 0, 7, 42).toISOString();
  expect(formatMailListTime(today, now)).toBe("00:07");
  expect(formatMailTime(today)).toContain("00:07:42");
  const recent = new Date(2026, 10, 6, 15).toISOString();
  expect(formatMailListTime(recent, now)).not.toContain("2026");
  const old = new Date(2025, 10, 6, 15).toISOString();
  expect(formatMailListTime(old, now)).toContain("2025");
  setInterfaceLanguage("en");
  expect(formatMailListTime(recent, now)).toBe("Nov 6");
  expect(formatMailListTime("invalid", now)).toBe("Unknown date");
});
it("switches catalog, calendar and document language without parsing inserted text", () => {
  setInterfaceLanguage("en");
  expect(t("All mail")).toBe("All mail");
  expect(dateLocale()).toBe("en-US");
  expect(calendarLocale().code).toBe("en-US");
  expect(document.documentElement.lang).toBe("en-US");
  expect(t("Select {value0}", { value0: "<b>账单 {value1}</b>" })).toBe(
    "Select <b>账单 {value1}</b>",
  );
  expect(t("user-defined-folder")).toBe("user-defined-folder");
  expect(t("constructor")).toBe("constructor");
  expect(t("__proto__")).toBe("__proto__");
  expect(() => setInterfaceLanguage("fr" as "en")).toThrow();
  expect(interfaceLanguage()).toBe("en");
  setInterfaceLanguage("zh-CN");
  expect(t("All mail")).toBe("全部邮件");
  expect(calendarLocale().code).toBe("zh-CN");
});
it("localizes system folder display while preserving custom names and wire paths", () => {
  setInterfaceLanguage("en");
  const folder: RemoteFolder = {
    accountId: "a",
    name: "INBOX",
    displayName: "收件箱",
    delimiter: "/",
    selectable: true,
    roles: ["inbox"],
  };
  expect(localizedFolderLabel(folder, folder.displayName)).toBe("Inbox");
  expect(folder.name).toBe("INBOX");
  expect(
    localizedFolderLabel({ ...folder, name: "账单", roles: [] }, "账单"),
  ).toBe("账单");
});
