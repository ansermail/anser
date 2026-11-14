import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { printWorkReport } from "@/lib/mail-print";
import { calendarLocale, dateLocale, interfaceLanguage, t } from "@/lib/i18n";
import { cancelMailAi, mailAiConfig, mailAiError } from "@/lib/mail-ai";
import {
  isWorkItemOnDate,
  newWorkItem,
  totals,
  workDate,
  workPriorities,
  workQuadrants,
  workPriority,
  workStatus,
  workStatuses,
  type WorkItem,
  type WorkPriority,
  type WorkStatus,
} from "@/lib/workbench";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Calendar, CalendarDayButton } from "./ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { WorkbenchTimeline } from "./workbench-timeline";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { SelectField, SelectOption } from "./ui/select-field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Textarea } from "./ui/textarea";
import { useConfirmation } from "@/hooks/use-confirmation";

type CalendarMode = "month" | "week" | "day";

function WorkbenchMonthNavigation({
  month,
  mode,
  onMonthChange,
  onToday,
}: {
  month: Date;
  mode: CalendarMode;
  onMonthChange: (month: Date) => void;
  onToday: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(String(month.getFullYear()));
  const [customYear, setCustomYear] = useState(false);
  const [monthIndex, setMonthIndex] = useState(month.getMonth());
  const changeOpen = (next: boolean) => {
    if (next) {
      setYear(String(month.getFullYear()));
      setCustomYear(false);
      setMonthIndex(month.getMonth());
    }
    setOpen(next);
  };
  const validYear = /^\d{1,4}$/.test(year) && Number(year) >= 1;
  const firstYear = Math.max(1, month.getFullYear() - 3);
  const lastYear = Math.min(9999, month.getFullYear() + 3);
  const step = (direction: number) =>
    mode === "month"
      ? addMonths(month, direction)
      : addDays(month, direction * (mode === "week" ? 7 : 1));
  const dayLabel = (day: Date) =>
    day.toLocaleDateString(dateLocale(), { dateStyle: "medium" });
  const weekStart = startOfWeek(month, { weekStartsOn: 1 });
  const caption =
    mode === "month"
      ? month.toLocaleDateString(dateLocale(), {
          year: "numeric",
          month: "long",
        })
      : mode === "day"
        ? dayLabel(month)
        : `${dayLabel(weekStart)} – ${dayLabel(addDays(weekStart, 6))}`;

  return (
    <div className="workbench-month-navigation">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={
          mode === "month"
            ? t("Previous month")
            : mode === "week"
              ? t("Previous week")
              : t("Previous day")
        }
        disabled={step(-1).getFullYear() < 1}
        onClick={() => onMonthChange(step(-1))}
      >
        <ChevronLeft />
      </Button>
      <Popover open={open} onOpenChange={changeOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`${t("Choose month and year")} · ${caption}`}
          >
            {caption}
            <ChevronDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!validYear) return;
              const next = startOfMonth(month);
              next.setFullYear(Number(year), monthIndex, 1);
              onMonthChange(next);
              setOpen(false);
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <Field>
                <FieldLabel htmlFor="workbench-year">{t("Year")}</FieldLabel>
                <SelectField
                  id="workbench-year"
                  value={customYear ? "custom" : year}
                  onValueChange={(value) => {
                    setCustomYear(value === "custom");
                    if (value !== "custom") setYear(value);
                  }}
                >
                  {Array.from(
                    { length: lastYear - firstYear + 1 },
                    (_, index) => {
                      const option = firstYear + index;
                      return (
                        <SelectOption key={option} value={option}>
                          {option}
                        </SelectOption>
                      );
                    },
                  )}
                  <SelectOption value="custom">{t("Enter year")}</SelectOption>
                </SelectField>
              </Field>
              <Field>
                <FieldLabel htmlFor="workbench-month">{t("Month")}</FieldLabel>
                <SelectField
                  id="workbench-month"
                  value={monthIndex}
                  onValueChange={(value) => setMonthIndex(Number(value))}
                >
                  {Array.from({ length: 12 }, (_, index) => (
                    <SelectOption key={index} value={index}>
                      {new Date(2000, index, 1).toLocaleDateString(
                        dateLocale(),
                        { month: "long" },
                      )}
                    </SelectOption>
                  ))}
                </SelectField>
              </Field>
            </div>
            {customYear && (
              <Field>
                <FieldLabel htmlFor="workbench-custom-year">
                  {t("Enter year")}
                </FieldLabel>
                <Input
                  id="workbench-custom-year"
                  inputMode="numeric"
                  maxLength={4}
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                />
              </Field>
            )}
            <Button type="submit" size="sm" disabled={!validYear}>
              {t("Go to month")}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
      <div className="flex items-center gap-1 justify-self-end">
        <Button type="button" size="sm" variant="outline" onClick={onToday}>
          {t("Today")}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={
            mode === "month"
              ? t("Next month")
              : mode === "week"
                ? t("Next week")
                : t("Next day")
          }
          disabled={step(1).getFullYear() > 9999}
          onClick={() => onMonthChange(step(1))}
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function DatePicker({
  date,
  onChange,
  label,
  fallback,
}: {
  fallback?: string;
  date: string;
  onChange: (date: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = date ? parseISO(date) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" aria-label={label}>
          <CalendarDays />
          {date || t("No end date")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          locale={calendarLocale()}
          mode="single"
          selected={selected}
          defaultMonth={selected ?? (fallback ? parseISO(fallback) : undefined)}
          onSelect={(day) => {
            if (day) {
              onChange(workDate(day));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function StatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: WorkStatus;
  onChange: (value: WorkStatus) => void;
  disabled?: boolean;
}) {
  return (
    <SelectField
      aria-label={t("Work status")}
      value={value}
      onValueChange={(value) => onChange(value as WorkStatus)}
      disabled={disabled}
    >
      {workStatuses.map((status) => (
        <SelectOption key={status} value={status}>
          {workStatus(status)}
        </SelectOption>
      ))}
    </SelectField>
  );
}

function WorkEditor({
  item,
  setItem,
  busy,
  close,
  save,
  remove,
  openMail,
  error,
}: {
  error: string;
  item: WorkItem;
  setItem: (item: WorkItem) => void;
  busy: boolean;
  close: () => void;
  save: () => void;
  remove: () => void;
  openMail: (id: string) => void;
}) {
  const [check, setCheck] = useState("");
  const update = (fields: Partial<WorkItem>) => setItem({ ...item, ...fields });
  const [hour = "", minute = "00"] = item.time ? item.time.split(":") : [];
  const editing = item.revision > 0;
  const Root = editing ? Sheet : Dialog;
  const Content = editing ? SheetContent : DialogContent;
  const Header = editing ? SheetHeader : DialogHeader;
  const Title = editing ? SheetTitle : DialogTitle;
  const Description = editing ? SheetDescription : DialogDescription;
  return (
    <Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <Content
        className={
          editing
            ? "flex w-full flex-col sm:max-w-lg"
            : "flex max-h-[min(48rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        }
      >
        <Header className="px-4 py-3 text-start">
          <Title>
            {item.revision ? t("Edit work item") : t("Add work record")}
          </Title>
          <Description>
            {t("Work items are shared across the workbench views.")}
          </Description>
        </Header>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="grid flex-1 gap-4 overflow-y-auto px-4 pb-4">
            <Field>
              <FieldLabel htmlFor="work-title">{t("Work item")}</FieldLabel>
              <Input
                id="work-title"
                required
                maxLength={200}
                value={item.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel>{t("Work status")}</FieldLabel>
                <StatusSelect
                  value={item.status}
                  onChange={(status) => update({ status })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="work-priority">
                  {t("Work priority")}
                </FieldLabel>
                <SelectField
                  id="work-priority"
                  value={item.priority}
                  onValueChange={(v) => update({ priority: v as WorkPriority })}
                >
                  {workPriorities.map((priority) => (
                    <SelectOption key={priority} value={priority}>
                      {workPriority(priority)}
                    </SelectOption>
                  ))}
                </SelectField>
              </Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <FieldLabel>
                <Checkbox
                  checked={!!item.important}
                  onCheckedChange={(value) =>
                    update({ important: value === true })
                  }
                />
                {t("Important work item")}
              </FieldLabel>
              <FieldLabel>
                <Checkbox
                  checked={!!item.urgent}
                  onCheckedChange={(value) =>
                    update({ urgent: value === true })
                  }
                />
                {t("Urgent")}
              </FieldLabel>
            </div>
            <Field>
              <FieldLabel htmlFor="work-project">{t("Project")}</FieldLabel>
              <Input
                id="work-project"
                maxLength={80}
                value={item.project}
                onChange={(e) => update({ project: e.target.value })}
              />
            </Field>
            <div className="flex flex-wrap items-end gap-3">
              <Field className="w-auto">
                <FieldLabel>{t("Work date")}</FieldLabel>
                <DatePicker
                  date={item.date}
                  label={t("Work date")}
                  onChange={(date) =>
                    update({
                      date,
                      endDate:
                        item.endDate && item.endDate < date ? "" : item.endDate,
                    })
                  }
                />
              </Field>
              <Field className="w-auto">
                <FieldLabel>{t("End date")}</FieldLabel>
                <div className="flex items-center gap-1">
                  <DatePicker
                    date={item.endDate || ""}
                    fallback={item.date}
                    label={t("End date")}
                    onChange={(endDate) => update({ endDate })}
                  />
                  {!!item.endDate && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Clear end date")}
                      onClick={() => update({ endDate: "" })}
                    >
                      <X />
                    </Button>
                  )}
                </div>
              </Field>
              <Field className="w-auto">
                <FieldLabel htmlFor="work-hour">
                  {t("Reminder hour")}
                </FieldLabel>
                <SelectField
                  id="work-hour"
                  value={hour || "none"}
                  onValueChange={(h) =>
                    update({ time: h === "none" ? "" : h + ":" + minute })
                  }
                >
                  <SelectOption value="none">{t("No time")}</SelectOption>
                  {Array.from({ length: 24 }, (_, i) =>
                    String(i).padStart(2, "0"),
                  ).map((h) => (
                    <SelectOption key={h} value={h}>
                      {h}
                    </SelectOption>
                  ))}
                </SelectField>
              </Field>
              {!!hour && (
                <Field className="w-auto">
                  <FieldLabel htmlFor="work-minute">
                    {t("Reminder minute")}
                  </FieldLabel>
                  <SelectField
                    id="work-minute"
                    value={minute}
                    onValueChange={(m) => update({ time: hour + ":" + m })}
                  >
                    {Array.from({ length: 60 }, (_, i) =>
                      String(i).padStart(2, "0"),
                    ).map((m) => (
                      <SelectOption key={m} value={m}>
                        {m}
                      </SelectOption>
                    ))}
                  </SelectField>
                </Field>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="work-estimate">
                  {t("Estimated minutes")}
                </FieldLabel>
                <Input
                  id="work-estimate"
                  type="number"
                  min={0}
                  max={100000}
                  value={item.estimatedMinutes}
                  onChange={(e) =>
                    update({ estimatedMinutes: +e.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="work-actual">
                  {t("Actual minutes")}
                </FieldLabel>
                <Input
                  id="work-actual"
                  type="number"
                  min={0}
                  max={100000}
                  value={item.actualMinutes}
                  onChange={(e) => update({ actualMinutes: +e.target.value })}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="work-notes">{t("Work notes")}</FieldLabel>
              <Textarea
                id="work-notes"
                maxLength={4000}
                value={item.notes}
                onChange={(e) => update({ notes: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="work-check">{t("Checklist")}</FieldLabel>
              {item.checklist.map((entry, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Checkbox
                    aria-label={entry.text}
                    checked={entry.done}
                    onCheckedChange={(done) =>
                      update({
                        checklist: item.checklist.map((c, j) =>
                          i === j ? { ...c, done: done === true } : c,
                        ),
                      })
                    }
                  />
                  <span className="flex-1 break-words">{entry.text}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Remove checklist item")}
                    onClick={() =>
                      update({
                        checklist: item.checklist.filter((_, j) => j !== i),
                      })
                    }
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  id="work-check"
                  maxLength={200}
                  value={check}
                  onChange={(e) => setCheck(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!check.trim() || item.checklist.length >= 50}
                  onClick={() => {
                    update({
                      checklist: [
                        ...item.checklist,
                        { text: check.trim(), done: false },
                      ],
                    });
                    setCheck("");
                  }}
                >
                  <Plus />
                  {t("Add subtask")}
                </Button>
              </div>
            </Field>
            {item.mailId && (
              <Button
                type="button"
                variant="outline"
                onClick={() => openMail(item.mailId)}
              >
                {t("Open linked email")}
              </Button>
            )}
          </div>
          {item.endDate && item.endDate < item.date && (
            <Alert variant="destructive" className="mx-4 w-auto">
              <AlertDescription>
                {t("End date must be on or after the work date.")}
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive" className="mx-4 w-auto">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-wrap justify-end gap-2 border-t p-4">
            {item.revision > 0 && (
              <Button
                type="button"
                variant="destructive"
                className="mr-auto"
                disabled={busy}
                onClick={remove}
              >
                {t("Delete work item")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !item.title.trim() ||
                !!(item.endDate && item.endDate < item.date)
              }
            >
              {t("Save")}
            </Button>
          </div>
        </form>
      </Content>
    </Root>
  );
}

function hoursLabel(items: WorkItem[]) {
  const total = totals(items);
  return t("Estimated {value0} min · Actual {value1} min", {
    value0: total.estimated,
    value1: total.actual,
  });
}

function WorkReport({
  items,
  writeMail,
}: {
  items: WorkItem[];
  writeMail: (subject: string, body: string) => void;
}) {
  const today = new Date();
  const [from, setFrom] = useState(
    workDate(startOfWeek(today, { weekStartsOn: 1 })),
  );
  const [to, setTo] = useState(workDate(endOfWeek(today, { weekStartsOn: 1 })));
  const [report, setReport] = useState("");
  const [processing, setProcessing] = useState(false);
  const request = useRef("");
  const filtered = useMemo(
    () => items.filter((item) => item.date >= from && item.date <= to),
    [items, from, to],
  );
  useEffect(() => {
    setReport("");
    setProcessing(false);
    return () => {
      cancelMailAi(request.current);
      request.current = "";
    };
  }, [filtered]);
  useEffect(() => {
    const reset = () => {
      cancelMailAi(request.current);
      request.current = "";
      setReport("");
      setProcessing(false);
    };
    window.addEventListener("anser-translation-config-changed", reset);
    return () =>
      window.removeEventListener("anser-translation-config-changed", reset);
  }, []);
  const subject = t("Work report · {value0} to {value1}", {
    value0: from,
    value1: to,
  });
  const total = totals(filtered);
  const projects = new Map<string, { estimated: number; actual: number }>();
  for (const item of filtered) {
    const project = item.project || t("No project");
    const group = projects.get(project) ?? { estimated: 0, actual: 0 };
    group.estimated += item.estimatedMinutes;
    group.actual += item.actualMinutes;
    projects.set(project, group);
  }
  const rows = filtered.map((item) => [
    item.date,
    item.title,
    workStatus(item.status),
    item.project,
    item.estimatedMinutes,
    item.actualMinutes,
  ]);
  const itemsByDate = new Map<string, WorkItem[]>();
  for (const item of filtered) {
    const day = itemsByDate.get(item.date);
    if (day) day.push(item);
    else itemsByDate.set(item.date, [item]);
  }
  const dateGroups = Array.from(itemsByDate).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const workLines = (heading: string) =>
    dateGroups.flatMap(([date, entries]) => [
      heading + date,
      ...entries.map(
        (item, index) =>
          `${index + 1}. ${[item.title, workStatus(item.status), item.project, hoursLabel([item])].filter(Boolean).join(" · ")}`,
      ),
      "",
    ]);
  const header = [
    t("Work date"),
    t("Work item"),
    t("Work status"),
    t("Project"),
    t("Estimated minutes"),
    t("Actual minutes"),
  ];
  const overview = [
    subject,
    hoursLabel(filtered),
    t("{value0} of {value1} checklist items completed", {
      value0: total.checked,
      value1: total.checklist,
    }),
    ...Array.from(
      projects,
      ([project, group]) =>
        `${project} · ${t("Estimated {value0} min · Actual {value1} min", { value0: group.estimated, value1: group.actual })}`,
    ),
  ];
  const markdown = [
    `# ${subject}`,
    "",
    ...overview.slice(1),
    "",
    report,
    "",
    ...workLines("## "),
  ].join("\n");
  function range(a: Date, b: Date) {
    setFrom(workDate(a));
    setTo(workDate(b));
  }
  function download(ext: "csv" | "md") {
    const data =
      ext === "md"
        ? markdown
        : "\uFEFF" +
          [header, ...rows]
            .map((row) =>
              row
                .map((value) => {
                  let cell = String(value);
                  if (/^[\t\r\n ]*[=+\-@]/.test(cell)) cell = "'" + cell;
                  return '"' + cell.replaceAll('"', '""') + '"';
                })
                .join(","),
            )
            .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([data], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `anser-${from}-${to}.${ext}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function generate() {
    if (request.current) return;
    const id = crypto.randomUUID();
    request.current = id;
    setProcessing(true);
    try {
      const config = await mailAiConfig();
      if (request.current !== id) return;
      if (!config) {
        toast.error(t("Set up a model to use mail AI."));
        return;
      }
      const completed = filtered.filter((item) => item.status === "done");
      const body = JSON.stringify({
        period: [from, to],
        total,
        projects: Array.from(projects, ([name, work]) => ({ name, ...work })),
        linkedMailNotes: filtered
          .filter((item) => item.mailId && item.notes)
          .map((item) => ({
            workItem: item.title,
            notes: item.notes,
          })),
        completed: completed.map((item) => ({
          title: item.title,
          project: item.project,
          notes: item.notes,
          actualMinutes: item.actualMinutes,
        })),
        open: filtered
          .filter((item) => item.status !== "done")
          .map((item) => ({
            title: item.title,
            status: item.status,
            project: item.project,
          })),
      });
      if (new TextEncoder().encode(body).length > 48_000) {
        toast.error(t("Choose a shorter reporting period."));
        return;
      }
      const reply = await call<{ text: string }>("run_mail_ai", {
        requestId: id,
        revision: config.revision,
        input: {
          kind: "report",
          body,
          language: interfaceLanguage(),
        },
      });
      if (request.current === id) setReport(reply.text);
    } catch (error) {
      if (request.current === id) toast.error(mailAiError(error));
    } finally {
      if (request.current === id) {
        request.current = "";
        setProcessing(false);
      }
    }
  }
  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle>{t("Work report")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => range(today, today)}
          >
            {t("Today")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              range(
                startOfWeek(today, { weekStartsOn: 1 }),
                endOfWeek(today, { weekStartsOn: 1 }),
              )
            }
          >
            {t("This week")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => range(startOfMonth(today), endOfMonth(today))}
          >
            {t("This month")}
          </Button>
          <DatePicker date={from} label={t("Start date")} onChange={setFrom} />
          <DatePicker date={to} label={t("End date")} onChange={setTo} />
        </div>
        <p>
          {t("{value0} of {value1} work items completed", {
            value0: total.done,
            value1: filtered.length,
          })}{" "}
          · {hoursLabel(filtered)}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={from > to || !filtered.length}
            onClick={() => {
              if (processing) {
                cancelMailAi(request.current);
                request.current = "";
                setProcessing(false);
              } else void generate();
            }}
          >
            {processing ? t("Stop generating") : t("Generate AI work report")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!filtered.length}
            onClick={() => download("csv")}
          >
            {t("Export CSV")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!filtered.length}
            onClick={() => download("md")}
          >
            {t("Export Markdown")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!filtered.length}
            onClick={() =>
              void printWorkReport(
                subject,
                [...overview.slice(1), "", report, "", ...workLines("")].join(
                  "\n",
                ),
              ).catch(() => toast.error(t("Could not print work report.")))
            }
          >
            {t("Print / Save as PDF")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!filtered.length}
            onClick={() => writeMail(subject, markdown)}
          >
            {t("Open as email draft")}
          </Button>
        </div>
        {report && (
          <Textarea
            aria-label={t("Work report")}
            value={report}
            onChange={(e) => setReport(e.target.value)}
            rows={8}
          />
        )}
        {!!projects.size && (
          <ul className="space-y-1 text-muted-foreground">
            {overview.slice(3).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}
        <div className="space-y-4">
          {dateGroups.map(([date, entries]) => (
            <section key={date} className="space-y-2">
              <h3 className="font-semibold tabular-nums">{date}</h3>
              <ol className="list-decimal space-y-1 pl-5">
                {entries.map((item) => (
                  <li key={item.id} className="break-words">
                    {item.title}{" "}
                    <span className="text-muted-foreground">
                      · {workStatus(item.status)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function Workbench({
  seed,
  onSeedConsumed,
  openMail,
  writeMail,
}: {
  seed?: WorkItem;
  onSeedConsumed: () => void;
  openMail: (id: string) => void;
  writeMail: (subject: string, body: string) => void;
}) {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [selected, setSelected] = useState(
    seed ? parseISO(seed.date) : new Date(),
  );
  const [month, setMonth] = useState(selected);
  const [view, setView] = useState("calendar");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [quick, setQuick] = useState("");
  const [editing, setEditing] = useState<WorkItem>();
  const [error, setError] = useState("");
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [groupBy, setGroupBy] = useState("status");
  const { askConfirmation, confirmationDialog } = useConfirmation();
  useEffect(() => {
    let active = true;
    void call<WorkItem[]>("list_work_items")
      .then((value) => {
        if (active) {
          setItems(value);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError(t("Could not load work items."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    if (seed) {
      setEditing(seed);
      setSelected(parseISO(seed.date));
      setMonth(parseISO(seed.date));
      onSeedConsumed();
    }
  }, [seed, onSeedConsumed]);
  const calendarComponents = useMemo(
    () => ({
      DayButton: (props: React.ComponentProps<typeof CalendarDayButton>) => {
        const day = workDate(props.day.date);
        const entries = items.filter((item) => isWorkItemOnDate(item, day));
        return (
          <CalendarDayButton
            {...props}
            className="workbench-day"
            aria-label={t("{value0} · {value1} work items", {
              value0: day,
              value1: entries.length,
            })}
          >
            <span
              className="workbench-day-number"
              data-today={props.modifiers.today || undefined}
            >
              {props.children}
            </span>
            <span className="workbench-day-items">
              {entries.slice(0, 2).map((item) => (
                <span key={item.id} data-work-status={item.status}>
                  {item.title}
                </span>
              ))}
              {entries.length > 2 && <small>+{entries.length - 2}</small>}
            </span>
          </CalendarDayButton>
        );
      },
    }),
    [items],
  );
  const date = workDate(selected);
  const daily = items.filter((item) => isWorkItemOnDate(item, date));
  const groups = new Map<string, WorkItem[]>();
  for (const item of items) {
    const label =
      groupBy === "project"
        ? item.project || t("No project")
        : groupBy === "priority"
          ? workPriority(item.priority)
          : groupBy === "date"
            ? item.date
            : workStatus(item.status);
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  async function save(item: WorkItem, after?: () => void) {
    if (mutation.current || loading || !item.title.trim()) return;
    mutation.current = true;
    setBusy(true);
    try {
      const saved = await call<WorkItem>("save_work_item", {
        item: { ...item, title: item.title.trim() },
      });
      setItems((previous) => [
        ...previous.filter((current) => current.id !== saved.id),
        saved,
      ]);
      after?.();
      setError("");
    } catch {
      setError(t("Could not save work item. Reload and try again."));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function remove(item: WorkItem) {
    if (
      mutation.current ||
      loading ||
      !(await askConfirmation({
        title: t("Delete work item"),
        description: item.title,
        action: t("Delete"),
        destructive: true,
      }))
    )
      return;
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    try {
      await call("delete_work_item", { id: item.id, revision: item.revision });
      setItems((previous) =>
        previous.filter((current) => current.id !== item.id),
      );
      setEditing(undefined);
    } catch {
      setError(t("Could not save work item. Reload and try again."));
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  function itemCard(item: WorkItem) {
    return (
      <Card key={item.id} className="gap-2 px-3 py-3 shadow-none">
        <Button
          variant="ghost"
          className="h-auto justify-start px-1 text-left whitespace-normal"
          onClick={() => setEditing(item)}
        >
          {item.title}
        </Button>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" data-work-status={item.status}>
            {workStatus(item.status)}
          </Badge>
          {view === "quadrants" && (
            <Badge variant="outline">
              {item.date}
              {item.endDate && item.endDate !== item.date
                ? ` – ${item.endDate}`
                : ""}
            </Badge>
          )}
          {item.time && <Badge variant="outline">{item.time}</Badge>}
          {item.project && <Badge variant="outline">{item.project}</Badge>}
        </div>
        {view === "board" && (
          <StatusSelect
            value={item.status}
            disabled={busy}
            onChange={(status) => void save({ ...item, status })}
          />
        )}
        {item.mailId && (
          <Button
            size="sm"
            variant="link"
            className="self-start px-0"
            onClick={() => openMail(item.mailId)}
          >
            {t("Open linked email")}
          </Button>
        )}
      </Card>
    );
  }
  return (
    <div className="workbench px-4 pb-4">
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>
            {error}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || loading}
              onClick={() => {
                setLoading(true);
                setReload((v) => v + 1);
              }}
            >
              {t("Reload")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <Tabs value={view} onValueChange={setView}>
        <div className="mb-3 flex flex-wrap justify-between gap-2">
          <TabsList>
            <TabsTrigger value="calendar">{t("Calendar")}</TabsTrigger>
            <TabsTrigger value="quadrants">{t("Four quadrants")}</TabsTrigger>
            <TabsTrigger value="table">{t("Work table")}</TabsTrigger>
            <TabsTrigger value="board">{t("Status board")}</TabsTrigger>
            <TabsTrigger value="report">{t("Work report")}</TabsTrigger>
          </TabsList>
          <Button
            size="sm"
            disabled={loading}
            onClick={() => setEditing(newWorkItem(date))}
          >
            <Plus />
            {t("Add work record")}
          </Button>
        </div>
        <TabsContent value="calendar">
          <Tabs
            value={calendarMode}
            onValueChange={(value) => {
              if (
                calendarMode === "month" &&
                workDate(month).slice(0, 7) !== date.slice(0, 7)
              )
                setSelected(startOfMonth(month));
              if (value === "month" && calendarMode !== "month")
                setMonth(selected);
              setCalendarMode(value as CalendarMode);
            }}
          >
            <TabsList className="mb-2" aria-label={t("Calendar view")}>
              <TabsTrigger value="month">{t("Month view")}</TabsTrigger>
              <TabsTrigger value="week">{t("Week view")}</TabsTrigger>
              <TabsTrigger value="day">{t("Day view")}</TabsTrigger>
            </TabsList>
            {calendarMode !== "month" && (
              <TabsContent value={calendarMode}>
                <Card className="min-w-0 gap-2 p-2 shadow-none">
                  <WorkbenchMonthNavigation
                    month={selected}
                    mode={calendarMode}
                    onMonthChange={setSelected}
                    onToday={() => setSelected(new Date())}
                  />
                  <WorkbenchTimeline
                    mode={calendarMode}
                    selected={selected}
                    items={items}
                    disabled={loading || busy}
                    onSelect={setSelected}
                    onOpen={setEditing}
                    onAdd={(day, time) =>
                      setEditing({ ...newWorkItem(day), time })
                    }
                  />
                </Card>
              </TabsContent>
            )}
            <TabsContent value="month">
              <div className="workbench-calendar-layout">
                <Card className="workbench-calendar-card block min-w-0 gap-0 p-2 shadow-none">
                  <WorkbenchMonthNavigation
                    month={month}
                    mode="month"
                    onMonthChange={(next) => {
                      setMonth(next);
                      setSelected(startOfMonth(next));
                    }}
                    onToday={() => {
                      const today = new Date();
                      setMonth(today);
                      setSelected(today);
                    }}
                  />
                  <Calendar
                    className="workbench-calendar bg-transparent"
                    classNames={{ month_caption: "sr-only" }}
                    hideNavigation
                    showOutsideDays={false}
                    locale={calendarLocale()}
                    weekStartsOn={1}
                    fixedWeeks
                    month={month}
                    onMonthChange={setMonth}
                    mode="single"
                    selected={selected}
                    onSelect={(day) => {
                      if (day) setSelected(day);
                    }}
                    components={calendarComponents}
                  />
                </Card>
                <Card className="gap-3 shadow-none">
                  <CardHeader>
                    <CardTitle>
                      {selected.toLocaleDateString(dateLocale(), {
                        dateStyle: "full",
                      })}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {hoursLabel(daily)}
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-2">
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void save({ ...newWorkItem(date), title: quick }, () =>
                          setQuick(""),
                        );
                      }}
                    >
                      <Input
                        aria-label={t("Quick add work item")}
                        placeholder={t("Quick add work item")}
                        maxLength={200}
                        value={quick}
                        onChange={(e) => setQuick(e.target.value)}
                      />
                      <Button
                        type="submit"
                        disabled={busy || loading || !quick.trim()}
                        size="icon"
                        aria-label={t("New work item")}
                      >
                        <Plus />
                      </Button>
                    </form>
                    {daily.map(itemCard)}
                    {!daily.length && (
                      <p className="text-muted-foreground">
                        {t("No work items for this day.")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="quadrants">
          <div className="workbench-quadrants">
            {workQuadrants.map(({ important, urgent, label }, index) => {
              const entries = items.filter(
                (item) =>
                  !!item.important === important && !!item.urgent === urgent,
              );
              return (
                <Card
                  key={index}
                  className="workbench-quadrant min-w-0 gap-3 py-3 shadow-none"
                  data-quadrant={index}
                >
                  <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-3">
                    <CardTitle>
                      {label()}{" "}
                      <Badge variant="outline">{entries.length}</Badge>
                    </CardTitle>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={loading || busy}
                      aria-label={t("Add work record in {value0}", {
                        value0: label(),
                      })}
                      onClick={() =>
                        setEditing({ ...newWorkItem(date), important, urgent })
                      }
                    >
                      <Plus />
                      {t("Add work record")}
                    </Button>
                  </CardHeader>
                  <CardContent className="grid gap-2 px-3">
                    {entries.map(itemCard)}
                    {!entries.length && (
                      <p className="text-muted-foreground">
                        {t("No work items in this quadrant.")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
        <TabsContent value="table">
          <div className="mb-3 flex items-center gap-2">
            <span>{t("Group work items by")}</span>
            <SelectField
              value={groupBy}
              onValueChange={setGroupBy}
              aria-label={t("Group work items by")}
            >
              <SelectOption value="status">{t("Work status")}</SelectOption>
              <SelectOption value="project">{t("Project")}</SelectOption>
              <SelectOption value="priority">{t("Work priority")}</SelectOption>
              <SelectOption value="date">{t("Work date")}</SelectOption>
            </SelectField>
          </div>
          <div className="grid gap-3">
            {Array.from(groups, ([label, group]) => (
              <Collapsible key={label} defaultOpen>
                <Card className="gap-3 py-3 shadow-none">
                  <CardHeader>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="justify-start">
                        {label} · {group.length} · {hoursLabel(group)}
                      </Button>
                    </CollapsibleTrigger>
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>
                      <Table className="w-full text-left text-sm">
                        <TableHeader>
                          <TableRow>
                            {[
                              t("Work item"),
                              t("Work status"),
                              t("Work priority"),
                              t("Project"),
                              t("Work date"),
                              t("Estimated minutes"),
                              t("Actual minutes"),
                            ].map((heading) => (
                              <TableHead
                                className="px-2 py-1 font-medium"
                                key={heading}
                              >
                                {heading}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {group.map((item) => (
                            <TableRow key={item.id} className="border-t">
                              <TableCell className="px-2 py-1">
                                <Checkbox
                                  aria-label={item.title}
                                  checked={item.status === "done"}
                                  disabled={busy}
                                  onCheckedChange={(checked) =>
                                    void save({
                                      ...item,
                                      status: checked ? "done" : "todo",
                                    })
                                  }
                                />
                                <Button
                                  variant="link"
                                  onClick={() => setEditing(item)}
                                >
                                  {item.title}
                                </Button>
                              </TableCell>
                              <TableCell className="px-2">
                                <StatusSelect
                                  value={item.status}
                                  disabled={busy}
                                  onChange={(status) =>
                                    void save({ ...item, status })
                                  }
                                />
                              </TableCell>
                              <TableCell className="px-2">
                                <SelectField
                                  aria-label={t("Work priority")}
                                  value={item.priority}
                                  disabled={busy}
                                  onValueChange={(priority) =>
                                    void save({
                                      ...item,
                                      priority: priority as WorkPriority,
                                    })
                                  }
                                >
                                  {workPriorities.map((value) => (
                                    <SelectOption key={value} value={value}>
                                      {workPriority(value)}
                                    </SelectOption>
                                  ))}
                                </SelectField>
                              </TableCell>
                              <TableCell className="px-2">
                                {item.project}
                              </TableCell>
                              <TableCell className="px-2">
                                {item.date}
                              </TableCell>
                              <TableCell className="px-2">
                                {item.estimatedMinutes}
                              </TableCell>
                              <TableCell className="px-2">
                                {item.actualMinutes}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
          </div>
          <p className="mt-3 text-muted-foreground">
            {t("{value0} of {value1} work items completed", {
              value0: totals(items).done,
              value1: items.length,
            })}{" "}
            · {hoursLabel(items)}
          </p>
        </TabsContent>
        <TabsContent value="board">
          <div className="workbench-board">
            {workStatuses.map((status) => (
              <section key={status} className="grid content-start gap-2">
                <div className="flex items-center gap-2">
                  <Badge data-work-status={status} variant="secondary">
                    {workStatus(status)}
                  </Badge>
                  <span>
                    {items.filter((item) => item.status === status).length}
                  </span>
                </div>
                {items.filter((item) => item.status === status).map(itemCard)}
              </section>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="report">
          <WorkReport items={items} writeMail={writeMail} />
        </TabsContent>
      </Tabs>
      {editing && (
        <WorkEditor
          key={editing.id}
          error={error}
          item={editing}
          setItem={setEditing}
          busy={busy}
          close={() => setEditing(undefined)}
          save={() => void save(editing, () => setEditing(undefined))}
          remove={() => void remove(editing)}
          openMail={openMail}
        />
      )}
      {confirmationDialog}
    </div>
  );
}
