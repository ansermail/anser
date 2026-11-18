import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
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
  ArrowUpRight,
  Circle,
  CircleDashed,
  CircleDot,
  Copy,
  Download,
  MoreHorizontal,
  Sparkles,
  Trash2,
  Check,
  Columns3,
  FileText,
  Flag,
  FolderOpen,
  Grid2X2,
  LayoutList,
  Mail,
  Minus,
  Pencil,
  Search,
  Settings2,
  RotateCcw,
  Star,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  TriangleAlert,
  Plus,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { printWorkReport } from "@/lib/mail-print";
import { calendarLocale, dateLocale, interfaceLanguage, t } from "@/lib/i18n";
import { cancelMailAi, mailAiConfig, mailAiError } from "@/lib/mail-ai";
import { renderSafeMarkdown } from "@/lib/release-notes";
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
  type WorkProject,
  type WorkbenchData,
  type WorkPriority,
  type WorkStatus,
} from "@/lib/workbench";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Calendar, CalendarDayButton } from "./ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "./ui/empty";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { WorkbenchTimeline } from "./workbench-timeline";
import {
  WorkItemContextMenu,
  WorkItemDeleteMenuItem,
} from "./work-item-context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from "./ui/field";
import { Input } from "./ui/input";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";
import { SelectField, SelectOption } from "./ui/select-field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetFooter,
  SheetTitle,
} from "./ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { ScrollArea } from "./ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import { TaskDataTable } from "./task-data-table";
import { WorkbenchProjects } from "./workbench-projects";
import { useConfirmation } from "@/hooks/use-confirmation";

