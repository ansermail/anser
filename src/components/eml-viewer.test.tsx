// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmlViewer } from "./eml-viewer";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async (_event: string, _handler: () => void) => () => {}),
  toastError: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../lib/api", () => ({ native: true }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.invoke.mockReset();
  mocks.listen.mockClear();
  mocks.toastError.mockClear();
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "take_eml_paths" ? [] : undefined,
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<EmlViewer />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function openFromSystem(path = "/tmp/sample.eml") {
  mocks.invoke.mockResolvedValueOnce([path]);
  const handler = mocks.listen.mock.calls.at(-1)![1] as () => void;
  await act(async () => handler());
}
it("opens queued OS files in the external window after subscribing", async () => {
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "take_eml_paths" ? ["/tmp/sample.eml"] : undefined,
  );
  await act(async () => {
    root.unmount();
    root = createRoot(host);
    root.render(<EmlViewer />);
  });
  expect(mocks.listen).toHaveBeenCalledWith(
    "eml-files-available",
    expect.any(Function),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("open_external_mail_window", {
    path: "/tmp/sample.eml",
  });
  expect(document.body.textContent).toBe("");
});
it("opens only the last queued path to avoid duplicate windows", async () => {
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "take_eml_paths"
      ? ["/tmp/first.eml", "/tmp/second.eml"]
      : undefined,
  );
  await act(async () => {
    root.unmount();
    root = createRoot(host);
    root.render(<EmlViewer />);
  });
  expect(mocks.invoke).toHaveBeenCalledWith("open_external_mail_window", {
    path: "/tmp/second.eml",
  });
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "open_external_mail_window",
    ),
  ).toHaveLength(1);
});
it("reports a localized window creation error without rendering a modal", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "open_external_mail_window") throw new Error("unreadable");
    return ["/tmp/sample.eml"];
  });
  await openFromSystem();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.toastError).toHaveBeenCalledWith("无法读取源文件。");
});
it("explains a changed file without exposing the backend error code", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "open_external_mail_window") throw new Error("fileChanged");
    return ["/tmp/sample.eml"];
  });
  await openFromSystem();
  expect(mocks.toastError).toHaveBeenCalledWith("源文件已变化，请重新选择。");
  expect(mocks.toastError).not.toHaveBeenCalledWith(
    expect.stringContaining("fileChanged"),
  );
});
