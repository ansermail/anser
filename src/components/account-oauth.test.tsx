// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountDialog } from "./account-dialog";
import { makeAccount } from "@/lib/providers";

const mock = vi.hoisted(() => ({
  call: vi.fn(),
  channels: [] as { onmessage?: (stage: string) => void }[],
}));
vi.mock("@/lib/api", () => ({
  call: mock.call,
  native: true,
  isDemo: () => false,
}));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (stage: string) => void;
    constructor() {
      mock.channels.push(this);
    }
  },
}));
let root: Root, host: HTMLDivElement, rejectRequest: (error: string) => void;
const done = vi.fn();
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
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
  mock.call.mockReset();
  done.mockReset();
  mock.channels.length = 0;
  mock.call.mockImplementation((command: string) =>
    command === "edit_account"
      ? new Promise((_, reject) => {
          rejectRequest = reject;
        })
      : Promise.resolve(),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const account = { ...makeAccount("gmail"), email: "test@example.com" };
  await act(async () =>
    root.render(
      <AccountDialog
        open
        editing={account}
        onOpenChange={() => {}}
        onDone={done}
      />,
    ),
  );
  const checkbox = document.querySelector(
    'button[role="checkbox"]',
  ) as HTMLButtonElement;
  await act(async () => checkbox.click());
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("shows actual authorization stages and removes cancellation after browser callback", async () => {
  expect(document.body.textContent).not.toContain("取消授权");
  await act(async () => mock.channels[0].onmessage!("browser"));
  expect(document.body.textContent).toContain("等待浏览器授权");
  expect(document.body.textContent).toContain("取消授权");
  for (const [stage, label] of [
    ["token", "正在交换授权令牌"],
    ["incoming", "正在验证收件服务器"],
    ["smtp", "正在验证发件服务器"],
  ]) {
    await act(async () => mock.channels[0].onmessage!(stage));
    expect(document.body.textContent).toContain(label);
    expect(document.body.textContent).not.toContain("取消授权");
  }
  await act(async () => rejectRequest("synthetic failure"));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(
    "synthetic failure",
  );
  expect(done).not.toHaveBeenCalled();
  await act(async () => mock.channels[0].onmessage!("browser"));
  expect(document.body.textContent).not.toContain("等待浏览器授权");
});
it("cancels the pending attempt without reporting a saved account", async () => {
  await act(async () => mock.channels[0].onmessage!("browser"));
  const cancel = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "取消授权",
  )!;
  await act(async () => cancel.click());
  expect(mock.call).toHaveBeenCalledWith("cancel_authorization", {
    id: expect.any(String),
  });
  expect(cancel.disabled).toBe(true);
  await act(async () => rejectRequest("已取消浏览器授权，账号未保存"));
  expect(done).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("账号未保存");
  expect(
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "验证并保存配置",
    )?.disabled,
  ).toBe(false);
});
