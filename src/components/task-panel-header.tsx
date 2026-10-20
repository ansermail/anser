import { t } from "@/lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { CardHeader } from "./ui/card";
import { CollapsibleTrigger } from "./ui/collapsible";

export function TaskPanelHeader({
  title,
  description,
  onRefresh,
}: {
  title: string;
  description: ReactNode;
  onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const pending = useRef(false);
  const live = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setRefreshing(true);
    const started = performance.now();
    try {
      await onRefresh();
    } catch (error) {
      if (live.current) toast.error(String(error));
    } finally {
      // Keep even a fast local read visible; never delay publishing fresh data.
      if (live.current) {
        timer.current = setTimeout(
          () => {
            pending.current = false;
            setRefreshing(false);
          },
          Math.max(0, 600 - (performance.now() - started)),
        );
      }
    }
  }

  return (
    <CardHeader className="flex flex-row items-start gap-2 px-4">
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          aria-label={t("Expand or collapse {value0}", { value0: title })}
          className="group h-auto min-w-0 flex-1 items-start justify-start gap-4 px-2 py-1 text-left whitespace-normal"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="font-semibold">{title}</span>
            <span className="text-sm leading-relaxed font-normal text-muted-foreground">
              {description}
            </span>
          </span>
          <ChevronDown className="mt-0.5 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
        </Button>
      </CollapsibleTrigger>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("Refresh {value0}", { value0: title })}
        aria-busy={refreshing}
        disabled={refreshing}
        onClick={() => void refresh()}
      >
        <RefreshCw
          data-icon="inline-start"
          className={cn(
            refreshing && "animate-spin motion-reduce:animate-none",
          )}
        />
        <span aria-live="polite">
          {refreshing ? t("Refreshing") : t("Refresh")}
        </span>
      </Button>
    </CardHeader>
  );
}
