// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { ComposeDialog } from "./compose-dialog";
import { makeDemo } from "@/lib/demo";
import { newDraft } from "@/lib/api";
import { emptySignature } from "@/lib/signatures";
import type { Compose, ForwardFile } from "@/lib/types";
const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  drop: undefined as undefined | ((event: any) => void),
  stop: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  native: true,
  isDemo: () => false,
  call: mocks.call,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: any) => {
      mocks.drop = handler;
      return mocks.stop;
    },
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
let root: Root, host: HTMLDivElement, initial: Compose;
const accounts = makeDemo().accounts;
async function render(draft: Compose | null = initial) {
  await act(async () =>
    root.render(
      <ComposeDialog
        draft={draft}
        accounts={accounts}
        onClose={() => {}}
        onSent={() => {}}
      />,
    ),
  );
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text || b.getAttribute("aria-label") === text,
  )!;
  expect(button).toBeDefined();
  await act(async () => button.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("devicePixelRatio", 2);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 10,
    top: 20,
    right: 500,
    bottom: 800,
    width: 490,
    height: 780,
    x: 10,
    y: 20,
    toJSON() {},
  });
  mocks.call.mockReset();
  mocks.stop.mockReset();
  mocks.drop = undefined;
  mocks.open.mockReset();
  mocks.call.mockImplementation(async (command: string, args: any) =>
    command === "mail_signature"
      ? emptySignature()
      : command === "contact_suggestions"
        ? []
        : command === "open_compose_session"
          ? `lease-${args.id}`
          : undefined,
  );
  initial = newDraft(accounts[0].id);
  initial.subject = "Fictional forward";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("managed original attachments", () => {
  it("blocks send until prepared and saves individual selection", async () => {
    initial.forwardSource = { id: "source", hash: "a".repeat(64) };
    let resolve!: (files: ForwardFile[]) => void;
    const promise = new Promise<ForwardFile[]>((done) => {
      resolve = done;
    });
    const base = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((cmd, args) =>
      cmd === "prepare_forward_files" ? promise : base(cmd, args),
    );
    await render();
    expect(
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "发送邮件",
      )?.disabled,
    ).toBe(true);
    await act(async () =>
      resolve([
        {
          id: "file-one",
          name: "同名.pdf",
          mime: "application/pdf",
          size: 4,
          included: true,
        },
        {
          id: "file-two",
          name: "同名.pdf",
          mime: "text/plain",
          size: 5,
          included: true,
        },
      ]),
    );
    const boxes = [...document.querySelectorAll('[role="checkbox"]')];
    expect(boxes).toHaveLength(2);
    await act(async () => (boxes[1] as HTMLElement).click());
    await click("保存草稿并关闭");
    const saved = mocks.call.mock.calls
      .filter(([cmd]) => cmd === "save_draft")
      .at(-1)?.[1].draft as Compose;
    expect(saved.forwardSource).toBeUndefined();
    expect(saved.forwardFiles?.map((file) => file.included)).toEqual([
      true,
      false,
    ]);
  });
  it("drops a result after changing drafts and releases the old session", async () => {
    initial.forwardSource = { id: "source", hash: "a".repeat(64) };
    let resolve!: (files: ForwardFile[]) => void;
    const pending = new Promise<ForwardFile[]>((done) => {
        resolve = done;
      }),
      base = mocks.call.getMockImplementation()!;
    mocks.call.mockImplementation((cmd, args) =>
      cmd === "prepare_forward_files" ? pending : base(cmd, args),
    );
    await render();
    await render({ ...newDraft(accounts[0].id), subject: "New draft" });
    await act(async () =>
      resolve([
        {
          id: "old-file",
          name: "do-not-add.txt",
          mime: "text/plain",
          size: 3,
          included: true,
        },
      ]),
    );
    expect(document.body.textContent).not.toContain("do-not-add.txt");
    expect(
      mocks.call.mock.calls.some(
        ([cmd, args]) =>
          cmd === "close_compose_session" && args.id === initial.id,
      ),
    ).toBe(true);
  });
  it("accepts drops inside the editable dialog and unlistens on closing", async () => {
    await render();
    expect(mocks.drop).toBeDefined();
    await act(async () =>
      mocks.drop!({
        payload: {
          type: "drop",
          paths: ["/one/report.txt", "/one/report.txt", "/two/report.txt"],
          position: { x: 100, y: 100 },
        },
      }),
    );
    expect(
      document.querySelectorAll(".compose-attachments > span"),
    ).toHaveLength(2);
    await act(async () =>
      mocks.drop!({
        payload: {
          type: "drop",
          paths: ["/outside.txt"],
          position: { x: 0, y: 0 },
        },
      }),
    );
    expect(document.body.textContent).not.toContain("outside.txt");
    await render(null);
    expect(mocks.stop).toHaveBeenCalled();
  });
});
