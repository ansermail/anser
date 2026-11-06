// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadingCacheSettings } from "./reading-cache-settings";
import { call, enterDemo, leaveDemo } from "../lib/api";
import * as api from "../lib/api";
import type { ReadingCacheStatus } from "../lib/types";

let root: Root;
let host: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
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

it("shows reading cache usage and clears only the temporary cache", async () => {
  const original = api.call;
  let cleared = false;
  const status = (): ReadingCacheStatus =>
    cleared
      ? {
          entries: 0,
          bytes: 0,
          limitBytes: 1024 * 1024 * 1024,
          retentionDays: 30,
        }
      : {
          entries: 2,
          bytes: 3 * 1024 * 1024,
          limitBytes: 1024 * 1024 * 1024,
          retentionDays: 30,
        };
  vi.spyOn(api, "call").mockImplementation(
    async <T,>(command: string, args: Record<string, unknown> = {}) => {
      if (command === "reading_cache_status") return status() as T;
      if (command === "clear_reading_cache") {
        cleared = true;
        return status() as T;
      }
      return original<T>(command, args);
    },
  );

  await act(async () => root.render(<ReadingCacheSettings />));
  for (let i = 0; i < 20 && !host.textContent?.includes("2 封"); i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  expect(host.textContent).toContain("2 封");
  const clear = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("清除缓存"),
  )!;
  expect(clear.disabled).toBe(false);
  await act(async () => clear.click());
  const dialog = document.querySelector('[role="alertdialog"]')!;
  const confirm = [...dialog.querySelectorAll<HTMLButtonElement>("button")].at(
    -1,
  )!;
  await act(async () => confirm.click());
  expect(cleared).toBe(true);
  expect(await call<ReadingCacheStatus>("reading_cache_status")).toEqual(
    status(),
  );
});

it("preserves unrelated preferences changed after the card loaded", async () => {
  const basePreferences = {
    syncIntervalMinutes: 5,
    newMailNotifications: true,
    sendResultNotifications: true,
    readingCacheDays: 30,
    readingCacheLimitMb: 1024,
  };
  await call("save_preferences", { preferences: basePreferences });
  await act(async () => root.render(<ReadingCacheSettings />));
  for (let i = 0; i < 20 && !host.textContent?.includes("阅读缓存"); i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

  await call("save_preferences", {
    preferences: { ...basePreferences, syncIntervalMinutes: 15 },
  });
  await act(async () =>
    host
      .querySelector("#reading-cache-days")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const ninetyDays = [...document.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent === "90 天",
  )!;
  expect(ninetyDays).toBeTruthy();
  await act(async () =>
    ninetyDays.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  const save = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("保存"),
  )!;
  expect(save.disabled).toBe(false);
  await act(async () => save.click());
  let saved = await call<Record<string, unknown>>("get_preferences");
  for (let i = 0; i < 20 && saved.readingCacheDays !== 90; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    saved = await call<Record<string, unknown>>("get_preferences");
  }
  expect(saved).toMatchObject({
    syncIntervalMinutes: 15,
    readingCacheDays: 90,
    readingCacheLimitMb: 1024,
  });
});
