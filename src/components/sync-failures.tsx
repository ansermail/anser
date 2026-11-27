import { useSettingsTabActive } from "./settings-layout";
import { TaskCellText, TaskDataTable } from "./task-data-table";
import { dateLocale, t } from "@/lib/i18n";
import { TaskPanelHeader, TaskPanelCollapsible } from "./task-panel-header";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, RefreshCw } from "lucide-react";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { formatSize } from "@/lib/providers";
import { toast } from "sonner";
import { Button, ButtonLabel } from "./ui/button";
import { CollapsibleContent } from "./ui/collapsible";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";

export type SyncFailureItem = {
  accountId: string;
  accountEmail: string;
  folder: string;
  displayName: string;
  remoteId: string;
  uid: number;
  subject: string;
  sender: string;
  date: string;
  size: number | null;
  stage: string;
  reason: string;
  status: "failed" | "skipped" | "header_only" | string;
  failedAt: string;
};

export function SyncFailuresPanel({
  defaultCollapsed = false,
  onResolved,
}: {
  defaultCollapsed?: boolean;
  onResolved?: () => void;
} = {}) {
  const tabActive = useSettingsTabActive();
  const [items, setItems] = useState<SyncFailureItem[] | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const live = useRef(false);
  const request = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;

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
        const data = await call<SyncFailureItem[]>("sync_failures");
        if (subscribed) {
          setItems(data);
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
      void listen("server-operations-updated", () => void update())
        .then((off) => {
          if (subscribed) unlisten = off;
          else off();
        })
        .catch((e) => {
          if (subscribed) setError(String(e));
        });
    return () => {
      subscribed = false;
      clearInterval(timer);
      unlisten?.();
    };
  }, [tabActive]);

  async function runAction(
    item: SyncFailureItem,
    action: "retry" | "header_only" | "skip" | "dismiss",
  ) {
    if (request.current) return;
    request.current = true;
    const key = JSON.stringify([item.accountId, item.folder, item.remoteId]);
    setBusyKey(key);
    setBusyAction(action);
    setError("");
    try {
      await call("sync_failure_action", {
        accountId: item.accountId,
        folder: item.folder,
        remoteId: item.remoteId,
        action,
      });
      if (live.current) {
        await reload.current();
        onResolvedRef.current?.();
        toast.success(
          action === "retry"
            ? t("Message retried successfully")
            : action === "header_only"
              ? t("Switched to online header only")
              : action === "skip"
                ? t("Message skipped")
                : t("Record removed"),
        );
      }
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      request.current = false;
      if (live.current) {
        setBusyKey("");
        setBusyAction("");
      }
    }
  }

  const unresolvedCount = (items ?? []).filter(
    (item) => item.status === "failed",
  ).length;

  return (
    <TaskPanelCollapsible
      defaultOpen={!defaultCollapsed || unresolvedCount > 0}
      remember={defaultCollapsed ? "sync-failures" : undefined}
    >
      <Card>
        <TaskPanelHeader
          title={t("Message sync failures")}
          badge={
            unresolvedCount > 0 ? (
              <Badge variant="destructive" className="tabular-nums">
                {t("{value0} failed messages", { value0: unresolvedCount })}
              </Badge>
            ) : undefined
          }
          description={t(
            "Messages that failed to download stay listed here. Retry, keep header-only for online reading, or skip so other messages keep syncing.",
          )}
          onRefresh={() => reload.current()}
        />
        <CollapsibleContent asChild>
          <CardContent className="flex flex-col gap-4">
            {(error || loadError) && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t("Action failed")}</AlertTitle>
                <AlertDescription>{error || loadError}</AlertDescription>
              </Alert>
            )}
            {(items || (!error && !loadError)) && (
              <TaskDataTable
                loadingLabel={
                  !items ? t("Loading message sync failures") : undefined
                }
                actionsWidth={18}
                label={t("Message sync failures")}
                empty={t("No failed messages.")}
                fields={[
                  "task",
                  "account",
                  "folder",
                  "status",
                  "reason",
                  "checked",
                  "actions",
                ]}
                rows={(items ?? []).map((item) => {
                  const key = JSON.stringify([
                    item.accountId,
                    item.folder,
                    item.remoteId,
                  ]);
                  const title =
                    item.subject || t("UID {value0}", { value0: item.uid });
                  const meta = [
                    item.subject,
                    item.sender,
                    item.size != null ? formatSize(item.size) : "",
                    t("UID {value0}", { value0: item.uid }),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const checked = new Date(item.failedAt);
                  const rowBusy = busyKey === key;
                  return {
                    id: key,
                    task: <TaskCellText text={title} detail={meta} />,
                    account: item.accountEmail && (
                      <TaskCellText text={item.accountEmail} />
                    ),
                    folder: <TaskCellText text={item.displayName} />,
                    status: (
                      <Badge
                        variant={
                          item.status === "failed"
                            ? "destructive"
                            : item.status === "header_only"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {item.status === "failed"
                          ? t("Fetch failed")
                          : item.status === "header_only"
                            ? t("Online header only")
                            : t("Skipped")}
                      </Badge>
                    ),
                    reason: (
                      <TaskCellText
                        text={item.reason || item.stage}
                        detail={[
                          item.reason,
                          item.size != null ? formatSize(item.size) : "",
                          t("UID {value0}", { value0: item.uid }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                    ),
                    checked: Number.isFinite(+checked) ? (
                      <TaskCellText
                        text={checked.toLocaleString(dateLocale(), {
                          hour12: false,
                        })}
                      />
                    ) : undefined,
                    actions: (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!!busyKey}
                          aria-busy={rowBusy && busyAction === "retry"}
                          onClick={() => void runAction(item, "retry")}
                        >
                          <RefreshCw
                            className={
                              rowBusy && busyAction === "retry"
                                ? "animate-spin"
                                : ""
                            }
                          />
                          <ButtonLabel
                            reserve={[t("Retry message"), t("Retrying…")]}
                          >
                            {rowBusy && busyAction === "retry"
                              ? t("Retrying…")
                              : t("Retry message")}
                          </ButtonLabel>
                        </Button>
                        {item.status === "failed" && (
                          <>
                            <Button
                              variant="outline"
                              size="xs"
                              disabled={!!busyKey}
                              onClick={() =>
                                void runAction(item, "header_only")
                              }
                            >
                              {t("Load header only")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={!!busyKey}
                              onClick={() => void runAction(item, "skip")}
                            >
                              {t("Skip this message")}
                            </Button>
                          </>
                        )}
                        {item.status !== "failed" && (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={!!busyKey}
                            onClick={() => void runAction(item, "dismiss")}
                          >
                            {t("Remove record")}
                          </Button>
                        )}
                      </div>
                    ),
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
