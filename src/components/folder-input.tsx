import { useCommandAria } from "@/hooks/use-command-aria";
import { useId, useState } from "react";
import { Folder } from "lucide-react";
import { Command, CommandItem, CommandList } from "./ui/command";
import { Input } from "./ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

export function FolderInput({
  value,
  onChange,
  folders,
}: {
  value: string;
  onChange: (value: string) => void;
  folders: string[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const options = folders.filter((folder) =>
    folder.toLowerCase().includes(value.toLowerCase()),
  );
  const aria = useCommandAria(
    open && options.length > 0,
    active,
    value,
    options.length,
  );
  return (
    <Popover open={open && options.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          autoFocus
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-autocomplete="list"
          aria-controls={aria.controls}
          aria-activedescendant={aria.activeDescendant}
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
            if (e.key === "Enter") {
              e.preventDefault();
              onChange(options[Math.min(active, options.length - 1)]);
              setOpen(false);
            }
          }}
          aria-label="本地文件夹名称"
          placeholder="文件夹名称，例如：项目 / 设计"
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
        />
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
          label="已有本地文件夹"
          shouldFilter={false}
          value={options[Math.min(active, options.length - 1)]}
          onValueChange={(folder) => {
            const index = options.indexOf(folder);
            if (index >= 0) setActive(index);
          }}
        >
          <CommandList ref={aria.listRef}>
            {options.map((folder, i) => (
              <CommandItem
                ref={(element) => aria.itemRef(i, element)}
                key={folder}
                onMouseDown={(e) => e.preventDefault()}
                value={folder}
                onSelect={() => {
                  onChange(folder);
                  setOpen(false);
                }}
              >
                <Folder />
                {folder}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
