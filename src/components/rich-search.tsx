import { t } from "@/lib/i18n";
import { useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { Search, ChevronUp, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip";

export function RichSearch({
  editor,
  disabled,
  open,
  onOpenChange,
}: {
  editor: Editor;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const s = editor.storage.findAndReplace;
      return {
        searchTerm: s?.searchTerm ?? "",
        replaceTerm: s?.replaceTerm ?? "",
        caseSensitive: s?.caseSensitive ?? false,
        wholeWord: s?.wholeWord ?? false,
        useRegex: s?.useRegex ?? false,
        ready: !!s,
        count: s?.results.length ?? 0,
        current: s?.currentIndex == null ? 0 : s.currentIndex + 1,
      };
    },
  });
  useEffect(
    () => () => {
      if (!editor.isDestroyed && editor.commands.clearSearch)
        editor.commands.clearSearch();
    },
    [editor],
  );
  disabled = disabled || !state.ready;
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) editor.commands.clearSearch();
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Find & replace in body")}
              disabled={disabled}
            >
              <Search data-icon="inline-start" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("Find & replace in body · ⌘F")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        className="rich-search-panel w-64 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3"
        align="end"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        <FieldGroup className="gap-2.5">
          <Field className="gap-1">
            <FieldLabel htmlFor="rich-search-text">
              {t("Find in body")}
            </FieldLabel>
            <Input
              id="rich-search-text"
              autoFocus
              value={state.searchTerm}
              disabled={disabled}
              onChange={(event) =>
                editor.commands.setSearchTerm(event.target.value)
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.shiftKey) editor.commands.goToPreviousResult();
                  else editor.commands.goToNextResult();
                }
              }}
            />
          </Field>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {state.current} / {state.count}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Previous match")}
              disabled={disabled || !state.count}
              onClick={() => editor.commands.goToPreviousResult()}
            >
              <ChevronUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Next match")}
              disabled={disabled || !state.count}
              onClick={() => editor.commands.goToNextResult()}
            >
              <ChevronDown />
            </Button>
          </div>
          <Field className="gap-1">
            <FieldLabel htmlFor="rich-replace-text">
              {t("Replace with")}
            </FieldLabel>
            <Input
              id="rich-replace-text"
              value={state.replaceTerm}
              disabled={disabled}
              onChange={(event) =>
                editor.commands.setReplaceTerm(event.target.value)
              }
            />
          </Field>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || !state.count}
              onClick={() => editor.commands.replace()}
            >
              {t("Replace current")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || !state.count}
              onClick={() => editor.commands.replaceAll()}
            >
              {t("Replace all")}
            </Button>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            {[
              {
                label: t("Match case"),
                key: "caseSensitive" as const,
                run: (v: boolean) => editor.commands.setCaseSensitive(v),
              },
              {
                label: t("Whole word"),
                key: "wholeWord" as const,
                run: (v: boolean) => editor.commands.setWholeWord(v),
              },
              {
                label: t("Regular expression"),
                key: "useRegex" as const,
                run: (v: boolean) => editor.commands.setUseRegex(v),
              },
            ].map((option) => (
              <Field
                orientation="horizontal"
                className="w-auto gap-1.5"
                key={option.key}
              >
                <Checkbox
                  id={`rich-search-${option.key}`}
                  checked={state[option.key]}
                  disabled={
                    disabled || (option.key === "wholeWord" && state.useRegex)
                  }
                  onCheckedChange={(v) => option.run(v === true)}
                />
                <FieldLabel htmlFor={`rich-search-${option.key}`}>
                  {option.label}
                </FieldLabel>
              </Field>
            ))}
          </div>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
