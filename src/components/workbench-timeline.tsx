import { addDays, startOfWeek } from "date-fns";
import { Plus } from "lucide-react";
import { dateLocale, t } from "@/lib/i18n";
import { isWorkItemOnDate, workDate, type WorkItem } from "@/lib/workbench";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

const hours = Array.from(
  { length: 24 },
  (_, hour) => `${String(hour).padStart(2, "0")}:00`,
);

export function WorkbenchTimeline({
  mode,
  selected,
  items,
  disabled,
  onSelect,
  onAdd,
  onOpen,
}: {
  mode: "week" | "day";
  selected: Date;
  items: WorkItem[];
  disabled: boolean;
  onSelect: (date: Date) => void;
  onAdd: (date: string, time: string) => void;
  onOpen: (item: WorkItem) => void;
}) {
  const days = (
    mode === "day"
      ? [selected]
      : Array.from({ length: 7 }, (_, i) =>
          addDays(startOfWeek(selected, { weekStartsOn: 1 }), i),
        )
  ).map((day) => {
    const date = workDate(day);
    const entries = items
      .filter((item) => isWorkItemOnDate(item, date))
      .sort((a, b) => a.time.localeCompare(b.time));
    const timed = new Map<string, WorkItem[]>();
    const allDay: WorkItem[] = [];
    for (const item of entries) {
      // A multi-day entry has one start time. Its continuation occupies the all-day row.
      if (!item.time || item.date !== date) allDay.push(item);
      else {
        const hour = item.time.slice(0, 2) + ":00";
        const group = timed.get(hour) ?? [];
        group.push(item);
        timed.set(hour, group);
      }
    }
    return { day, date, timed, allDay };
  });
  const slot = (date: string, time: string, entries: WorkItem[]) => (
    <TableCell key={date} className="workbench-time-slot align-top">
      {entries.length > 0 && (
        <div className="flex min-w-0 flex-col gap-0.5">
          {entries.map((item) => (
            <Button
              key={item.id}
              type="button"
              variant="secondary"
              size="sm"
              data-work-status={item.status}
              className="h-auto min-h-7 min-w-0 justify-start gap-2 whitespace-normal py-1 text-left"
              onClick={() => onOpen(item)}
            >
              {time && (
                <span className="shrink-0 tabular-nums">{item.time}</span>
              )}
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {item.title}
              </span>
            </Button>
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="workbench-time-add"
        disabled={disabled}
        aria-label={t("Add work item on {value0} at {value1}", {
          value0: date,
          value1: time || t("All day"),
        })}
        onClick={() => onAdd(date, time)}
      >
        <Plus />
      </Button>
    </TableCell>
  );
  return (
    <div className="workbench-timeline" data-mode={mode}>
      <Table aria-label={mode === "week" ? t("Week view") : t("Day view")}>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t("Time")}</TableHead>
            {days.map(({ day, date }) => (
              <TableHead key={date} scope="col">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={date === workDate(selected)}
                  onClick={() => onSelect(day)}
                >
                  {day.toLocaleDateString(dateLocale(), {
                    weekday: "short",
                    month: "numeric",
                    day: "numeric",
                  })}
                </Button>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <th scope="row" className="px-2 text-left font-medium">
              {t("All day")}
            </th>
            {days.map(({ date, allDay }) => slot(date, "", allDay))}
          </TableRow>
          {hours.map((hour) => (
            <TableRow key={hour}>
              <th
                scope="row"
                className="px-2 text-left font-normal tabular-nums text-muted-foreground"
              >
                {hour}
              </th>
              {days.map(({ date, timed }) =>
                slot(date, hour, timed.get(hour) ?? []),
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
