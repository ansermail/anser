import { formatMailListTime, formatMailTime, t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { TaskCellText, TaskDataTable } from "./task-data-table";
import { TaskPanelHeader } from "./task-panel-header";
import { Card, CardContent } from "./ui/card";
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
export function RuleRunsPanel() {
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
        <TaskPanelHeader
          title={t("Rule processing tasks")}
          badge={
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
          }
          description={t(
            "The latest 100 tasks. Online bodies are checked as needed; filing follows successful complete saving. Verification, saving or queueing failures stop later rules. See linked tasks for server results.",
          )}
          onRefresh={() => reload.current()}
        />
        {error && !open && (
          <div className="px-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
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
            {items && (
              <TaskDataTable
                actionsWidth={14}
                label={t("Rule processing tasks")}
                empty={t(
                  "No asynchronous rules to process. Rules requiring online bodies or complete saving appear here.",
                )}
                fields={[
                  "task",
                  "account",
                  "step",
                  "progress",
                  "matched",
                  "status",
                  "reason",
                  "time",
                  "actions",
                ]}
                rows={items.map((item) => {
                  const step = item.step || t("Rule review");
                  const actionable = !["completed", "cancelled"].includes(
                    item.status,
                  );
                  return {
                    id: item.id,
                    task: (
                      <TaskCellText text={item.subject || t("(No subject)")} />
                    ),
                    account: item.accountEmail && (
                      <TaskCellText text={item.accountEmail} />
                    ),
                    step: (
                      <TaskCellText
                        text={`${item.status === "completed" ? t("Last check") : t("Current step")}：${step}`}
                      />
                    ),
                    progress: (
                      <TaskCellText text={`${item.cursor}/${item.total}`} />
                    ),
                    matched: <TaskCellText text={String(item.applied)} />,
                    status: (
                      <Badge
                        variant={
                          item.status === "blocked" ? "destructive" : "outline"
                        }
                      >
                        {states[item.status] || item.status}
                      </Badge>
                    ),
                    reason: item.error && <TaskCellText text={item.error} />,
                    time: item.updatedAt ? (
                      <TaskCellText
                        text={formatMailListTime(item.updatedAt)}
                        detail={formatMailTime(item.updatedAt)}
                      />
                    ) : undefined,
                    actions: actionable ? (
                      <div className="flex items-center justify-end gap-1">
                        {["queued", "running"].includes(item.status) && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void action(item.id, "pause")}
                          >
                            {t("Pause")}
                          </Button>
                        )}
                        {item.status === "paused" && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void action(item.id, "resume")}
                          >
                            {t("Continue")}
                          </Button>
                        )}
                        {item.status === "blocked" && (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy}
                            onClick={() => void action(item.id, "retry")}
                          >
                            {t("Recheck & run remaining rules")}
                          </Button>
                        )}
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void action(item.id, "cancel")}
                        >
                          {t("Cancel remaining rules")}
                        </Button>
                      </div>
                    ) : undefined,
                  };
                })}
              />
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
