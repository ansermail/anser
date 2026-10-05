// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { disableFrameContextMenu } from "./context-menu";

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
