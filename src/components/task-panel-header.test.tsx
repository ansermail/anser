// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ArchiveJobsPanel } from "./archive-jobs";
import { ServerOperations } from "./server-operations";
import { FolderHealthPanel } from "./folder-health";
import { DirectoryOperationsPanel } from "./server-copy";
import * as api from "@/lib/api";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const cases = [
  {
    Panel: ArchiveJobsPanel,
    title: "完整保存任务",
    command: "archive_jobs",
    initial: [],
    updated: [
      {
        id: "fresh",
        subject: "Fresh fixture",
        status: "completed",
        error: "",
        folder: "INBOX",
        accountEmail: "test@example.com",
      },
    ],
    text: "Fresh fixture",
  },
  {
    Panel: ServerOperations,
    title: "服务器状态同步",
    command: "server_operations",
    initial: { pending: 0, blocked: 0, completed: 0, items: [] },
    updated: { pending: 7, blocked: 0, completed: 0, items: [] },
    text: "待同步 7",
  },
  {
    Panel: FolderHealthPanel,
    title: "目录来源检查",
    command: "folder_health",
    initial: [],
    updated: [
      {
        accountId: "fixture",
        accountEmail: "test@example.com",
        folder: "INBOX",
        displayName: "Fresh fixture",
        reason: "fixture",
        checkedAt: "",
        sources: 0,
        alternateSources: 0,
        saved: 0,
        evidence: { exists: 0, uidCount: 0, inboxUidOverlap: 0 },
      },
    ],
    text: "Fresh fixture",
  },
  {
    Panel: DirectoryOperationsPanel,
    title: "服务器文件夹操作",
    command: "directory_operations",
    initial: [],
    updated: [
      {
        id: "fresh",
        subject: "Fresh fixture",
        status: "completed",
        error: "",
        folder: "INBOX",
        target: "Archive",
        accountEmail: "test@example.com",
      },
    ],
    text: "Fresh fixture",
  },
];
it.each(cases)(
  "$title: expands from description and refreshes data without toggling the panel",
  async ({ Panel, title, command, initial, updated, text }) => {
    const read = vi.spyOn(api, "call").mockResolvedValue(initial as never);
    await act(async () => root.render(<Panel defaultCollapsed />));
    const trigger = host.querySelector(
      `[aria-label="展开或收起${title}"]`,
    ) as HTMLButtonElement;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () =>
      (trigger.querySelector("span span:last-child") as HTMLElement).click(),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await act(async () =>
      (trigger.querySelector("span span:first-child") as HTMLElement).click(),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    let resolve!: (value: unknown) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never,
    );
    const refresh = host.querySelector(
      `[aria-label="刷新${title}"]`,
    ) as HTMLButtonElement;
    await act(async () => {
      refresh.click();
      refresh.click();
    });
    expect(refresh.disabled).toBe(true);
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(
      refresh.querySelector("svg")?.classList.contains("animate-spin"),
    ).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(read.mock.calls.map(([name]) => name)).toEqual([command, command]);
    await act(async () => resolve(updated));
    await act(async () => trigger.click());
    expect(host.textContent).toContain(text);
    expect(refresh.disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(600));
    expect(refresh.disabled).toBe(false);
    expect(refresh.getAttribute("aria-busy")).toBe("false");
    expect(
      refresh.querySelector("svg")?.classList.contains("animate-spin"),
    ).toBe(false);
  },
);
it("keeps refresh busy for a slow request and releases it after failure", async () => {
  const read = vi.spyOn(api, "call").mockResolvedValue([] as never);
  await act(async () => root.render(<ArchiveJobsPanel />));
  let reject!: (reason: Error) => void;
  read.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }) as never,
  );
  const refresh = host.querySelector(
    '[aria-label="刷新完整保存任务"]',
  ) as HTMLButtonElement;
  await act(async () => refresh.click());
  await act(async () => vi.advanceTimersByTime(1200));
  expect(refresh.disabled).toBe(true);
  await act(async () => reject(new Error("Read fixture failed")));
  await act(async () => vi.advanceTimersByTime(0));
  expect(host.textContent).toContain("Read fixture failed");
  expect(refresh.disabled).toBe(false);
  expect(refresh.getAttribute("aria-busy")).toBe("false");
});
