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
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import FindAndReplace from "@tiptap/extension-find-and-replace";
import { mergeAttributes } from "@tiptap/core";
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

export function richExtensions() {
  return [
    StarterKit.configure({
      link: { openOnClick: false, protocols: ["http", "https", "mailto"] },
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
    TaskList.configure({
      HTMLAttributes: { style: "list-style:none;padding-left:0" },
    }),
    TaskItem.configure({ nested: true }),
    Table.configure({
      resizable: false,
      HTMLAttributes: {
        style: "border-collapse:collapse;width:100%;margin:12px 0",
      },
    }),
    TableRow,
    TableHeader.configure({
      HTMLAttributes: {
        style:
          "border:1px solid #d0d0d0;padding:6px 10px;background:#f6f6f6;text-align:left;vertical-align:top",
      },
    }),
    TableCell.configure({
      HTMLAttributes: {
        style:
          "border:1px solid #d0d0d0;padding:6px 10px;text-align:left;vertical-align:top",
      },
    }),
    FindAndReplace.configure({ searchDebounceMs: 0, injectCSS: false }),
  ];
}
