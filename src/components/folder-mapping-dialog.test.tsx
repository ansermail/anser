// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { FolderMappingDialog } from "./folder-mapping-dialog";
import * as api from "@/lib/api";
import { makeAccount } from "@/lib/providers";
import type { FolderSettings } from "@/lib/types";
let root: Root, host: HTMLDivElement;
let settings: FolderSettings;
const account = { ...makeAccount("qq"), id: "fixture-account" };
const onClose = vi.fn(),
  onSaved = vi.fn();
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function select(role: string, label: string) {
  await act(async () =>
    document
      .querySelector(`[aria-label="${role}"]`)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const item = [...document.querySelectorAll('[role="option"]')].find(
    (i) => i.textContent === label,
  );
  expect(item).toBeTruthy();
  await act(async () => (item as HTMLElement).click());
}
async function render() {
  await act(async () =>
    root.render(
      <FolderMappingDialog
        account={account}
        onClose={onClose}
        onSaved={onSaved}
      />,
    ),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  onClose.mockClear();
  onSaved.mockClear();
  settings = {
    folders: [
      {
        accountId: account.id,
        name: "INBOX",
        displayName: "收件箱",
        delimiter: "/",
        selectable: true,
        roles: ["inbox"],
      },
      {
        accountId: account.id,
        name: "Sent",
        displayName: "已发送",
        delimiter: "/",
        selectable: true,
        roles: ["sent"],
        detectedRoles: ["sent"],
      },
      {
        accountId: account.id,
        name: "Parent",
        displayName: "父目录",
        delimiter: "/",
        selectable: false,
        roles: [],
      },
      {
        accountId: account.id,
        name: "Parent/Custom",
        displayName: "父目录/自定义",
        delimiter: "/",
        selectable: true,
        roles: [],
        detectedRoles: [],
      },
    ],
    mappings: [],
  };
  vi.spyOn(api, "call").mockImplementation(async (command) =>
    command === "folder_settings"
      ? structuredClone(settings)
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
describe("special folder settings", () => {
  it("saves manual targets and disabled roles using server paths, excluding INBOX and nonselectable parents", async () => {
    await render();
    await select("已发送", "父目录/自定义");
    await select("垃圾邮件", "不指定");
    await click("保存");
    expect(api.call).toHaveBeenCalledWith("save_folder_mappings", {
      id: account.id,
      mappings: [
        { role: "sent", folder: "Parent/Custom" },
        { role: "junk", folder: null },
      ],
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("restores automatic discovery only after saving and closing without saving keeps persisted mappings", async () => {
    settings.mappings = [{ role: "sent", folder: "Parent/Custom" }];
    await render();
    await click("恢复自动识别");
    expect(api.call).not.toHaveBeenCalledWith(
      "save_folder_mappings",
      expect.anything(),
    );
    await click("保存");
    expect(api.call).toHaveBeenCalledWith("save_folder_mappings", {
      id: account.id,
      mappings: [],
    });
  });
  it("blocks missing mappings, keeps unsaved selection during refresh and allows recovery", async () => {
    settings.mappings = [{ role: "sent", folder: "Removed" }];
    await render();
    expect(document.body.textContent).toContain("目录已移除或不能存放邮件");
    expect(
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "保存",
      )!.disabled,
    ).toBe(true);
    await select("已发送", "父目录/自定义");
    await click("刷新目录");
    await click("保存");
    expect(api.call).toHaveBeenCalledWith("account_folders", {
      id: account.id,
    });
    expect(api.call).toHaveBeenCalledWith("save_folder_mappings", {
      id: account.id,
      mappings: [{ role: "sent", folder: "Parent/Custom" }],
    });
  });
  it("retains the dialog and selection on save failure then permits retry", async () => {
    await render();
    await select("已发送", "父目录/自定义");
    vi.mocked(api.call).mockImplementationOnce(async () => {
      throw new Error("选择的目录已不存在");
    });
    await click("保存");
    expect(document.body.textContent).toContain("选择的目录已不存在");
    expect(onClose).not.toHaveBeenCalled();
    await click("保存");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
