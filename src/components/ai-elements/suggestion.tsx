import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Suggestions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-suggestions"
      className={cn("flex flex-wrap gap-1", className)}
      {...props}
    />
  );
}

export function Suggestion({
  suggestion,
  onSelect,
  className,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "onSelect"> & {
  suggestion: string;
  onSelect: (suggestion: string) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      className={cn("h-7 px-2 text-xs", className)}
      onClick={() => onSelect(suggestion)}
      {...props}
    >
      {suggestion}
    </Button>
  );
}
