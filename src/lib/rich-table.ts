import { Extension, mergeAttributes, type Editor } from "@tiptap/core";
import {
  Table,
  TableView,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { EditorView } from "@tiptap/pm/view";
import { selectionCell, selectedRect, TableMap } from "@tiptap/pm/tables";

export const tableDimensions = {
  width: [200, 2000],
  column: [48, 1600],
  row: [24, 1200],
} as const;

export function tablePixels(
  value: unknown,
  dimension: keyof typeof tableDimensions,
): number | null {
  const [min, max] = tableDimensions[dimension];
  const text = String(value ?? "").trim();
  if (!/^\d+(?:px)?$/i.test(text)) return null;
  const pixels = Number.parseInt(text, 10);
  return pixels >= min && pixels <= max ? pixels : null;
}

function dimensionAttribute(
  property: "width" | "height",
  dimension: keyof typeof tableDimensions,
) {
  return {
    default: null as number | null,
    parseHTML: (element: HTMLElement) =>
      tablePixels(
        element.style[property] || element.getAttribute(property),
        dimension,
      ),
    renderHTML: (attrs: Record<string, unknown>) => {
      const pixels = tablePixels(attrs[property], dimension);
      return pixels ? { style: `${property}:${pixels}px` } : {};
    },
  };
}

function savedColumnWidths(table: ProseMirrorNode): number[] {
  const widths: number[] = [];
  table.firstChild?.forEach((cell) => {
    for (let i = 0; i < cell.attrs.colspan; i++)
      widths.push(tablePixels(cell.attrs.colwidth?.[i], "column") || 0);
  });
  return widths;
}

const sumWidths = (widths: number[]) =>
  widths.reduce((sum, width) => sum + width, 0);

class MailTableView extends TableView {
  constructor(node: ProseMirrorNode, minWidth: number) {
    super(node, minWidth);
    this.syncWidth();
  }

  override update(node: ProseMirrorNode) {
    if (!super.update(node)) return false;
    this.syncWidth();
    return true;
  }

  private syncWidth() {
    const pixels = tablePixels(this.node.attrs.width, "width");
    const widths = savedColumnWidths(this.node);
    this.table.style.setProperty(
      "--mail-table-width",
      pixels ? `${pixels}px` : "100%",
    );
    // An automatic table with complete widths keeps its proportions when
    // the writing area changes. Resetting a column clears its old track width.
    const proportional = !pixels && widths.every(Boolean);
    const total = sumWidths(widths);
    if (proportional)
      this.table.style.minWidth = `${widths.length * this.cellMinWidth}px`;
    [...this.colgroup.children].forEach((col, index) => {
      const style = (col as HTMLTableColElement).style;
      const width = widths[index];
      style.width = width
        ? proportional
          ? `${(width / total) * 100}%`
          : `${width}px`
        : "";
      style.minWidth = width ? "" : `${this.cellMinWidth}px`;
    });
  }
}

export const MailTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        ...dimensionAttribute("width", "width"),
        rendered: false,
      },
    };
  },
  renderHTML({ node }) {
    const width = tablePixels(node.attrs.width, "width");
    const columns = savedColumnWidths(node);
    const sized = columns.length > 0 && columns.every(Boolean);
    const attributes = {
      style: `border-collapse:collapse;width:${width ? `${width}px` : "100%"};max-width:100%;margin:12px 0${sized ? ";table-layout:fixed" : ""}`,
    };
    if (!sized) return ["table", attributes, ["tbody", 0]];
    const total = sumWidths(columns);
    return [
      "table",
      attributes,
      [
        "colgroup",
        ...columns.map((column) => [
          "col",
          { style: `width:${(column / total) * 100}%` },
        ]),
      ],
      ["tbody", 0],
    ];
  },
}).configure({
  resizable: false,
  cellMinWidth: tableDimensions.column[0],
  allowTableNodeSelection: true,
  View: MailTableView,
});

