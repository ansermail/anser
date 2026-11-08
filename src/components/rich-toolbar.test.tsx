// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { expect, it, vi } from "vitest";
import { richExtensions } from "../lib/rich-extensions";
import { RichToolbar } from "./rich-toolbar";
import { TooltipProvider } from "./ui/tooltip";

it("applies a low-frequency format only to the preserved selection and returns focus to the body", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const originalRect = Range.prototype.getBoundingClientRect;
  const originalRects = Range.prototype.getClientRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  const body = document.createElement("div"),
    toolbar = document.createElement("div");
  document.body.append(body, toolbar);
  const editor = new Editor({
    element: body,
    extensions: richExtensions(),
    content: "<p>selected remainder</p>",
  });
  const root = createRoot(toolbar);
  try {
    editor.commands.setTextSelection({ from: 1, to: 9 });
    await act(async () =>
      root.render(
        <TooltipProvider>
          <RichToolbar
            editor={editor}
            disabled={false}
            imageBusy={false}
            onImage={() => {}}
            onLink={() => {}}
            searchOpen={false}
            onSearchOpen={() => {}}
            dark={false}
            themeMode="light"
          />
        </TooltipProvider>,
      ),
    );
    expect(toolbar.querySelector('[aria-label="上标"]')).toBeNull();
    const more = toolbar.querySelector('[aria-label="更多格式"]')!;
    await act(async () =>
      more.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
    );
    const sup = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
    ].find((item) => item.textContent?.trim() === "上标")!;
    expect(sup).toBeTruthy();
    await act(async () => sup.click());
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(editor.view.dom),
    );
    expect(editor.getHTML()).toContain("<sup>selected</sup> remainder");
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(9);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    editor.destroy();
    body.remove();
    toolbar.remove();
    Range.prototype.getBoundingClientRect = originalRect;
    Range.prototype.getClientRects = originalRects;
  }
});
