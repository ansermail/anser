// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  DirectoryOperationsPanel,
  type DirectoryOperation,
} from "./server-copy";
import * as api from "@/lib/api";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
let host: HTMLDivElement, root: Root;
let items: DirectoryOperation[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  items = ["uncertain", "confirmed", "blocked", "queued", "completed"].map(
    (status) =>
      ({
        id: status,
        subject: status,
        accountEmail: "owner@example.com",
        folder: "收件箱",
        target: "归档",
        error: "",
        status,
      }) as DirectoryOperation,
  );
  vi.spyOn(api, "call").mockImplementation(async (command) => {
    if (command === "directory_operations")
      return structuredClone(items) as never;
    if (
      command === "queue_server_copy" ||
      command === "queue_server_move" ||
      command === "directory_operation_action"
    )
      return "task-id" as never;
    throw new Error("Unexpected command");
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
}
describe("directory task feedback", () => {
  it("keeps interrupted compatibility moves distinct from copying and wires explicit continuation", async () => {
    items = ["cleanup_pending", "cleanup_uncertain", "cleanup_blocked"].map(
      (status) =>
        ({
          ...items[0],
          id: status,
          kind: "move",
          strategy: "copy-delete",
          receipt: { validity: 9, uid: 34 },
          status,
        }) as DirectoryOperation,
    );
    await act(async () => root.render(<DirectoryOperationsPanel />));
    const rows = host.querySelectorAll("li");
    expect(rows[0].textContent).toContain("待完成移动");
    expect(rows[0].querySelectorAll("button")).toHaveLength(0);
    expect(rows[1].textContent).toContain("原目录结果未确认");
    expect(rows[1].textContent).toContain("只读核对");
    expect(rows[1].textContent).toContain("继续移除原目录");
    expect(rows[1].textContent).not.toContain("重试");
    await act(async () => button("继续移除原目录").click());
    expect(api.call).toHaveBeenCalledWith("directory_operation_action", {
      id: "cleanup_uncertain",
      action: "continue_move",
    });
  });
  it("never offers continuation for missing receipts or ordinary MOVE results", async () => {
    items[0] = {
      ...items[0],
      kind: "move",
      strategy: "copy-delete",
      receipt: null,
    };
    items[1] = {
      ...items[1],
      kind: "move",
      strategy: null,
      receipt: { validity: 9, uid: 34 },
    };
    await act(async () => root.render(<DirectoryOperationsPanel />));
    expect(host.textContent).not.toContain("继续移除原目录");
  });
  it("offers only safe actions for each persisted state", async () => {
    await act(async () => root.render(<DirectoryOperationsPanel />));
    const rows = [...host.querySelectorAll("li")];
    expect(rows[0].textContent).toContain("结果未确认");
    expect(rows[0].querySelectorAll("button")).toHaveLength(0);
    expect(rows[1].textContent).toContain("只读核对");
    expect(rows[1].textContent).not.toContain("重试");
    expect(rows[2].textContent).toContain("重试");
    expect(rows[3].textContent).toContain("取消任务");
    expect(rows[4].querySelectorAll("button")).toHaveLength(0);
    await act(async () => button("只读核对").click());
    expect(api.call).toHaveBeenCalledWith("directory_operation_action", {
      id: "confirmed",
      action: "verify",
    });
  });
  it("suppresses duplicate task actions and preserves errors after a reload", async () => {
    await act(async () => root.render(<DirectoryOperationsPanel />));
    let reject!: (e: Error) => void;
    vi.mocked(api.call).mockImplementationOnce(
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    );
    await act(async () => {
      button("重试").click();
      button("重试").click();
    });
    expect(
      vi
        .mocked(api.call)
        .mock.calls.filter(([c]) => c === "directory_operation_action"),
    ).toHaveLength(1);
    await act(async () => reject(new Error("账号配置已变化")));
    await act(async () => button("刷新").click());
    expect(host.textContent).toContain("账号配置已变化");
    expect(button("重试").disabled).toBe(false);
  });
  it("distinguishes MOVE and COPY and only offers read-only checking for uncertain MOVE", async () => {
    items[0].kind = "move";
    items[4].kind = "move";
    await act(async () => root.render(<DirectoryOperationsPanel />));
    const rows = host.querySelectorAll("li");
    expect(rows[0].textContent).toContain("移动");
    expect(rows[0].querySelectorAll("button")).toHaveLength(1);
    expect(rows[0].textContent).toContain("只读核对");
    expect(rows[0].textContent).not.toContain("重试");
    expect(rows[4].textContent).toContain("移动完成");
  });
});