export const MailTableRow = TableRow.extend({
  addAttributes() {
    return { ...this.parent?.(), height: dimensionAttribute("height", "row") };
  },
});

function cellAttributes() {
  return {
    align: {
      default: null,
      parseHTML: (element: HTMLElement) => {
        const align = element.getAttribute("align") || element.style.textAlign;
        return align && ["left", "center", "right"].includes(align)
          ? align
          : null;
      },
      renderHTML: ({ align }: { align?: string }) =>
        align ? { align, style: `text-align:${align}` } : {},
    },
    colwidth: {
      default: null as number[] | null,
      parseHTML: (element: HTMLElement) => {
        const raw =
          element.getAttribute("colwidth") ||
          element.getAttribute("data-colwidth");
        const span = Number(element.getAttribute("colspan") || 1);
        if (raw) {
          const widths = raw
            .split(",")
            .map((part) => tablePixels(part, "column") || 0);
          if (widths.length === span && widths.some(Boolean)) return widths;
        }
        const width = tablePixels(
          element.style.width || element.getAttribute("width"),
          "column",
        );
        return width && span === 1 ? [width] : null;
      },
      renderHTML: ({ colwidth }: { colwidth?: number[] | null }) =>
        colwidth?.some(Boolean) ? { "data-colwidth": colwidth.join(",") } : {},
    },
    height: dimensionAttribute("height", "row"),
    width: {
      ...dimensionAttribute("width", "column"),
      parseHTML: (element: HTMLElement) =>
        Number(element.getAttribute("colspan")) > 1
          ? tablePixels(
              element.style.width || element.getAttribute("width"),
              "column",
            )
          : null,
      rendered: false,
    },
  };
}

function renderCell(
  tag: "td" | "th",
  node: ProseMirrorNode,
  attributes: Record<string, unknown>,
): ["td" | "th", Record<string, unknown>, 0] {
  const colwidth: number[] | null = node.attrs.colwidth;
  const width =
    colwidth?.length && colwidth.every(Boolean)
      ? colwidth.reduce((sum, pixels) => sum + pixels, 0)
      : tablePixels(node.attrs.width, "column");
  return [
    tag,
    mergeAttributes(
      {
        ...(width ? { style: `width:${width}px` } : {}),
      },
      attributes,
    ),
    0,
  ];
}

export const MailTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  },
  renderHTML({ node, HTMLAttributes }) {
    return renderCell("th", node, HTMLAttributes);
  },
});

export const MailTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellAttributes() };
  },
  renderHTML({ node, HTMLAttributes }) {
    return renderCell("td", node, HTMLAttributes);
  },
});

function setRowHeight(tr: Transaction, pos: number, height: number | null) {
  const row = tr.doc.nodeAt(pos);
  if (!row || row.type.name !== "tableRow") return;
  tr.setNodeAttribute(pos, "height", height);
  row.forEach((cell, offset) => {
    if (cell.attrs.rowspan === 1)
      tr.setNodeAttribute(pos + 1 + offset, "height", height);
  });
}

export function currentTableDimensions(editor: Editor) {
  if (!editor.isActive("table")) return null;
  const { table, map, tableStart } = selectedRect(editor.state);
  const offset = selectionCell(editor.state).pos - tableStart;
  const { top } = map.findCell(offset);
  const cell = table.nodeAt(offset);
  return {
    width: tablePixels(table.attrs.width, "width"),
    column: tablePixels(cell?.attrs.colwidth?.[0], "column"),
    row: tablePixels(table.child(top).attrs.height, "row"),
  };
}

