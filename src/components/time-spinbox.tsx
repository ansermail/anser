import { t } from "@/lib/i18n";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./ui/input-group";

const padTime = (value: number) => String(value).padStart(2, "0");

export function TimeSpinbox({
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
  const input = useRef<HTMLInputElement>(null);

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
    const base = draft ? current : Number(value);
    const next = Math.min(max, Math.max(min, base + delta));
    commit(padTime(next));
  }

  const stepWithWheel = useEffectEvent((event: WheelEvent) => {
    if (disabled || document.activeElement !== input.current || !event.deltaY)
      return;
    event.preventDefault();
    step(event.deltaY < 0 ? 1 : -1);
  });

  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => stepWithWheel(event);
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <InputGroup className="schedule-time-input">
      <InputGroupInput
        ref={input}
        id={id}
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value)}
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
            event.currentTarget.blur();
          }
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
