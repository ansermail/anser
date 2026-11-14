import { format } from "date-fns";
import { t } from "./i18n";

export const workStatuses = ["todo", "doing", "waiting", "done"] as const;
export const workPriorities = ["low", "normal", "high"] as const;
export type WorkStatus = (typeof workStatuses)[number];
export type WorkPriority = (typeof workPriorities)[number];
export type WorkItem = {
  id: string;
  revision: number;
  title: string;
  status: WorkStatus;
  priority: WorkPriority;
  project: string;
  date: string;
  time: string;
  endDate?: string;
  important?: boolean;
  urgent?: boolean;
  estimatedMinutes: number;
  actualMinutes: number;
  checklist: { text: string; done: boolean }[];
  mailId: string;
  notes: string;
};

export function workStatus(status: WorkStatus) {
  return {
    todo: t("To do"),
    doing: t("In progress"),
    waiting: t("Waiting for reply"),
    done: t("Completed"),
  }[status];
}

export function workPriority(priority: WorkPriority) {
  return {
    low: t("Low priority"),
    normal: t("Normal priority"),
    high: t("High priority"),
  }[priority];
}

export function workDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function newWorkItem(date: string): WorkItem {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    title: "",
    status: "todo",
    priority: "normal",
    project: "",
    date,
    time: "",
    endDate: "",
    important: false,
    urgent: false,
    estimatedMinutes: 0,
    actualMinutes: 0,
    checklist: [],
    mailId: "",
    notes: "",
  };
}

export function totals(items: WorkItem[]) {
  return items.reduce(
    (sum, item) => ({
      done: sum.done + Number(item.status === "done"),
      estimated: sum.estimated + item.estimatedMinutes,
      actual: sum.actual + item.actualMinutes,
      checklist: sum.checklist + item.checklist.length,
      checked:
        sum.checked + item.checklist.filter((check) => check.done).length,
    }),
    { done: 0, estimated: 0, actual: 0, checklist: 0, checked: 0 },
  );
}

export const workQuadrants = [
  { important: true, urgent: true, label: () => t("Important and urgent") },
  { important: true, urgent: false, label: () => t("Important, not urgent") },
  { important: false, urgent: true, label: () => t("Urgent, not important") },
  {
    important: false,
    urgent: false,
    label: () => t("Neither important nor urgent"),
  },
];

export function isWorkItemOnDate(item: WorkItem, date: string) {
  return item.date <= date && date <= (item.endDate || item.date);
}