export function resizeTable(
  editor: Editor,
  sizes: { width?: number | null; column: number | null; row: number | null },
) {
  if (!editor.isEditable || !editor.isActive("table")) return false;
  const { table, map, tableStart } = selectedRect(editor.state);
  const { left, top } = map.findCell(
    selectionCell(editor.state).pos - tableStart,
  );
  const tr = editor.state.tr;
  if (sizes.width !== undefined)
    tr.setNodeAttribute(tableStart - 1, "width", sizes.width);
  const columnCells = new Set(
    Array.from(
      { length: map.height },
      (_, row) => map.map[row * map.width + left],
    ),
  );
  for (const offset of columnCells) {
    const cell = table.nodeAt(offset);
    if (!cell) continue;
    const widths: number[] =
      cell.attrs.colwidth?.slice() || Array(cell.attrs.colspan).fill(0);
    widths[left - map.colCount(offset)] = sizes.column ?? 0;
    tr.setNodeAttribute(
      tableStart + offset,
      "colwidth",
      widths.some(Boolean) ? widths : null,
    );
    tr.setNodeAttribute(tableStart + offset, "width", null);
  }
  let rowPos = tableStart;
  for (let row = 0; row < top; row++) rowPos += table.child(row).nodeSize;
  setRowHeight(tr, rowPos, sizes.row);
  editor.view.dispatch(tr);
  return true;
}

const handleRadius = 5;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

type ResizeHit = {
  pos: number;
  node: ProseMirrorNode;
  table: HTMLTableElement;
  edge: number;
} & (
  | { axis: "row"; element: HTMLTableRowElement }
  | { axis: "column"; index: number; outer: boolean }
);

function resizeHit(view: EditorView, event: PointerEvent): ResizeHit | null {
  if (!view.editable || event.pointerType !== "mouse") return null;
  if (!(event.target instanceof Element)) return null;
  const cell = event.target.closest("td,th");
  const table =
    cell?.closest("table") ??
    event.target.closest(".tableWrapper")?.querySelector(":scope > table");
  if (!table || !view.dom.contains(table)) return null;
  const bounds = table.getBoundingClientRect();

  if (
    Math.abs(event.clientX - bounds.right) <= handleRadius &&
    event.clientY >= bounds.top &&
    event.clientY <= bounds.bottom
  ) {
    const pos = view.posAtDOM(table.tBodies[0], 0) - 1;
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name === "table") {
      return {
        axis: "column",
        pos,
        node,
        table,
        index: TableMap.get(node).width - 1,
        outer: true,
        edge: bounds.right,
      };
    }
  }

  if (!cell || cell.closest("table") !== table) return null;
  const cellBounds = cell.getBoundingClientRect();
  const left = Math.abs(event.clientX - cellBounds.left);
  const right = Math.abs(event.clientX - cellBounds.right);
  if (Math.min(left, right) <= handleRadius) {
    const anchor = view.posAtDOM(cell, 0) - 1;
    const $cell = view.state.doc.resolve(anchor);
    const node = $cell.node(-1);
    if (node.type.name !== "table") return null;
    const start = $cell.start(-1);
    const map = TableMap.get(node);
    const columns = map.findCell(anchor - start);
    const index = (left < right ? columns.left : columns.right) - 1;
    if (index < 0 || index >= map.width - 1) return null;
    return {
      axis: "column",
      pos: start - 1,
      node,
      table,
      index,
      outer: false,
      edge: left < right ? cellBounds.left : cellBounds.right,
    };
  }

  const element = cell.closest("tr");
  if (!element) return null;
  const edge = element.getBoundingClientRect().bottom;
  if (Math.abs(event.clientY - edge) > 4) return null;
  const pos = view.posAtDOM(element, 0) - 1;
  const node = view.state.doc.nodeAt(pos);
  return node?.type.name === "tableRow"
    ? { axis: "row", pos, node, table, edge, element }
    : null;
}

