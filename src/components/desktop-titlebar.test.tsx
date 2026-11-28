// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DesktopTitlebar } from "./desktop-titlebar";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";

const state = vi.hoisted(() => ({
  native: true,
  windows: true,
  maximized: false,
  resized: undefined as (() => void) | undefined,
  minimize: vi.fn(),
  maximize: vi.fn(),
  close: vi.fn(),
  stop: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../lib/api", () => ({
  get native() {
    return state.native;
  },
}));
vi.mock("../lib/platform", () => ({ isWindows: () => state.windows }));
vi.mock("../lib/i18n", () => ({
  t: (key: string) => key,
  useLanguage: () => {},
}));
vi.mock("sonner", () => ({ toast: { error: state.error } }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: state.minimize,
    toggleMaximize: state.maximize,
    close: state.close,
    isMaximized: async () => state.maximized,
    onResized: async (callback: () => void) => {
      state.resized = callback;
      return state.stop;
    },
  }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  state.native = true;
  state.windows = true;
  state.maximized = false;
  state.resized = undefined;
  state.minimize.mockResolvedValue(undefined);
  state.close.mockResolvedValue(undefined);
  state.maximize.mockImplementation(async () => {
    state.maximized = !state.maximized;
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function render() {
  await act(async () => root.render(<DesktopTitlebar />));
}
async function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}

it("uses three accessible shadcn window actions without a duplicated app caption", async () => {
  await render();
  expect(host.querySelectorAll('button[data-slot="button"]')).toHaveLength(3);
  expect(host.textContent).toBe("");
  expect(host.querySelector("img")).toBeNull();
  await click("Minimize window");
  expect(state.minimize).toHaveBeenCalledOnce();
  await click("Maximize window");
  expect(state.maximize).toHaveBeenCalledOnce();
  expect(
    host.querySelector('button[aria-label="Restore window"]'),
  ).not.toBeNull();
  await click("Restore window");
  expect(state.maximized).toBe(false);
  await click("Close window");
  expect(state.close).toHaveBeenCalledOnce();
});

it("tracks maximization changed by native dragging and releases its resize listener", async () => {
  await render();
  state.maximized = true;
  await act(async () => state.resized?.());
  expect(
    host.querySelector('button[aria-label="Restore window"]'),
  ).not.toBeNull();
  await act(async () => root.unmount());
  expect(state.stop).toHaveBeenCalledOnce();
  root = createRoot(host);
});

it.each([
  [false, true],
  [true, false],
])(
  "keeps native controls out of browsers and Mac windows (%s, %s)",
  async (native, windows) => {
    state.native = native;
    state.windows = windows;
    await render();
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(state.resized).toBeUndefined();
    expect(host.querySelector("[data-tauri-drag-region]")).not.toBeNull();
  },
);

it("reports a failed native action and keeps the controls usable", async () => {
  state.minimize.mockRejectedValueOnce(new Error("native operation failed"));
  await render();
  await click("Minimize window");
  expect(state.error).toHaveBeenCalledWith("Unable to control this window");
  expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
  await click("Close window");
  expect(state.close).toHaveBeenCalledOnce();
});

it("keeps an open draft dialog intact when a caption action is clicked", async () => {
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <>
        <DesktopTitlebar />
        <Dialog open onOpenChange={changed}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Mail draft</DialogTitle>
          </DialogContent>
        </Dialog>
      </>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const button = host.querySelector<HTMLButtonElement>(
    'button[aria-label="Minimize window"]',
  )!;
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    button.click();
  });
  expect(changed).not.toHaveBeenCalled();
  expect(state.minimize).toHaveBeenCalledOnce();
});

it("marks right-side sheets with data-side and offsets them below the Windows titlebar", async () => {
  await act(async () =>
    root.render(
      <>
        <DesktopTitlebar />
        <Sheet open>
          <SheetContent
            side="right"
            className="wb-editor"
            aria-describedby={undefined}
          >
            <SheetTitle>Add work record</SheetTitle>
          </SheetContent>
        </Sheet>
      </>,
    ),
  );
  const sheet = document.body.querySelector<HTMLElement>(
    '[data-slot="sheet-content"]',
  );
  expect(sheet?.getAttribute("data-side")).toBe("right");
  const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
  expect(css).toMatch(
    /:root\[data-platform="windows"\]\[data-desktop="true"\][\s\S]*?\[data-slot="sheet-overlay"\][\s\S]*?top:\s*var\(--window-titlebar-height\)/,
  );
  expect(css).toMatch(
    /:root\[data-platform="windows"\]\[data-desktop="true"\][\s\S]*?\[data-slot="sheet-content"\]\[data-side="right"\][\s\S]*?top:\s*var\(--window-titlebar-height\)[\s\S]*?height:\s*calc\(100dvh\s*-\s*var\(--window-titlebar-height\)\)/,
  );
});
