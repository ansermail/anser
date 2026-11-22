import { dateLocale, calendarLocale, t } from "@/lib/i18n";
import { useEffect, useId, useState } from "react";
import { CalendarIcon, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./ui/input-group";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  isScheduledTimeInFuture,
  localDateTime,
  nextScheduledMinute,
  normalizeScheduledTime,
} from "@/lib/schedule-time";

const padTime = (value: number) => String(value).padStart(2, "0");

function ScheduleTimeField({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit(next = draft) {
    if (!/^\d{1,2}$/.test(next)) {
      setDraft(value);
      return;
    }
    const number = Number(next);
    if (number < min || number > max) {
      setDraft(value);
      return;
    }
    const padded = padTime(number);
    setDraft(padded);
    onChange(padded);
  }

  function step(delta: number) {
    const current = Number(draft);
    const base = Number.isFinite(current) ? current : Number(value);
    const next = Math.min(max, Math.max(min, base + delta));
    commit(padTime(next));
  }

  return (
    <InputGroup className="schedule-time-input">
      <InputGroupInput
        id={id}
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(draft)}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        disabled={disabled}
        value={draft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const next = event.currentTarget.value.replace(/\D/g, "").slice(0, 2);
          setDraft(next);
          if (next.length === 2 && Number(next) >= min && Number(next) <= max) {
            onChange(next);
          }
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            step(event.key === "ArrowUp" ? 1 : -1);
          }
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        onWheel={(event) => {
          if (document.activeElement !== event.currentTarget) return;
          event.preventDefault();
          step(event.deltaY < 0 ? 1 : -1);
        }}
      />
      <InputGroupAddon align="inline-end" className="schedule-time-stepper">
        <InputGroupButton
          size="icon-xs"
          tabIndex={-1}
          className="schedule-time-step"
          aria-label={t("Increase value")}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => step(1)}
        >
          <ChevronUp />
        </InputGroupButton>
        <InputGroupButton
          size="icon-xs"
          tabIndex={-1}
          className="schedule-time-step"
          aria-label={t("Decrease value")}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => step(-1)}
        >
          <ChevronDown />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

export function SchedulePicker({
  value,
  onChange,
  onConfirm,
  onCancel,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const parsed = new Date(value);
  const date = Number.isFinite(parsed.getTime()) ? parsed : undefined;
  const future = isScheduledTimeInFuture(value, now);
  const [hour = "09", minute = "00"] = value.split("T")[1]?.split(":") ?? [];
  const selectedDay = value.split("T")[0];
  const earliest = nextScheduledMinute(new Date(now));
  const earliestDay = earliest.split("T")[0];
  const earliestHour = Number(earliest.split("T")[1].slice(0, 2));
  const earliestMinute = Number(earliest.split("T")[1].slice(3, 5));
  const hourMin =
    selectedDay === earliestDay
      ? earliestHour
      : selectedDay > earliestDay
        ? 0
        : 23;
  const minuteMin =
    selectedDay === earliestDay && Number(hour) === earliestHour
      ? earliestMinute
      : 0;
  useEffect(() => {
    if (!date || future) return;
    onChange(normalizeScheduledTime(value, now));
  }, [date, future, now, onChange, value]);
  function changeTime(nextHour: string, nextMinute: string) {
    const day = value.split("T")[0] || localDateTime().split("T")[0];
    onChange(normalizeScheduledTime(`${day}T${nextHour}:${nextMinute}`, now));
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return (
    <div className="schedule-picker">
      <div className="schedule-controls">
        <Label htmlFor={`${id}-date`}>{t("Send date")}</Label>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              id={`${id}-date`}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t("Choose send date")}
            >
              <CalendarIcon />
              {date
                ? date.toLocaleDateString(dateLocale(), {
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  })
                : t("Choose date")}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              locale={calendarLocale()}
              selected={date}
              defaultMonth={date}
              disabled={[{ before: today }, ...(busy ? [() => true] : [])]}
              onSelect={(day) => {
                if (!day) return;
                onChange(
                  normalizeScheduledTime(
                    `${localDateTime(day).split("T")[0]}T${hour}:${minute}`,
                    now,
                  ),
                );
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
        <Label
          htmlFor={`${id}-hour`}
          className="inline-flex items-center gap-1"
        >
          <Clock className="size-3.5" />
          {t("Time")}
        </Label>
        <div className="flex items-center gap-1">
          <ScheduleTimeField
            id={`${id}-hour`}
            label={t("Send hour")}
            value={hour}
            min={hourMin}
            max={23}
            disabled={busy}
            onChange={(hour) => changeTime(hour, minute)}
          />
          <span aria-hidden="true">:</span>
          <ScheduleTimeField
            id={`${id}-minute`}
            label={t("Send minute")}
            value={minute}
            min={minuteMin}
            max={59}
            disabled={busy}
            onChange={(minute) => changeTime(hour, minute)}
          />
        </div>
        <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        <Button
          size="sm"
          disabled={busy || !future}
          onClick={() => future && onConfirm(value)}
        >
          {busy ? t("Saving…") : t("Confirm scheduled send")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
      <p>
        {t(
          "Scheduled on this computer: Anser must be running and the computer awake. Reschedule if missed by more than 5 minutes.",
        )}
      </p>
    </div>
  );
}