function columnWidths(
  view: EditorView,
  hit: Extract<ResizeHit, { axis: "column" }>,
) {
  const map = TableMap.get(hit.node);
  const bounds = hit.table.getBoundingClientRect();
  if (!bounds.width) return null;
  // WebKit can report empty boxes for <col>. Resolve the actual rendered
  // edges through cells, including those covering multiple logical columns.
  const edges: (number | undefined)[] = Array(map.width + 1).fill(undefined);
  edges[0] = Math.round(bounds.left);
  edges[map.width] = Math.round(bounds.right);
  for (const offset of new Set(map.map)) {
    const cell = view.nodeDOM(hit.pos + 1 + offset);
    if (!(cell instanceof HTMLTableCellElement)) continue;
    const rect = cell.getBoundingClientRect();
    if (!rect.width) continue;
    const { left, right } = map.findCell(offset);
    edges[left] ??= Math.round(rect.left);
    edges[right] ??= Math.round(rect.right);
  }
  const saved = savedColumnWidths(hit.node);
  const weights = Array.from(
    { length: map.width },
    (_, index) => saved[index] || tableDimensions.column[0],
  );
  const widths: number[] = [];
  for (let left = 0; left < map.width;) {
    let right = left + 1;
    while (edges[right] === undefined) right++;
    const width = edges[right]! - edges[left]!;
    const segment = weights.slice(left, right);
    const weight = sumWidths(segment);
    let used = 0;
    let consumed = 0;
    for (const column of segment) {
      consumed += column;
      const end = Math.round((width * consumed) / weight);
      widths.push(end - used);
      used = end;
    }
    left = right;
  }
  return widths.every((width) => width > 0) ? widths : null;
}

function resizedColumns(
  widths: number[],
  index: number,
  outer: boolean,
  delta: number,
) {
  const [min, max] = tableDimensions.column;
  if (!outer) {
    const left = widths[index];
    const right = widths[index + 1];
    const movement = clamp(
      delta,
      Math.min(0, Math.max(min - left, right - max)),
      Math.max(0, Math.min(max - left, right - min)),
    );
    const next = widths.slice();
    next[index] += movement;
    next[index + 1] -= movement;
    return { widths: next, movement };
  }
  const total = sumWidths(widths);
  const minWidth = Math.max(tableDimensions.width[0], widths.length * min);
  const maxWidth = Math.min(tableDimensions.width[1], widths.length * max);
  if (minWidth > maxWidth) return { widths, movement: 0 };
  const width = clamp(total + delta, minWidth, maxWidth);
  let remaining = width;
  let weight = total;
  const next = widths.map((column, i) => {
    const rest = widths.length - i - 1;
    const pixels = clamp(
      Math.round((remaining * column) / weight),
      Math.max(min, remaining - rest * max),
      Math.min(max, remaining - rest * min),
    );
    remaining -= pixels;
    weight -= column;
    return pixels;
  });
  return { widths: next, width, movement: width - total };
}

function setColumnWidths(
  tr: Transaction,
  pos: number,
  table: ProseMirrorNode,
  widths: number[],
) {
  const map = TableMap.get(table);
  for (const offset of new Set(map.map)) {
    const cell = table.nodeAt(offset);
    if (!cell) continue;
    const { left, right } = map.findCell(offset);
    tr.setNodeAttribute(
      pos + 1 + offset,
      "colwidth",
      widths.slice(left, right),
    );
    if (cell.attrs.width) tr.setNodeAttribute(pos + 1 + offset, "width", null);
  }
}

