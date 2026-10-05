// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  FolderHealthPanel,
  type FolderHealthItem,
  type SelectionEvidence,
} from "./folder-health";
import * as api from "@/lib/api";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
let host: HTMLDivElement, root: Root;
const fixture: FolderHealthItem = {
  accountId: "test-account",
  accountEmail: "fixture@example.com",
  folder: "&UXZO1mWHTvZZOQ-",
  displayName: "其他文件夹",
  reason: "服务器报告目录为空，却返回了邮件编号",
  checkedAt: "2026-10-05T08:00:00Z",
  evidence: { exists: 0, uidCount: 2, inboxUidOverlap: 2 },
  sources: 2,
  alternateSources: 1,
  saved: 2,
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(api, "call").mockImplementation(async (command) => {
    if (command === "folder_health") return [structuredClone(fixture)] as never;
    if (command === "probe_remote_folder")
      return { exists: 0, uidCount: 2, inboxUidOverlap: 2 } as never;
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
  await act(async () => root.render(<FolderHealthPanel />));
}
function probeButton() {
  return host.querySelector(
    'button[aria-label^="重新核查"]',
  ) as HTMLButtonElement;
}
describe("isolated folder feedback", () => {
  it("shows decoded folder and retained alternate/archive counts", async () => {
    await render();
    expect(host.textContent).toContain("其他文件夹");
    expect(host.textContent).toContain("其中 1 条另有可用来源");
    expect(host.textContent).toContain("2 条有完整本地存档");
    expect(host.textContent).not.toContain(fixture.folder);
  });
  it("probes the exact account and wire folder without restoring or syncing mail", async () => {
    await render();
    await act(async () => probeButton().click());
    expect(api.call).toHaveBeenCalledWith("probe_remote_folder", {
      accountId: fixture.accountId,
      folder: fixture.folder,
    });
    expect(host.textContent).toContain("核查后目录响应仍矛盾，继续隔离。");
    expect(
      vi
        .mocked(api.call)
        .mock.calls.every(([c]) =>
          ["folder_health", "probe_remote_folder"].includes(c),
        ),
    ).toBe(true);
  });
  it("suppresses duplicate probes and retains isolation when read-only evidence recovers", async () => {
    let resolve!: (v: SelectionEvidence) => void;
    await render();
    vi.mocked(api.call).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as typeof resolve;
        }),
    );
    await act(async () => {
      probeButton().click();
      probeButton().click();
    });
    expect(probeButton().disabled).toBe(true);
    expect(host.textContent).toContain("正在核查…");
    await act(async () =>
      resolve({ exists: 2, uidCount: 2, inboxUidOverlap: null }),
    );
    expect(
      vi
        .mocked(api.call)
        .mock.calls.filter(([c]) => c === "probe_remote_folder"),
    ).toHaveLength(1);
    expect(host.textContent).toContain("请重新收取此目录以核对旧来源");
    expect(host.textContent).toContain("来源已隔离");
  });
  it("keeps source details and releases the button after a probe failure", async () => {
    await render();
    vi.mocked(api.call).mockRejectedValueOnce(
      new Error("此目录正在收取，请稍后重新核查"),
    );
    await act(async () => probeButton().click());
    expect(host.textContent).toContain("核查未完成");
    expect(host.textContent).toContain("此目录正在收取");
    expect(probeButton().disabled).toBe(false);
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "刷新")!
        .click(),
    );
    expect(host.textContent).toContain("此目录正在收取");
    expect(host.textContent).toContain("保留 2 条旧来源");
  });
});
