// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TextStyle, FontFamily, FontSize } from "@tiptap/extension-text-style";
import {
  BODY_FONTS,
  inlineImageBytes,
  readBodyImage,
  MAX_INLINE_IMAGE,
} from "./rich-body";
import { hasDraftContent, prepareCompose } from "./compose-format";
import { newDraft } from "./api";
import { richExtensions } from "./rich-extensions";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
describe("rich body snapshots", () => {
  it("preserves Simple Editor formats in delivery and static task state without editor inputs", () => {
    const editor = new Editor({
      extensions: richExtensions(),
      content:
        '<h4>标题四</h4><p style="text-align:center"><s>删除</s> <sup>2</sup> <sub>3</sub> <mark data-color="#fff59d" style="background-color:#fff59d">高亮</mark></p><pre><code>const n = 1;</code></pre><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>已完成</p></div></li><li data-type="taskItem" data-checked="false"><div><p>待处理</p></div></li></ul>',
    });
    const html = editor.getHTML(),
      draft = { ...newDraft("a"), html, body: editor.getText() };
    const delivered = prepareCompose(draft);
    expect(delivered.html).toBe(html);
    for (const token of [
      "<h4>",
      "<s>",
      "<sup>",
      "<sub>",
      "<mark",
      "text-align: center",
      "<pre><code>",
      "☑",
      "☐",
    ])
      expect(delivered.deliveryHtml).toContain(token);
    expect(delivered.deliveryHtml).not.toContain("<input");
    expect(delivered.deliveryBody).toContain("☑ 已完成");
    expect(delivered.deliveryBody).toContain("☐ 待处理");
    editor.commands.setTextSelection(2);
    editor.commands.setSuperscript();
    editor.commands.setSubscript();
    expect(editor.isActive("superscript")).toBe(false);
    expect(editor.isActive("subscript")).toBe(true);
    editor.destroy();
  });
  it("finds across marks, navigates and replaces without changing image bytes; undo restores authored text", () => {
    const editor = new Editor({
      extensions: richExtensions(),
      content: `<p>Alpha <strong>Al</strong>pha alpha <img src="data:image/png;base64,${png}"></p>`,
    });
    const original = editor.getHTML();
    editor.commands.setSearchTerm("Alpha");
    expect(editor.storage.findAndReplace.results).toHaveLength(3);
    expect(editor.getHTML()).toBe(original);
    editor.commands.setCaseSensitive(true);
    expect(editor.storage.findAndReplace.results).toHaveLength(2);
    editor.commands.goToNextResult();
    editor.commands.setReplaceTerm("Beta");
    editor.commands.replace();
    expect(editor.getText()).toContain("Beta");
    expect(editor.getHTML()).toContain(png);
    editor.commands.undo();
    expect(editor.getHTML()).toBe(original);
    editor.commands.setCaseSensitive(false);
    editor.commands.replaceAll();
    expect(editor.getText()).toBe("Beta Beta Beta ");
    expect(editor.getHTML()).toContain(png);
    editor.commands.clearSearch();
    expect(editor.storage.findAndReplace.results).toHaveLength(0);
    editor.destroy();
  });
  it("defaults new mail to rich, keeps legacy plain and treats image-only mail as content", () => {
    expect(newDraft("a").format).toBe("rich");
    expect(hasDraftContent(newDraft("a"))).toBe(false);
    expect(
      hasDraftContent({
        ...newDraft("a"),
        html: `<p><img src="data:image/png;base64,${png}"></p>`,
      }),
    ).toBe(true);
  });
  it("persists Chinese and English font families and pt sizes, images and delivery without repeating signatures", () => {
    const extensions = [
      StarterKit,
      Image.configure({ allowBase64: true, inline: true }),
      TextStyle,
      FontFamily,
      FontSize,
    ];
    for (const font of BODY_FONTS) {
      const editor = new Editor({
        extensions,
        content: "<p>中文样本 English sample</p>",
      });
      editor.commands.selectAll();
      editor.commands.setFontFamily(font.value);
      editor.commands.setFontSize("10.5pt");
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.setImage({
        src: `data:image/png;base64,${png}`,
        alt: "示例图",
      });
      const draft = {
        ...newDraft("a"),
        body: editor.getText(),
        html: editor.getHTML(),
        signature: { accountId: "a", included: true, body: "签名", html: "" },
      };
      const reopened = new Editor({
        extensions,
        content: JSON.parse(JSON.stringify(draft)).html,
      });
      const delivered = prepareCompose({ ...draft, html: reopened.getHTML() });
      expect(delivered.html).toContain("font-family:");
      expect(delivered.html).toContain("10.5pt");
      expect(delivered.html).toContain(png);
      expect(delivered.deliveryHtml).toContain(png);
      const sent = new DOMParser().parseFromString(
        delivered.deliveryHtml!,
        "text/html",
      );
      const storedFont = (sent.querySelector("span[style]") as HTMLElement)
        .style.fontFamily;
      const normalize = (value: string) =>
        value.replace(/["'\s]/g, "").toLowerCase();
      expect(normalize(storedFont)).toBe(normalize(font.value));
      expect(reopened.getText()).toContain("English sample");
      expect(
        (delivered.deliveryHtml?.match(/data-anser-signature/g) || []).length,
      ).toBe(1);
      editor.destroy();
      reopened.destroy();
    }
  });
  it("sniffs actual image bytes rather than trusting extension/type, rejects SVG and oversized input", async () => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const result = await readBodyImage(
      new File([bytes], "image.dat", { type: "text/plain" }),
    );
    expect(result.src).toBe(`data:image/png;base64,${png}`);
    await expect(
      readBodyImage(
        new File(["<svg onload='bad()'/>"], "image.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("PNG");
    await expect(
      readBodyImage(
        new File([new Uint8Array(MAX_INLINE_IMAGE + 1)], "big.png"),
      ),
    ).rejects.toThrow("10 MB");
    expect(
      inlineImageBytes(`<img src="${result.src}"><img src="${result.src}">`, [
        result,
      ]),
    ).toBe(bytes.length);
  });
});
