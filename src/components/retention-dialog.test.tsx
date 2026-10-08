// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RetentionDialog } from "./retention-dialog";
import * as api from "@/lib/api";
import { makeAccount } from "@/lib/providers";
import type { Account, RetentionSettings } from "@/lib/types";
let root: Root, host: HTMLDivElement, settings: RetentionSettings;
const a = { ...makeAccount("qq"), id: "fixture-a", saveLocally: false };
const onClose = vi.fn(),
  onSaved = vi.fn();
async function render(account: Account | null = a) {
  await act(async () =>
    root.render(
      <RetentionDialog account={account} onClose={onClose} onSaved={onSaved} />,
    ),
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function select(label: string, value: string) {
  await act(async () =>
    document
      .querySelector(`[aria-label="${label}"]`)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (item) => item.textContent === value,
  );
  expect(option).toBeTruthy();
  await act(async () => (option as HTMLElement).click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  onClose.mockReset();
  onSaved.mockReset();
  settings = {
    defaultSave: false,
    overrides: [],
    folders: [
      {
        accountId: a.id,
        name: "INBOX",
        displayName: "收件箱",
        delimiter: "/",
        selectable: true,
        roles: ["inbox"],
      },
      {
        accountId: a.id,
        name: "&encoded-spam-",
        displayName: "垃圾邮件",
        delimiter: "/",
        selectable: true,
        roles: ["junk"],
      },
      {
        accountId: a.id,
        name: "Parent",
        displayName: "容器目录",
        delimiter: "/",
        selectable: false,
        roles: [],
      },
    ],
  };
  vi.spyOn(api, "call").mockImplementation(async (command) =>
    command === "retention_settings"
      ? (settings as never)
      : (undefined as never),
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
it("shows the account default and submits explicit wire folder overrides only", async () => {
  await render();
  expect(document.body.textContent).toContain("账号默认：在线阅读");
  expect(document.body.textContent).not.toContain("容器目录");
  await select("收件箱保存方式", "完整保存");
  await select("垃圾邮件保存方式", "在线阅读");
  await click("保存范围");
  expect(api.call).toHaveBeenCalledWith("save_retention", {
    account: a,
    overrides: [
      { folder: "INBOX", saveLocally: true },
      { folder: "&encoded-spam-", saveLocally: false },
    ],
  });
  expect(onSaved).toHaveBeenCalledOnce();
});
it("inherit removes an override and cancel does not save changes", async () => {
  settings.overrides = [{ folder: "INBOX", saveLocally: true }];
  await render();
  await select("收件箱保存方式", "跟随账号");
  await click("取消");
  expect(onClose).toHaveBeenCalledOnce();
  expect(api.call).not.toHaveBeenCalledWith(
    "save_retention",
    expect.anything(),
  );
  await click("保存范围");
  expect(api.call).toHaveBeenCalledWith("save_retention", {
    account: a,
    overrides: [],
  });
});
it("requires removal of disappeared folders and displays save errors", async () => {
  settings.overrides = [{ folder: "gone", saveLocally: true }];
  await render();
  const save = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "保存范围",
  )!;
  expect(save.disabled).toBe(true);
  await click("移除失效设置");
  expect(save.disabled).toBe(false);
  vi.mocked(api.call).mockImplementation(async (command) => {
    if (command === "save_retention") throw new Error("账号连接已变化");
    return settings as never;
  });
  await click("保存范围");
  expect(document.body.textContent).toContain("账号连接已变化");
  expect(onSaved).not.toHaveBeenCalled();
});
it("ignores stale loads and a save completion after changing accounts", async () => {
  let resolveLoad!: (value: RetentionSettings) => void;
  vi.mocked(api.call).mockImplementation(async (command, args) =>
    command === "retention_settings" && args?.id === a.id
      ? (new Promise<RetentionSettings>((resolve) => {
          resolveLoad = resolve;
        }) as never)
      : ({ ...settings, defaultSave: true } as never),
  );
  await render();
  const b = { ...a, id: "fixture-b" };
  await render(b);
  await act(async () => resolveLoad({ ...settings, defaultSave: false }));
  expect(document.body.textContent).toContain("账号默认：完整保存");
  let resolveSave!: () => void;
  vi.mocked(api.call).mockImplementation(async (command) =>
    command === "save_retention"
      ? (new Promise<void>((resolve) => {
          resolveSave = resolve;
        }) as never)
      : (settings as never),
  );
  await click("保存范围");
  await render(null);
  await act(async () => resolveSave());
  expect(onClose).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
});
