import { dateLocale, calendarLocale, t } from "@/lib/i18n";
import { useId, useState } from "react";
import { CalendarIcon, Clock } from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { SelectField, SelectOption } from "./ui/select-field";
import { localDateTime } from "@/lib/schedule-time";

const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);

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
  const parsed = new Date(value);
  const date = Number.isFinite(parsed.getTime()) ? parsed : undefined;
  const [hour = "09", minute = "00"] = value.split("T")[1]?.split(":") ?? [];
  function changeTime(nextHour: string, nextMinute: string) {
    const day = value.split("T")[0] || localDateTime().split("T")[0];
    onChange(`${day}T${nextHour}:${nextMinute}`);
  }
  const today = new Date();
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
                  `${localDateTime(day).split("T")[0]}T${hour}:${minute}`,
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
          <SelectField
            id={`${id}-hour`}
            aria-label={t("Send hour")}
            value={hour}
            onValueChange={(hour) => changeTime(hour, minute)}
            disabled={busy}
            className="h-8 w-[72px]"
          >
            {hours.map((hour) => (
              <SelectOption key={hour} value={hour}>
                {hour}
              </SelectOption>
            ))}
          </SelectField>
          <span aria-hidden="true">:</span>
          <SelectField
            aria-label={t("Send minute")}
            value={minute}
            onValueChange={(minute) => changeTime(hour, minute)}
            disabled={busy}
            className="h-8 w-[72px]"
          >
            {minutes.map((minute) => (
              <SelectOption key={minute} value={minute}>
                {minute}
              </SelectOption>
            ))}
          </SelectField>
        </div>
        <span>{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
        <Button
          size="sm"
          disabled={busy || !date}
          onClick={() => onConfirm(value)}
        >
          {busy ? t("Saving…") : t("Confirm scheduled send")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
      <p>
        {t(
          "Scheduled on this Mac: Anser must be running and the Mac awake. Reschedule if missed by more than 5 minutes.",
        )}
      </p>
    </div>
  );
}
