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
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("persists independent notification toggles and leaves the sync interval intact", async () => {
  await call("save_preferences", {
    preferences: {
      syncIntervalMinutes: 15,
      newMailNotifications: true,
      sendResultNotifications: true,
      readingCacheDays: 90,
      readingCacheLimitMb: 512,
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
    readingCacheDays: 90,
    readingCacheLimitMb: 512,
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
    readingCacheDays: 90,
    readingCacheLimitMb: 512,
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
const idleHealth: ArchiveHealth = {
  checked: 0,
  healthy: 0,
  checkedAt: "",
  problems: [],
  mode: "fast",
  running: false,
  total: 0,
  completed: false,
  cancelled: false,
  startedAt: "",
  problemCount: 0,
  error: "",
};
const buttonNamed = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(name),
  )!;
it("runs a fast check from the summary control, reports progress, and prevents duplicate starts", async () => {
  vi.useFakeTimers();
  let statusCalls = 0;
  const request = vi
    .spyOn(api, "call")
    .mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "archive_verification_status") {
          statusCalls += 1;
          return (
            statusCalls === 1
              ? idleHealth
              : {
                  ...idleHealth,
                  checked: 3,
                  healthy: 3,
                  total: 4,
                  running: true,
                }
          ) as T;
        }
        if (command === "start_archive_verification") {
          expect(args).toEqual({ mode: "fast" });
          return {
            ...idleHealth,
            checked: 1,
            healthy: 1,
            total: 4,
            running: true,
          } as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    );
  await act(async () => root.render(<ArchiveIntegrity />));
  await act(async () => {
    buttonNamed("快速校验").click();
    buttonNamed("快速校验").click();
  });
  expect(
    request.mock.calls.filter(
      ([command]) => command === "start_archive_verification",
    ),
  ).toHaveLength(1);
  expect(host.textContent).toContain("快速校验进行中：1 / 4 封");
  expect(buttonNamed("快速校验").disabled).toBe(true);
  expect(buttonNamed("深度校验").disabled).toBe(true);
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(host.textContent).toContain("快速校验进行中：3 / 4 封");
});
it("runs a deep check and shows problem details with the truncation notice", async () => {
  const request = vi
    .spyOn(api, "call")
    .mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "archive_verification_status") return idleHealth as T;
        if (command === "start_archive_verification") {
          expect(args).toEqual({ mode: "deep" });
          return {
            ...idleHealth,
            checked: 4,
            healthy: 3,
            checkedAt: "2026-10-09T08:00:00Z",
            problems: [
              {
                mailId: "test",
                subject: "example",
                error: "附件解码失败",
              },
            ],
            mode: "deep",
            total: 4,
            completed: true,
            problemCount: 3,
          } as T;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    );
  await act(async () => root.render(<ArchiveIntegrity />));
  await act(async () => buttonNamed("深度校验").click());
  expect(
    request.mock.calls.filter(
      ([command]) => command === "start_archive_verification",
    ),
  ).toHaveLength(1);
  expect(host.textContent).toContain("3 / 4 封校验通过");
  expect(host.textContent).toContain("3 封需要检查");
  expect(host.textContent).toContain("仅显示前 1 个问题。");
  expect(host.textContent).toContain("example");
  expect(host.textContent).toContain("附件解码失败");
  expect(host.textContent).toContain("最近校验：");
  expect(host.textContent).toContain("深度校验");
});
it("cancels a running check and reflects the cancelled progress", async () => {
  vi.useFakeTimers();
  let statusCalls = 0;
  const request = vi
    .spyOn(api, "call")
    .mockImplementation(async <T,>(command: string) => {
      if (command === "archive_verification_status") {
        statusCalls += 1;
        return (
          statusCalls === 1
            ? idleHealth
            : {
                ...idleHealth,
                checked: 4,
                healthy: 4,
                total: 10,
                cancelled: true,
              }
        ) as T;
      }
      if (command === "start_archive_verification") {
        return {
          ...idleHealth,
          checked: 4,
          healthy: 4,
          total: 10,
          running: true,
          mode: "deep",
        } as T;
      }
      if (command === "cancel_archive_verification") {
        return {
          ...idleHealth,
          checked: 4,
          healthy: 4,
          total: 10,
          running: true,
          mode: "deep",
        } as T;
      }
      throw new Error(`Unexpected command: ${command}`);
    });
  await act(async () => root.render(<ArchiveIntegrity />));
  await act(async () => buttonNamed("深度校验").click());
  await act(async () => buttonNamed("取消校验").click());
  expect(
    request.mock.calls.filter(
      ([command]) => command === "cancel_archive_verification",
    ),
  ).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(600));
  expect(host.textContent).toContain("已取消校验，完成 4 / 10 封。");
  expect(buttonNamed("快速校验").disabled).toBe(false);
});
it("reports a check failure without presenting a successful count", async () => {
  vi.spyOn(api, "call").mockImplementation(async <T,>(command: string) => {
    if (command === "archive_verification_status") return idleHealth as T;
    if (command === "start_archive_verification") {
      throw new Error("存档磁盘未连接");
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(<ArchiveIntegrity />));
  await act(async () => buttonNamed("快速校验").click());
  expect(host.textContent).toContain("校验未完成");
  expect(host.textContent).toContain("存档磁盘未连接");
  expect(host.textContent).not.toContain("封校验通过");
});
