// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { OutboxPanel } from "./outbox-panel";
import { SidebarProvider } from "./ui/sidebar";
import * as api from "@/lib/api";
import type { OutboxRecord } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let host: HTMLDivElement, root: Root, records: OutboxRecord[];

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  records = [
    "uncertain",
    "blocked",
    "completed",
    "preparing",
    "legacy",
    "pop3",
    "failed",
  ].map((id) => ({
    id,
    status: id === "failed" ? "failed" : "sent",
    draft: {
      id,
      accountId: "demo-a",
      to: "recipient@example.com",
      subject: id,
    } as OutboxRecord["draft"],
    error: "",
    updatedAt: "2026-11-14T12:00:00Z",
    archived: true,
    serverCopyAvailable: id !== "pop3",
    serverCopy: ["legacy", "pop3", "failed"].includes(id)
      ? undefined
      : {
          status: id,
          target: "&ZeVnLIqe-",
          targetLabel: "日本語",
          error: id === "uncertain" ? "confirmation lost" : "",
          validity: 7,
        },
  }));
  vi.spyOn(api, "call").mockImplementation(async <T,>(command: string) =>
    command === "list_outbox" ? (records as T) : (undefined as T),
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

async function render() {
  await act(async () =>
    root.render(
      <SidebarProvider>
        <OutboxPanel onDraft={vi.fn()} />
      </SidebarProvider>,
    ),
  );
}

function row(id: string) {
  return host.querySelector<HTMLTableRowElement>(`[data-row-id="${id}"]`)!;
}

function dialog() {
  return document.querySelector<HTMLElement>('[data-slot="dialog-content"]');
}

async function openDetails(id: string) {
  await act(async () => {
    [...row(id).querySelectorAll("button")]
      .find((button) => button.textContent?.includes("详情"))!
      .click();
  });
}

async function closeDetails() {
  await act(async () =>
    dialog()?.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.click(),
  );
}

async function pressInDialog(label: string) {
  await act(async () => {
    [...dialog()!.querySelectorAll("button")]
      .find((button) => button.textContent === label)!
      .click();
  });
}

it("splits send records into a compact table and keeps diagnostics in details", async () => {
  await render();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(7);
  expect(host.textContent).toContain("收件人");
  expect(host.textContent).toContain("服务器副本");
  expect(row("uncertain").textContent).toContain("发送成功 · SMTP 已确认");
  expect(row("uncertain").textContent).toContain("recipient@example.com");
  expect(row("uncertain").textContent).toContain("保存结果未确认");
  expect(row("uncertain").textContent).not.toContain("confirmation lost");
  expect(
    host.querySelector(
      '[data-slot="table-container"] [data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]',
    ),
  ).toBeTruthy();

  await openDetails("uncertain");
  expect(dialog()?.textContent).toContain("日本語");
  expect(dialog()?.textContent).toContain("confirmation lost");
  expect(dialog()?.textContent).toContain("只读核对副本");
  await pressInDialog("只读核对副本");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "uncertain",
    action: "verify",
  });
  expect(
    vi.mocked(api.call).mock.calls.some(([command]) => command === "send_mail"),
  ).toBe(false);
});

it("queues legacy accepted records and retries only pre-submission failures", async () => {
  await render();
  await openDetails("legacy");
  await pressInDialog("保存到服务器已发送");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "legacy",
    action: "queue",
  });
  await closeDetails();

  await openDetails("blocked");
  await pressInDialog("重试保存副本");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "blocked",
    action: "retry",
  });
  await closeDetails();

  await openDetails("preparing");
  expect(dialog()?.textContent).not.toContain("重试保存副本");
  expect(dialog()?.textContent).toContain("重新编辑此邮件");
});

