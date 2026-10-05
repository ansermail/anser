import { useCommandAria } from "@/hooks/use-command-aria";
import { useState } from "react";
import { Command, CommandItem, CommandList } from "./ui/command";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
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
  const aria = useCommandAria(
    open && options.length > 0,
    active,
    value,
    options.length,
  );
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
    <Popover open={open && options.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
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
            aria-controls={aria.controls}
            aria-activedescendant={aria.activeDescendant}
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
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-72 p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement).id === id) e.preventDefault();
        }}
      >
        <Command
          label="收件人建议"
          shouldFilter={false}
          value={options[Math.min(active, options.length - 1)]?.email}
          onValueChange={(email) => {
            const index = options.findIndex((a) => a.email === email);
            if (index >= 0) setActive(index);
          }}
        >
          <CommandList ref={aria.listRef}>
            {options.map((a, i) => (
              <CommandItem
                key={a.email}
                value={a.email}
                ref={(element) => aria.itemRef(i, element)}
                className="flex-col items-start gap-0.5"
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => choose(a)}
              >
                <strong>{a.name || a.email}</strong>
                <small className="text-muted-foreground">{a.email}</small>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
