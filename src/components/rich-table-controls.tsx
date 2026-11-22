import { useState, type RefObject } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Table2 } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  currentTableDimensions,
  resizeTable,
  tableDimensions,
  tablePixels,
} from "@/lib/rich-table";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { ContextMenuItem, ContextMenuSeparator } from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export type TableDialogKind = "insert" | "resize";
export type TableDialogTarget = {
  kind: TableDialogKind;
  doc: Editor["state"]["doc"];
  selection: Editor["state"]["selection"];
};

export function TableOperations({
  editor,
  context = false,
  onResize,
}: {
  editor: Editor;
  context?: boolean;
  onResize: () => void;
}) {
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  const operations = [
    [
      ["Insert row above", "addRowBefore"],
      ["Insert row below", "addRowAfter"],
      ["Delete row", "deleteRow"],
    ],
    [
      ["Insert column left", "addColumnBefore"],
      ["Insert column right", "addColumnAfter"],
      ["Delete column", "deleteColumn"],
    ],
    [
      ["Merge cells", "mergeCells"],
      ["Split cell", "splitCell"],
      ["Toggle header row", "toggleHeaderRow"],
      ["Toggle header column", "toggleHeaderColumn"],
    ],
  ] as const;
  const dimensions = currentTableDimensions(editor);
  const operationGroups = (
    <>
      {operations.map((group) => (
        <div key={group[0][0]} role="group">
          <Separator />
          {group.map(([label, command]) => (
            <Item
              key={command}
              disabled={!editor.can()[command]()}
              onSelect={() => editor.chain().focus()[command]().run()}
            >
              {t(label)}
            </Item>
          ))}
        </div>
      ))}
    </>
  );
  const footerActions = (
    <>
      <Separator />
      <Item disabled={!dimensions} onSelect={onResize}>
        {t("Table dimensions…")}
      </Item>
      <Item
        disabled={!dimensions || (!dimensions.column && !dimensions.row)}
        onSelect={() => resizeTable(editor, { column: null, row: null })}
      >
        {t("Reset column width and row height")}
      </Item>
      <Item
        variant="destructive"
        disabled={!editor.can().deleteTable()}
        onSelect={() => editor.chain().focus().deleteTable().run()}
      >
        {t("Delete table")}
      </Item>
    </>
  );
  return context ? (
    <>
      {operationGroups}
      {footerActions}
    </>
  ) : (
    <>
      <div className="rich-table-menu-groups">{operationGroups}</div>
      <div className="rich-table-menu-footer">{footerActions}</div>
    </>
  );
}

