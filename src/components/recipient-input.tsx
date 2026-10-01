import { useState } from "react";
import { Input } from "./ui/input";
import { addressTokens, formatAddress, parseAddresses } from "@/lib/addresses";
import type { Address } from "@/lib/types";

export function RecipientInput({
  id,
  value,
  onChange,
  suggestions,
  autoFocus = false,
}: {
  id: string;
  value: string;
  onChange: (s: string) => void;
  suggestions: Address[];
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const tokens = addressTokens(value);
  const term = (tokens.at(-1) || "").toLowerCase();
  const used = new Set(
    parseAddresses(tokens.slice(0, -1).join(",")).map((a) =>
      a.email.toLowerCase(),
    ),
  );
  const options = term
    ? suggestions
        .filter(
          (a) =>
            !used.has(a.email.toLowerCase()) &&
            `${a.name} ${a.email}`.toLowerCase().includes(term),
        )
        .slice(0, 6)
    : [];
  function choose(address: Address) {
    onChange(
      [...tokens.slice(0, -1).filter(Boolean), formatAddress(address)].join(
        ", ",
      ) + ", ",
    );
    setOpen(false);
    setActive(0);
  }
  return (
    <div className="recipient-input">
      <Input
        id={id}
        autoFocus={autoFocus}
        value={value}
        autoComplete="off"
        placeholder="多个地址用逗号分隔"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && options.length > 0}
        aria-controls={`${id}-suggestions`}
        aria-activedescendant={
          open && options.length
            ? `${id}-option-${Math.min(active, options.length - 1)}`
            : undefined
        }
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!open || !options.length) return;
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setActive(
              (i) =>
                (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                options.length,
            );
          }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            choose(options[Math.min(active, options.length - 1)]);
          }
        }}
      />
      {open && options.length > 0 && (
        <div
          className="recipient-suggestions"
          role="listbox"
          id={`${id}-suggestions`}
        >
          {options.map((a, i) => (
            <button
              key={a.email}
              type="button"
              role="option"
              id={`${id}-option-${i}`}
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(a)}
            >
              <strong>{a.name || a.email}</strong>
              <small>{a.email}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
