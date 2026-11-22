// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./app-error-boundary";
import { setInterfaceLanguage } from "../lib/i18n";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setInterfaceLanguage("zh-CN");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

it("replaces a failed interface with a reload action", async () => {
  function Broken(): never {
    throw new Error("render failed");
  }

  await act(async () =>
    root.render(
      <AppErrorBoundary>
        <Broken />
      </AppErrorBoundary>,
    ),
  );

  expect(host.textContent).toContain("界面出现错误");
  expect(host.textContent).toContain("重新加载后可恢复邮箱");
  expect(host.querySelector("button")?.textContent).toBe("重新加载应用");
});
