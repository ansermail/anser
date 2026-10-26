// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MAIL_IMAGE_TIMEOUT_MS, watchMailImages } from "./mail-images";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function fixture() {
  const doc = document.implementation.createHTMLDocument("mail");
  doc.body.innerHTML =
    '<img src="https://example.com/stall.png" srcset="https://example.com/stall@2.png 2x"><img src="data:image/png;base64,aGVsbG8=">';
  const [slow, good] = [...doc.images];
  let complete = false,
    width = 0;
  Object.defineProperties(slow, {
    complete: { get: () => complete },
    naturalWidth: { get: () => width },
  });
  Object.defineProperties(good, {
    complete: { value: true },
    naturalWidth: { value: 100 },
  });
  return {
    doc,
    slow,
    good,
    finish: (success = true) => {
      complete = true;
      width = success ? 100 : 0;
    },
  };
}
describe("mail image deadline", () => {
  it.each([
    '<div style="display:none">IMAGE</div>',
    '<div style="opacity:0">IMAGE</div>',
    '<div style="content-visibility:hidden">IMAGE</div>',
    '<div style="height:0;overflow-y:hidden">IMAGE</div>',
    '<div style="max-height:0;overflow-y:clip">IMAGE</div>',
    '<div style="max-width:0;overflow-x:hidden">IMAGE</div>',
    '<div style="position:absolute;clip:rect(0px,0px,0px,0px)">IMAGE</div>',
    "<details><summary>Summary</summary>IMAGE</details>",
  ])(
    "excludes non-content image requests inside %s and tracks them once revealed",
    (wrapper) => {
      const f = fixture(),
        changed = vi.fn();
      f.finish();
      f.doc.body.insertAdjacentHTML(
        "beforeend",
        wrapper.replace(
          "IMAGE",
          '<img src="https://other.example/unavailable">',
        ),
      );
      const image = f.doc.images[2];
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 0 },
      });
      const tracker = watchMailImages(f.doc, changed, false);
      expect(changed).toHaveBeenLastCalledWith({
        waiting: 0,
        timedOut: 0,
        failed: 0,
      });
      f.doc.body.append(image);
      tracker.refresh();
      expect(changed).toHaveBeenLastCalledWith({
        waiting: 0,
        timedOut: 0,
        failed: 1,
      });
      tracker.dispose();
    },
  );
  it.each([
    '<div style="height:0;overflow-y:visible">IMAGE</div>',
    '<div style="height:80px;overflow-y:hidden">IMAGE</div>',
    '<div style="height:0;overflow-y:hidden;padding-bottom:80px">IMAGE</div>',
    '<div style="height:0;overflow-y:hidden"><div style="position:fixed">IMAGE</div></div>',
    '<div style="height:0;overflow-y:hidden"><div style="position:absolute">IMAGE</div></div>',
    '<div style="min-height:80px;max-height:0;overflow-y:hidden">IMAGE</div>',
    '<div style="position:absolute;clip:rect(0px,80px,40px,0px)">IMAGE</div>',
    '<div style="overflow-y:auto">IMAGE</div>',
    "<details open><summary>Summary</summary>IMAGE</details>",
    "<details><summary>IMAGE</summary></details>",
  ])("retains content image failures inside %s", (wrapper) => {
    const f = fixture(),
      changed = vi.fn();
    f.finish();
    f.doc.body.insertAdjacentHTML(
      "beforeend",
      wrapper.replace("IMAGE", '<img src="https://other.example/unavailable">'),
    );
    Object.defineProperties(f.doc.images[2], {
      complete: { value: true },
      naturalWidth: { value: 0 },
    });
    const tracker = watchMailImages(f.doc, changed, false);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 1,
    });
    tracker.dispose();
  });
  it("excludes explicit zero-size analytics despite WebKit's broken-image fallback box", () => {
    const f = fixture(),
      changed = vi.fn();
    f.finish();
    f.doc.body.insertAdjacentHTML(
      "beforeend",
      '<img src="https://example.com/statistics" width="0" height="0"><img src="https://example.com/statistics2" style="width:0px;height:0px">',
    );
    const analytics = [...f.doc.images].slice(2);
    for (const image of analytics) {
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 0 },
      });
      vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
        width: 0,
        height: 20,
      } as DOMRect);
    }
    const writes = analytics.map((i) => vi.spyOn(i, "setAttribute"));
    const tracker = watchMailImages(f.doc, changed, false);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 0,
    });
    tracker.retry();
    expect(writes.every((s) => s.mock.calls.length === 0)).toBe(true);
    // A later CSS expansion makes this a real content image again.
    analytics[0].style.cssText = "width:240px;height:80px";
    vi.mocked(analytics[0].getBoundingClientRect).mockReturnValue({
      width: 240,
      height: 80,
    } as DOMRect);
    tracker.refresh();
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 1,
    });
    tracker.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps semantic, responsive, CSS-overridden and unknown-size failures visible", () => {
    const f = fixture(),
      changed = vi.fn();
    f.finish();
    f.doc.body.insertAdjacentHTML(
      "beforeend",
      [
        'width="0" height="0" alt="Chart"',
        'width="0" height="0" aria-label="Chart"',
        'width="0" height="0" aria-labelledby="caption"',
        'width="0" height="0" role="img"',
        'width="0" height="0" srcset="https://example.com/photo2.png 2x"',
        'width="0" height="0" style="width:100%;height:auto"',
        'width="0"',
        "",
      ]
        .map((attrs) => `<img src="https://example.com/photo.png" ${attrs}>`)
        .join("") +
        '<picture><source srcset="https://example.com/photo2.png"><img src="https://example.com/photo.png" width="0" height="0"></picture>',
    );
    for (const image of [...f.doc.images].slice(2)) {
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 0 },
      });
      vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
        width: 0,
        height: 20,
      } as DOMRect);
    }
    const tracker = watchMailImages(f.doc, changed, false);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 9,
    });
    tracker.dispose();
  });
  it("ignores failed unlabelled 130×1 and 1×130 strips, but reports actual missing content", () => {
    const f = fixture(),
      changed = vi.fn();
    f.finish();
    f.doc.body.insertAdjacentHTML(
      "beforeend",
      '<img src="https://example.com/spacer.png" width="130" height="1"><img src="https://example.com/blank.png" style="width:1px;height:130px"><img src="https://example.com/photo.png"><img src="https://example.com/chart.png" width="130" height="1" alt="Chart">',
    );
    const [horizontal, vertical, photo, labelled] = [...f.doc.images].slice(2);
    for (const image of [horizontal, vertical, photo, labelled])
      Object.defineProperties(image, {
        complete: { value: true },
        naturalWidth: { value: 0 },
      });
    const writes = [horizontal, vertical].map((i) =>
      vi.spyOn(i, "setAttribute"),
    );
    const tracker = watchMailImages(f.doc, changed, false);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 2,
    });
    tracker.retry();
    expect(writes.every((s) => s.mock.calls.length === 0)).toBe(true);
    photo.remove();
    labelled.remove();
    tracker.refresh();
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
    tracker.dispose();
  });
  it("ignores hidden tracking pixels without masking an unsized pending content image", () => {
    const f = fixture(),
      changed = vi.fn();
    f.doc.body.insertAdjacentHTML(
      "beforeend",
      `
      <img src="https://example.com/pixel" style="display:none;width:1px;height:1px">
      <img src="https://example.com/pixel2" width="1" height="1">
      <img src="https://example.com/pixel3" style="visibility:hidden">
      <div style="opacity:0"><img src="https://example.com/pixel4"></div>
      <div hidden><img src="https://example.com/pixel5"></div>
    `,
    );
    const hidden = [...f.doc.images].slice(2);
    for (const image of hidden)
      Object.defineProperty(image, "complete", { value: false });
    const writes = hidden.map((image) => vi.spyOn(image, "setAttribute"));
    const tracker = watchMailImages(f.doc, changed, false);
    // jsdom gives the unsized visible slow image a zero rect. Still track it.
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 1,
      timedOut: 0,
      failed: 0,
    });
    f.finish();
    vi.advanceTimersByTime(1000);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 0,
    });
    vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS);
    tracker.retry();
    expect(writes.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    tracker.dispose();
  });
  it("rechecks visibility, cancels hidden deadlines, and tracks a revealed content image", () => {
    const f = fixture(),
      changed = vi.fn();
    const tracker = watchMailImages(f.doc, changed);
    vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS);
    f.slow.parentElement!.style.display = "none";
    tracker.retry();
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
    f.slow.parentElement!.style.display = "block";
    tracker.refresh();
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 1,
      timedOut: 0,
      failed: 0,
    });
    vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 1,
      failed: 0,
    });
    tracker.dispose();
  });
  it("expires once without layout changes extending the deadline and accepts a late fixed-size load", () => {
    const f = fixture(),
      changed = vi.fn();
    const tracker = watchMailImages(f.doc, changed);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 1,
      timedOut: 0,
      failed: 0,
    });
    for (let i = 0; i < 14; i++) {
      vi.advanceTimersByTime(1000);
      tracker.refresh();
    }
    vi.advanceTimersByTime(1000);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 1,
      failed: 0,
    });
    f.finish();
    // No load event or resize required on the WebKit sandbox path.
    vi.advanceTimersByTime(1000);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 0,
    });
    expect(vi.getTimerCount()).toBe(0);
    tracker.dispose();
  });
  it("keeps native sandbox tracking out of child frame event listeners", () => {
    const f = fixture(),
      changed = vi.fn();
    const listener = vi.spyOn(f.doc, "addEventListener");
    const tracker = watchMailImages(f.doc, changed, false);
    expect(
      listener.mock.calls.filter(
        ([name]) => name === "load" || name === "error",
      ),
    ).toHaveLength(0);
    f.finish();
    vi.advanceTimersByTime(1000);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 0,
    });
    tracker.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retries only unavailable images using the exact sanitized src/srcset and a new deadline", () => {
    const f = fixture(),
      changed = vi.fn();
    const tracker = watchMailImages(f.doc, changed);
    vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS);
    const src = f.slow.getAttribute("src"),
      srcset = f.slow.getAttribute("srcset");
    const set = vi.spyOn(f.good, "setAttribute");
    tracker.retry();
    expect(set).not.toHaveBeenCalled();
    expect(f.slow.getAttribute("src")).toBe(src);
    expect(f.slow.getAttribute("srcset")).toBe(srcset);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 1,
      timedOut: 0,
      failed: 0,
    });
    vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 1,
      failed: 0,
    });
    tracker.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("clears errors for completed successful images and removes detached images and their timers", () => {
    const f = fixture(),
      changed = vi.fn();
    const tracker = watchMailImages(f.doc, changed);
    f.finish(false);
    f.slow.dispatchEvent(new Event("error"));
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 1,
    });
    f.slow.remove();
    tracker.refresh();
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 0,
      timedOut: 0,
      failed: 0,
    });
    tracker.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not deliver old timeouts after switching mail and gives a changed source a fresh deadline", () => {
    const f = fixture(),
      changed = vi.fn();
    const tracker = watchMailImages(f.doc, changed);
    vi.advanceTimersByTime(10_000);
    f.slow.src = "https://example.com/other.png";
    tracker.refresh();
    vi.advanceTimersByTime(5000);
    expect(changed).toHaveBeenLastCalledWith({
      waiting: 1,
      timedOut: 0,
      failed: 0,
    });
    tracker.dispose();
    changed.mockClear();
    vi.advanceTimersByTime(30_000);
    f.slow.dispatchEvent(new Event("load"));
    tracker.retry();
    tracker.refresh();
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
describe("mail image console diagnostics", () => {
  it("prints each failing image once with a URL-encoded address", () => {
    const f = fixture(),
      changed = vi.fn(),
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    f.slow.setAttribute("alt", "价格 图表");
    f.finish(false);
    const tracker = watchMailImages(f.doc, changed, false);
    tracker.refresh();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("reason=failed");
    expect(line).toContain("url=https%3A%2F%2Fexample.com%2Fstall.png");
    expect(line).toContain(
      "srcset=https%3A%2F%2Fexample.com%2Fstall%402.png%202x",
    );
    expect(line).toContain("alt=%E4%BB%B7%E6%A0%BC%20%E5%9B%BE%E8%A1%A8");
    expect(line).not.toContain("data:image");
    tracker.refresh();
    expect(warn).toHaveBeenCalledTimes(1);
    tracker.dispose();
    warn.mockRestore();
  });
  it("prints a timed-out image once and stays quiet for loaded images", () => {
    const f = fixture(),
      changed = vi.fn(),
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tracker = watchMailImages(f.doc, changed, false);
    vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("reason=timeout");
    vi.advanceTimersByTime(MAIL_IMAGE_TIMEOUT_MS);
    tracker.refresh();
    expect(warn).toHaveBeenCalledTimes(1);
    f.finish();
    tracker.refresh();
    expect(warn).toHaveBeenCalledTimes(1);
    tracker.dispose();
    warn.mockRestore();
  });
});
