import type { Editor } from "@tiptap/core";
import { NodeSelection, type SelectionBookmark } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";

export const MAX_IMAGE_DIMENSION = 10000;
export function imageDimension(value: unknown): number | null {
  const text = String(value ?? "");
  if (!/^\d+(?:px)?$/.test(text)) return null;
  const number = Number(text.replace(/px$/, ""));
  return Number.isInteger(number) &&
    number >= 1 &&
    number <= MAX_IMAGE_DIMENSION
    ? number
    : null;
}

export type ImageTarget = { bookmark: SelectionBookmark; node: Node };

// A mapped bookmark alone can resolve to the next image after deletion. Node
// identity prevents a late dialog from resizing that different image instead.
export function resizeImage(
  editor: Editor,
  target: ImageTarget | null,
  width: number | null,
  height: number | null,
): boolean {
  if (!target || editor.isDestroyed || !editor.isEditable) return false;
  if (
    (width !== null && imageDimension(width) === null) ||
    (height !== null && imageDimension(height) === null)
  )
    return false;
  const selection = target.bookmark.resolve(editor.state.doc);
  if (
    !(selection instanceof NodeSelection) ||
    selection.node !== target.node ||
    selection.node.type.name !== "image"
  )
    return false;
  editor.view.dispatch(
    editor.state.tr
      .setSelection(selection)
      .setNodeMarkup(selection.from, undefined, {
        ...target.node.attrs,
        width,
        height,
      }),
  );
  editor.commands.focus();
  return true;
}