type CalendarMode = "year" | "month" | "week" | "day";

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
    mode === "month" || mode === "year"
      ? addMonths(month, direction * (mode === "year" ? 12 : 1))
      : addDays(month, direction * (mode === "week" ? 7 : 1));
  const dayLabel = (day: Date) =>
    day.toLocaleDateString(dateLocale(), { dateStyle: "medium" });
  const weekStart = startOfWeek(month, { weekStartsOn: 1 });
  const caption =
    mode === "year"
      ? String(month.getFullYear())
      : mode === "month"
        ? month.toLocaleDateString(dateLocale(), {
            year: "numeric",
            month: "long",
          })
        : mode === "day"
          ? dayLabel(month)
          : `${dayLabel(weekStart)} – ${dayLabel(addDays(weekStart, 6))}`;

  return (
    <div className="workbench-month-navigation" data-mode={mode}>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={
          mode === "year"
            ? t("Previous year")
            : mode === "month"
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
            mode === "year"
              ? t("Next year")
              : mode === "month"
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
  minDate,
  disabled,
}: {
  fallback?: string;
  minDate?: string;
  disabled?: boolean;
  date: string;
  onChange: (date: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = date ? parseISO(date) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={label}
          disabled={disabled}
        >
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
          disabled={minDate ? { before: parseISO(minDate) } : undefined}
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
  compact = false,
}: {
  value: WorkStatus;
  onChange: (value: WorkStatus) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <SelectField
      className={compact ? "wb-status-select-compact" : undefined}
      data-status={value}
      aria-label={t("Work status")}
      value={value}
      onValueChange={(value) => onChange(value as WorkStatus)}
      disabled={disabled}
    >
      {workStatuses.map((status) => (
        <SelectOption key={status} value={status}>
          <span className="wb-status-option" data-status={status}>
            <span className="wb-status-option-dot" />
            {workStatus(status)}
          </span>
        </SelectOption>
      ))}
    </SelectField>
  );
}

const statusIcons = {
  todo: Circle,
  doing: CircleDot,
  waiting: CircleDashed,
  done: Check,
} as const;

const priorityIcons = {
  low: Flag,
  normal: Minus,
  high: TriangleAlert,
} as const;

function newestWorkItemFirst(a: WorkItem, b: WorkItem) {
  return (
    b.date.localeCompare(a.date) ||
    b.time.localeCompare(a.time) ||
    a.title.localeCompare(b.title, undefined, { numeric: true })
  );
}

function StatusLabel({ status }: { status: WorkStatus }) {
  const Icon = statusIcons[status];
  return (
    <span className="wb-status" data-status={status}>
      <Icon />
      {workStatus(status)}
    </span>
  );
}

function PriorityLabel({ priority }: { priority: WorkPriority }) {
  const Icon = priorityIcons[priority];
  return (
    <span className="wb-priority-option" data-priority={priority}>
      <Icon />
      {workPriority(priority)}
    </span>
  );
}

function WorkTableStatusBadge({ status }: { status: WorkStatus }) {
  const Icon = statusIcons[status];
  const label = workStatus(status);
  return (
    <Badge
      variant="outline"
      className="wb-table-badge wb-table-status-badge"
      data-status={status}
      title={label}
    >
      <Icon />
      <span className="wb-table-badge-label">{label}</span>
    </Badge>
  );
}

function WorkTablePriorityBadge({ priority }: { priority: WorkPriority }) {
  const Icon = priorityIcons[priority];
  const label = workPriority(priority);
  return (
    <Badge
      variant="outline"
      className="wb-table-badge wb-table-priority-badge"
      data-priority={priority}
      title={label}
    >
      <Icon />
      <span className="wb-table-badge-label">{label}</span>
    </Badge>
  );
}

function WorkTableFlagBadge({ kind }: { kind: "important" | "urgent" }) {
  const important = kind === "important";
  const Icon = important ? Star : Zap;
  return (
    <Badge
      variant="outline"
      className="wb-table-badge wb-table-flag-badge"
      data-kind={kind}
    >
      <Icon />
      {important ? t("Important work item") : t("Urgent")}
    </Badge>
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
  projects,
  manageProjects,
}: {
  projects: WorkProject[];
  manageProjects: () => void;
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
  const [showEndDate, setShowEndDate] = useState(Boolean(item.endDate));
  const update = (fields: Partial<WorkItem>) => setItem({ ...item, ...fields });
  const [hour = "", minute = "00"] = item.time ? item.time.split(":") : [];
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <SheetContent className="wb-editor">
        <SheetHeader>
          <SheetTitle>
            {item.revision ? t("Work record") : t("Add work record")}
          </SheetTitle>
          <SheetDescription>
            {item.date} · {t("Saved on this device")}
          </SheetDescription>
        </SheetHeader>
        <form
          className="wb-editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) save();
          }}
        >
          <ScrollArea className="wb-editor-scroll">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="work-title">
                  {t("Record title")}
                </FieldLabel>
                <Input
                  id="work-title"
                  required
                  maxLength={200}
                  placeholder={t("What would you like to record?")}
                  value={item.title}
                  disabled={busy}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </Field>
              <div className="wb-form-pair">
                <Field>
                  <FieldLabel>{t("Record status")}</FieldLabel>
                  <StatusSelect
                    value={item.status}
                    disabled={busy}
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
                    disabled={busy}
                    onValueChange={(priority) =>
                      update({ priority: priority as WorkPriority })
                    }
                  >
                    {workPriorities.map((priority) => (
                      <SelectOption key={priority} value={priority}>
                        {workPriority(priority)}
                      </SelectOption>
                    ))}
                  </SelectField>
                </Field>
              </div>
              <div className="wb-form-pair">
                <Field>
                  <FieldLabel>{t("Record date")}</FieldLabel>
                  <DatePicker
                    date={item.date}
                    label={t("Work date")}
                    disabled={busy}
                    onChange={(date) =>
                      update({
                        date,
                        endDate:
                          item.endDate && item.endDate < date
                            ? ""
                            : item.endDate,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="work-hour">
                    {t("Specific time")}
                  </FieldLabel>
                  <div className="wb-time-controls">
                    <SelectField
                      id="work-hour"
                      aria-label={t("Schedule hour")}
                      disabled={busy}
                      value={hour || "none"}
                      onValueChange={(next) =>
                        update({
                          time: next === "none" ? "" : `${next}:${minute}`,
                        })
                      }
                    >
                      <SelectOption value="none">{t("All day")}</SelectOption>
                      {Array.from({ length: 24 }, (_, index) =>
                        String(index).padStart(2, "0"),
                      ).map((value) => (
                        <SelectOption key={value} value={value}>
                          {value}
                        </SelectOption>
                      ))}
                    </SelectField>
                    {hour && (
                      <>
                        <span>:</span>
                        <SelectField
                          id="work-minute"
                          aria-label={t("Schedule minute")}
                          disabled={busy}
                          value={minute}
                          onValueChange={(next) =>
                            update({ time: `${hour}:${next}` })
                          }
                        >
                          {Array.from({ length: 60 }, (_, index) =>
                            String(index).padStart(2, "0"),
                          ).map((value) => (
                            <SelectOption key={value} value={value}>
                              {value}
                            </SelectOption>
                          ))}
                        </SelectField>
                      </>
                    )}
                  </div>
                </Field>
              </div>
              {showEndDate || item.endDate ? (
                <Field className="wb-end-date-field">
                  <FieldLabel>{t("End date")}</FieldLabel>
                  <div className="flex items-center gap-1">
                    <DatePicker
                      date={item.endDate || ""}
                      fallback={item.date}
                      minDate={item.date}
                      label={t("End date")}
                      disabled={busy}
                      onChange={(endDate) => update({ endDate })}
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("Clear end date")}
                      disabled={busy}
                      onClick={() => {
                        update({ endDate: "" });
                        setShowEndDate(false);
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                </Field>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="wb-end-date-add"
                  disabled={busy}
                  onClick={() => setShowEndDate(true)}
                >
                  <Plus />
                  {t("Add end date")}
                </Button>
              )}
              <Field>
                <div className="wb-editor-field-heading">
                  <FieldLabel htmlFor="work-project">
                    {t("Work project")}
                  </FieldLabel>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="wb-project-manage-link"
                    disabled={busy}
                    onClick={manageProjects}
                  >
                    <Settings2 />
                    {t("New or manage project")}
                  </Button>
                </div>
                <SelectField
                  key={projects
                    .map((project) => project.id + project.name)
                    .join("\0")}
                  id="work-project"
                  value={item.project}
                  disabled={busy}
                  onValueChange={(project) => update({ project })}
                >
                  <SelectOption value="">{t("No project")}</SelectOption>
                  {item.project &&
                    !projects.some(
                      (project) => project.name === item.project,
                    ) && (
                      <SelectOption value={item.project}>
                        {item.project}
                      </SelectOption>
                    )}
                  {projects.map((project) => (
                    <SelectOption key={project.id} value={project.name}>
                      {project.name}
                    </SelectOption>
                  ))}
                </SelectField>
              </Field>
              <FieldSet>
                <FieldLegend variant="label">{t("Four quadrants")}</FieldLegend>
                <div className="wb-form-checks">
                  <FieldLabel>
                    <Checkbox
                      checked={!!item.important}
                      disabled={busy}
                      onCheckedChange={(value) =>
                        update({ important: value === true })
                      }
                    />
                    {t("Important work item")}
                  </FieldLabel>
                  <FieldLabel>
                    <Checkbox
                      checked={!!item.urgent}
                      disabled={busy}
                      onCheckedChange={(value) =>
                        update({ urgent: value === true })
                      }
                    />
                    {t("Urgent")}
                  </FieldLabel>
                </div>
              </FieldSet>
              <Field>
                <FieldLabel htmlFor="work-notes">
                  {t("Work content")}
                </FieldLabel>
                <Textarea
                  id="work-notes"
                  rows={5}
                  maxLength={4000}
                  placeholder={t(
                    "Write down progress, decisions or follow-up questions…",
                  )}
                  value={item.notes}
                  disabled={busy}
                  onChange={(event) => update({ notes: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="work-check">{t("Subtasks")}</FieldLabel>
                {item.checklist.map((entry, index) => (
                  <div className="wb-checklist" key={index}>
                    <Checkbox
                      aria-label={entry.text}
                      disabled={busy}
                      checked={entry.done}
                      onCheckedChange={(done) =>
                        update({
                          checklist: item.checklist.map((check, n) =>
                            n === index
                              ? { ...check, done: done === true }
                              : check,
                          ),
                        })
                      }
                    />
                    <span>{entry.text}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Remove checklist item")}
                      disabled={busy}
                      onClick={() =>
                        update({
                          checklist: item.checklist.filter(
                            (_, n) => n !== index,
                          ),
                        })
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Input
                  id="work-check"
                  aria-label={t("Add subtask")}
                  maxLength={200}
                  placeholder={t("Add a subtask, press Enter to confirm")}
                  value={check}
                  disabled={busy || item.checklist.length >= 50}
                  onChange={(event) => setCheck(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key !== "Enter" ||
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229
                    )
                      return;
                    event.preventDefault();
                    if (check.trim()) {
                      update({
                        checklist: [
                          ...item.checklist,
                          { text: check.trim(), done: false },
                        ],
                      });
                      setCheck("");
                    }
                  }}
                />
              </Field>
              {item.mailId && (
                <Field>
                  <FieldLabel>{t("Linked email")}</FieldLabel>
                  <Button
                    type="button"
                    variant="outline"
                    className="wb-source-mail"
                    onClick={() => openMail(item.mailId)}
                  >
                    <Mail />
                    {t("Open linked email")}
                    <ArrowUpRight />
                  </Button>
                </Field>
              )}
              {item.endDate && item.endDate < item.date && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {t("End date must be on or after the work date.")}
                  </AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          </ScrollArea>
          <SheetFooter>
            <div className="wb-editor-footer-note">
              <span>
                {item.revision
                  ? t("Changes are shared across all views.")
                  : t("New records appear in the calendar and work items.")}
              </span>
              {item.revision > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Delete work item")}
                      disabled={busy}
                      onClick={remove}
                    >
                      <Trash2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Delete work item")}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <Button
              type="submit"
              disabled={
                busy ||
                !item.title.trim() ||
                !!(item.endDate && item.endDate < item.date)
              }
            >
              <Check />
              {t("Save record")}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

const reportPromptStorageKey = "anser-work-report-prompt";
const reportPromptLimit = 2000;

function WorkReport({
  items,
  writeMail,
  from,
  to,
  setFrom,
  setTo,
  projectSelection,
}: {
  items: WorkItem[];
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  projectSelection: ReactNode;
  writeMail: (subject: string, body: string) => void;
}) {
  const today = new Date();
  const [report, setReport] = useState("");
  const [processing, setProcessing] = useState(false);
  const [reportPrompt, setReportPrompt] = useState(() => {
    try {
      return localStorage.getItem(reportPromptStorageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(reportPrompt);
  const request = useRef("");
  const filtered = useMemo(
    () =>
      items
        .filter((item) => item.date >= from && item.date <= to)
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) || b.time.localeCompare(a.time),
        ),
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
  const rows = filtered.map((item) => [
    item.date,
    item.title,
    workStatus(item.status),
    item.project,
  ]);
  const itemsByDate = new Map<string, WorkItem[]>();
  for (const item of filtered) {
    const day = itemsByDate.get(item.date);
    if (day) day.push(item);
    else itemsByDate.set(item.date, [item]);
  }
  const dateGroups = Array.from(itemsByDate).sort(([a], [b]) =>
    b.localeCompare(a),
  );
  const workLines = (heading: string) =>
    dateGroups.flatMap(([date, entries]) => [
      heading + date,
      ...entries.map(
        (item, index) =>
          `${index + 1}. ${[item.title, workStatus(item.status), item.project].filter(Boolean).join(" · ")}`,
      ),
      "",
    ]);
  const header = [
    t("Work date"),
    t("Work item"),
    t("Work status"),
    t("Project"),
  ];
  const overview = [
    subject,
    t("{value0} of {value1} checklist items completed", {
      value0: total.checked,
      value1: total.checklist,
    }),
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
      if (!config || config.revision === "demo") {
        toast.error(t("Set up a model to use mail AI."));
        return;
      }
      const completed = filtered.filter((item) => item.status === "done");
      const body = JSON.stringify({
        period: [from, to],
        total,
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
          instructions: reportPrompt || undefined,
        },
      });
      if (request.current === id) {
        setReport(reply.text);
      }
    } catch (error) {
      if (request.current === id) toast.error(mailAiError(error));
    } finally {
      if (request.current === id) {
        request.current = "";
        setProcessing(false);
      }
    }
  }
  function savePrompt() {
    const next = promptDraft.trim();
    try {
      if (next) localStorage.setItem(reportPromptStorageKey, next);
      else localStorage.removeItem(reportPromptStorageKey);
    } catch {
      // Keep the prompt for this session when local persistence is unavailable.
    }
    setReportPrompt(next);
    setPromptDraft(next);
    setPromptOpen(false);
    setReport("");
    toast.success(
      t(next ? "AI report prompt saved." : "AI report prompt reset."),
    );
  }
  const period =
    from === workDate(today) && to === from
      ? "today"
      : from === workDate(startOfWeek(today, { weekStartsOn: 1 })) &&
          to === workDate(endOfWeek(today, { weekStartsOn: 1 }))
        ? "week"
        : from === workDate(startOfMonth(today)) &&
            to === workDate(endOfMonth(today))
          ? "month"
          : "custom";
  const title =
    period === "today"
      ? t("Today's work report")
      : period === "week"
        ? t("This week's work report")
        : period === "month"
          ? t("This month's work report")
          : t("Work report");
  return (
    <>
      <div className="wb-report-layout">
        <Card className="wb-report-options">
          <CardHeader>
            <CardTitle>{t("Report range")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <div className="wb-report-range-label">
                  <FieldLabel>{t("Date range")}</FieldLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("Custom report period")}
                      >
                        <CalendarDays />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="wb-report-range-popover w-80 max-w-[calc(100vw-2rem)] p-4"
                    >
                      <PopoverHeader>
                        <PopoverTitle>{t("Custom report period")}</PopoverTitle>
                      </PopoverHeader>
                      <FieldGroup className="wb-report-range-fields">
                        <Field>
                          <FieldLabel>{t("Start date")}</FieldLabel>
                          <DatePicker
                            date={from}
                            label={t("Start date")}
                            onChange={setFrom}
                          />
                        </Field>
                        <Field>
                          <FieldLabel>{t("End date")}</FieldLabel>
                          <DatePicker
                            date={to}
                            label={t("End date")}
                            onChange={setTo}
                          />
                        </Field>
                      </FieldGroup>
                    </PopoverContent>
                  </Popover>
                </div>
                <ToggleGroup
                  type="single"
                  value={period}
                  aria-label={t("Report range")}
                  onValueChange={(value) => {
                    if (value === "today") range(today, today);
                    if (value === "week")
                      range(
                        startOfWeek(today, { weekStartsOn: 1 }),
                        endOfWeek(today, { weekStartsOn: 1 }),
                      );
                    if (value === "month")
                      range(startOfMonth(today), endOfMonth(today));
                  }}
                >
                  <ToggleGroupItem value="today">{t("Today")}</ToggleGroupItem>
                  <ToggleGroupItem value="week">
                    {t("This week")}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="month">
                    {t("This month")}
                  </ToggleGroupItem>
                </ToggleGroup>
              </Field>
              <Field>
                <FieldLabel>{t("Work project")}</FieldLabel>
                {projectSelection}
              </Field>
              <Field>
                <FieldLabel>{t("AI report prompt")}</FieldLabel>
                <Button
                  type="button"
                  variant="outline"
                  className="wb-report-prompt-trigger"
                  onClick={() => {
                    setPromptDraft(reportPrompt);
                    setPromptOpen(true);
                  }}
                >
                  <Settings2 />
                  <span>{t("Custom prompt")}</span>
                  {reportPrompt && (
                    <Badge variant="secondary">{t("Customized")}</Badge>
                  )}
                </Button>
                <FieldDescription>
                  {t(
                    "Set the report structure and wording. Leave blank to use the default.",
                  )}
                </FieldDescription>
              </Field>
            </FieldGroup>
            <div className="wb-report-numbers">
              <span>
                {t("Work records")}
                <strong>{filtered.length}</strong>
              </span>
              <span>
                {t("Completed")}
                <strong>{total.done}</strong>
              </span>
            </div>
            <Button
              variant="outline"
              disabled={processing || !filtered.length || from > to}
              onClick={() => void generate()}
            >
              <Sparkles />
              {processing ? t("Generating report…") : t("Generate AI report")}
            </Button>
            {processing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  cancelMailAi(request.current);
                  request.current = "";
                  setProcessing(false);
                }}
              >
                {t("Cancel")}
              </Button>
            )}
          </CardContent>
        </Card>
        <Card className="wb-report-paper">
          <CardHeader>
            <div className="wb-report-heading">
              <div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>
                  {from} — {to}
                </CardDescription>
              </div>
              <div className="wb-report-actions">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!filtered.length}
                      aria-label={t("Copy report")}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(markdown)
                          .then(() => toast.success(t("Report copied.")))
                          .catch(() => toast.error(t("Could not copy report.")))
                      }
                    >
                      <Copy />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Copy report")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={!filtered.length}
                      aria-label={t("Download Markdown")}
                      onClick={() => download("md")}
                    >
                      <Download />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Download Markdown")}</TooltipContent>
                </Tooltip>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("More report actions")}
                      disabled={!filtered.length}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onSelect={() => download("csv")}>
                        {t("Export CSV")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() =>
                          void printWorkReport(
                            subject,
                            [
                              ...overview.slice(1),
                              "",
                              report,
                              "",
                              ...workLines(""),
                            ].join("\n"),
                          ).catch(() =>
                            toast.error(t("Could not print work report.")),
                          )
                        }
                      >
                        {t("Print / Save as PDF")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => writeMail(subject, markdown)}
                      >
                        {t("Open as email draft")}
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </CardHeader>
          <ScrollArea className="wb-report-scroll">
            <CardContent>
              {report && (
                <section className="wb-report-summary">
                  <h3>
                    <Sparkles />
                    {t("AI work summary")}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="wb-report-summary-copy"
                          aria-label={t("Copy summary")}
                          onClick={() =>
                            void copyText(report).then((copied) =>
                              copied
                                ? toast.success(t("Summary copied"))
                                : toast.error(t("Could not copy summary.")),
                            )
                          }
                        >
                          <Copy />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("Copy summary")}</TooltipContent>
                    </Tooltip>
                  </h3>
                  <div
                    className="wb-report-summary-text"
                    dangerouslySetInnerHTML={{
                      __html: renderSafeMarkdown(report, true),
                    }}
                  />
                </section>
              )}
              {dateGroups.map(([date, entries]) => (
                <section className="wb-report-date" key={date}>
                  <h3>
                    {parseISO(date).toLocaleDateString(dateLocale(), {
                      month: "long",
                      day: "numeric",
                    })}{" "}
                    ·{" "}
                    {parseISO(date).toLocaleDateString(dateLocale(), {
                      weekday: "long",
                    })}
                  </h3>
                  <ol>
                    {entries.map((item) => (
                      <li key={item.id}>
                        <div>
                          <strong>{item.title}</strong>
                          <StatusLabel status={item.status} />
                        </div>
                        <p>{item.notes || item.project}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
              {!filtered.length && (
                <p className="wb-empty">{t("No work items in this period.")}</p>
              )}
            </CardContent>
          </ScrollArea>
        </Card>
      </div>
      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="wb-report-prompt-dialog">
          <DialogHeader>
            <DialogTitle>{t("Customize AI report prompt")}</DialogTitle>
            <DialogDescription>
              {t(
                "Add formatting, section and wording requirements. These instructions are combined with the default factual and response rules.",
              )}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="work-report-prompt">
              {t("Additional report instructions")}
            </FieldLabel>
            <Textarea
              id="work-report-prompt"
              value={promptDraft}
              maxLength={reportPromptLimit}
              placeholder={t(
                "For example: Group by project, then list completed work, risks and next steps. Use concise Markdown with headings and short bullet points.",
              )}
              onChange={(event) => setPromptDraft(event.target.value)}
            />
            <FieldDescription className="wb-report-prompt-count">
              {t("{value0} / {value1} characters", {
                value0: promptDraft.length,
                value1: reportPromptLimit,
              })}
            </FieldDescription>
          </Field>
          <DialogFooter className="wb-report-prompt-actions">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPromptDraft("")}
            >
              <RotateCcw />
              {t("Use default prompt")}
            </Button>
            <Button type="button" onClick={savePrompt}>
              {t("Save prompt")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
  const [projects, setProjects] = useState<WorkProject[]>([]);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [layout, setLayout] = useState("table");
  const [selected, setSelected] = useState(
    seed ? parseISO(seed.date) : new Date(),
  );
  const [reportFrom, setReportFrom] = useState(() =>
    workDate(startOfWeek(new Date(), { weekStartsOn: 1 })),
  );
  const [reportTo, setReportTo] = useState(() =>
    workDate(endOfWeek(new Date(), { weekStartsOn: 1 })),
  );
  const [month, setMonth] = useState(selected);
  const today = new Date();
  function selectDate(next: Date) {
    setSelected(next);
    setMonth(next);
  }
  const [view, setView] = useState("calendar");
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("month");
  const [quick, setQuick] = useState("");
  const [editing, setEditing] = useState<WorkItem>();
  const [contextItemId, setContextItemId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const mutation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [groupBy, setGroupBy] = useState("none");
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<HTMLElement | null>(null);
  const [dragGhost, setDragGhost] = useState<{
    title: string;
    x: number;
    y: number;
    width: number;
  } | null>(null);
  const dragSession = useRef<{
    pointerId: number;
    item: WorkItem;
    board: HTMLElement | null;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    active: boolean;
  } | null>(null);
  const suppressedTaskClick = useRef<string | null>(null);
  const { askConfirmation, confirmationDialog } = useConfirmation();
  useEffect(() => {
    let active = true;
    void Promise.all([
      call<WorkItem[]>("list_work_items"),
      call<WorkProject[]>("list_work_projects"),
    ])
      .then(([value, projectList]) => {
        if (active) {
          setItems(value);
          setProjects(projectList);
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
  const activeProject = projects.find(
    (project) => project.id === projectFilter,
  );
  const visible = useMemo(
    () =>
      items
        .filter(
          (item) =>
            (!projectFilter ||
              (projectFilter === "__none__"
                ? !item.project
                : item.project === activeProject?.name)) &&
            (view !== "items" ||
              ((!statusFilter || item.status === statusFilter) &&
                `${item.title} ${item.project} ${item.notes} ${item.mailSubject ?? ""}`
                  .toLocaleLowerCase()
                  .includes(query.trim().toLocaleLowerCase()))),
        )
        .sort(newestWorkItemFirst),
    [items, projectFilter, activeProject, view, statusFilter, query],
  );
  const projectTone = (name: string) => {
    if (!name) return "none";
    const index = projects.findIndex((project) => project.name === name);
    return index < 0 ? "none" : String(index % 6);
  };
  const calendarComponents = useMemo(
    () => ({
      DayButton: (props: React.ComponentProps<typeof CalendarDayButton>) => {
        const day = workDate(props.day.date);
        const entries = visible
          .filter((item) => isWorkItemOnDate(item, day))
          .sort(
            (a, b) =>
              a.time.localeCompare(b.time) || a.title.localeCompare(b.title),
          );
        return (
          <CalendarDayButton
            {...props}
            className={`workbench-day ${
              props.modifiers.outside
                ? "workbench-day-outside"
                : "workbench-day-current-month"
            }`}
            aria-label={t("{value0} · {value1} work items", {
              value0: day,
              value1: entries.length,
            })}
          >
            <span
              className="workbench-day-number"
              data-today={props.modifiers.today || undefined}
            >
              {props.day.date.getDate()}
            </span>
            <span className="workbench-day-items">
              {entries.slice(0, 2).map((item) => (
                <WorkItemContextMenu
                  key={item.id}
                  item={item}
                  disabled={busy || loading}
                  onOpen={setEditing}
                  onDelete={remove}
                >
                  <span
                    className="workbench-day-event"
                    data-project-tone={projectTone(item.project)}
                    data-work-status={item.status}
                  >
                    <span className="workbench-project-dot" />
                    {item.time && <small>{item.time}</small>}
                    <span>{item.title}</span>
                  </span>
                </WorkItemContextMenu>
              ))}
              {entries.length > 2 && (
                <small className="workbench-day-more">
                  +{entries.length - 2}
                </small>
              )}
            </span>
          </CalendarDayButton>
        );
      },
    }),
    [visible, projects, busy, loading],
  );
  const date = workDate(selected);
  const daily = visible
    .filter((item) => isWorkItemOnDate(item, date))
    .sort((a, b) => a.time.localeCompare(b.time));
  const activeDaily = daily.filter((item) => item.status !== "done");
  async function copyDailyWorkItems() {
    const value = [
      date.replaceAll("-", "/"),
      ...daily.flatMap((item, index) => [
        `${index + 1}.${item.title}`,
        ...item.checklist.map((entry) => `  -- ${entry.text}`),
      ]),
    ].join("\n");
    if (await copyText(value)) toast.success(t("Daily work records copied."));
    else toast.error(t("Could not copy daily work records."));
  }
  const groups = new Map<string, WorkItem[]>();
  for (const item of visible) {
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
  function moveToQuadrant(item: WorkItem, important: boolean, urgent: boolean) {
    if (!!item.important === important && !!item.urgent === urgent) return;
    void save({ ...item, important, urgent });
  }
  function workDropTarget(x: number, y: number, board: HTMLElement | null) {
    const hit = document.elementFromPoint?.(x, y);
    if (!board) return hit?.closest<HTMLElement>(".wb-matrix-quadrant") ?? null;
    const column = hit?.closest<HTMLElement>(".wb-board-column");
    return column?.parentElement === board ? column : null;
  }
  function resetWorkDrag() {
    dragSession.current = null;
    setDraggingItemId(null);
    setDropTarget(null);
    setDragGhost(null);
  }
  function beginWorkDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    item: WorkItem,
  ) {
    if (
      busy ||
      loading ||
      mutation.current ||
      !event.isPrimary ||
      event.pointerType === "touch" ||
      event.button !== 0 ||
      (event.target as Element).closest(
        'button:not(.wb-task-title), a, input, textarea, select, [contenteditable="true"]',
      )
    )
      return;
    suppressedTaskClick.current = null;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragSession.current = {
      pointerId: event.pointerId,
      item,
      board: event.currentTarget.closest(".workbench-board"),
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      active: false,
    };
    // Capture on the pressed element so a click without movement still opens the record.
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }
  function updateWorkDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (
      !session.active &&
      Math.hypot(
        event.clientX - session.startX,
        event.clientY - session.startY,
      ) < 5
    )
      return;
    session.active = true;
    event.preventDefault();
    setDraggingItemId(session.item.id);
    setDropTarget(workDropTarget(event.clientX, event.clientY, session.board));
    setDragGhost({
      title: session.item.title,
      x: event.clientX - session.offsetX,
      y: event.clientY - session.offsetY,
      width: event.currentTarget.getBoundingClientRect().width,
    });
  }
  function finishWorkDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    cancelled = false,
  ) {
    const session = dragSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const target =
      session.active && !cancelled
        ? workDropTarget(event.clientX, event.clientY, session.board)
        : null;
    if (session.active && !cancelled) {
      event.preventDefault();
      suppressedTaskClick.current = session.item.id;
      window.setTimeout(() => {
        if (suppressedTaskClick.current === session.item.id)
          suppressedTaskClick.current = null;
      }, 0);
    }
    // Pointer capture is released by the browser after pointerup/pointercancel.
    resetWorkDrag();
    if (!target) return;
    if (session.board) {
      const status = workStatuses.find(
        (value) => value === target.dataset.status,
      );
      if (status && status !== session.item.status)
        void save({ ...session.item, status });
    } else {
      const quadrant = workQuadrants[Number(target.dataset.quadrant)];
      if (quadrant)
        moveToQuadrant(session.item, quadrant.important, quadrant.urgent);
    }
  }
  async function changeProject(project: WorkProject, deleting: boolean) {
    if (mutation.current || loading) return false;
    const name = project.name.trim();
    if (!deleting && (!name || name.length > 80)) {
      toast.error(t("Enter a project name."));
      return false;
    }
    if (
      !deleting &&
      projects.some(
        (entry) =>
          entry.id !== project.id &&
          entry.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      toast.error(t("A project with this name already exists."));
      return false;
    }
    mutation.current = true;
    setBusy(true);
    try {
      const previous = projects.find((entry) => entry.id === project.id);
      const data = await call<WorkbenchData>(
        deleting ? "delete_work_project" : "save_work_project",
        deleting
          ? { id: project.id, revision: project.revision }
          : { project: { ...project, name } },
      );
      setProjects(data.projects);
      setItems(data.items);
      if (deleting && projectFilter === project.id) setProjectFilter("");
      setEditing((draft) => {
        if (!draft) return draft;
        if (!previous) return { ...draft, project: name };
        if (draft.project !== previous.name) return draft;
        const current = data.items.find((item) => item.id === draft.id);
        const original = items.find((item) => item.id === draft.id);
        const revision =
          original?.project === previous.name &&
          original.revision === draft.revision &&
          (deleting || previous.name !== name) &&
          current?.revision === draft.revision + 1
            ? current.revision
            : draft.revision;
        return { ...draft, project: deleting ? "" : name, revision };
      });
      setError("");
      return true;
    } catch {
      toast.error(t("Could not save work project. Reload and try again."));
      setError(t("Could not save work project. Reload and try again."));
      return false;
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  const saveProject = (project: WorkProject) => changeProject(project, false);
  async function removeProject(project: WorkProject) {
    if (busy || loading) return;
    if (
      await askConfirmation({
        title: t("Delete project {value0}", { value0: project.name }),
        description: t(
          "The {value0} linked work records will be kept without a project.",
          {
            value0: items.filter((item) => item.project === project.name)
              .length,
          },
        ),
        action: t("Delete"),
        destructive: true,
      })
    )
      await changeProject(project, true);
  }
  function workDragBindings(item: WorkItem) {
    return {
      "data-dragging": draggingItemId === item.id || undefined,
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) =>
        beginWorkDrag(event, item),
      onPointerMove: updateWorkDrag,
      onPointerUp: finishWorkDrag,
      onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) =>
        finishWorkDrag(event, true),
      onLostPointerCapture: (event: ReactPointerEvent<HTMLDivElement>) =>
        finishWorkDrag(event, true),
      onClickCapture: (event: React.MouseEvent) => {
        if (suppressedTaskClick.current !== item.id || event.detail === 0)
          return;
        suppressedTaskClick.current = null;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }
  function taskRow(item: WorkItem, compact = false) {
    const row = (
      <div
        className={
          compact ? "wb-task-row wb-task-compact wb-matrix-task" : "wb-task-row"
        }
        key={item.id}
        title={
          compact
            ? t("Drag to another quadrant to update importance and urgency")
            : undefined
        }
        {...(compact && workDragBindings(item))}
      >
        <Checkbox
          aria-label={item.title}
          checked={item.status === "done"}
          disabled={busy || loading}
          onCheckedChange={(checked) =>
            void save({ ...item, status: checked ? "done" : "todo" })
          }
        />
        <Button
          variant="ghost"
          className="wb-task-title"
          title={item.title}
          data-done={item.status === "done"}
          onClick={() => setEditing(item)}
        >
          <span>{item.title}</span>
          {!compact && (
            <small>
              <span
                className="wb-task-project"
                data-project-tone={projectTone(item.project)}
              >
                <span className="workbench-project-dot" />
                <span>{item.project || t("No project")}</span>
              </span>
              {item.checklist.length > 0 && (
                <span>
                  <Check />
                  {item.checklist.filter((entry) => entry.done).length}/
                  {item.checklist.length}
                </span>
              )}
            </small>
          )}
        </Button>
        {item.priority === "high" && <Flag className="wb-priority" />}
        {compact && (
          <span className="wb-row-date">
            {item.time ||
              parseISO(item.date).toLocaleDateString(dateLocale(), {
                month: "2-digit",
                day: "2-digit",
              })}
          </span>
        )}
      </div>
    );
    // Board cards own their menu, including their footer and status selector.
    if (!compact && view === "items") return row;
    return (
      <WorkItemContextMenu
        key={item.id}
        item={item}
        disabled={busy || loading}
        onOpen={setEditing}
        onDelete={remove}
      >
        {row}
      </WorkItemContextMenu>
    );
  }
  const tableRows = (entries: WorkItem[]) =>
    entries.map((item) => ({
      id: item.id,
      complete: (
        <Checkbox
          aria-label={item.title}
          checked={item.status === "done"}
          disabled={busy}
          onCheckedChange={(checked) =>
            void save({ ...item, status: checked ? "done" : "todo" })
          }
        />
      ),
      work: (
        <Button
          variant="ghost"
          className="wb-table-title"
          title={item.title}
          onClick={() => setEditing(item)}
        >
          <span className="truncate">{item.title}</span>
        </Button>
      ),
      status: <WorkTableStatusBadge status={item.status} />,
      priority: <WorkTablePriorityBadge priority={item.priority} />,
      important: item.important ? (
        <WorkTableFlagBadge kind="important" />
      ) : null,
      urgent: item.urgent ? <WorkTableFlagBadge kind="urgent" /> : null,
      linkedMail: item.mailId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="wb-table-mail-link"
              aria-label={
                item.mailSubject
                  ? t("Open linked email: {value0}", {
                      value0: item.mailSubject,
                    })
                  : t("Open linked email")
              }
              title={item.mailSubject || t("Open linked email")}
              onClick={() => openMail(item.mailId)}
            >
              <Mail />
              <span>{item.mailSubject || t("Open linked email")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80 whitespace-normal break-words">
            {item.mailSubject || t("Open linked email")}
          </TooltipContent>
        </Tooltip>
      ) : null,
      project: item.project ? (
        <span
          className="wb-table-project"
          data-project-tone={projectTone(item.project)}
          title={item.project}
        >
          <span className="workbench-project-dot" />
          {item.project}
        </span>
      ) : null,
      workDate: (
        <span
          className="block truncate"
          title={[item.date, item.endDate, item.time]
            .filter(Boolean)
            .join(" · ")}
        >
          {item.date}
          {item.time && ` · ${item.time}`}
          {item.endDate && ` – ${item.endDate}`}
        </span>
      ),
    }));
  const renderTable = (entries: WorkItem[]) => {
    const entriesById = new Map(entries.map((item) => [item.id, item]));
    return (
      <TaskDataTable
        label={t("Work table")}
        rows={tableRows(entries)}
        fields={[
          ...(entries.length ? ["complete" as const] : []),
          "work",
          "status",
          "project",
          "workDate",
          "priority",
          "important",
          "urgent",
          "linkedMail",
        ]}
        pageSize={14}
        keepEmptyFields
        showRecordCount
        empty={t("No matching work items.")}
        selectedRowId={contextItemId}
        renderRow={(row, rowElement) => {
          const item = entriesById.get(row.id);
          if (!item) return rowElement;
          return (
            <ContextMenu
              onOpenChange={(open) => setContextItemId(open ? item.id : null)}
            >
              <ContextMenuTrigger asChild>{rowElement}</ContextMenuTrigger>
              <ContextMenuContent className="wb-work-item-menu">
                <ContextMenuLabel className="wb-work-item-menu-label">
                  {item.title}
                </ContextMenuLabel>
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={busy || loading}
                  onSelect={() => setEditing(item)}
                >
                  <Pencil />
                  <span className="wb-context-label">
                    {t("Edit work item")}
                  </span>
                </ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={busy || loading}>
                    <CircleDot />
                    <span className="wb-context-label">{t("Work status")}</span>
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="wb-work-item-menu">
                    <ContextMenuRadioGroup
                      value={item.status}
                      onValueChange={(status) =>
                        void save({
                          ...item,
                          status: status as WorkStatus,
                        })
                      }
                    >
                      {workStatuses.map((status) => (
                        <ContextMenuRadioItem
                          key={status}
                          value={status}
                          disabled={busy || loading}
                        >
                          <StatusLabel status={status} />
                        </ContextMenuRadioItem>
                      ))}
                    </ContextMenuRadioGroup>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={busy || loading}>
                    <FolderOpen />
                    <span className="wb-context-label">{t("Project")}</span>
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="wb-work-item-menu wb-project-context-menu">
                    <ContextMenuRadioGroup
                      value={item.project || "__none__"}
                      onValueChange={(project) =>
                        void save({
                          ...item,
                          project: project === "__none__" ? "" : project,
                        })
                      }
                    >
                      <ContextMenuRadioItem
                        value="__none__"
                        disabled={busy || loading}
                      >
                        <span
                          className="wb-table-project"
                          data-project-tone="none"
                        >
                          <span className="workbench-project-dot" />
                          {t("No project")}
                        </span>
                      </ContextMenuRadioItem>
                      {item.project &&
                        !projects.some(
                          (project) => project.name === item.project,
                        ) && (
                          <ContextMenuRadioItem
                            value={item.project}
                            disabled={busy || loading}
                          >
                            <span
                              className="wb-table-project"
                              data-project-tone="none"
                            >
                              <span className="workbench-project-dot" />
                              {item.project}
                            </span>
                          </ContextMenuRadioItem>
                        )}
                      {projects.map((project, index) => (
                        <ContextMenuRadioItem
                          key={project.id}
                          value={project.name}
                          disabled={busy || loading}
                        >
                          <span
                            className="wb-table-project"
                            data-project-tone={index % 6}
                          >
                            <span className="workbench-project-dot" />
                            {project.name}
                          </span>
                        </ContextMenuRadioItem>
                      ))}
                    </ContextMenuRadioGroup>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={busy || loading}>
                    <Flag />
                    <span className="wb-context-label">
                      {t("Work priority")}
                    </span>
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="wb-work-item-menu">
                    <ContextMenuRadioGroup
                      value={item.priority}
                      onValueChange={(priority) =>
                        void save({
                          ...item,
                          priority: priority as WorkPriority,
                        })
                      }
                    >
                      {workPriorities.map((priority) => (
                        <ContextMenuRadioItem
                          key={priority}
                          value={priority}
                          disabled={busy || loading}
                        >
                          <PriorityLabel priority={priority} />
                        </ContextMenuRadioItem>
                      ))}
                    </ContextMenuRadioGroup>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={busy || loading}>
                    <Grid2X2 />
                    <span className="wb-context-label">
                      {t("Four quadrants")}
                    </span>
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="wb-work-item-menu">
                    <ContextMenuRadioGroup
                      value={String(
                        workQuadrants.findIndex(
                          (quadrant) =>
                            quadrant.important === !!item.important &&
                            quadrant.urgent === !!item.urgent,
                        ),
                      )}
                      onValueChange={(quadrant) => {
                        const target = workQuadrants[Number(quadrant)];
                        if (!target) return;
                        void save({
                          ...item,
                          important: target.important,
                          urgent: target.urgent,
                        });
                      }}
                    >
                      {workQuadrants.map(
                        ({ important, urgent, label }, index) => (
                          <ContextMenuRadioItem
                            key={index}
                            value={String(index)}
                            disabled={busy || loading}
                          >
                            <span
                              className="wb-quadrant-option"
                              data-quadrant={index}
                            >
                              <span className="wb-quadrant-dot" />
                              {label()}
                            </span>
                          </ContextMenuRadioItem>
                        ),
                      )}
                    </ContextMenuRadioGroup>
                  </ContextMenuSubContent>
                </ContextMenuSub>
                {item.mailId && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      disabled={busy || loading}
                      onSelect={() => openMail(item.mailId)}
                    >
                      <Mail />
                      <span className="wb-context-label">
                        {t("Open linked email")}
                      </span>
                    </ContextMenuItem>
                  </>
                )}
                <ContextMenuSeparator />
                <WorkItemDeleteMenuItem
                  disabled={busy || loading}
                  onDelete={() => void remove(item)}
                />
              </ContextMenuContent>
            </ContextMenu>
          );
        }}
      />
    );
  };
  const renderBoard = (entries: WorkItem[], group?: string) => {
    const statuses =
      group !== undefined
        ? workStatuses.filter((status) =>
            entries.some((item) => item.status === status),
          )
        : workStatuses;
    return (
      <div
        className="workbench-board"
        data-columns={Math.max(1, statuses.length)}
      >
        {statuses.map((status) => {
          const statusEntries = entries.filter(
            (item) => item.status === status,
          );
          return (
            <section
              key={status}
              className="wb-board-column"
              data-status={status}
              data-board-group={group}
              data-drop-target={
                (dropTarget?.dataset.status === status &&
                  dropTarget?.dataset.boardGroup === group) ||
                undefined
              }
            >
              <header className="wb-board-column-heading">
                <h3>
                  <StatusLabel status={status} />
                </h3>
                <Badge variant="secondary" className="wb-count">
                  {statusEntries.length}
                </Badge>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="wb-board-add"
                  aria-label={t("Add work record in {value0}", {
                    value0: workStatus(status),
                  })}
                  disabled={busy || loading}
                  onClick={() => {
                    const example = entries[0];
                    setEditing({
                      ...newWorkItem(
                        group !== undefined && groupBy === "date"
                          ? example.date
                          : date,
                      ),
                      status,
                      project:
                        group !== undefined && groupBy === "project"
                          ? example.project
                          : activeProject?.name || "",
                      ...(group !== undefined &&
                        groupBy === "priority" && {
                          priority: example.priority,
                        }),
                    });
                  }}
                >
                  <Plus />
                </Button>
              </header>
              {!statusEntries.length && !loading && (
                <p className="wb-board-empty">
                  {t("No work items in this status.")}
                </p>
              )}
              {statusEntries.map((item) => (
                <WorkItemContextMenu
                  key={item.id}
                  item={item}
                  disabled={busy || loading}
                  onOpen={setEditing}
                  onDelete={remove}
                >
                  <Card
                    className="wb-board-item"
                    data-status={item.status}
                    key={item.id}
                    title={t("Drag to another status column")}
                    {...workDragBindings(item)}
                  >
                    <CardContent>
                      {taskRow(item)}
                      <div className="wb-board-footer">
                        <div className="wb-board-meta">
                          <span>{item.date}</span>
                          {item.time && <span>{item.time}</span>}
                        </div>
                        <div className="wb-board-actions">
                          {item.mailId && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t("Open linked email")}
                                  onClick={() => openMail(item.mailId)}
                                >
                                  <Mail />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("Open linked email")}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          <StatusSelect
                            compact
                            value={item.status}
                            disabled={busy}
                            onChange={(status) =>
                              void save({ ...item, status })
                            }
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </WorkItemContextMenu>
              ))}
            </section>
          );
        })}
      </div>
    );
  };
  const projectSelection = (
    <SelectField
      aria-label={t("Filter work projects")}
      value={projectFilter}
      onValueChange={setProjectFilter}
      disabled={loading}
    >
      <SelectOption value="">{t("All projects")}</SelectOption>
      <SelectOption value="__none__">{t("No project")}</SelectOption>
      {projects.map((project) => (
        <SelectOption key={project.id} value={project.id}>
          {project.name}
        </SelectOption>
      ))}
    </SelectField>
  );
  return (
    <TooltipProvider>
      <div className="workbench">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>
              {error}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || loading}
                onClick={() => {
                  setLoading(true);
                  setReload((value) => value + 1);
                }}
              >
                {t("Reload")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <Tabs value={view} onValueChange={setView} className="wb-tabs">
          <div className="wb-navigation">
            <TabsList variant="line" aria-label={t("Workbench view")}>
              <TabsTrigger value="calendar">
                <CalendarDays />
                {t("Calendar")}
              </TabsTrigger>
              <TabsTrigger value="quadrants">
                <Grid2X2 />
                {t("Four quadrants")}
              </TabsTrigger>
              <TabsTrigger value="items">
                <LayoutList />
                {t("Work items")}
              </TabsTrigger>
              <TabsTrigger value="report">
                <FileText />
                {t("Work report")}
              </TabsTrigger>
            </TabsList>
            <Button
              size="sm"
              disabled={loading || busy}
              onClick={() =>
                setEditing({
                  ...newWorkItem(date),
                  project: activeProject?.name || "",
                })
              }
            >
              <Plus />
              {t("Add work record")}
            </Button>
          </div>
          {view !== "report" && (
            <div className="wb-toolbar" data-view={view}>
              <div className="wb-toolbar-left">
                {view === "calendar" ? (
                  <WorkbenchMonthNavigation
                    month={
                      calendarMode === "month" || calendarMode === "year"
                        ? month
                        : selected
                    }
                    mode={calendarMode}
                    onMonthChange={selectDate}
                    onToday={() => selectDate(new Date())}
                  />
                ) : (
                  <h2>
                    {view === "items"
                      ? t("Work items")
                      : t("Importance and urgency")}
                  </h2>
                )}
                {view === "quadrants" && (
                  <>
                    <div className="wb-quadrant-date">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("Previous day")}
                        onClick={() => selectDate(addDays(selected, -1))}
                      >
                        <ChevronLeft />
                      </Button>
                      <DatePicker
                        date={date}
                        label={t("Work date")}
                        onChange={(value) => selectDate(parseISO(value))}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("Next day")}
                        onClick={() => selectDate(addDays(selected, 1))}
                      >
                        <ChevronRight />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => selectDate(new Date())}
                      >
                        {t("Today")}
                      </Button>
                    </div>
                    <span className="wb-toolbar-caption">
                      {t("{value0} work records", {
                        value0: activeDaily.length,
                      })}
                    </span>
                  </>
                )}
              </div>
              <div className="wb-toolbar-right">
                {view === "items" && (
                  <>
                    <InputGroup className="wb-items-search">
                      <InputGroupAddon>
                        <Search />
                      </InputGroupAddon>
                      <InputGroupInput
                        aria-label={t("Search work items")}
                        placeholder={t("Search work items")}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </InputGroup>
                    <SelectField
                      aria-label={t("Filter work status")}
                      value={statusFilter}
                      onValueChange={setStatusFilter}
                    >
                      <SelectOption value="">
                        {t("All work statuses")}
                      </SelectOption>
                      {workStatuses.map((status) => (
                        <SelectOption key={status} value={status}>
                          {workStatus(status)}
                        </SelectOption>
                      ))}
                    </SelectField>
                    <SelectField
                      aria-label={t("Group work items by")}
                      value={groupBy}
                      onValueChange={setGroupBy}
                    >
                      <SelectOption value="none">
                        {t("No grouping")}
                      </SelectOption>
                      <SelectOption value="status">
                        {t("Work status")}
                      </SelectOption>
                      <SelectOption value="project">
                        {t("Project")}
                      </SelectOption>
                      <SelectOption value="priority">
                        {t("Work priority")}
                      </SelectOption>
                      <SelectOption value="date">{t("Work date")}</SelectOption>
                    </SelectField>
                  </>
                )}
                {projectSelection}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Manage work projects")}
                      disabled={loading || busy}
                      onClick={() => setProjectsOpen(true)}
                    >
                      <Settings2 />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Manage work projects")}</TooltipContent>
                </Tooltip>
                {view === "calendar" && (
                  <ToggleGroup
                    type="single"
                    value={calendarMode}
                    aria-label={t("Calendar view")}
                    onValueChange={(value) => {
                      if (value) {
                        if (
                          (calendarMode === "month" ||
                            calendarMode === "year") &&
                          workDate(month).slice(0, 7) !== date.slice(0, 7)
                        )
                          setSelected(startOfMonth(month));
                        if (value === "month" || value === "year")
                          setMonth(selected);
                        setCalendarMode(value as CalendarMode);
                      }
                    }}
                  >
                    <ToggleGroupItem value="year">
                      {t("Year view")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="month">
                      {t("Month view")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="week">
                      {t("Week view")}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="day">
                      {t("Day view")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
                {view === "items" && (
                  <ToggleGroup
                    type="single"
                    value={layout}
                    aria-label={t("Work item layout")}
                    onValueChange={(value) => {
                      if (value) setLayout(value);
                    }}
                  >
                    <ToggleGroupItem value="table" aria-label={t("Work table")}>
                      <LayoutList />
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="board"
                      aria-label={t("Status board")}
                    >
                      <Columns3 />
                    </ToggleGroupItem>
                  </ToggleGroup>
                )}
              </div>
            </div>
          )}
          <TabsContent
            value="calendar"
            className="wb-content wb-calendar-content"
          >
            <div className="workbench-calendar-layout">
              <Card
                className={`workbench-calendar-card${
                  calendarMode === "month"
                    ? " workbench-calendar-card-current-month"
                    : ""
                }`}
              >
                <CardContent className="wb-calendar-main">
                  {calendarMode === "year" ? (
                    <ScrollArea className="wb-year-scroll">
                      <div className="wb-year-grid">
                        {Array.from({ length: 12 }, (_, index) => {
                          const first = new Date(month);
                          first.setFullYear(month.getFullYear(), index, 1);
                          return (
                            <Calendar
                              key={index}
                              className="wb-year-calendar"
                              classNames={{ today: "wb-year-today" }}
                              data-current-month={
                                (first.getFullYear() === today.getFullYear() &&
                                  index === today.getMonth()) ||
                                undefined
                              }
                              locale={calendarLocale()}
                              mode="single"
                              weekStartsOn={1}
                              fixedWeeks
                              showOutsideDays={false}
                              month={first}
                              selected={selected}
                              hideNavigation
                              modifiers={{
                                hasWork: (day) =>
                                  visible.some((item) =>
                                    isWorkItemOnDate(item, workDate(day)),
                                  ),
                              }}
                              modifiersClassNames={{
                                hasWork: "wb-year-has-work",
                              }}
                              onSelect={(day) => {
                                if (day) {
                                  setSelected(day);
                                  setMonth(day);
                                  setCalendarMode("month");
                                }
                              }}
                            />
                          );
                        })}
                      </div>
                    </ScrollArea>
                  ) : calendarMode === "month" ? (
                    <Calendar
                      className="workbench-calendar"
                      hideNavigation
                      showOutsideDays
                      locale={calendarLocale()}
                      weekStartsOn={1}
                      fixedWeeks
                      month={month}
                      onMonthChange={setMonth}
                      mode="single"
                      selected={selected}
                      onSelect={(day) => {
                        if (!day) return;
                        setSelected(day);
                        if (
                          day.getFullYear() !== month.getFullYear() ||
                          day.getMonth() !== month.getMonth()
                        ) {
                          setMonth(startOfMonth(day));
                        }
                      }}
                      components={calendarComponents}
                    />
                  ) : (
                    <WorkbenchTimeline
                      mode={calendarMode}
                      selected={selected}
                      items={visible}
                      disabled={loading || busy}
                      onSelect={setSelected}
                      onOpen={setEditing}
                      onDelete={remove}
                      projectTone={projectTone}
                      onAdd={(day, time) =>
                        setEditing({
                          ...newWorkItem(day),
                          time,
                          project: activeProject?.name || "",
                        })
                      }
                    />
                  )}
                </CardContent>
              </Card>
              <Card className="wb-agenda">
                <CardHeader>
                  <p>
                    {selected.toLocaleDateString(dateLocale(), {
                      weekday: "long",
                    })}
                  </p>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      {selected.toLocaleDateString(dateLocale(), {
                        month: "long",
                        day: "numeric",
                      })}
                    </CardTitle>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={t("Copy daily work records")}
                            disabled={loading || busy || !daily.length}
                            onClick={() => void copyDailyWorkItems()}
                          >
                            <Copy />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("Copy daily work records")}
                        </TooltipContent>
                      </Tooltip>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t("Add work record")}
                        disabled={loading || busy}
                        onClick={() =>
                          setEditing({
                            ...newWorkItem(date),
                            project: activeProject?.name || "",
                          })
                        }
                      >
                        <Plus />
                      </Button>
                    </div>
                  </div>
                  <p>
                    {t("{value0} of {value1} work items completed", {
                      value0: totals(daily).done,
                      value1: daily.length,
                    })}
                  </p>
                </CardHeader>
                <CardContent className="wb-agenda-body">
                  <form
                    className="wb-quick"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save(
                        {
                          ...newWorkItem(date),
                          title: quick,
                          project: activeProject?.name || "",
                        },
                        () => setQuick(""),
                      );
                    }}
                  >
                    <InputGroup>
                      <InputGroupAddon>
                        <Plus />
                      </InputGroupAddon>
                      <InputGroupInput
                        aria-label={t("Quick add work item")}
                        placeholder={t("Quick add work item")}
                        maxLength={200}
                        value={quick}
                        disabled={loading || busy}
                        onChange={(event) => setQuick(event.target.value)}
                      />
                    </InputGroup>
                  </form>
                  <ScrollArea className="wb-agenda-scroll">
                    <div className="wb-agenda-entries">
                      {daily
                        .filter((item) => item.status !== "done")
                        .map((item) => (
                          <div className="wb-agenda-entry" key={item.id}>
                            <div className="wb-agenda-meta">
                              <span>
                                {item.date === date
                                  ? item.time || t("All day")
                                  : t("Continued")}
                              </span>
                              <StatusLabel status={item.status} />
                            </div>
                            {taskRow(item)}
                            {item.mailId && (
                              <Button
                                className="wb-mail-link"
                                variant="ghost"
                                size="sm"
                                onClick={() => openMail(item.mailId)}
                              >
                                <Mail />
                                {t("Open linked email")}
                              </Button>
                            )}
                          </div>
                        ))}
                      {daily.some((item) => item.status === "done") && (
                        <div className="wb-done-group">
                          <p className="text-xs text-muted-foreground">
                            <Check />
                            {t("Completed")} · {totals(daily).done}
                          </p>
                          {daily
                            .filter((item) => item.status === "done")
                            .map((item) => taskRow(item))}
                        </div>
                      )}
                      {!daily.length &&
                        (loading ? (
                          <p className="wb-empty">{t("Loading…")}</p>
                        ) : (
                          <Empty className="wb-agenda-empty">
                            <EmptyHeader>
                              <EmptyMedia>
                                <CalendarDays aria-hidden="true" />
                              </EmptyMedia>
                              <EmptyTitle>
                                {t("No work items for this day.")}
                              </EmptyTitle>
                              <EmptyDescription>
                                {t(
                                  "Type above and press Enter to add a work item.",
                                )}
                              </EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="items" className="wb-content">
            <ScrollArea className="wb-view-scroll">
              {layout === "table" ? (
                <Card className="wb-items-card">
                  <CardContent>
                    {groupBy === "none" ? (
                      renderTable(visible)
                    ) : (
                      <div className="flex flex-col gap-4">
                        {Array.from(groups, ([label, entries]) => (
                          <Collapsible key={label} defaultOpen>
                            <CollapsibleTrigger asChild>
                              <Button
                                variant="ghost"
                                className="mb-2 justify-start"
                              >
                                <ChevronDown />
                                {label} · {entries.length}
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              {renderTable(entries)}
                            </CollapsibleContent>
                          </Collapsible>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : groupBy === "none" || !groups.size ? (
                renderBoard(visible)
              ) : (
                <div className="wb-board-groups">
                  {Array.from(groups, ([label, entries]) => (
                    <Collapsible
                      className="wb-board-group"
                      key={label}
                      defaultOpen
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          className="wb-board-group-trigger"
                        >
                          <ChevronDown />
                          <span>{label}</span>
                          <Badge variant="secondary">{entries.length}</Badge>
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {renderBoard(entries, label)}
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
          <TabsContent value="quadrants" className="wb-content">
            <ScrollArea className="wb-view-scroll wb-quadrants-scroll">
              <div className="workbench-matrix">
                <div className="workbench-matrix-plane">
                  <span
                    className="wb-matrix-axis-line wb-matrix-axis-line-y"
                    aria-hidden="true"
                  />
                  <span
                    className="wb-matrix-axis-line wb-matrix-axis-line-x"
                    aria-hidden="true"
                  />
                  <span className="wb-matrix-axis-label wb-matrix-axis-label-y">
                    {t("Importance axis")}
                  </span>
                  <span className="wb-matrix-axis-label wb-matrix-axis-label-x">
                    {t("Urgency axis")}
                  </span>
                  <div className="workbench-matrix-grid">
                    {workQuadrants.map(
                      ({ important, urgent, label }, index) => {
                        const entries = activeDaily.filter(
                          (item) =>
                            !!item.important === important &&
                            !!item.urgent === urgent,
                        );
                        return (
                          <section
                            className="wb-matrix-quadrant"
                            data-quadrant={index}
                            data-drop-target={
                              dropTarget?.dataset.quadrant === String(index) ||
                              undefined
                            }
                            key={index}
                            aria-label={label()}
                          >
                            <header className="wb-matrix-quadrant-header">
                              <div className="wb-matrix-quadrant-title">
                                <span className="wb-quadrant-dot" />
                                <span className="wb-quadrant-code">
                                  Q{index + 1}
                                </span>
                                <span>{label()}</span>
                                <Badge variant="secondary" className="wb-count">
                                  {entries.length}
                                </Badge>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={t("Add work record in {value0}", {
                                  value0: label(),
                                })}
                                disabled={loading || busy}
                                onClick={() =>
                                  setEditing({
                                    ...newWorkItem(date),
                                    important,
                                    urgent,
                                    project: activeProject?.name || "",
                                  })
                                }
                              >
                                <Plus />
                              </Button>
                            </header>
                            <ScrollArea className="wb-matrix-quadrant-scroll">
                              <div className="wb-matrix-quadrant-items">
                                {entries.map((item) => taskRow(item, true))}
                                {!entries.length && (
                                  <p className="wb-matrix-empty">
                                    {t(
                                      "Drag work anywhere in this area or add a new item.",
                                    )}
                                  </p>
                                )}
                              </div>
                            </ScrollArea>
                          </section>
                        );
                      },
                    )}
                    <span className="wb-matrix-origin" aria-hidden="true" />
                  </div>
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
          <TabsContent value="report" className="wb-content wb-report-content">
            <WorkReport
              items={visible}
              writeMail={writeMail}
              from={reportFrom}
              to={reportTo}
              setFrom={setReportFrom}
              setTo={setReportTo}
              projectSelection={projectSelection}
            />
          </TabsContent>
        </Tabs>
        {dragGhost && (
          <div
            className="wb-matrix-drag-ghost"
            style={{
              width: dragGhost.width,
              transform: `translate3d(${dragGhost.x}px, ${dragGhost.y}px, 0)`,
            }}
            aria-hidden="true"
          >
            <span />
            {dragGhost.title}
          </div>
        )}
        {editing && (
          <WorkEditor
            key={editing.id}
            item={editing}
            setItem={setEditing}
            projects={projects}
            manageProjects={() => setProjectsOpen(true)}
            error={error}
            busy={busy}
            close={() => setEditing(undefined)}
            save={() => void save(editing, () => setEditing(undefined))}
            remove={() => void remove(editing)}
            openMail={openMail}
          />
        )}
        <WorkbenchProjects
          open={projectsOpen}
          onOpenChange={setProjectsOpen}
          projects={projects}
          items={items}
          busy={busy}
          save={saveProject}
          remove={(project) => void removeProject(project)}
        />
        {confirmationDialog}
      </div>
    </TooltipProvider>
  );
}
