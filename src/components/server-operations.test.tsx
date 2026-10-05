// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { ServerOperations, type OperationSnapshot } from "./server-operations";
import * as api from "@/lib/api";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
let host: HTMLDivElement, root: Root;
let fixture: OperationSnapshot;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture = {
    pending: 1,
    blocked: 1,
    completed: 1,
    items: [
      {
        id: "failed",
        accountEmail: "fixture@example.com",
        subject: "Fixture",
        folder: "收件箱",
        action: "star",
        value: true,
        status: "blocked",
        attempts: 1,
        error: "服务器未保存状态修改",
      },
      {
        id: "paused",
        accountEmail: "fixture@example.com",
        subject: "Paused",
        folder: "收件箱",
        action: "read",
        value: false,
        status: "paused",
        attempts: 0,
        error: "",
      },
      {
        id: "done",
        accountEmail: "fixture@example.com",
        subject: "Done",
        folder: "收件箱",
        action: "read",
        value: true,
        status: "completed",
        attempts: 1,
        error: "",
      },
    ],
  };
  vi.spyOn(api, "call").mockImplementation(async (command) => {
    if (command === "server_operations")
      return structuredClone(fixture) as never;
    if (command === "retry_server_operation") {
      fixture.items[0].status = "queued";
      fixture.items[0].error = "";
      return undefined as never;
    }
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
async function render() {
  await act(async () => root.render(<ServerOperations />));
}
describe("server operation feedback", () => {
  it("shows conflicts and local account pause without offering completed retries", async () => {
    await render();
    expect(host.textContent).toContain("服务器未保存状态修改");
    expect(host.textContent).toContain("需要处理 1");
    expect(host.textContent).toContain("账号已暂停");
    expect(
      [...host.querySelectorAll("button")].filter(
        (b) => b.textContent === "重试",
      ),
    ).toHaveLength(1);
    expect(host.textContent).toContain("标记未读");
    expect(host.textContent).toContain("加星标");
  });
  it("retries exactly the selected task then fetches its new state", async () => {
    await render();
    const button = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "重试",
    )!;
    await act(async () => button.click());
    expect(api.call).toHaveBeenCalledWith("retry_server_operation", {
      id: "failed",
    });
    expect(host.textContent).not.toContain("服务器未保存状态修改");
    expect(host.textContent).toContain("待同步");
  });
  it("retains task details when a retry fails", async () => {
    await render();
    vi.mocked(api.call).mockRejectedValueOnce(
      new Error("账号已移除，本地存档保留"),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "重试")!
        .click(),
    );
    expect(host.textContent).toContain("账号已移除，本地存档保留");
    expect(host.textContent).toContain("Fixture");
  });
  it("offers refresh after a failed initial load", async () => {
    vi.mocked(api.call).mockRejectedValueOnce(new Error("storage unavailable"));
    await render();
    expect(host.textContent).toContain("storage unavailable");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "刷新")!
        .click(),
    );
    expect(host.textContent).not.toContain("storage unavailable");
    expect(host.textContent).toContain("Fixture");
  });
});
