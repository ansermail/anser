import { useRef } from "react";
import { ArrowUp, Square } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

export function PromptInput({
  value,
  onChange,
  onSubmit,
  onStop,
  onEscape,
  busy = false,
  disabled = false,
  hasActiveSuggestion = false,
  placeholder,
  sendLabel,
  stopLabel,
  maxLength = 1000,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onStop: () => void;
  onEscape?: () => void;
  busy?: boolean;
  disabled?: boolean;
  hasActiveSuggestion?: boolean;
  placeholder: string;
  sendLabel: string;
  stopLabel: string;
  maxLength?: number;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function triggerSubmit() {
    const trimmed = value.trim();
    if (!trimmed || busy || disabled) return;
    onChange("");
    onSubmit(trimmed);
  }

  return (
    <div data-slot="ai-prompt-input">
      <InputGroup>
        <InputGroupTextarea
          ref={textareaRef}
          autoFocus
          value={value}
          disabled={disabled}
          maxLength={maxLength}
          placeholder={placeholder}
          aria-label={placeholder}
          rows={2}
          className="max-h-24 min-h-12 overflow-y-auto"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            const composing =
              event.nativeEvent.isComposing || event.keyCode === 229;
            if (composing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onEscape?.();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              triggerSubmit();
            }
          }}
        />
        <InputGroupAddon align="inline-end" className="self-end">
          {busy ? (
            <InputGroupButton
              type="button"
              size="icon-sm"
              aria-label={stopLabel}
              title={stopLabel}
              onClick={onStop}
            >
              <Square />
            </InputGroupButton>
          ) : (
            <InputGroupButton
              type="button"
              size="icon-sm"
              variant={hasActiveSuggestion ? "secondary" : "default"}
              disabled={disabled || !value.trim()}
              aria-label={sendLabel}
              title={sendLabel}
              onClick={triggerSubmit}
            >
              <ArrowUp />
            </InputGroupButton>
          )}
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
