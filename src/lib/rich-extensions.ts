import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import {
  TextStyle,
  FontFamily,
  FontSize,
  Color,
} from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import {
  MailTable,
  MailTableRow,
  MailTableHeader,
  MailTableCell,
  MailTableResize,
} from "./rich-table";
import FindAndReplace from "@tiptap/extension-find-and-replace";
import { Extension, mergeAttributes } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { RichMarkdown } from "./rich-markdown";
import { t } from "./i18n";
import { imageDimension } from "./rich-image-size";

// Retain the official Image node and attributes. Inline sizes override the
// reader's height:auto fallback, so independently specified height is honored.
const MailImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...Object.fromEntries(
        ["width", "height"].map((dimension) => [
          dimension,
          {
            default: null,
            parseHTML: (element: HTMLElement) =>
              imageDimension(
                element.getAttribute(dimension) ||
                  element.style.getPropertyValue(dimension),
              ),
          },
        ]),
      ),
    };
  },
  renderHTML({ HTMLAttributes }) {
    const width = imageDimension(HTMLAttributes.width);
    const height = imageDimension(HTMLAttributes.height);
    const dimensions = `${width ? `width:${width}px;` : ""}${height ? `height:${height}px;` : "height:auto;"}`;
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, {
        ...HTMLAttributes,
        width,
        height,
        style: `max-width:100%;${dimensions}`,
      }),
    ];
  },
});

const BodyPlaceholder = Extension.create({
  name: "mailBodyPlaceholder",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const node = state.doc.firstChild;
            if (
              state.doc.childCount !== 1 ||
              node?.type.name !== "paragraph" ||
              node.content.size
            )
              return null;
            return DecorationSet.create(state.doc, [
              Decoration.node(0, node.nodeSize, {
                "data-placeholder": t(
                  "Write your email. You can type Markdown, insert tables or drop images.",
                ),
              }),
            ]);
          },
        },
      }),
    ];
  },
});

export function richExtensions() {
  return [
    StarterKit.configure({
      link: {
        openOnClick: false,
        protocols: ["http", "https", "mailto"],
      },
      heading: { levels: [1, 2, 3, 4] },
    }),
    MailImage.configure({
      allowBase64: true,
      inline: true,
    }),
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({
      multicolor: true,
      HTMLAttributes: { style: "color:#242424" },
    }),
    Subscript.extend({ excludes: "superscript" }),
    Superscript.extend({ excludes: "subscript" }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({
      nested: true,
      HTMLAttributes: { "data-type": "taskItem" },
      a11y: {
        checkboxLabel: (node, checked) =>
          t(checked ? "Mark {task} incomplete" : "Mark {task} complete", {
            task: node.textContent || t("Task"),
          }),
      },
    }),
    MailTable,
    MailTableRow,
    MailTableHeader,
    MailTableCell,
    MailTableResize,
    RichMarkdown,
    BodyPlaceholder,
    FindAndReplace.configure({ searchDebounceMs: 0, injectCSS: false }),
  ];
}