export function RichTableMenu({
  editor,
  disabled,
  dialog,
  onDialog,
}: {
  editor: Editor;
  disabled: boolean;
  dialog: RefObject<TableDialogTarget | null>;
  onDialog: (kind: TableDialogKind) => void;
}) {
  const { inside } = useEditorState({
    editor,
    selector: ({ editor }) => ({ inside: editor.isActive("table") }),
  });
  const [grid, setGrid] = useState({ rows: 0, cols: 0 });
  const setSize = (rows: number, cols: number) => setGrid({ rows, cols });
  const gridLabel = (rows: number, cols: number) =>
    t("Insert {rows} rows × {columns} columns", { rows, columns: cols });
  return (
    <DropdownMenu modal={false} onOpenChange={() => setSize(0, 0)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Table")}
              disabled={disabled}
            >
              <Table2 />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("Table")}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="rich-format-menu rich-table-menu"
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (
            !dialog.current &&
            !editor.isDestroyed &&
            !document.querySelector(
              '[data-slot="dropdown-menu-content"][data-state="open"]',
            )
          )
            editor.commands.focus();
        }}
      >
        {!inside && (
          <div
            className="px-2 py-1.5"
            role="group"
            aria-label={t("Insert table")}
          >
            <div className="mb-1.5 text-xs text-muted-foreground">
              {grid.rows ? gridLabel(grid.rows, grid.cols) : t("Insert table")}
            </div>
            <div className="rich-table-grid grid grid-cols-8 gap-1">
              {Array.from({ length: 48 }, (_, index) => {
                const rows = Math.floor(index / 8) + 1;
                const cols = (index % 8) + 1;
                const active = rows <= grid.rows && cols <= grid.cols;
                return (
                  <DropdownMenuItem
                    key={index}
                    asChild
                    onFocus={() => setSize(rows, cols)}
                    onPointerMove={() => setSize(rows, cols)}
                    onSelect={() =>
                      editor
                        .chain()
                        .focus()
                        .insertTable({ rows, cols, withHeaderRow: true })
                        .run()
                    }
                  >
                    <Button
                      type="button"
                      aria-label={gridLabel(rows, cols)}
                      variant="outline"
                      size="icon-sm"
                      className={`size-5 rounded-sm p-0 shadow-none ${active ? "border-ring bg-accent" : ""}`}
                    />
                  </DropdownMenuItem>
                );
              })}
            </div>
          </div>
        )}
        <DropdownMenuItem disabled={inside} onSelect={() => onDialog("insert")}>
          {t("Custom table…")}
        </DropdownMenuItem>
        <TableOperations editor={editor} onResize={() => onDialog("resize")} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RichTableDialog({
  editor,
  target,
  disabled,
  onClose,
}: {
  editor: Editor;
  target: TableDialogTarget;
  disabled: boolean;
  onClose: () => void;
}) {
  const inserting = target.kind === "insert";
  const dimensions = inserting ? null : currentTableDimensions(editor);
  const [width, setWidth] = useState(String(dimensions?.width ?? ""));
  const [column, setColumn] = useState(String(dimensions?.column ?? ""));
  const [row, setRow] = useState(String(dimensions?.row ?? ""));
  const [rows, setRows] = useState("3");
  const [cols, setCols] = useState("3");
  const [header, setHeader] = useState(true);
  const [error, setError] = useState("");
  const title = inserting ? t("Custom table") : t("Table dimensions");
  function apply(reset = false) {
    if (
      disabled ||
      !editor.isEditable ||
      editor.state.doc !== target.doc ||
      !editor.state.selection.eq(target.selection)
    ) {
      setError(
        t(
          "The selection changed. Close this dialog and select the table again.",
        ),
      );
      return;
    }
    if (inserting) {
      const rowCount = Number(rows);
      const colCount = Number(cols);
      if (
        !Number.isInteger(rowCount) ||
        rowCount < 1 ||
        rowCount > 20 ||
        !Number.isInteger(colCount) ||
        colCount < 1 ||
        colCount > 12
      )
        return;
      if (
        !editor.commands.insertTable({
          rows: rowCount,
          cols: colCount,
          withHeaderRow: header,
        })
      )
        return;
    } else {
      const sizes = reset
        ? { width: null, column: null, row: null }
        : {
            width: tablePixels(width, "width"),
            column: tablePixels(column, "column"),
            row: tablePixels(row, "row"),
          };
      if (
        !reset &&
        ((width && !sizes.width) ||
          (column && !sizes.column) ||
          (row && !sizes.row))
      )
        return;
      if (!resizeTable(editor, sizes)) return;
    }
    onClose();
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-sm"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!editor.isDestroyed) editor.commands.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {inserting
              ? t("Choose up to 20 rows and 12 columns.")
              : t(
                  "Leave a dimension blank to let it size automatically. Content can make rows taller.",
                )}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <FieldGroup className="gap-3">
            {(inserting
              ? [
                  {
                    id: "rows",
                    label: t("Rows"),
                    bounds: [1, 20],
                    value: rows,
                    change: setRows,
                  },
                  {
                    id: "cols",
                    label: t("Columns"),
                    bounds: [1, 12],
                    value: cols,
                    change: setCols,
                  },
                ]
              : [
                  {
                    id: "width",
                    label: t("Table width (px)"),
                    bounds: tableDimensions.width,
                    value: width,
                    change: setWidth,
                  },
                  {
                    id: "column",
                    label: t("Column width (px)"),
                    bounds: tableDimensions.column,
                    value: column,
                    change: setColumn,
                  },
                  {
                    id: "row",
                    label: t("Row height (px)"),
                    bounds: tableDimensions.row,
                    value: row,
                    change: setRow,
                  },
                ]
            ).map(({ id, label, bounds: [min, max], value, change }) => (
              <Field key={id}>
                <FieldLabel htmlFor={`rich-table-${id}`}>{label}</FieldLabel>
                <Input
                  id={`rich-table-${id}`}
                  type="number"
                  min={min}
                  max={max}
                  step={1}
                  required={inserting}
                  disabled={disabled}
                  placeholder={
                    inserting
                      ? undefined
                      : id === "width"
                        ? t("Automatic (100%)")
                        : t("Automatic")
                  }
                  value={value}
                  onChange={(event) => change(event.target.value)}
                />
              </Field>
            ))}
            {inserting && (
              <Field orientation="horizontal">
                <Checkbox
                  id="rich-table-header"
                  checked={header}
                  onCheckedChange={(checked) => setHeader(checked === true)}
                  disabled={disabled}
                />
                <FieldLabel htmlFor="rich-table-header">
                  {t("Include header row")}
                </FieldLabel>
              </Field>
            )}
            {error && <FieldError>{error}</FieldError>}
            <DialogFooter>
              {!inserting && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => apply(true)}
                >
                  {t("Restore default dimensions")}
                </Button>
              )}
              <Button type="submit" disabled={disabled}>
                {inserting ? t("Insert table") : t("Apply")}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
