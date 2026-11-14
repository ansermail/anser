import { formatMailListTime, formatMailTime, t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { TaskCellText, TaskDataTable } from "./task-data-table";
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
  CardAction,
} from "./ui/card";
import { RefreshCw } from "lucide-react";

export type RuleExecution = {
  id: string;
  ruleName: string;
  accountEmail: string;
  subject: string;
  action: string;
  source: string;
  target: string;
  status: string;
  error: string;
  operationId: string | null;
  updatedAt: string;
};
const states: Record<string, string> = {
  get queued() {
    return t("Pending");
  },
  get preparing() {
    return t("Preparing");
  },
  get submitted() {
    return t("Awaiting receipt");
  },
  get confirmed() {
    return t("Needs verification");
  },
  get verifying() {
    return t("Verifying");
  },
  get completed() {
    return t("Completed");
  },
  get uncertain() {
    return t("Result unconfirmed");
  },
  get blocked() {
    return t("Needs attention");
  },
  get cancelled() {
    return t("Canceled");
  },
  get cleanup_pending() {
    return t("Source removal pending");
  },
  get cleanup_running() {
    return t("Checking source");
  },
  get cleanup_submitted() {
    return t("Source removal awaiting confirmation");
  },
  get cleanup_uncertain() {
    return t("Source removal unconfirmed");
  },
  get cleanup_blocked() {
    return t("Source removal needs attention");
  },
};
export function RuleExecutions({ onShowTasks }: { onShowTasks: () => void }) {
  const [items, setItems] = useState<RuleExecution[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState<() => Promise<void>>(
    () => async () => {},
  );
  useEffect(() => {
    let live = true;
    const update = coalesceRefresh(async () => {
      try {
        const data = await call<RuleExecution[]>("rule_executions");
        if (live) {
          setItems(data);
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    });
    setReload(() => update);
    void update();
    const timer = setInterval(() => void update(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  async function retry(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await call("retry_rule_execution", { id });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("Server rule history")}</CardTitle>
        <CardDescription>
          {t(
            "The latest 50 matches. Success is shown only after task completion. Unconfirmed results are not resent automatically.",
          )}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => void reload()}>
            <RefreshCw />
            {t("Refresh")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!items && !error && (
          <Skeleton className="h-16" aria-label={t("Loading rule history")} />
        )}
        {items && (
          <TaskDataTable
            actionsWidth={12}
            label={t("Server rule matches")}
            empty={t(
              "No server rule matches. Previewing does not create tasks.",
            )}
            fields={[
              "rule",
              "task",
              "account",
              "operation",
              "folder",
              "target",
              "status",
              "time",
              "reason",
              "actions",
            ]}
            rows={items.map((item) => {
              const retryable = !item.operationId && item.status === "blocked";
              const viewTasks =
                !!item.operationId &&
                !["completed", "cancelled"].includes(item.status);
              return {
                id: item.id,
                rule: item.ruleName && <TaskCellText text={item.ruleName} />,
                task: <TaskCellText text={item.subject || t("(No subject)")} />,
                account: item.accountEmail && (
                  <TaskCellText text={item.accountEmail} />
                ),
                operation: (
                  <TaskCellText
                    text={item.action === "serverMove" ? t("Move") : t("Copy")}
                  />
                ),
                folder: item.source && <TaskCellText text={item.source} />,
                target: item.target && <TaskCellText text={item.target} />,
                status: (
                  <Badge
                    variant={
                      item.status === "blocked" ? "destructive" : "outline"
                    }
                  >
                    {states[item.status] || item.status}
                  </Badge>
                ),
                time: item.updatedAt ? (
                  <TaskCellText
                    text={formatMailListTime(item.updatedAt)}
                    detail={formatMailTime(item.updatedAt)}
                  />
                ) : undefined,
                reason: item.error && <TaskCellText text={item.error} />,
                actions:
                  retryable || viewTasks ? (
                    <div className="flex items-center justify-end gap-1">
                      {retryable && (
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={busy}
                          onClick={() => void retry(item.id)}
                        >
                          {t("Recheck & queue")}
                        </Button>
                      )}
                      {viewTasks && (
                        <Button
                          variant="outline"
                          size="xs"
                          onClick={onShowTasks}
                        >
                          {t("View server tasks")}
                        </Button>
                      )}
                    </div>
                  ) : undefined,
              };
            })}
          />
        )}
      </CardContent>
    </Card>
  );
}
