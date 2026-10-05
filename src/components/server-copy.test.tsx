// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  ServerCopyDialog,
  DirectoryOperationsPanel,
  type DirectoryOperation,
} from "./server-copy";
import * as api from "@/lib/api";
import type { Mail, RemoteFolder } from "@/lib/types";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
let host: HTMLDivElement, root: Root;
const close = vi.fn();
const mail = {
  id: "controlled-sample",
  accountId: "owner",
  subject: "雁信联调",
} as Mail;
const folder = (name: string, extra = {}): RemoteFolder => ({
  accountId: "owner",
  name,
  displayName: name,
  selectable: true,
  delimiter: "/",
  roles: [],
  ...extra,
});
let folders: RemoteFolder[], items: DirectoryOperation[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  close.mockClear();
  folders = [
    folder("INBOX", { displayName: "收件箱", roles: ["inbox"] }),
    folder("Archive", { displayName: "归档" }),
    folder("Parent", { selectable: false }),
    folder("Isolated", { syncError: "目录来源已隔离" }),
  ];
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
    if (command === "copy_sources") return ["INBOX", "Archive"] as never;
    if (command === "account_folders") return structuredClone(folders) as never;
    if (command === "directory_operations")
      return structuredClone(items) as never;
    if (
      command === "queue_server_copy" ||
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
async function dialog() {
  await act(async () =>
    root.render(
      <ServerCopyDialog mail={mail} initialSource="INBOX" onClose={close} />,
    ),
  );
}
function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  )!;
}
async function open(id: string) {
  await act(async () =>
    document
      .getElementById(id)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
}
async function choose(label: string) {
  const el = [...document.querySelectorAll('[role="option"]')].find(
    (e) => e.textContent === label,
  );
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
}
describe("server copy interaction", () => {
  it("offers only selectable trusted targets and clears the target after changing source", async () => {
    await dialog();
    await open("copy-target");
    expect(
      [...document.querySelectorAll('[role="option"]')].map(
        (e) => e.textContent,
      ),
    ).toEqual(["归档"]);
    await choose("归档");
    expect(button("复制邮件").disabled).toBe(false);
    await open("copy-source");
    await choose("归档");
    expect(button("复制邮件").disabled).toBe(true);
    expect(document.getElementById("copy-target")!.textContent).toContain(
      "选择服务器文件夹",
    );
  });
  it("queues exact wire paths once and closes only after durable recording", async () => {
    await dialog();
    await open("copy-target");
    await choose("归档");
    let resolve!: (v: string) => void;
    vi.mocked(api.call).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as typeof resolve;
        }),
    );
    await act(async () => {
      button("复制邮件").click();
      button("复制邮件").click();
    });
    expect(close).not.toHaveBeenCalled();
    expect(
      vi.mocked(api.call).mock.calls.filter(([c]) => c === "queue_server_copy"),
    ).toEqual([
      [
        "queue_server_copy",
        { id: mail.id, source: "INBOX", target: "Archive" },
      ],
    ]);
    await act(async () => resolve("task-id"));
    expect(close).toHaveBeenCalledOnce();
  });
  it("keeps the dialog and selection when recording fails", async () => {
    await dialog();
    await open("copy-target");
    await choose("归档");
    vi.mocked(api.call).mockRejectedValueOnce(new Error("目标目录已隔离"));
    await act(async () => button("复制邮件").click());
    expect(document.body.textContent).toContain("目标目录已隔离");
    expect(close).not.toHaveBeenCalled();
    expect(button("复制邮件").disabled).toBe(false);
  });
  it("prevents submission without trusted sources", async () => {
    vi.mocked(api.call).mockImplementation(async (command) =>
      command === "copy_sources" ? ([] as never) : (folders as never),
    );
    await dialog();
    expect(document.body.textContent).toContain("没有可信的 IMAP 来源");
    expect(button("复制邮件").disabled).toBe(true);
  });
  it("does not let a previous mail's delayed source response replace the current mail", async () => {
    let resolve!: (v: string[]) => void;
    vi.mocked(api.call).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as typeof resolve;
        }),
    );
    await dialog();
    await act(async () =>
      root.render(
        <ServerCopyDialog
          mail={{ ...mail, id: "new-sample" }}
          initialSource="Archive"
          onClose={close}
        />,
      ),
    );
    await act(async () => resolve(["Old"]));
    expect(document.getElementById("copy-source")!.textContent).toBe("归档");
  });
});
describe("directory task feedback", () => {
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
});
