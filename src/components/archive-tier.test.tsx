// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ArchiveTier } from "./archive-tier";
import type { ArchiveTierStatus } from "@/lib/types";
import { enterDemo, leaveDemo } from "../lib/api";
import * as api from "../lib/api";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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

const idle: ArchiveTierStatus = {
  configured: true,
  path: "/Volumes/Archive/Anser-Archive",
  available: true,
  error: "",
  retentionDays: 7,
  archivedCount: 62744,
  archivedBytes: 13.3 * 1024 * 1024 * 1024,
  pendingCount: 28,
  pendingBytes: 2 * 1024,
  running: false,
  action: "",
  completed: 0,
  total: 0,
  recent: [
    {
      id: 2,
      time: "2026-11-04T08:00:00Z",
      action: "archive",
      moved: 1,
      bytes: 2048,
      error: "",
    },
    {
      id: 1,
      time: "2026-11-03T08:00:00Z",
      action: "retrieve",
      moved: 2,
      bytes: 4096,
      error: "",
    },
  ],
};

it("shows attached archive counts, pending work and recent records", async () => {
  vi.spyOn(api, "call").mockImplementation(async <T,>(command: string) => {
    if (command === "archive_tier_status") return idle as T;
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(<ArchiveTier onChanged={() => {}} />));
  expect(host.textContent).toContain("附加存档");
  expect(host.textContent).toContain("62744");
  expect(host.textContent).toContain("13.3 GB");
  expect(host.textContent).toContain("28");
  expect(host.textContent).toContain("等待归档");
  expect(host.textContent).toContain("最近归档记录");
  const recent = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.includes("最近归档记录"),
  )!;
  await act(async () => recent.click());
  expect(host.textContent).toContain("已归档");
  expect(host.textContent).toContain("已取回本地");
  expect(host.textContent).toContain("2 KB");
});

it("renders task progress and a disconnected archive error", async () => {
  vi.spyOn(api, "call").mockImplementation(async <T,>(command: string) => {
    if (command === "archive_tier_status") {
      return {
        ...idle,
        available: false,
        error: "附加存档盘未连接或目录不可用，请连接原磁盘",
        running: true,
        action: "archive",
        completed: 3,
        total: 10,
      } as T;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  await act(async () => root.render(<ArchiveTier onChanged={() => {}} />));
  expect(host.textContent).toContain("未连接");
  expect(host.textContent).toContain("附加存档任务：3 / 10");
  expect(host.textContent).toContain("附加存档盘未连接");
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
});
