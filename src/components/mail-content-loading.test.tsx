// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailContent } from "./mail-content";
import { MAIL_IMAGE_TIMEOUT_MS } from "../lib/mail-images";
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => platform.native }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  platform.native = false;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function load(
  inspectable = true,
  hiddenTracking = false,
  layoutStrip = false,
) {
  await act(async () =>
    root.render(
      <MailContent
        inspectable={inspectable}
        html={`<p>Unchanged body</p><img src="https://example.com/${layoutStrip ? "spacer-123" : "slow"}.png" ${layoutStrip ? 'width="130" height="1"' : hiddenTracking ? 'style="display:none;width:1px;height:1px"' : ""}><img src="data:image/png;base64,aGVsbG8=">`}
        onOpenLink={() => {}}
      />,
    ),
  );
  const frame = host.querySelector("iframe")!;
  const doc = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  Object.defineProperty(frame, "contentDocument", {
    value: doc,
    configurable: true,
  });
  vi.spyOn(doc, "createRange").mockReturnValue({
    selectNodeContents() {},
    getBoundingClientRect: () => new DOMRect(0, 0, 400, 100),
  } as unknown as Range);
  let complete = false;
  Object.defineProperties(doc.images[0], {
    complete: { get: () => complete },
    naturalWidth: { get: () => (complete ? 100 : 0) },
  });
  Object.defineProperties(doc.images[1], {
    complete: { value: true },
    naturalWidth: { value: 100 },
  });
  await act(async () => frame.dispatchEvent(new Event("load")));
  return {
    doc,
    frame,
    finish: () => {
      complete = true;
    },
  };
}
it("native spacer strips do not produce a loading/error banner or remote resource retry", async () => {
  platform.native = true;
  const { doc } = await load(true, false, true);
  const spacer = doc.images[0];
  expect(spacer.src).toMatch(/^data:image\/gif/);
  expect(spacer.getAttribute("width")).toBe("130");
  expect(host.querySelector('[aria-busy="false"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS + 1000));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
});
it("does not keep a loaded native mail busy or show a timeout for a hidden analytics image", async () => {
  platform.native = true;
  const { doc } = await load(true, true);
  expect(doc.images).toHaveLength(2);
  expect(doc.images[0].complete).toBe(false);
  expect(host.querySelector('[aria-busy="false"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
  await act(async () => vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS + 1000));
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
});
it("replaces stalled loading with retry after the deadline and clears the notice on a late success", async () => {
  const { finish } = await load();
  expect(host.querySelector('[aria-label="正在加载图片"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS));
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
  expect(host.textContent).toContain("有 1 张正文图片未加载（1 张超时）");
  expect(host.querySelector('[aria-busy="false"]')).not.toBeNull();
  await act(async () =>
    host.querySelector<HTMLButtonElement>("button")!.click(),
  );
  expect(host.querySelector('[aria-label="正在加载图片"]')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  finish();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("reports failed and timed-out content counts together without including decorative resources", async () => {
  const { doc } = await load();
  await act(async () => {
    for (const attrs of [
      'alt="Chart"',
      'width="320" height="180"',
      'width="0" height="0"',
      'width="130" height="1"',
    ]) {
      const template = doc.createElement("template");
      template.innerHTML = `<img src="https://example.com/unavailable.png" ${attrs}>`;
      const image = template.content.firstElementChild as HTMLImageElement;
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 0 },
      });
      vi.spyOn(image, "getBoundingClientRect").mockReturnValue(
        new DOMRect(
          0,
          0,
          Number(image.getAttribute("width") ?? 320),
          Number(image.getAttribute("height") || 20) || 20,
        ),
      );
      doc.body.append(image);
    }
  });
  await act(async () => vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS));
  expect(host.textContent).toContain(
    "有 3 张正文图片未加载（2 张失败，1 张超时）",
  );
  expect(host.querySelectorAll("button")).toHaveLength(1);
});
it("allows Inspect Element for reading but keeps scripts disabled and signature preview menus suppressed", async () => {
  let { doc, frame } = await load(true);
  const context = () =>
    doc.body.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  expect(context()).toBe(true);
  expect(frame.getAttribute("sandbox")).toBe(
    "allow-same-origin allow-top-navigation-by-user-activation",
  );
  expect(host.querySelector("[data-mail-debug-region]")).not.toBeNull();
  await act(async () =>
    root.render(<MailContent html="<p>signature</p>" onOpenLink={() => {}} />),
  );
  frame = host.querySelector("iframe")!;
  doc = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  Object.defineProperty(frame, "contentDocument", {
    value: doc,
    configurable: true,
  });
  vi.spyOn(doc, "createRange").mockReturnValue({
    selectNodeContents() {},
    getBoundingClientRect: () => new DOMRect(),
  } as unknown as Range);
  await act(async () => frame.dispatchEvent(new Event("load")));
  expect(context()).toBe(false);
  expect(host.querySelector("[data-mail-debug-region]")).toBeNull();
  await act(async () => vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS));
  expect(host.textContent).not.toContain("加载超时");
});

it("tracks native images without child-frame script callbacks and retains routed native links", async () => {
  platform.native = true;
  await load();
  await act(async () =>
    root.render(
      <MailContent
        inspectable
        html='<p>native changed</p><a href="https://example.com">link</a><img src="https://example.com/slow.png">'
        onOpenLink={() => {}}
      />,
    ),
  );
  const frame = host.querySelector("iframe")!;
  const next = new DOMParser().parseFromString(frame.srcdoc, "text/html");
  Object.defineProperty(frame, "contentDocument", {
    value: next,
    configurable: true,
  });
  vi.spyOn(next, "createRange").mockReturnValue({
    selectNodeContents() {},
    getBoundingClientRect: () => new DOMRect(),
  } as unknown as Range);
  let complete = false;
  Object.defineProperties(next.images[0], {
    complete: { get: () => complete },
    naturalWidth: { get: () => (complete ? 100 : 0) },
  });
  const listeners = vi.spyOn(next, "addEventListener");
  await act(async () => frame.dispatchEvent(new Event("load")));
  expect(
    listeners.mock.calls.filter(([name]) =>
      ["load", "error", "click", "auxclick"].includes(name),
    ),
  ).toHaveLength(0);
  expect(next.querySelector("a")?.getAttribute("href")).toContain(
    "https://anser-mail-link.invalid/open?",
  );
  complete = true;
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.querySelector('[aria-label="正在加载图片"]')).toBeNull();
  expect(frame.getAttribute("sandbox")).toBe(
    "allow-same-origin allow-top-navigation-by-user-activation",
  );
});

it("defers body resize writes and ignores iframe height-only notifications", async () => {
  let observed: ResizeObserverCallback = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const { frame, doc } = await load();
  await act(async () => vi.advanceTimersByTime(20));
  const measure = vi
    .spyOn(doc.body, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 400, 800));
  const notify = (target: Element, width: number) =>
    observed(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, width, 900),
        } as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
  await act(async () => notify(frame, 0));
  expect(measure).not.toHaveBeenCalled();
  await act(async () => notify(doc.body, 400));
  expect(measure).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(20));
  expect(frame.style.height).toBe("802px");
  const calls = measure.mock.calls.length;
  await act(async () => notify(frame, 0));
  await act(async () => vi.advanceTimersByTime(20));
  expect(measure).toHaveBeenCalledTimes(calls);
  await act(async () => notify(frame, 500));
  await act(async () => vi.advanceTimersByTime(20));
  expect(measure.mock.calls.length).toBeGreaterThan(calls);
});
