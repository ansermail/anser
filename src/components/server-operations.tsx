import { TaskCellText, TaskDataTable } from "./task-data-table";
import { t } from "@/lib/i18n";
import { TaskPanelHeader } from "./task-panel-header";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle } from "lucide-react";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";

export type ServerOperation = {
  id: string;
  accountEmail: string;
  subject: string;
  folder: string;
  action: "read" | "star";
  value: boolean;
  status:
    "queued" | "running" | "completed" | "blocked" | "paused" | "isolated";
  attempts: number;
  error: string;
};
export type OperationSnapshot = {
  pending: number;
  blocked: number;
  completed: number;
  isolated?: number;
  items: ServerOperation[];
};
const states = {
  get queued() {
    return t("Sync pending");
  },
  get running() {
    return t("Syncing");
  },
  get completed() {
    return t("Synced");
  },
  get blocked() {
    return t("Needs attention");
  },
  get paused() {
    return t("Account paused");
  },
  get isolated() {
    return t("Source quarantined");
  },
};
export function ServerOperations({
  defaultCollapsed = false,
}: { defaultCollapsed?: boolean } = {}) {
  const [data, setData] = useState<OperationSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // The effect owns requests and event subscriptions, including pending listen().
  const [reload, setReload] = useState<() => Promise<void>>(
    () => async () => {},
  );
  useEffect(() => {
    let live = true;
    const update = coalesceRefresh(async () => {
      try {
        const result = await call<OperationSnapshot>("server_operations");
        if (live) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    });
    setReload(() => update);
    void update();
    const timer = setInterval(() => void update(), 5000);
    let unlisten: (() => void) | undefined;
    if (native && !isDemo()) {
      void listen("server-operations-updated", () => void update())
        .then((off) => {
          if (live) unlisten = off;
          else off();
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    }
    return () => {
      live = false;
      clearInterval(timer);
      unlisten?.();
    };
  }, []);
  async function retry(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await call("retry_server_operation", { id });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Collapsible defaultOpen={!defaultCollapsed} asChild>
      <Card>
        <TaskPanelHeader
          title={t("Server flag synchronization")}
          description={
            <>
              {t(
                "Read and star flags sync automatically to IMAP, with retries after reconnecting. POP3 and local-only messages keep local flags.",
              )}
            </>
          }
          onRefresh={() => reload()}
        />
        <CollapsibleContent asChild>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t("Could not update sync task")}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!data && !error && (
              <Skeleton
                className="h-16 w-full"
                aria-label={t("Loading sync tasks")}
              />
            )}
            {data && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {t("Pending ")}
                    {data.pending}
                  </Badge>
                  <Badge variant={data.blocked ? "destructive" : "secondary"}>
                    {t("Needs attention ")}
                    {data.blocked}
                  </Badge>
                  <Badge variant="outline">
                    {t("Synced ")}
                    {data.completed}
                  </Badge>
                  {!!data.isolated && (
                    <Badge variant="secondary">
                      {t("Source quarantined ")}
                      {data.isolated}
                    </Badge>
                  )}
                </div>
                <TaskDataTable
                  actionsWidth={6}
                  label={t("Server sync tasks")}
                  empty={t("No sync tasks")}
                  fields={[
                    "task",
                    "account",
                    "folder",
                    "operation",
                    "status",
                    "reason",
                    "actions",
                  ]}
                  rows={data.items.map((item) => ({
                    id: item.id,
                    task: (
                      <TaskCellText text={item.subject || t("(No subject)")} />
                    ),
                    account: item.accountEmail && (
                      <TaskCellText text={item.accountEmail} />
                    ),
                    folder: item.folder && <TaskCellText text={item.folder} />,
                    operation: (
                      <TaskCellText
                        text={
                          item.action === "read"
                            ? item.value
                              ? t("Mark read")
                              : t("Mark unread")
                            : item.value
                              ? t("Add star")
                              : t("Unstar")
                        }
                      />
                    ),
                    reason: item.error && <TaskCellText text={item.error} />,
                    status: (
                      <Badge
                        variant={
                          item.status === "blocked" ? "destructive" : "outline"
                        }
                      >
                        {item.status === "queued" && item.error
                          ? t("Waiting to retry")
                          : states[item.status]}
                      </Badge>
                    ),
                    actions:
                      item.status === "blocked" ||
                      (item.status === "queued" && item.error) ? (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="xs"
                            disabled={busy !== null}
                            onClick={() => void retry(item.id)}
                          >
                            {busy === item.id ? t("Retrying…") : t("Retry")}
                          </Button>
                        </div>
                      ) : undefined,
                  }))}
                />
                {data.items.length >= 50 && (
                  <p className="text-xs text-muted-foreground">
                    {t("Up to 50 entries, with pending tasks first.")}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
