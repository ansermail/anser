import { calendarLocale, t } from "@/lib/i18n";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export function mailDateBounds(range: DateRange | undefined) {
  if (!range?.from) return { dateFrom: undefined, dateBefore: undefined };
  const from = new Date(range.from),
    before = new Date(range.to || range.from);
  from.setHours(0, 0, 0, 0);
  before.setHours(0, 0, 0, 0);
  before.setDate(before.getDate() + 1);
  return { dateFrom: from.toISOString(), dateBefore: before.toISOString() };
}
function selectedRange(from?: string, before?: string): DateRange | undefined {
  if (!from) return undefined;
  const to = before ? new Date(before) : new Date(from);
  if (before) to.setDate(to.getDate() - 1);
  return { from: new Date(from), to };
}
export function MailDateFilter({
  id,
  placeholder = t("时间范围"),
  dateFrom,
  dateBefore,
  onChange,
}: {
  id?: string;
  placeholder?: string;
  dateFrom?: string;
  dateBefore?: string;
  onChange: (range: { dateFrom?: string; dateBefore?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(() =>
    selectedRange(dateFrom, dateBefore),
  );
  const current = selectedRange(dateFrom, dateBefore);
  const dateFormat =
    calendarLocale().code === "en-US" ? "MMM d, yyyy" : "yyyy/MM/dd";
  const fromLabel = current?.from
    ? format(current.from, dateFormat, { locale: calendarLocale() })
    : "";
  const toLabel = current?.from
    ? format(current.to || current.from, dateFormat, {
        locale: calendarLocale(),
      })
    : "";
  const label = fromLabel
    ? fromLabel === toLabel
      ? fromLabel
      : `${fromLabel} — ${toLabel}`
    : placeholder;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setRange(selectedRange(dateFrom, dateBefore));
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant={dateFrom ? "secondary" : "outline"}
          size="sm"
          aria-label={t("按时间筛选邮件")}
          title={label}
        >
          <CalendarDays data-icon="inline-start" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
        aria-label={t("邮件时间范围")}
      >
        <FieldGroup>
          <Field>
            <FieldLabel>{t("邮件时间范围")}</FieldLabel>
            <FieldDescription>
              {t("包含起止日期，使用本机时区；时间未知的邮件不参与时间筛选。")}
            </FieldDescription>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setRange(undefined)}
            >
              {t("重新选择")}
            </Button>
            <Calendar
              mode="range"
              selected={range}
              onSelect={setRange}
              locale={calendarLocale()}
              captionLayout="dropdown"
              startMonth={new Date(1900, 0)}
              endMonth={new Date(2100, 11)}
              defaultMonth={range?.from}
              autoFocus
            />
          </Field>
          <div className="flex items-center justify-between gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onChange({ dateFrom: undefined, dateBefore: undefined });
                setOpen(false);
              }}
            >
              {t("不限时间")}
            </Button>
            <Button
              disabled={!range?.from}
              onClick={() => {
                onChange(mailDateBounds(range));
                setOpen(false);
              }}
            >
              {t("应用筛选")}
            </Button>
          </div>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
