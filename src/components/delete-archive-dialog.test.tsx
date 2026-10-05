// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeleteArchiveDialog } from "./delete-archive-dialog";
import * as api from "@/lib/api";
let root: Root, host: HTMLDivElement;
const done = vi.fn();
const preview = {
  count: 3,
  bytes: 1024,
  offlineOnly: 1,
  reviewToken: "reviewed-scope",
  accounts: [
    { accountId: "a", name: "测试邮箱", email: "a@example.com", count: 3 },
  ],
};
let deletion: (args: Record<string, unknown>) => Promise<unknown>;
let calls: unknown;
function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
}
async function click(element: HTMLElement) {
  await act(async () => element.click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  done.mockClear();
  deletion = async () => ({
    deleted: 3,
    freedBytes: 1024,
    cleanupPending: false,
  });
  calls = vi
    .spyOn(api, "call")
    .mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "archive_deletion_preview") return preview as T;
        if (command === "delete_local_archives")
          return (await deletion(args)) as T;
        throw new Error(command);
      },
    );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<DeleteArchiveDialog onDeleted={done} />));
  await click(button("删除本地存档"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("shows offline loss, requires acknowledgement and cancels without deleting", async () => {
  expect(document.body.textContent).toContain("3 封");
  expect(document.body.textContent).toContain("1 封没有可用的服务器来源");
  expect(button("确认删除").disabled).toBe(true);
  await click(button("取消"));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(calls).not.toHaveBeenCalledWith(
    "delete_local_archives",
    expect.anything(),
  );
});
it("submits reviewed count and retention choice only after explicit confirmation", async () => {
  await click(document.getElementById("archive-stop-saving")!);
  expect(document.body.textContent).toContain("重新下载存档");
  await click(document.getElementById("archive-delete-confirm")!);
  expect(button("确认删除").disabled).toBe(false);
  await click(button("确认删除"));
  expect(calls).toHaveBeenCalledWith("delete_local_archives", {
    accountId: "",
    stopSaving: false,
    expectedCount: 3,
    expectedToken: "reviewed-scope",
  });
  expect(done).toHaveBeenCalledOnce();
});
it("keeps an error visible and requires confirmation again after a failed deletion", async () => {
  deletion = async () => {
    throw new Error("存档数量已变化，请重新查看删除范围后确认");
  };
  await click(document.getElementById("archive-delete-confirm")!);
  await click(button("确认删除"));
  expect(document.body.textContent).toContain("存档数量已变化");
  expect(button("确认删除").disabled).toBe(true);
  expect(done).not.toHaveBeenCalled();
});
