import { useEffect, useState, type ComponentProps } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Shimmer } from "./shimmer";

export function Reasoning({
  isStreaming = false,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  className,
  ...props
}: ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  useEffect(() => {
    if (controlledOpen !== undefined) return;
    if (isStreaming) setUncontrolledOpen(true);
  }, [isStreaming, controlledOpen]);

  return (
    <Collapsible
      data-slot="ai-reasoning"
      open={open}
      onOpenChange={setOpen}
      className={cn("w-full", className)}
      {...props}
    />
  );
}

export function ReasoningTrigger({
  isStreaming = false,
  title,
  streamingTitle,
  className,
}: {
  isStreaming?: boolean;
  title: string;
  streamingTitle?: string;
  className?: string;
}) {
  return (
    <CollapsibleTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-slot="ai-reasoning-trigger"
        className={cn(
          "group h-7 max-w-full justify-start gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        <Brain className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate tabular-nums">
          {isStreaming ? <Shimmer>{streamingTitle ?? title}</Shimmer> : title}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </Button>
    </CollapsibleTrigger>
  );
}

export function ReasoningContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="ai-reasoning-content"
      className={cn(
        "mt-1 rounded-md bg-secondary/55 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground break-words whitespace-pre-wrap select-text",
        className,
      )}
      {...props}
    >
      {children}
    </CollapsibleContent>
  );
}
