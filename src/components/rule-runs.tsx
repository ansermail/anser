import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { call } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "./ui/card";
export type RuleRun = {
  id: string;
  accountEmail: string;
  subject: string;
  step: string;
  cursor: number;
  total: number;
  applied: number;
  status: string;
  error: string;
  updatedAt: string;
};
const states: Record<string, string> = {
  get queued() {
    return t("Pending");
  },
  get running() {
    return t("Checking & processing");
  },
  get paused() {
    return t("Paused");
  },
  get blocked() {
    return t("Needs attention");
  },
  get completed() {
    return t("Step processed");
  },
  get cancelled() {
    return t("Canceled");
  },
};
export function RuleRunsPanel({ onShowTasks }: { onShowTasks: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RuleRun[] | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(false),
    reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let live = true;
    const update = coalesceRefresh(async () => {
      try {
        const rows = await call<RuleRun[]>("rule_runs");
        if (live) {
          setItems(rows);
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    });
    reload.current = update;
    void update();
    const timer = setInterval(() => void update(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function action(id: string, kind: string) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try {
      await call("rule_run_action", { id, action: kind });
      await reload.current();
    } catch (e) {
      setError(String(e));
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>
            {t("Rule processing tasks")}{" "}
            <Badge
              variant={
                items?.some((item) => item.status === "blocked")
                  ? "destructive"
                  : "secondary"
              }
            >
              {items?.filter(
                (item) => !["completed", "cancelled"].includes(item.status),
              ).length ?? 0}{" "}
              {t(" items pending")}
            </Badge>
          </CardTitle>
          <CardDescription>
            {t(
              "The latest 100 tasks. Online bodies are checked as needed; filing follows successful complete saving. Verification, saving or queueing failures stop later rules. See linked tasks for server results.",
            )}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  open
                    ? t("Collapse rule processing tasks")
                    : t("Expand rule processing tasks")
                }
              >
                <ChevronDown className={open ? "rotate-180" : ""} />
              </Button>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void reload.current()}
            >
              <RefreshCw data-icon="inline-start" />
              {t("Refresh")}
            </Button>
          </CardAction>
          {error && !open && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!items && !error && (
              <Skeleton className="h-24" aria-label={t("Loading rule tasks")} />
            )}
            {items?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t(
                  "No asynchronous rules to process. Rules requiring online bodies or complete saving appear here.",
                )}
              </p>
            )}
            {items?.map((item) => (
              <div key={item.id} className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate" title={item.subject}>
                      {item.subject}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.accountEmail}
                      {t(" · Checked ")}
                      {item.cursor}/{item.total} {t(" items; matched ")}
                      {item.applied}
                      {t(" items")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.status === "completed"
                        ? t("Last check")
                        : t("Current step")}
                      ：{item.step || t("Rule review")}
                    </p>
                  </div>
                  <Badge
                    variant={
                      item.status === "blocked" ? "destructive" : "secondary"
                    }
                  >
                    {states[item.status] || item.status}
                  </Badge>
                </div>
                {item.error && (
                  <Alert variant="destructive">
                    <AlertDescription>{item.error}</AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  {["queued", "running"].includes(item.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action(item.id, "pause")}
                    >
                      {t("Pause")}
                    </Button>
                  )}
                  {item.status === "paused" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action(item.id, "resume")}
                    >
                      {t("Continue")}
                    </Button>
                  )}
                  {item.status === "blocked" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void action(item.id, "retry")}
                    >
                      {t("Recheck & run remaining rules")}
                    </Button>
                  )}
                  {!["completed", "cancelled"].includes(item.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void action(item.id, "cancel")}
                    >
                      {t("Cancel remaining rules")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              {t(
                "Saved originals remain. Rechecking runs remaining rules using current flags and filing as the starting point. See linked tasks for actual server outcomes.",
              )}
            </p>
            <Button variant="outline" size="sm" onClick={onShowTasks}>
              {t("View saving & server tasks")}
            </Button>
          </CardFooter>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