export const MailTableResize = Extension.create({
  name: "mailTableResize",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(view) {
          const { dom } = view;
          const document = dom.ownerDocument;
          const line = document.createElement("div");
          line.setAttribute("aria-hidden", "true");
          let drag: {
            hit: ResizeHit;
            pointer: number;
            origin: number;
            widths: number[];
            height: number;
          } | null = null;

          function draw(hit: ResizeHit, edge = hit.edge) {
            const bounds = hit.table.getBoundingClientRect();
            const viewport = dom.getBoundingClientRect();
            const wrapper = hit.table.parentElement!.getBoundingClientRect();
            const left = Math.max(bounds.left, viewport.left, wrapper.left);
            const right = Math.min(bounds.right, viewport.right, wrapper.right);
            const top = Math.max(bounds.top, viewport.top);
            const bottom = Math.min(bounds.bottom, viewport.bottom);
            const row = hit.axis === "row";
            dom.classList.toggle("row-resize-cursor", row);
            dom.classList.toggle("column-resize-cursor", !row);
            if (
              left >= right ||
              top >= bottom ||
              (row
                ? edge < viewport.top || edge > viewport.bottom
                : edge < left || edge > Math.min(viewport.right, wrapper.right))
            ) {
              line.remove();
              return;
            }
            line.className = row ? "row-resize-handle" : "column-resize-handle";
            line.style.cssText = row
              ? `top:${edge}px;left:${left}px;width:${right - left}px`
              : `top:${top}px;left:${edge}px;height:${bottom - top}px`;
            if (!line.isConnected) document.body.append(line);
          }

          function leave() {
            if (drag) return;
            dom.classList.remove("row-resize-cursor", "column-resize-cursor");
            line.remove();
          }

          const rowHeight = (height: number, delta: number) =>
            clamp(height + delta, ...tableDimensions.row);

          function move(event: PointerEvent) {
            if (drag?.pointer === event.pointerId) {
              const { hit, origin, widths, height } = drag;
              if (hit.axis === "row") {
                const edge = hit.element.getBoundingClientRect().top;
                draw(
                  hit,
                  edge + rowHeight(height, Math.round(event.clientY - origin)),
                );
              } else {
                const { movement } = resizedColumns(
                  widths,
                  hit.index,
                  hit.outer,
                  Math.round(event.clientX - origin),
                );
                draw(hit, hit.edge + movement);
              }
              return;
            }
            const hit = resizeHit(view, event);
            if (hit) draw(hit);
            else leave();
          }

          function down(event: PointerEvent) {
            if (event.button !== 0 || drag) return;
            const hit = resizeHit(view, event);
            if (!hit) return;
            const widths = hit.axis === "column" ? columnWidths(view, hit) : [];
            if (!widths) return;
            event.preventDefault();
            dom.setPointerCapture(event.pointerId);
            drag = {
              hit,
              pointer: event.pointerId,
              origin: hit.axis === "row" ? event.clientY : event.clientX,
              widths,
              height:
                hit.axis === "row"
                  ? Math.round(hit.element.getBoundingClientRect().height)
                  : 0,
            };
            draw(hit);
          }

          function finish(event: PointerEvent) {
            if (!drag || event.pointerId !== drag.pointer) return;
            const { hit, origin, widths, height } = drag;
            drag = null;
            leave();
            if (
              event.type !== "pointerup" ||
              !view.editable ||
              !dom.contains(hit.table) ||
              view.state.doc.nodeAt(hit.pos) !== hit.node
            )
              return;
            const delta = Math.round(
              (hit.axis === "row" ? event.clientY : event.clientX) - origin,
            );
            if (!delta) return;
            const tr = closeHistory(view.state.tr);
            if (hit.axis === "row") {
              setRowHeight(tr, hit.pos, rowHeight(height, delta));
            } else {
              const next = resizedColumns(widths, hit.index, hit.outer, delta);
              if (!next.movement) return;
              setColumnWidths(tr, hit.pos, hit.node, next.widths);
              if (next.width !== undefined)
                tr.setNodeAttribute(hit.pos, "width", next.width);
            }
            view.dispatch(tr);
          }

          dom.addEventListener("pointerdown", down, true);
          dom.addEventListener("pointermove", move);
          dom.addEventListener("pointerleave", leave);
          dom.addEventListener("pointerup", finish);
          dom.addEventListener("pointercancel", finish);
          dom.addEventListener("lostpointercapture", finish);
          dom.addEventListener("scroll", leave, true);
          return {
            destroy() {
              dom.removeEventListener("pointerdown", down, true);
              dom.removeEventListener("pointermove", move);
              dom.removeEventListener("pointerleave", leave);
              dom.removeEventListener("pointerup", finish);
              dom.removeEventListener("pointercancel", finish);
              dom.removeEventListener("lostpointercapture", finish);
              dom.removeEventListener("scroll", leave, true);
              drag = null;
              leave();
            },
          };
        },
      }),
    ];
  },
});
