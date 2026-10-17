// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { makeDemo } from "./demo";
import type { OutboxRecord } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

afterEach(() => {
  vi.resetModules();
  localStorage.clear();
});

it("lists fictional send records by recent activity regardless of status or timezone", async () => {
  localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(makeDemo()));
  localStorage.setItem(
    "mail-desktop-demo-v1-outbox",
    JSON.stringify([
      {
        id: "older-plan",
        status: "scheduled",
        updatedAt: "2026-10-15T23:00:00+08:00",
        scheduledAt: "2027-01-01T00:00:00Z",
      },
      { id: "newest", status: "sent", updatedAt: "2026-10-16T08:30:00Z" },
      {
        id: "middle",
        status: "failed",
        updatedAt: "2026-10-16T12:00:00+08:00",
      },
    ]),
  );
  const api = await import("./api");
  api.restoreDemo();
  const records = await api.call<OutboxRecord[]>("list_outbox");
  expect(records.map((record) => record.id)).toEqual([
    "newest",
    "middle",
    "older-plan",
  ]);
});
