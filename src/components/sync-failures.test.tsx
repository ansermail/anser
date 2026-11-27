// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { SyncFailuresPanel, type SyncFailureItem } from "./sync-failures";

let root: Root;
let host: HTMLDivElement;

const sample: SyncFailureItem = {
  accountId: "acc-1",
  accountEmail: "work@example.com",
  folder: "INBOX",
  displayName: "收件箱",
  remoteId: "7:42",
  uid: 42,
  subject: "大附件报价单",
  sender: "Alice <alice@example.com>",
  date: "2026-11-27T01:00:00Z",
  size: 26 * 1024 * 1024,
  stage: "下载 UID 42 的完整邮件",
  reason: "读取超时",
  status: "failed",
  failedAt: "2026-11-27T01:05:00Z",
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SyncFailuresPanel", () => {
  it("shows readable message identity and supports retry, header-only and skip actions", async () => {
    let items: SyncFailureItem[] = [sample];
    const resolved = vi.fn();
    const callSpy = vi
      .spyOn(api, "call")
      .mockImplementation(async (command, args) => {
        if (command === "sync_failures") return items as never;
        if (command === "sync_failure_action") {
          const action = args?.action as string;
          if (action === "skip") {
            items = [{ ...sample, status: "skipped" }];
          } else if (action === "dismiss") {
            items = [];
          }
          return null as never;
        }
        return null as never;
      });

    await act(async () =>
      root.render(<SyncFailuresPanel onResolved={resolved} />),
    );
    expect(host.textContent).toContain("大附件报价单");
    expect(host.textContent).toContain("读取超时");
    expect(host.textContent).toContain("1 封失败");

    const skipButton = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent?.trim() === "跳过此邮件",
    );
    expect(skipButton).toBeTruthy();
    await act(async () => skipButton!.click());

    expect(callSpy).toHaveBeenCalledWith("sync_failure_action", {
      accountId: "acc-1",
      folder: "INBOX",
      remoteId: "7:42",
      action: "skip",
    });
    expect(resolved).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("已跳过");

    const dismissButton = [...host.querySelectorAll("button")].find(
      (btn) => btn.textContent?.trim() === "移除记录",
    );
    expect(dismissButton).toBeTruthy();
    await act(async () => dismissButton!.click());
    expect(host.textContent).toContain("没有拉取失败的邮件");
  });
});
