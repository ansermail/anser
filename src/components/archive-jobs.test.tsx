// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { ArchiveJobsPanel, type ArchiveJob } from "./archive-jobs";
import * as api from "@/lib/api";
let root: Root, host: HTMLDivElement, items: ArchiveJob[];
async function click(label: string) {
  const b = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(b).toBeTruthy();
  await act(async () => b!.click());
}
async function render() {
  await act(async () => root.render(<ArchiveJobsPanel />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  items = [];
  vi.spyOn(api, "call").mockImplementation(async (command) =>
    command === "archive_jobs" ? (items as never) : (undefined as never),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function job(status: string, error = ""): ArchiveJob {
  return {
    id: status,
    mailId: "mail",
    accountEmail: "test@example.com",
    subject: "example",
    folder: "收件箱",
    status,
    error,
    updatedAt: "",
  };
}
it("separates pending, paused, failed and actual complete tasks and keeps reasons", async () => {
  items = [
    job("queued"),
    job("paused"),
    job("blocked", "来源已失效"),
    job("completed"),
  ];
  await render();
  expect(document.body.textContent).toContain("来源已失效");
  expect(document.body.textContent).toContain("完整已保存");
  await click("继续保存");
  expect(api.call).toHaveBeenCalledWith("archive_job_action", {
    id: "paused",
    action: "resume",
  });
  await click("重新检查并保存");
  expect(api.call).toHaveBeenCalledWith("archive_job_action", {
    id: "blocked",
    action: "retry",
  });
});
it("applies global controls to all tasks and refuses duplicate clicks while in flight", async () => {
  items = [job("running")];
  await render();
  let resolve!: () => void;
  vi.mocked(api.call).mockImplementation(async (command) =>
    command === "archive_job_action"
      ? (new Promise<void>((r) => {
          resolve = r;
        }) as never)
      : (items as never),
  );
  await click("暂停全部待保存");
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "取消全部未完成",
  )!;
  expect(button.disabled).toBe(true);
  await click("暂停全部待保存");
  expect(
    vi.mocked(api.call).mock.calls.filter(([c]) => c === "archive_job_action"),
  ).toHaveLength(1);
  expect(api.call).toHaveBeenCalledWith("archive_job_action", {
    id: "",
    action: "pause",
  });
  await act(async () => resolve());
});
it("shows load and action failures without pretending a save completed", async () => {
  items = [job("blocked")];
  await render();
  vi.mocked(api.call).mockRejectedValue(new Error("不能读取来源"));
  await click("重新检查并保存");
  expect(document.body.textContent).toContain("不能读取来源");
  expect(document.body.textContent).not.toContain("完整已保存");
});
