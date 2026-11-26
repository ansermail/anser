import { useSettingsTabActive } from "./settings-layout";
import { TaskCellText, TaskDataTable } from "./task-data-table";
import { t } from "@/lib/i18n";
import { TaskPanelHeader, TaskPanelCollapsible } from "./task-panel-header";
import { CollapsibleContent } from "./ui/collapsible";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Card, CardContent } from "./ui/card";
export type DirectoryOperation = {
  receiptOrigin?: "observed" | null;
  strategy?: "copy-delete" | null;
  receipt?: { validity: number; uid: number } | null;
  id: string;
  kind?: "copy" | "move";
  subject: string;
  accountEmail: string;
  folder: string;
  target: string;
  status:
    | "queued"
    | "preparing"
    | "submitted"
    | "confirmed"
    | "verifying"
    | "completed"
    | "uncertain"
    | "blocked"
    | "cleanup_pending"
    | "cleanup_running"
    | "cleanup_submitted"
    | "cleanup_uncertain"
    | "cleanup_blocked"
    | "cancelled";
  error: string;
};
const statuses = {
  get queued() {
    return t("Waiting to copy");
  },
  get preparing() {
    return t("Checking source");
  },
  get submitted() {
    return t("Submitted");
  },
  get confirmed() {
    return t("Destination verification pending");
  },
  get verifying() {
    return t("Checking destination");
  },
  get completed() {
    return t("Copy completed");
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
    return t("Move completion pending");
  },
  get cleanup_running() {
    return t("Checking both copies");
  },
  get cleanup_submitted() {
    return t("Removing source");
  },
  get cleanup_uncertain() {
    return t("Source result unconfirmed");
  },
  get cleanup_blocked() {
    return t("Source not removed");
  },
};
export function DirectoryOperationsPanel({
  defaultCollapsed = false,
}: { defaultCollapsed?: boolean } = {}) {
  const tabActive = useSettingsTabActive();
  const [items, setItems] = useState<DirectoryOperation[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const request = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!tabActive) return;
    let subscribed = true;
    const update = coalesceRefresh(async () => {
      if (!subscribed) return;
      try {
        const result = await call<DirectoryOperation[]>("directory_operations");
        if (subscribed) {
          setItems(result);
          setLoadError("");
        }
      } catch (e) {
        if (subscribed) setLoadError(String(e));
      }
    });
    reload.current = update;
    void update();
    const timer = setInterval(() => void update(), 5000);
    let unlisten: (() => void) | undefined;
    if (native && !isDemo())
      void listen("directory-operations-updated", () => void update())
        .then((off) => {
          if (subscribed) unlisten = off;
          else off();
        })
        .catch((e) => {
          if (subscribed) setLoadError(String(e));
        });
    return () => {
      subscribed = false;
      clearInterval(timer);
      unlisten?.();
    };
  }, [tabActive]);
  async function action(id: string, action: string) {
    if (request.current) return;
    request.current = true;
    setBusy(id);
    setError("");
    try {
      await call("directory_operation_action", { id, action });
      await reload.current();
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      request.current = false;
      if (live.current) setBusy("");
    }
  }
  return (
    <TaskPanelCollapsible
      defaultOpen={!defaultCollapsed}
      remember={defaultCollapsed ? "directory-operations" : undefined}
    >
      <Card>
        <TaskPanelHeader
          title={t("Server folder operations")}
          description={
            <>
              {t(
                "Review the progress and results of server copies and moves. If the result is unclear, check the destination before continuing.",
              )}
            </>
          }
          onRefresh={() => reload.current()}
        />
        <CollapsibleContent asChild>
          <CardContent>
            {(loadError || error) && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t("Operation incomplete")}</AlertTitle>
                <AlertDescription>{error || loadError}</AlertDescription>
              </Alert>
            )}
            {(items || !loadError) && (
              <TaskDataTable
                loadingLabel={
                  !items ? t("Loading folder operations") : undefined
                }
                actionsWidth={12}
                columnWidths={{
                  task: 8.5,
                  account: 8,
                  operation: 5,
                  folder: 7,
                  target: 7,
                  status: 8,
                  reason: 6,
                }}
                label={t("Server folder tasks")}
                empty={t("No server folder operations.")}
                fields={[
                  "task",
                  "account",
                  "operation",
                  "folder",
                  "target",
                  "status",
                  "reason",
                  "actions",
                ]}
                rows={(items ?? []).map((item) => {
                  const verify =
                    item.status === "confirmed" ||
                    item.status === "cleanup_uncertain" ||
                    item.status === "cleanup_blocked" ||
                    (item.kind === "move" && item.status === "uncertain");
                  const cancel = ["queued", "blocked"].includes(item.status);
                  const statusText =
                    item.kind === "move" && item.status === "completed"
                      ? t("Move completed")
                      : item.kind === "move" && item.status === "queued"
                        ? t("Waiting to move")
                        : statuses[item.status];
                  const details = [
                    item.error,
                    item.receiptOrigin === "observed" &&
                      item.status === "completed" &&
                      t(
                        "Destination full content and source verified read-only",
                      ),
                    item.strategy === "copy-delete" &&
                      t(
                        "Compatible move · Verify destination before removing source",
                      ),
                  ].filter((text): text is string => !!text);
                  return {
                    id: item.id,
                    task: (
                      <TaskCellText text={item.subject || t("(No subject)")} />
                    ),
                    account: item.accountEmail && (
                      <TaskCellText text={item.accountEmail} />
                    ),
                    operation: (
                      <TaskCellText
                        text={item.kind === "move" ? t("Move") : t("Copy")}
                      />
                    ),
                    folder: item.folder && <TaskCellText text={item.folder} />,
                    target: item.target && <TaskCellText text={item.target} />,
                    reason: details.length ? (
                      <TaskCellText
                        text={details[0]}
                        detail={details.join("\n")}
                      />
                    ) : undefined,
                    status: (
                      <Badge
                        className="inline-block max-w-full truncate align-middle"
                        title={statusText}
                        variant={
                          item.status === "blocked" ||
                          item.status === "cleanup_blocked"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {statusText}
                      </Badge>
                    ),
                    actions:
                      verify || cancel ? (
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {item.status === "blocked" && (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={!!busy}
                              onClick={() => void action(item.id, "retry")}
                            >
                              {t("Retry")}
                            </Button>
                          )}
                          {verify && (
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={!!busy}
                              onClick={() => void action(item.id, "verify")}
                            >
                              {t("Verify read-only")}
                            </Button>
                          )}
                          {item.kind === "move" &&
                            item.strategy === "copy-delete" &&
                            item.receipt &&
                            [
                              "confirmed",
                              "cleanup_uncertain",
                              "cleanup_blocked",
                            ].includes(item.status) && (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={!!busy}
                                onClick={() =>
                                  void action(item.id, "continue_move")
                                }
                              >
                                {t("Continue source removal")}
                              </Button>
                            )}
                          {cancel && (
                            <Button
                              size="xs"
                              variant="ghost"
                              disabled={!!busy}
                              onClick={() => void action(item.id, "cancel")}
                            >
                              {t("Cancel task")}
                            </Button>
                          )}
                        </div>
                      ) : undefined,
                  };
                })}
              />
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </TaskPanelCollapsible>
  );
}
