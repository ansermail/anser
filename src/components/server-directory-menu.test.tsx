// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerDirectoryMenu } from "./server-directory-menu";
import * as api from "@/lib/api";
import type { Mail, RemoteFolder } from "@/lib/types";
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const mail = {
  id: "controlled",
  accountId: "owner",
  sourceFolder: "INBOX",
} as Mail;
const folder = (name: string, extra = {}): RemoteFolder => ({
  name,
  displayName: name,
  accountId: "owner",
  delimiter: "/",
  selectable: true,
  ...extra,
});
let host: HTMLDivElement,
  root: Root,
  folders: RemoteFolder[],
  sources: string[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  sources = ["INBOX", "Parent/Project", "Sent"];
  folders = [
    folder("INBOX", { displayName: "收件箱", roles: ["inbox"] }),
    folder("Parent/Project", { displayName: "其他文件夹/项目" }),
    folder("Sent", { roles: ["sent"] }),
    folder("Archive", { roles: ["archive"] }),
    folder("Junk", { roles: ["junk"] }),
    folder("Trash", { roles: ["trash"] }),
    folder("Parent", { selectable: false }),
    folder("Broken", { syncError: "来源已隔离" }),
    folder("Foreign", { accountId: "someone-else" }),
  ];
  vi.spyOn(api, "call").mockImplementation(async (command) => {
    if (command === "copy_sources") return sources as never;
    if (command === "folder_settings")
      return { folders: structuredClone(folders), mappings: [] } as never;
    if (command === "account_folders") return structuredClone(folders) as never;
    return "task" as never;
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
async function render(extra = {}) {
  await act(async () =>
    root.render(
      <ServerDirectoryMenu mail={mail} kind="move" view="account" {...extra} />,
    ),
  );
}
async function open() {
  await act(async () =>
    host
      .querySelector("button")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
}
function item(text: string) {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (e) => e.textContent?.trim() === text,
  )!;
}
describe("direct server directory menu", () => {
  it("discovers folders only when the account has no cached directory", async () => {
    const fallback = vi.mocked(api.call).getMockImplementation()!;
    vi.mocked(api.call).mockImplementation(async (command, args) =>
      command === "folder_settings"
        ? ({ folders: [], mappings: [] } as never)
        : fallback(command, args),
    );
    await render();
    await open();
    expect(api.call).toHaveBeenCalledWith("account_folders", {
      id: mail.accountId,
    });
    expect(item("归档")).toBeTruthy();
  });
  it("fixes the current remote source and queues immediately when a target is selected", async () => {
    await render({ remoteFolder: "Parent/Project" });
    await open();
    expect(api.call).not.toHaveBeenCalledWith(
      "account_folders",
      expect.anything(),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="combobox"]')).toBeNull();
    expect(document.body.textContent).toContain("从 其他文件夹/项目");
    expect(item("其他文件夹/项目")).toBeUndefined();
    expect(item("Parent")).toBeUndefined();
    expect(item("Broken")).toBeUndefined();
    expect(item("Foreign")).toBeUndefined();
    await act(async () => item("收件箱").click());
    expect(api.call).toHaveBeenCalledWith("queue_server_move", {
      id: mail.id,
      source: "Parent/Project",
      target: "INBOX",
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
  it("uses sent-role source in the aggregate sent view instead of INBOX", async () => {
    await render({ view: "sent" });
    await open();
    await act(async () => item("归档").click());
    expect(api.call).toHaveBeenCalledWith("queue_server_move", {
      id: mail.id,
      source: "Sent",
      target: "Archive",
    });
  });
  it("does not fall back to another copy if the current folder's source has disappeared", async () => {
    sources = ["INBOX"];
    await render({ remoteFolder: "Parent/Project" });
    await open();
    expect(document.body.textContent).toContain("已不在当前服务器文件夹");
    expect(item("收件箱")).toBeUndefined();
    expect(
      vi.mocked(api.call).mock.calls.some(([c]) => c === "queue_server_move"),
    ).toBe(false);
  });
  it("queues only once while durable recording is pending and retains failures for review", async () => {
    await render();
    await open();
    let reject!: (e: Error) => void;
    vi.mocked(api.call).mockImplementationOnce(
      () =>
        new Promise((_r, j) => {
          reject = j;
        }),
    );
    const target = item("其他文件夹/项目");
    await act(async () => {
      target.click();
      target.click();
    });
    expect(
      vi.mocked(api.call).mock.calls.filter(([c]) => c === "queue_server_move"),
    ).toHaveLength(1);
    await act(async () => reject(new Error("来源已失效")));
    expect(document.body.textContent).toContain("来源已失效");
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(target.getAttribute("data-disabled")).toBeNull();
  });
  it("keeps a previous delayed directory load from replacing the new view", async () => {
    let resolve!: (v: string[]) => void;
    vi.mocked(api.call).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as typeof resolve;
        }),
    );
    await render();
    await open();
    await render({ remoteFolder: "Parent/Project" });
    await open();
    await act(async () => resolve(["INBOX"]));
    expect(document.body.textContent).toContain("从 其他文件夹/项目");
    await act(async () => item("归档").click());
    expect(api.call).toHaveBeenCalledWith("queue_server_move", {
      id: mail.id,
      source: "Parent/Project",
      target: "Archive",
    });
  });
  it.each([
    ["归档", "Archive"],
    ["移到垃圾邮件", "Junk"],
    ["移到服务器废纸篓", "Trash"],
  ])("%s uses mapped role destinations", async (label, target) => {
    await render();
    await open();
    await act(async () => item(label).click());
    expect(api.call).toHaveBeenCalledWith("queue_server_move", {
      id: mail.id,
      source: "INBOX",
      target,
    });
  });
  it("disables ambiguous, unavailable and current-directory shortcuts without guessing", async () => {
    folders.push(folder("Archive2", { roles: ["archive"] }));
    folders.find((f) => f.name === "Junk")!.syncError = "isolated";
    await render({ remoteFolder: "Trash" });
    sources.push("Trash");
    await open();
    for (const text of [
      "归档请在账号中指定唯一目标",
      "移到垃圾邮件目标目录不可用",
      "移到服务器废纸篓已在此目录",
    ]) {
      expect(item(text).getAttribute("data-disabled")).not.toBeNull();
    }
  });
  it("gives COPY the same target-only interaction and keeps the original source", async () => {
    await render({ kind: "copy", remoteFolder: "Parent/Project" });
    await open();
    expect(item("归档")).toBeUndefined();
    await act(async () => item("Archive").click());
    expect(api.call).toHaveBeenCalledWith("queue_server_copy", {
      id: mail.id,
      source: "Parent/Project",
      target: "Archive",
    });
  });
});
