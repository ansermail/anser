import type { ComponentProps, ReactNode } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function Plan({
  defaultOpen = true,
  className,
  children,
  ...props
}: ComponentProps<typeof Collapsible> & { className?: string }) {
  return (
    <Collapsible defaultOpen={defaultOpen} asChild {...props}>
      <Card
        data-slot="ai-plan"
        className={cn(
          "gap-0 overflow-hidden rounded-xl border border-border bg-secondary/35 py-0 text-xs",
          className,
        )}
      >
        {children}
      </Card>
    </Collapsible>
  );
}

export function PlanHeader({
  title,
  badge,
  description,
  toggleLabel,
  className,
}: {
  title: string;
  badge?: string;
  description?: string;
  toggleLabel: string;
  className?: string;
}) {
  return (
    <CardHeader
      data-slot="ai-plan-header"
      className={cn(
        "flex flex-row items-center gap-2 space-y-0 px-3 pt-2.5 pb-1.5",
        className,
      )}
    >
      <ListChecks
        className="size-3.5 shrink-0 text-[var(--item-selected-foreground)]"
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-xs font-semibold leading-snug text-foreground">
            {title}
          </CardTitle>
          {badge && (
            <Badge
              variant="secondary"
              className="h-4 bg-card px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums"
            >
              {badge}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-[11px] leading-snug text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label={toggleLabel}
          className="group shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-180"
            aria-hidden
          />
        </Button>
      </CollapsibleTrigger>
    </CardHeader>
  );
}

export function PlanContent({
  className,
  children,
  ...props
}: ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent data-slot="ai-plan-content" {...props}>
      <CardContent
        className={cn(
          "flex max-h-48 flex-col gap-2 overflow-y-auto px-2.5 pt-0.5 pb-2",
          className,
        )}
      >
        {children}
      </CardContent>
    </CollapsibleContent>
  );
}

export function PlanStep({
  badge,
  preview,
  className,
}: {
  badge: string;
  preview: string;
  className?: string;
}) {
  return (
    <div
      data-slot="ai-plan-step"
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border/60 bg-card px-2.5 py-2",
        className,
      )}
    >
      <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
        {badge}
      </span>
      <p
        className="line-clamp-5 text-xs leading-relaxed text-foreground whitespace-pre-line break-words"
        title={preview}
      >
        {preview}
      </p>
    </div>
  );
}

export function PlanFooter({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <CardFooter
      data-slot="ai-plan-footer"
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 px-2.5 pt-0.5 pb-2.5",
        className,
      )}
    >
      {children}
    </CardFooter>
  );
}
