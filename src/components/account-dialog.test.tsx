// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountDialog } from "./account-dialog";
import { enterDemo, leaveDemo, snapshot } from "@/lib/api";
import { makeAccount } from "@/lib/providers";
import type { Account } from "@/lib/types";

let root: Root, host: HTMLDivElement, account: Account;
const query = {
  view: "all",
  accountId: "",
  folder: "",
  search: "",
  limit: 10,
  unreadOnly: false,
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  localStorage.clear();
  enterDemo();
  account = (await snapshot(query)).accounts[0];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
});

describe("per-account local retention", () => {
  it("defaults new accounts to full local retention", () => {
    expect(makeAccount("qq").saveLocally).toBe(true);
  });
  it("persists online reading on edit and restores the switch when reopened", async () => {
    const done = vi.fn();
    const render = async (editing: Account) => {
      await act(async () =>
        root.render(
          <AccountDialog
            open
            editing={editing}
            onOpenChange={() => {}}
            onDone={done}
          />,
        ),
      );
    };
    await render(account);
    const toggle = () =>
      document.querySelector("#save-locally") as HTMLButtonElement;
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(document.body.textContent).toContain("保存设置");
    await act(async () => toggle().click());
    expect(document.body.textContent).toContain("已有存档保留");
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(done).toHaveBeenCalledOnce();
    const updated = (await snapshot(query)).accounts.find(
      (a) => a.id === account.id,
    )!;
    expect(updated.saveLocally).toBe(false);
    expect(updated.email).toBe(account.email);
    await render(updated);
    expect(toggle().getAttribute("aria-checked")).toBe("false");
  });
});
