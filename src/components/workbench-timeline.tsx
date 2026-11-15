import { addDays, startOfWeek } from "date-fns";
import { Flag, Plus } from "lucide-react";
import { dateLocale, t } from "@/lib/i18n";
import {
  isWorkItemOnDate,
  workDate,
  workStatus,
  type WorkItem,
} from "@/lib/workbench";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

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
  projectTone,
}: {
  mode: "week" | "day";
  selected: Date;
  items: WorkItem[];
  disabled: boolean;
  onSelect: (date: Date) => void;
  onAdd: (date: string, time: string) => void;
  onOpen: (item: WorkItem) => void;
  projectTone: (name: string) => string;
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
  const grid = {
    gridTemplateColumns: `50px repeat(${days.length}, minmax(0, 1fr))`,
  };
  const slot = (date: string, time: string, entries: WorkItem[]) => (
    <div
      key={date}
      className="workbench-time-slot"
      data-date={date}
      data-time={time}
    >
      <div className="wb-slot-entries">
        {entries.map((item) => (
          <Button
            key={item.id}
            type="button"
            variant="ghost"
            className={time ? "wb-timed-event" : "wb-all-day-event"}
            title={`${item.title} · ${workStatus(item.status)}`}
            aria-label={`${item.title}. ${workStatus(item.status)}. ${
              time || t("All day")
            }`}
            data-work-status={item.status}
            data-project-tone={projectTone(item.project)}
            onClick={() => onOpen(item)}
          >
            <span className="wb-event-meta">
              <span className="wb-event-status-dot" />
              <span className="wb-event-time">
                {time ? item.time : t("All day")}
              </span>
              <span className="wb-event-status-label">
                {workStatus(item.status)}
              </span>
              {item.date !== date && (
                <span className="wb-event-continued">{t("Continued")}</span>
              )}
              {item.priority === "high" && (
                <Flag className="wb-event-priority" />
              )}
            </span>
            <span className="wb-event-title">
              <span className="workbench-project-dot" />
              <span className="wb-event-title-text">{item.title}</span>
            </span>
          </Button>
        ))}
      </div>
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
    </div>
  );
  return (
    <ScrollArea
      orientation="horizontal"
      type="always"
      className="wb-timeline-horizontal"
      data-mode={mode}
    >
      <div
        className="workbench-timeline"
        data-mode={mode}
        aria-label={mode === "week" ? t("Week view") : t("Day view")}
      >
        <div className="wb-timeline-heading" style={grid}>
          <div className="wb-time-zone">
            {
              Intl.DateTimeFormat(dateLocale(), { timeZoneName: "shortOffset" })
                .formatToParts(selected)
                .find((part) => part.type === "timeZoneName")?.value
            }
          </div>
          {days.map(({ day, date }) => (
            <div className="wb-week-day" key={date}>
              <span>
                {day.toLocaleDateString(dateLocale(), { weekday: "short" })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={date}
                aria-pressed={date === workDate(selected)}
                onClick={() => onSelect(day)}
              >
                {day.getDate()}
              </Button>
            </div>
          ))}
          <div className="wb-all-day-label">{t("All day")}</div>
          {days.map(({ date, allDay }) => slot(date, "", allDay))}
        </div>
        <ScrollArea className="wb-hours" type="always">
          <div className="wb-timeline-hours" style={grid}>
            {hours.map((hour) => (
              <div className="wb-hour-row" key={hour}>
                <div className="wb-time-label">{hour}</div>
                {days.map(({ date, timed }) =>
                  slot(date, hour, timed.get(hour) ?? []),
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </ScrollArea>
  );
}
