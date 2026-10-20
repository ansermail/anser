// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageSettings } from "./language-settings";
import { StorageTools } from "./storage-tools";
import { call, enterDemo, leaveDemo } from "@/lib/api";
import * as api from "@/lib/api";
import { interfaceLanguage, setInterfaceLanguage } from "@/lib/i18n";
import { toast } from "sonner";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  setInterfaceLanguage("zh-CN");
  enterDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  setInterfaceLanguage("zh-CN");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function selectEnglish() {
  await act(async () =>
    host
      .querySelector("#interface-language")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent === "English",
  )!;
  expect(option).toBeTruthy();
  await act(async () =>
    option.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
it("saves through the language selector, survives unrelated preference writes and restores on remount", async () => {
  await act(async () =>
    root.render(
      <>
        <LanguageSettings />
        <StorageTools />
      </>,
    ),
  );
  await selectEnglish();
  expect(interfaceLanguage()).toBe("en");
  expect(await call("get_interface_language")).toBe("en");
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#new-mail-notifications")!.click(),
  );
  expect(await call("get_interface_language")).toBe("en");
  await act(async () => root.unmount());
  root = createRoot(host);
  setInterfaceLanguage("zh-CN");
  await act(async () => root.render(<LanguageSettings />));
  expect(interfaceLanguage()).toBe("en");
  expect(host.textContent).toContain("Interface language");
});
it("keeps the displayed language and saved preference on a failed save", async () => {
  const errorToast = vi
    .spyOn(toast, "error")
    .mockImplementation(() => "fixture");
  const original = api.call;
  vi.spyOn(api, "call").mockImplementation((command, args) =>
    command === "set_interface_language"
      ? Promise.reject("save failed")
      : original(command, args),
  );
  await act(async () => root.render(<LanguageSettings />));
  await selectEnglish();
  expect(interfaceLanguage()).toBe("zh-CN");
  expect(await original("get_interface_language")).toBe("zh-CN");
  expect(errorToast).toHaveBeenCalledWith("save failed");
  expect(
    host.querySelector<HTMLButtonElement>("#interface-language")!.disabled,
  ).toBe(false);
});
