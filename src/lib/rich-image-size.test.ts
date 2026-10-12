// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { richExtensions } from "./rich-extensions";
import { imageDimension, resizeImage } from "./rich-image-size";
import { prepareCompose } from "./compose-format";
import { newDraft } from "./api";
const src = "data:image/png;base64,aW1hZ2U=";
describe("authored image dimensions", () => {
  it("preserves independent sizes through HTML, draft reopen and delivery; undo and reset preserve bytes", () => {
    const editor = new Editor({
      extensions: richExtensions(),
      content: `<p><img src="${src}" width="800" height="400"></p>`,
    });
    const target = {
      node: editor.state.doc.nodeAt(1)!,
      bookmark: NodeSelection.create(editor.state.doc, 1).getBookmark(),
    };
    expect(resizeImage(editor, target, 240, 80)).toBe(true);
    expect(editor.getHTML()).toContain('width="240"');
    expect(editor.getHTML()).toContain('height="80"');
    editor.commands.undo();
    expect(editor.getHTML()).toContain('width="800"');
    const restored = {
      node: editor.state.doc.nodeAt(1)!,
      bookmark: NodeSelection.create(editor.state.doc, 1).getBookmark(),
    };
    resizeImage(editor, restored, 240, 80);
    const html = JSON.parse(JSON.stringify({ html: editor.getHTML() })).html;
    const reopened = new Editor({
      extensions: richExtensions(),
      content: html,
    });
    const delivered = prepareCompose({
      ...newDraft("a"),
      html: reopened.getHTML(),
    });
    const img = new DOMParser()
      .parseFromString(delivered.deliveryHtml!, "text/html")
      .querySelector("img")!;
    expect(img.getAttribute("src")).toBe(src);
    expect(img.getAttribute("width")).toBe("240");
    expect(img.getAttribute("height")).toBe("80");
    expect(img.style.width).toBe("240px");
    expect(img.style.height).toBe("80px");
    const resetTarget = {
      node: reopened.state.doc.nodeAt(1)!,
      bookmark: NodeSelection.create(reopened.state.doc, 1).getBookmark(),
    };
    expect(resizeImage(reopened, resetTarget, null, null)).toBe(true);
    expect(reopened.getHTML()).not.toContain('width="');
    expect(reopened.getHTML()).toContain(src);
    editor.destroy();
    reopened.destroy();
  });
  it("maps target after preceding edits, rejects deleted same-source neighbor, and refuses locked edits", () => {
    const editor = new Editor({
      extensions: richExtensions(),
      content: `<p><img src="${src}"><img src="${src}"></p>`,
    });
    const target = {
      node: editor.state.doc.nodeAt(1)!,
      bookmark: NodeSelection.create(editor.state.doc, 1).getBookmark(),
    };
    let tr = editor.state.tr.insertText("prefix", 1);
    target.bookmark = target.bookmark.map(tr.mapping);
    editor.view.dispatch(tr);
    expect(resizeImage(editor, target, 120, 60)).toBe(true);
    const first = NodeSelection.create(editor.state.doc, 7);
    const deleted = { node: first.node, bookmark: first.getBookmark() };
    tr = editor.state.tr.delete(first.from, first.to);
    deleted.bookmark = deleted.bookmark.map(tr.mapping);
    editor.view.dispatch(tr);
    expect(resizeImage(editor, deleted, 50, 50)).toBe(false);
    expect(editor.getHTML()).not.toContain('width="50"');
    const remaining = {
      node: editor.state.doc.nodeAt(7)!,
      bookmark: NodeSelection.create(editor.state.doc, 7).getBookmark(),
    };
    editor.setEditable(false);
    expect(resizeImage(editor, remaining, 30, 30)).toBe(false);
    editor.destroy();
  });
  it("accepts bounded pixel dimensions from pasted styles and rejects malformed dimensions", () => {
    for (const invalid of [
      0,
      -1,
      10001,
      1.5,
      "50%",
      "NaN",
      "20px;color:red",
      null,
    ])
      expect(imageDimension(invalid)).toBeNull();
    expect(imageDimension("320px")).toBe(320);
    const editor = new Editor({
      extensions: richExtensions(),
      content: `<p><img src="${src}" style="width:320px;height:100px"></p>`,
    });
    expect(editor.getHTML()).toContain('width="320"');
    expect(editor.getHTML()).toContain('height="100"');
    editor.destroy();
  });
});
