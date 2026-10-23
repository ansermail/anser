// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  disableFrameContextMenu,
  disableNativeContextMenu,
} from "./context-menu";

function readableDocument() {
  const doc = document.implementation.createHTMLDocument("preview");
  Object.defineProperties(doc, {
    URL: { value: "about:srcdoc" },
    readyState: { value: "interactive" },
  });
  return doc;
}
const context = (doc: Document) =>
  doc.body.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
  );
describe("preview context menu suppression", () => {
  it("allows browser inspection only in the marked reading region", () => {
    const doc = document.implementation.createHTMLDocument("mail");
    doc.body.innerHTML =
      '<div data-mail-debug-region><p>mail text</p></div><input><div class="sidebar">sidebar</div>';
    const stop = disableNativeContextMenu(doc);
    const event = (element: Element) =>
      element.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      );
    expect(event(doc.querySelector("p")!)).toBe(true);
    expect(event(doc.querySelector("input")!)).toBe(false);
    expect(event(doc.querySelector(".sidebar")!)).toBe(false);
    stop();
    expect(event(doc.querySelector("input")!)).toBe(true);
  });
  it("clears secondary-click text selection inside sidebar and settings navigation controls", () => {
    document.body.innerHTML =
      '<div class="mail-sidebar"><button class="nav-item"><span>本地废纸篓</span></button></div><div class="settings-navigation" data-slot="tabs-list"><button data-slot="tabs-trigger">阅读与写信</button></div>';
    const stop = disableNativeContextMenu(document);
    try {
      for (const selector of [".nav-item span", '[data-slot="tabs-trigger"]']) {
        const target = document.querySelector(selector)!;
        const range = document.createRange();
        range.selectNodeContents(target);
        const selection = document.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        expect(selection.toString()).not.toBe("");
        target.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
        expect(selection.rangeCount).toBe(0);
      }
    } finally {
      stop();
      document.body.innerHTML = "";
    }
  });
  it("follows a new iframe document before remote images finish loading and cleans up", () => {
    vi.useFakeTimers();
    const frame = document.createElement("iframe");
    const first = readableDocument(),
      next = readableDocument();
    let current = first;
    Object.defineProperty(frame, "contentDocument", { get: () => current });
    const stop = disableFrameContextMenu(frame);
    try {
      expect(context(first)).toBe(false);
      current = next;
      vi.advanceTimersByTime(50);
      expect(context(next)).toBe(false);
      expect(context(first)).toBe(true);
      stop();
      expect(context(next)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
