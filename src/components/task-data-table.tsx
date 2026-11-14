import { useEffect, useState, type ReactNode } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { t } from "@/lib/i18n";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const headers = {
  task: () => t("Subject"),
  recipient: () => t("Recipient"),
  rule: () => t("Rule name"),
  account: () => t("Email address"),
  folder: () => t("Folder name"),
  target: () => t("Destination folder"),
  operation: () => t("Task operation"),
  step: () => t("Current step"),
  status: () => t("Task status"),
  progress: () => t("Task progress"),
  matched: () => t("Matched count"),
  added: () => t("Imported count"),
  upgraded: () => t("Completed originals count"),
  duplicate: () => t("Duplicate count"),
  failed: () => t("Failed count"),
  warnings: () => t("Warning count"),
  reason: () => t("Details"),
  checked: () => t("Review time"),
  scheduled: () => t("Scheduled time"),
  time: () => t("Time"),
  copy: () => t("Server copy"),
  activity: () => t("Activity record"),
  actions: () => t("Task actions"),
};

type TaskColumn = keyof typeof headers;
type TaskTableRow = { id: string } & Partial<Record<TaskColumn, ReactNode>>;

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
const column = createColumnHelper<typeof features, TaskTableRow>();
const columnIds = Object.keys(headers) as TaskColumn[];
const columnsById = Object.fromEntries(
  columnIds.map((id) => [
    id,
    column.display({
      id,
      header: headers[id],
      cell: ({ row }) =>
        row.original[id] === "" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          (row.original[id] ?? <span className="text-muted-foreground">—</span>)
        ),
    }),
  ]),
);

// Keep cell text on one line. The hover text retains the full value, including
// related diagnostics that would otherwise turn the cell into a paragraph.
export function TaskCellText({
  text,
  detail,
  status,
}: {
  text: string;
  detail?: string;
  status?: boolean;
}) {
  if (!text) return null;
  return (
    <span
      className="block truncate"
      role={status ? "status" : undefined}
      title={detail || text}
    >
      {text}
    </span>
  );
}

const widths: Partial<Record<TaskColumn, number>> = {
  task: 13,
  recipient: 13,
  rule: 10,
  account: 11,
  scheduled: 10,
  time: 6,
  copy: 10,
  operation: 6,
  step: 9,
  status: 8,
  progress: 6,
  matched: 4.5,
  folder: 10,
  target: 10,
  reason: 11,
  checked: 9.5,
  added: 4,
  upgraded: 4,
  duplicate: 5,
  failed: 4,
  warnings: 4.5,
};
export function TaskDataTable({
  label,
  rows,
  empty,
  fields,
  actionsWidth = 9,
  pageSize = 10,
}: {
  label: string;
  rows: TaskTableRow[];
  empty: string;
  fields: readonly TaskColumn[];
  actionsWidth?: number;
  pageSize?: number;
}) {
  const visibleFields = rows.length
    ? fields.filter((field) =>
        rows.some((row) => row[field] != null && row[field] !== ""),
      )
    : fields.slice(0, 1);
  const columns = visibleFields.map((field) => columnsById[field]);
  const widthFor = (field: TaskColumn) =>
    field === "actions" ? actionsWidth : widths[field];
  const minWidth = visibleFields.reduce(
    (sum, field) => sum + (widthFor(field) ?? 8),
    0,
  );
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageIndex = Math.min(page, pageCount - 1);
  useEffect(() => {
    if (page !== pageIndex) setPage(pageIndex);
  }, [page, pageIndex]);
  const table = useTable({
    features,
    data: rows,
    columns,
    getRowId: (row) => row.id,
    autoResetPageIndex: false,
    state: { pagination: { pageIndex, pageSize } },
  });

  return (
    <div className="task-data-table flex min-w-0 flex-col gap-2">
      <div className="overflow-hidden rounded-md border">
        <Table aria-label={label} style={{ minWidth: `${minWidth}rem` }}>
          <TableHeader className="bg-secondary/60">
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    scope="col"
                    data-column={header.column.id}
                    className="h-8 px-2.5"
                    title={headers[header.column.id as TaskColumn]()}
                    style={{
                      width:
                        widthFor(header.column.id as TaskColumn) &&
                        `${widthFor(header.column.id as TaskColumn)}rem`,
                    }}
                  >
                    <table.FlexRender header={header} />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-row-id={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      data-column={cell.column.id}
                      className="h-9 px-2.5 py-1.5 align-middle"
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="px-2.5 py-2 whitespace-normal text-muted-foreground"
                >
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("Page {page} of {total}", {
              page: pageIndex + 1,
              total: pageCount,
            })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Previous page")}
            disabled={!table.getCanPreviousPage()}
            onClick={() => setPage(pageIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("Next page")}
            disabled={!table.getCanNextPage()}
            onClick={() => setPage(pageIndex + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}
