import type { ComponentProps, ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Shimmer } from "./shimmer";

export function ChainOfThought({
  className,
  ...props
}: ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible
      data-slot="ai-chain-of-thought"
      className={cn("w-full", className)}
      {...props}
    />
  );
}

export function ChainOfThoughtHeader({
  active = false,
  className,
  children,
}: {
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CollapsibleTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-slot="ai-chain-of-thought-header"
        className={cn(
          "group h-7 max-w-full justify-start gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        {active ? (
          <LoaderCircle
            className="size-3.5 shrink-0 animate-spin text-primary"
            aria-hidden
          />
        ) : (
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="truncate tabular-nums">
          {active ? <Shimmer>{children}</Shimmer> : children}
        </span>
        <ChevronDown
          className="size-3.5 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-180"
          aria-hidden
        />
      </Button>
    </CollapsibleTrigger>
  );
}

export function ChainOfThoughtContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="ai-chain-of-thought-content"
      className={cn("mt-1 flex flex-col gap-2 pl-2", className)}
      {...props}
    >
      {children}
    </CollapsibleContent>
  );
}

export function ChainOfThoughtStep({
  status = "complete",
  label,
  description,
  icon,
  className,
  children,
}: {
  status?: "complete" | "active" | "pending";
  label: string;
  description?: string;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      data-slot="ai-chain-of-thought-step"
      data-status={status}
      className={cn("relative flex items-start gap-2 text-xs", className)}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          status === "complete" &&
            "bg-secondary text-[var(--item-selected-foreground)]",
          status === "active" && "text-primary",
          status === "pending" && "text-muted-foreground/60",
        )}
        aria-hidden
      >
        {icon ??
          (status === "active" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : status === "complete" ? (
            <Check className="size-3" />
          ) : (
            <Circle className="size-2.5" />
          ))}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "leading-snug",
            status === "pending"
              ? "text-muted-foreground"
              : "font-medium text-foreground",
          )}
        >
          {status === "active" ? <Shimmer>{label}</Shimmer> : label}
        </span>
        {description && (
          <span className="text-[11px] leading-relaxed text-muted-foreground text-pretty tabular-nums">
            {description}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}
