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
    updatedAt: "",
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
async function render(expand = true) {
  await act(async () =>
    root.render(
      <SidebarProvider>
        <OutboxPanel onDraft={vi.fn()} />
      </SidebarProvider>,
    ),
  );
  if (expand) {
    for (const trigger of [
      ...host.querySelectorAll<HTMLButtonElement>(
        '[data-slot="collapsible-trigger"]',
      ),
    ]) {
      await act(async () => trigger.click());
    }
  }
}
function card(id: string) {
  return [...host.querySelectorAll("article")].find(
    (a) => a.querySelector("h3")?.textContent === id,
  )!;
}
async function press(id: string, label: string) {
  await act(async () => {
    [...card(id).querySelectorAll("button")]
      .find((b) => b.textContent === label)!
      .click();
  });
}
it("separates SMTP success from uncertain archival and restricts its actions", async () => {
  await render();
  expect(card("uncertain").textContent).toContain("发送成功 · SMTP 已确认");
  expect(card("uncertain").textContent).toContain("保存结果未确认");
  expect(card("uncertain").textContent).toContain("日本語");
  expect(card("uncertain").textContent).not.toContain("重试保存副本");
  expect(card("completed").textContent).toContain("服务器已发送副本已核对");
  expect(card("pop3").textContent).not.toContain("保存到服务器已发送");
  expect(card("failed").textContent).not.toContain("保存到服务器已发送");
  await press("uncertain", "只读核对副本");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "uncertain",
    action: "verify",
  });
  expect(
    vi.mocked(api.call).mock.calls.some(([command]) => command === "send_mail"),
  ).toBe(false);
});
it("queues legacy accepted records explicitly and retries only pre-submission failures", async () => {
  await render();
  await press("legacy", "保存到服务器已发送");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "legacy",
    action: "queue",
  });
  await press("blocked", "重试保存副本");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "blocked",
    action: "retry",
  });
  expect(card("preparing").textContent).not.toContain("重试保存副本");
  expect(card("preparing").textContent).toContain("重新编辑此邮件");
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
  expect(card("unbound").textContent).not.toContain("只读核对副本");
  expect(card("reported").textContent).toContain("不会再次上传");
  expect(card("reported").textContent).not.toContain("重试保存副本");
  await press("blocked", "只读核对副本");
  expect(api.call).toHaveBeenCalledWith("sent_upload_action", {
    id: "blocked",
    action: "verify",
  });
  expect(
    vi
      .mocked(api.call)
      .mock.calls.some(
        ([cmd]) => cmd === "send_mail" || cmd === "retry_outbox",
      ),
  ).toBe(false);
});
it("shows a cancelable send countdown and submits immediate send through the queued record", async () => {
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
  await render(false);
  expect(card("undo-send").textContent).toContain("等待发送");
  expect(
    card("undo-send").querySelector('[aria-label="发送等待进度"]'),
  ).not.toBeNull();
  expect(card("undo-send").textContent).not.toContain("修改时间");
  await press("undo-send", "立即发送");
  expect(api.call).toHaveBeenCalledWith("send_queued_now", { id: "undo-send" });
  expect(
    vi.mocked(api.call).mock.calls.some(([command]) => command === "send_mail"),
  ).toBe(false);
});
it("keeps completed records compact until details are opened", async () => {
  await render(false);
  expect(card("completed").textContent).toContain("completed");
  expect(card("completed").textContent).not.toContain("服务器已发送副本已核对");
  await act(async () =>
    card("completed")
      .querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')!
      .click(),
  );
  expect(card("completed").textContent).toContain("服务器已发送副本已核对");
});
