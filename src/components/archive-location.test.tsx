// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  ArchiveLocation,
  type ArchiveLocationStatus,
} from "./archive-location";
const mocks = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/api", () => ({
  native: true,
  isDemo: () => false,
  call: mocks.call,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
let host: HTMLDivElement, root: Root, status: ArchiveLocationStatus;
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.call.mockReset();
  mocks.open.mockReset();
  mocks.open.mockResolvedValue("/External");
  status = {
    path: "/Old/archive",
    defaultPath: "/Old/archive",
    available: true,
    error: "",
    external: false,
    cleanupPending: false,
    migrating: false,
    completed: 0,
    total: 0,
  };
  mocks.call.mockImplementation(async (command: string) => {
    if (command === "archive_location") return status;
    throw new Error("copy failed");
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ArchiveLocation onChanged={() => {}} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("requires reviewing the destination and cancellation never starts a migration", async () => {
  await click("修改存档位置");
  expect(document.body.textContent).toContain(
    "/External/Anser-Archive/archive",
  );
  await click("取消");
  expect(
    mocks.call.mock.calls.some(
      ([command]) => command === "move_archive_location",
    ),
  ).toBe(false);
  expect(host.textContent).toContain("/Old/archive");
});
it("shows a migration failure and rereads the active path instead of claiming completion", async () => {
  await click("修改存档位置");
  await click("开始迁移");
  expect(mocks.call).toHaveBeenCalledWith("move_archive_location", {
    parent: "/External",
  });
  expect(host.textContent).toContain("copy failed");
  expect(host.textContent).toContain("/Old/archive");
  expect(host.textContent).not.toContain("/External/Anser-Archive/archive");
});
it("disables migration while the configured disk is disconnected", async () => {
  status = { ...status, available: false, external: true, error: "磁盘未连接" };
  await act(async () =>
    root.render(<ArchiveLocation key="offline" onChanged={() => {}} />),
  );
  expect(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "修改存档位置",
    )?.disabled,
  ).toBe(true);
  expect(host.textContent).toContain("磁盘未连接");
});
