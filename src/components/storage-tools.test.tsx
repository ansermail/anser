// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArchiveIntegrity } from "./archive-integrity";
import type { ArchiveHealth } from "@/lib/types";
import { StorageTools } from "./storage-tools";
import { enterDemo, leaveDemo, call } from "../lib/api";
import * as api from "../lib/api";
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
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
it("persists independent notification toggles and leaves the sync interval intact", async () => {
  await call("save_preferences", {
    preferences: {
      syncIntervalMinutes: 15,
      newMailNotifications: true,
      sendResultNotifications: true,
    },
  });
  await act(async () => root.render(<StorageTools />));
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#new-mail-notifications")!.click(),
  );
  expect(await call("get_preferences")).toEqual({
    syncIntervalMinutes: 15,
    newMailNotifications: false,
    sendResultNotifications: true,
  });
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>("#send-result-notifications")!
      .click(),
  );
  expect(await call("get_preferences")).toEqual({
    syncIntervalMinutes: 15,
    newMailNotifications: false,
    sendResultNotifications: false,
  });
  await act(async () =>
    host.querySelector<HTMLButtonElement>("#auto-start")!.click(),
  );
  expect(
    (await call<{ autoStart: boolean }>("desktop_settings")).autoStart,
  ).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<StorageTools />));
  expect(
    host.querySelector("#new-mail-notifications")?.getAttribute("aria-checked"),
  ).toBe("false");
  expect(host.querySelector("#auto-start")?.getAttribute("aria-checked")).toBe(
    "true",
  );
});
it("does not register a development preview as a broken login startup item", async () => {
  const original = api.call;
  vi.spyOn(api, "call").mockImplementation(
    async <T,>(command: string, args: Record<string, unknown> = {}) =>
      command === "desktop_settings"
        ? ({ autoStart: false, autoStartAvailable: false } as T)
        : original<T>(command, args),
  );
  await act(async () => root.render(<StorageTools />));
  expect(host.querySelector<HTMLButtonElement>("#auto-start")?.disabled).toBe(
    true,
  );
  expect(host.textContent).toContain("请在正式应用中开启开机自启");
});
it("checks originals from the summary control and preserves progress and problem details", async () => {
  let resolve!: (health: ArchiveHealth) => void;
  const request = vi.spyOn(api, "call").mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r as typeof resolve;
      }),
  );
  await act(async () => root.render(<ArchiveIntegrity />));
  const button = host.querySelector("button")!;
  await act(async () => {
    button.click();
    button.click();
  });
  expect(request).toHaveBeenCalledExactlyOnceWith("archive_health");
  expect(button.disabled).toBe(true);
  expect(host.textContent).toContain("正在校验原始邮件与附件");
  await act(async () =>
    resolve({
      checked: 2,
      healthy: 1,
      checkedAt: "2026-10-09T08:00:00Z",
      problems: [{ mailId: "test", subject: "example", error: "原件缺失" }],
    }),
  );
  expect(button.disabled).toBe(false);
  expect(host.textContent).toContain("1 / 2 封校验通过");
  expect(host.textContent).toContain("原件缺失");
});
it("reports an integrity check failure without presenting a successful count", async () => {
  vi.spyOn(api, "call").mockRejectedValueOnce(new Error("存档磁盘未连接"));
  await act(async () => root.render(<ArchiveIntegrity />));
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("校验未完成");
  expect(host.textContent).toContain("存档磁盘未连接");
  expect(host.textContent).not.toContain("封校验通过");
});
