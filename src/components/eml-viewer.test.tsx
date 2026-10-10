// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EmlViewer } from "./eml-viewer";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  listen: vi.fn(async (_event: string, _handler: () => void) => () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: mocks.open,
  save: vi.fn(),
}));
vi.mock("../lib/api", () => ({ native: true }));
vi.mock("./mail-content", () => ({
  MailContent: ({ html }: { html: string }) => <div>{html}</div>,
}));
let root: Root, host: HTMLDivElement;
const documentResult = {
  token: "sample-token",
  filename: "sample.eml",
  detail: {
    mail: {
      subject: "Original subject",
      sender: "sample@example.com",
      recipients: "reader@example.com",
      date: "2026-10-08",
      parseWarnings: [],
    },
    html: "Original body",
    cc: [],
    attachments: [],
  },
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.invoke.mockReset();
  mocks.open.mockReset();
  mocks.listen.mockClear();
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
it("opens queued OS files after subscribing, with read-only headers", async () => {
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "take_eml_paths" ? ["/tmp/sample.eml"] : documentResult,
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
  expect(document.body.textContent).toContain("Original subject");
  expect(document.body.textContent).toContain("2026-10-08");
  expect(document.body.textContent).toContain("只读查看，不导入邮箱或存档");
  expect(mocks.invoke).not.toHaveBeenCalledWith(
    "save_draft",
    expect.anything(),
  );
});
it("closing while parsing ignores a late result and releases its snapshot", async () => {
  let resolve!: (value: typeof documentResult) => void;
  mocks.invoke.mockImplementation((command: string) =>
    command === "open_eml_file"
      ? new Promise((done) => {
          resolve = done;
        })
      : Promise.resolve([]),
  );
  await openFromSystem();
  const close = document.querySelector(
    '[data-slot="dialog-close"]',
  ) as HTMLButtonElement;
  await act(async () => close.click());
  await act(async () => resolve(documentResult));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledWith("close_eml_file", {
    token: "sample-token",
  });
});
it("an unreadable file shows an error and a subsequent file can open", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "open_eml_file") throw "文件不存在";
    return [];
  });
  await openFromSystem();
  expect(document.body.textContent).toContain("文件不存在");
  await act(async () => {
    (
      document.querySelector('[data-slot="dialog-close"]') as HTMLButtonElement
    ).click();
  });
  mocks.invoke.mockImplementation(async (command: string) =>
    command === "open_eml_file" ? documentResult : [],
  );
  await openFromSystem();
  expect(document.body.textContent).toContain("Original body");
});
