import { Extension, InputRule } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { marked } from "marked";
import { markdownMarkup } from "./compose-format";
import { composeLinkAllowed } from "./markdown-serialization";

const tableDivider = /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?$/;
const tableHeader = /^\|.+\|$/;

function tableSource(line: string) {
  if (!tableHeader.test(line) || tableDivider.test(line)) return null;
  // Pipes escaped by the author are part of cell text.
  const columns = line.slice(1, -1).split(/(?<!\\)(?:\\\\)*\|/).length;
  if (columns > 12) return null;
  return `${line}\n| ${Array<string>(columns).fill("---").join(" | ")} |`;
}

function looksLikeMarkdown(text: string) {
  if (!/\S[\s\S]*\n[\s\S]*\S/.test(text)) return false;
  return marked
    .lexer(text, { gfm: true })
    .some(
      (token) =>
        ["heading", "table", "code", "blockquote"].includes(token.type) ||
        (token.type === "list" &&
          (token.items.length > 1 ||
            token.items.some((item: { task: boolean }) => item.task))),
    );
}

export const RichMarkdown = Extension.create({
  name: "mailMarkdownInput",
  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\]\n]+)\]\(([^()\s]+)\)$/,
        handler: ({ state, range, match }) => {
          const href = match[2];
          const marks = state.doc.resolve(range.from).marks();
          if (
            !composeLinkAllowed(href) ||
            marks.some((mark) => mark.type.spec.code)
          )
            return null;
          const { link } = state.schema.marks;
          state.tr
            .replaceWith(
              range.from,
              range.to,
              state.schema.text(
                match[1],
                link.create({ href }).addToSet(marks),
              ),
            )
            .removeStoredMark(link);
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.isComposing ||
              view.composing ||
              !view.editable ||
              !view.state.selection.empty
            )
              return false;
            const { schema, tr, selection } = view.state;
            const { $from } = selection;
            if (
              $from.parent.type !== schema.nodes.paragraph ||
              $from.parentOffset !== $from.parent.content.size
            )
              return false;
            if (!(
              $from.parent.childCount === 1 && $from.parent.firstChild?.isText
            ))
              return false;
            const line = $from.parent.textContent.trim();
            const start = $from.before();
            const end = $from.after();
            const tableRole =
              $from.depth > 1 ? $from.node(-1).type.spec.tableRole : undefined;

            // If a conventional GFM divider is typed after the shortcut,
            // populate alignment on the generated header and first data row.
            if (tableRole === "cell" && tableDivider.test(line)) {
              const row = $from.node(-2);
              const table = $from.node(-3);
              if (
                $from.index(-2) !== 0 ||
                $from.index(-3) !== 1 ||
                table.childCount !== 2
              )
                return false;
              const alignments = line
                .replace(/^\||\|$/g, "")
                .split("|")
                .map((part) => {
                  const separator = part.trim();
                  return separator.endsWith(":")
                    ? separator.startsWith(":")
                      ? "center"
                      : "right"
                    : separator.startsWith(":")
                      ? "left"
                      : null;
                });
              const header = table.firstChild;
              if (
                !header ||
                alignments.length !== header.childCount ||
                row.childCount !== header.childCount ||
                [...Array(row.childCount - 1)].some(
                  (_, index) => row.child(index + 1).textContent,
                )
              )
                return false;
              header.forEach((_cell, offset, index) =>
                tr.setNodeAttribute(
                  $from.start(-3) + 1 + offset,
                  "align",
                  alignments[index],
                ),
              );
              row.forEach((_cell, offset, index) =>
                tr.setNodeAttribute(
                  $from.start(-2) + offset,
                  "align",
                  alignments[index],
                ),
              );
              view.dispatch(tr.delete(start + 1, end - 1).scrollIntoView());
              return true;
            }

            // A table is a block. Do not replace text inside a list item or an
            // existing table cell with a nested table.
            if ($from.depth !== 1) return false;
            const source = tableSource(line);
            if (source) {
              const tableBody = markdownMarkup(source).body;
              const table =
                ProseMirrorDOMParser.fromSchema(schema).parse(
                  tableBody,
                ).firstChild;
              if (
                !table ||
                table.type !== schema.nodes.table ||
                !table.firstChild
              )
                return false;
              const cells = Array.from(
                { length: table.firstChild.childCount },
                () => schema.nodes.tableCell.createAndFill()!,
              );
              const row = schema.nodes.tableRow.create(null, cells);
              tr.replaceWith(
                start,
                end,
                schema.nodes.table.create(table.attrs, [table.firstChild, row]),
              );
              tr.setSelection(
                TextSelection.create(
                  tr.doc,
                  start + table.firstChild.nodeSize + 4,
                ),
              );
            } else if (/^`{3}([\w+-]+)?$/.test(line)) {
              const language = line.slice(3) || null;
              tr.replaceWith(
                start,
                end,
                schema.nodes.codeBlock.create({ language }),
              );
              tr.setSelection(TextSelection.create(tr.doc, start + 1));
            } else if (line === "***" || line === "---") {
              const rule = schema.nodes.horizontalRule.create();
              tr.replaceWith(start, end, [
                rule,
                schema.nodes.paragraph.create(),
              ]);
              tr.setSelection(
                TextSelection.create(tr.doc, start + rule.nodeSize + 1),
              );
            } else {
              return false;
            }
            view.dispatch(tr.scrollIntoView());
            return true;
          },
          handlePaste(view, event) {
            const clipboard = event.clipboardData;
            if (!view.editable || !clipboard || clipboard.getData("text/html"))
              return false;
            const text = clipboard.getData("text/plain");
            if (
              !looksLikeMarkdown(text) ||
              view.state.selection.$from.parent.type.spec.code
            )
              return false;
            const body = markdownMarkup(text).body;
            const slice = ProseMirrorDOMParser.fromSchema(
              view.state.schema,
            ).parseSlice(body);
            if (!slice.size) return false;
            view.dispatch(
              view.state.tr.replaceSelection(slice).scrollIntoView(),
            );
            return true;
          },
        },
      }),
    ];
  },
});