it("offers read-only verification for a rejected bound copy and never resends SMTP", async () => {
  records.push({
    ...records[1],
    id: "unbound",
    draft: { ...records[1].draft, subject: "unbound" },
    serverCopy: { ...records[1].serverCopy!, target: "", validity: 0 },
  });
  records.push({
    ...records[1],
    id: "reported",
    draft: { ...records[1].draft, subject: "reported" },
    serverCopy: {
      ...records[1].serverCopy!,
      status: "checking",
      origin: "smtpReported",
    },
  });
  await render();
  await openDetails("unbound");
  expect(dialog()?.textContent).not.toContain("只读核对副本");
  await closeDetails();

  await openDetails("reported");
  expect(dialog()?.textContent).toContain("不会再次上传");
  expect(dialog()?.textContent).not.toContain("重试保存副本");
  await closeDetails();

  await openDetails("blocked");
  await pressInDialog("只读核对副本");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "blocked",
    action: "verify",
  });
  expect(
    vi
      .mocked(api.call)
      .mock.calls.some(
        ([command]) => command === "send_mail" || command === "retry_outbox",
      ),
  ).toBe(false);
});

it("shows a cancelable send countdown in the table and immediate send in details", async () => {
  records = [
    {
      ...records[0],
      id: "undo-send",
      status: "scheduled",
      sendKind: "undo",
      scheduledAt: new Date(Date.now() + 8000).toISOString(),
      draft: { ...records[0].draft, subject: "undo-send" },
      serverCopy: undefined,
    },
  ];
  await render();
  expect(row("undo-send").textContent).toContain("等待发送");
  await openDetails("undo-send");
  expect(dialog()?.querySelector('[aria-label="发送等待进度"]')).not.toBeNull();
  expect(dialog()?.textContent).not.toContain("修改时间");
  await pressInDialog("立即发送");
  expect(api.call).toHaveBeenCalledWith("send_queued_now", { id: "undo-send" });
  expect(
    vi.mocked(api.call).mock.calls.some(([command]) => command === "send_mail"),
  ).toBe(false);
});

it("paginates long send histories fifteen rows at a time", async () => {
  records = Array.from({ length: 16 }, (_, index) => ({
    ...records[2],
    id: `record-${index}`,
    draft: {
      ...records[2].draft,
      id: `record-${index}`,
      subject: `Record ${index + 1}`,
    },
  }));
  await render();
  expect(host.querySelectorAll("tbody tr")).toHaveLength(15);
  expect(host.textContent).toContain("第 1 页，共 2 页");
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>('button[aria-label="下一页"]')!
      .click();
  });
  expect(row("record-15").textContent).toContain("Record 16");
});

it("shows all recipients, Cc and Bcc in bounded address groups", async () => {
  records[2] = {
    ...records[2],
    draft: {
      ...records[2].draft,
      to: Array.from(
        { length: 12 },
        (_, index) => `person-${index + 1}@example.com`,
      ).join(", "),
      cc: "manager@example.com, design@example.com",
      bcc: "archive@example.com",
    },
  };
  await render();
  const recipientCell = row("completed").querySelector(
    '[data-column="recipient"]',
  );
  expect(recipientCell?.textContent).toContain("person-1@example.com");
  expect(recipientCell?.textContent).toContain("+11");
  expect(
    recipientCell?.querySelector<HTMLElement>(".outbox-recipient-cell")?.title,
  ).toContain("person-12@example.com");
  await openDetails("completed");
  const lists = dialog()!.querySelectorAll(".outbox-detail-address-list");
  expect(lists).toHaveLength(3);
  expect(lists[0].querySelectorAll(".outbox-detail-address")).toHaveLength(12);
  expect(lists[1].querySelectorAll(".outbox-detail-address")).toHaveLength(2);
  expect(lists[2].querySelectorAll(".outbox-detail-address")).toHaveLength(1);
  expect(dialog()!.textContent).toContain("person-12@example.com");
  expect(dialog()!.textContent).toContain("archive@example.com");
});

it("hides empty columns instead of rendering dashes across the table", async () => {
  records = [
    {
      ...records[6],
      draft: {
        ...records[6].draft,
        to: "",
        subject: "offline failure",
      },
      updatedAt: "",
      serverCopy: undefined,
      serverCopyAvailable: false,
    },
  ];
  await render();
  expect(host.textContent).not.toContain("收件人");
  expect(host.textContent).not.toContain("计划时间");
  expect(host.textContent).not.toContain("服务器副本");
  expect(row("failed").textContent).toContain("offline failure");
});
