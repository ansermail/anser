// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MailSignatures } from "./mail-signatures";
import type { Account, MailSignature } from "@/lib/types";
import { emptySignature } from "@/lib/signatures";
const mocks = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/api", () => ({ call: mocks.call }));
vi.mock("./mail-content", () => ({ MailContent: () => null }));
let host: HTMLDivElement, root: Root;
let configurations: Record<string, MailSignature>;
const accounts = [
  { id: "work", name: "工作邮箱", email: "work@example.com" },
  { id: "personal", name: "个人邮箱", email: "personal@example.com" },
] as Account[];
function toggle() {
  return host.querySelector('[aria-label="启用邮件签名"]') as HTMLButtonElement;
}
async function click(element: HTMLElement) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  configurations = {
    work: { ...emptySignature(), text: "Saved work signature" },
    personal: { ...emptySignature(), text: "Saved personal signature" },
  };
  mocks.call.mockReset();
  mocks.call.mockImplementation(async (command, args) => {
    if (command === "mail_signature")
      return structuredClone(configurations[args.accountId]);
    if (command === "save_mail_signature")
      configurations[args.accountId] = structuredClone(args.signature);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<MailSignatures accounts={accounts} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("persists the header toggle, collapses controls and preserves unsaved edits without publishing them", async () => {
  expect(host.querySelector("#signature-text")).toBeNull();
  await click(toggle());
  expect(configurations.work.enabled).toBe(true);
  const editor = host.querySelector("#signature-text") as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(editor, "Unsaved work signature");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(toggle());
  expect(configurations.work).toMatchObject({
    enabled: false,
    text: "Saved work signature",
  });
  expect(host.querySelector("#signature-text")).toBeNull();
  await click(toggle());
  expect(
    (host.querySelector("#signature-text") as HTMLTextAreaElement).value,
  ).toBe("Unsaved work signature");
  await click(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "保存签名",
    )!,
  );
  expect(configurations.work.text).toBe("Unsaved work signature");
  expect(host.textContent).not.toContain("自动附加邮件签名");
});
it("retains the disabled state and shows errors when saving the toggle fails", async () => {
  mocks.call.mockRejectedValueOnce(new Error("保存失败"));
  await click(toggle());
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(host.querySelector("#signature-text")).toBeNull();
  expect(host.textContent).toContain("保存失败");
  expect(configurations.work.enabled).toBe(false);
});
it("selects an account while collapsed and only enables that account's saved configuration", async () => {
  await act(async () => {
    host
      .querySelector('[aria-label="签名所属账号"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
  });
  await click(
    [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((e) =>
      e.textContent?.includes("个人邮箱"),
    )!,
  );
  expect(host.querySelector("#signature-text")).toBeNull();
  await click(toggle());
  expect(configurations.personal).toMatchObject({
    enabled: true,
    text: "Saved personal signature",
  });
  expect(configurations.work.enabled).toBe(false);
  expect(
    (host.querySelector("#signature-text") as HTMLTextAreaElement).value,
  ).toBe("Saved personal signature");
});
