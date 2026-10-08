// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountEmailField } from "./account-email-field";

let root: Root, host: HTMLDivElement;
const changed = vi.fn();
function Form({
  provider,
  initial = "",
  disabled = false,
}: {
  provider: string;
  initial?: string;
  disabled?: boolean;
}) {
  const [email, setEmail] = useState(initial);
  return (
    <form>
      <AccountEmailField
        provider={provider}
        value={email}
        disabled={disabled}
        onChange={(value) => {
          setEmail(value);
          changed(value);
        }}
      />
    </form>
  );
}
async function render(provider: string, initial = "", disabled = false) {
  await act(async () =>
    root.render(
      <Form
        key={provider}
        provider={provider}
        initial={initial}
        disabled={disabled}
      />,
    ),
  );
}
function field() {
  return document.querySelector("#email") as HTMLInputElement;
}
async function input(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function suffix(label: string) {
  await act(async () =>
    document
      .querySelector('[aria-label="邮箱后缀"]')!
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
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  changed.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it.each([
  ["qq", "qq.com"],
  ["gmail", "gmail.com"],
  ["outlook", "outlook.com"],
  ["netease", "163.com"],
])("defaults %s and submits the complete address", async (provider, domain) => {
  await render(provider);
  expect(document.querySelector('[aria-label="邮箱后缀"]')?.textContent).toBe(
    `@${domain}`,
  );
  expect(field().value).toBe("");
  expect(field().checkValidity()).toBe(false);
  await input("sample");
  expect(changed).toHaveBeenLastCalledWith(`sample@${domain}`);
  expect(field().value).toBe("sample");
  expect(field().checkValidity()).toBe(true);
  await input("");
  expect(changed).toHaveBeenLastCalledWith("");
});
it("accepts a complete pasted address without duplicating the suffix", async () => {
  await render("qq");
  await input(" sample@QQ.COM ");
  expect(changed).toHaveBeenLastCalledWith("sample@qq.com");
  expect(field().value).toBe("sample");
  expect(field().checkValidity()).toBe(true);
});
it("keeps custom domains and allows switching back to a known suffix", async () => {
  await render("gmail");
  await input("sample@workspace.example");
  expect(field().type).toBe("email");
  expect(field().value).toBe("sample@workspace.example");
  expect(changed).toHaveBeenLastCalledWith("sample@workspace.example");
  await suffix("@gmail.com");
  expect(changed).toHaveBeenLastCalledWith("sample@gmail.com");
  expect(field().value).toBe("sample");
});
it("switches NetEase suffixes and can enter a full address", async () => {
  await render("netease");
  await input("sample");
  await suffix("@126.com");
  expect(changed).toHaveBeenLastCalledWith("sample@126.com");
  await suffix("@yeah.net");
  expect(changed).toHaveBeenLastCalledWith("sample@yeah.net");
  await suffix("完整地址");
  expect(field().value).toBe("sample@yeah.net");
  expect(field().type).toBe("email");
});
it("retains full address entry for enterprise and editing accounts", async () => {
  await render("exmail");
  expect(document.querySelector('[aria-label="邮箱后缀"]')).toBeNull();
  await input("sample@company.example");
  expect(changed).toHaveBeenLastCalledWith("sample@company.example");
  await render("qq", "sample@qq.com", true);
  expect(field().value).toBe("sample@qq.com");
  expect(field().disabled).toBe(true);
  expect(document.querySelector('[aria-label="邮箱后缀"]')).toBeNull();
});
