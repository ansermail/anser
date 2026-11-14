import { Extension, type Editor } from "@tiptap/core";
import { Mark, type Node } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { MailRepair } from "./mail-ai";

export type DraftParagraph = {
  from: number;
  to: number;
  text: string;
  marks: readonly Mark[];
};
export type DraftEdit = DraftParagraph & { replacement: string };

export function editableParagraphs(doc: Node) {
  const paragraphs: DraftParagraph[] = [];
  const blank =
    doc.childCount === 1 &&
    doc.firstChild?.type.name === "paragraph" &&
    doc.firstChild.content.size === 0;
  doc.forEach((node, offset) => {
    if (!["paragraph", "heading"].includes(node.type.name)) return;
    if (!blank && (!node.childCount || !node.textContent.trim())) return;
    const marks = node.firstChild?.marks ?? [];
    let compatible = !marks.some((mark) => mark.type.name === "link");
    node.forEach((child) => {
      if (!child.isText || !Mark.sameSet(marks, child.marks))
        compatible = false;
    });
    if (compatible)
      paragraphs.push({
        from: offset + 1,
        to: offset + node.nodeSize - 1,
        text: node.textContent,
        marks,
      });
  });
  return { paragraphs, blank };
}

export function draftEdits(
  paragraphs: DraftParagraph[],
  edits: MailRepair["edits"],
  blank: boolean,
): DraftEdit[] | null {
  const seen = new Set<number>();
  const result: DraftEdit[] = [];
  if (!Array.isArray(edits) || edits.length > paragraphs.length) return null;
  for (const edit of edits) {
    const paragraph = paragraphs[edit.index];
    if (
      !Number.isInteger(edit.index) ||
      !paragraph ||
      seen.has(edit.index) ||
      typeof edit.text !== "string" ||
      edit.text.length > 12_000 ||
      (!blank && /[\r\n]/.test(edit.text))
    )
      return null;
    seen.add(edit.index);
    if (edit.text !== paragraph.text)
      result.push({ ...paragraph, replacement: edit.text });
  }
  return result.sort((a, b) => b.from - a.from);
}

const repairKey = new PluginKey<DecorationSet>("anser-compose-repair");
export const composeRepairDecoration = Extension.create({
  name: "composeRepairDecoration",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: repairKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, previous) =>
            tr.docChanged
              ? DecorationSet.empty
              : ((tr.getMeta(repairKey) as DecorationSet | undefined) ??
                previous),
        },
        props: { decorations: (state) => repairKey.getState(state) },
      }),
    ];
  },
});

export function showDraftEdits(editor: Editor, edits: DraftEdit[]) {
  const decorations = edits.flatMap((edit) => {
    const overlays = [];
    if (edit.from < edit.to) {
      overlays.push(
        Decoration.inline(edit.from, edit.to, {
          class: "compose-repair-removed",
        }),
      );
      overlays.push(
        Decoration.widget(
          edit.from,
          () => {
            const prefix = document.createElement("span");
            prefix.className = "compose-repair-prefix";
            prefix.textContent = "− ";
            return prefix;
          },
          { side: -1 },
        ),
      );
    }
    if (edit.replacement)
      overlays.push(
        Decoration.widget(
          edit.to,
          () => {
            const addition = document.createElement("span");
            addition.className = "compose-repair-added";
            addition.textContent = "+ " + edit.replacement;
            return addition;
          },
          { side: -1 },
        ),
      );
    return overlays;
  });
  editor.view.dispatch(
    editor.state.tr
      .setMeta(repairKey, DecorationSet.create(editor.state.doc, decorations))
      .setMeta("addToHistory", false),
  );
}

export function applyDraftEdits(
  editor: Editor,
  snapshot: Node,
  edits: DraftEdit[],
  blank: boolean,
) {
  if (
    editor.isDestroyed ||
    !editor.isEditable ||
    !editor.state.doc.eq(snapshot) ||
    !edits.length
  )
    return false;
  const { schema } = editor;
  const tr = closeHistory(editor.state.tr);
  if (blank) {
    const paragraphs = edits[0].replacement.trim().split(/\r?\n\s*/);
    tr.replaceWith(
      0,
      snapshot.content.size,
      paragraphs.map((paragraph) =>
        schema.nodes.paragraph.create(
          null,
          paragraph ? schema.text(paragraph) : undefined,
        ),
      ),
    );
  } else {
    for (const edit of edits) {
      if (edit.replacement)
        tr.replaceWith(
          edit.from,
          edit.to,
          schema.text(edit.replacement, edit.marks),
        );
      else tr.delete(edit.from, edit.to);
    }
  }
  editor.view.dispatch(tr);
  // Separate the next keystroke from the single undo step for applying AI edits.
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.commands.focus();
  return true;
}
