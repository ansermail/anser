import { addDays, startOfWeek } from "date-fns";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Flag, Plus } from "lucide-react";
import { dateLocale, t } from "@/lib/i18n";
import {
  isWorkItemOnDate,
  workDate,
  workStatus,
  type WorkItem,
} from "@/lib/workbench";
import { Button } from "./ui/button";
import { WorkItemContextMenu } from "./work-item-context-menu";
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
  onDelete,
  projectTone,
}: {
  mode: "week" | "day";
  selected: Date;
  items: WorkItem[];
  disabled: boolean;
  onSelect: (date: Date) => void;
  onAdd: (date: string, time: string) => void;
  onOpen: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  projectTone: (name: string) => string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const today = workDate(now);
  const nowHour = hours[now.getHours()];
  const firstDate = workDate(
    mode === "day" ? selected : startOfWeek(selected, { weekStartsOn: 1 }),
  );
  useLayoutEffect(() => {
    const area = viewport.current;
    const start = area?.querySelector('[data-hour-label="08:00"]');
    if (area && start)
      area.scrollTop =
        start.getBoundingClientRect().top -
        area.getBoundingClientRect().top +
        area.scrollTop;
  }, [mode, firstDate]);

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
          <WorkItemContextMenu
            key={item.id}
            item={item}
            disabled={disabled}
            onOpen={onOpen}
            onDelete={onDelete}
          >
            <Button
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
          </WorkItemContextMenu>
        ))}
      </div>
      {date === today && time === nowHour && (
        <span
          className="wb-now-indicator"
          style={{ top: `${(now.getMinutes() / 60) * 100}%` }}
          aria-hidden="true"
        />
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
                aria-current={date === today ? "date" : undefined}
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
        <ScrollArea className="wb-hours" type="always" viewportRef={viewport}>
          <div className="wb-timeline-hours" style={grid}>
            {hours.map((hour) => (
              <div className="wb-hour-row" key={hour}>
                <div className="wb-time-label" data-hour-label={hour}>
                  {hour}
                </div>
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
