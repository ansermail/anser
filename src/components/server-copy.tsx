import { t } from "@/lib/i18n";
import { TaskPanelHeader } from "./task-panel-header";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
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
  const [items, setItems] = useState<DirectoryOperation[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const request = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});
  const live = useRef(false);
  useEffect(() => {
    let subscribed = true;
    live.current = true;
    const update = coalesceRefresh(async () => {
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
      live.current = false;
      clearInterval(timer);
      unlisten?.();
    };
  }, []);
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
    <Collapsible defaultOpen={!defaultCollapsed} asChild>
      <Card>
        <TaskPanelHeader
          title={t("Server folder operations")}
          description={
            <>
              {t(
                "Copy keeps the original; move updates both folders after confirmation. Unconfirmed tasks are not automatically resent. For moves with lost receipts, refresh the destination and verify read-only. Compatible moves copy and verify before removing the source. Interrupted moves require explicit continuation and a fresh check of both copies.",
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
            {!items && (
              <Skeleton
                className="h-16"
                aria-label={t("Loading folder operations")}
              />
            )}
            {items?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("No server folder operations.")}
              </p>
            )}
            <ul
              className="flex flex-col gap-4"
              aria-label={t("Server folder tasks")}
            >
              {items?.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="break-words">
                      {item.subject || t("(No subject)")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.accountEmail} ·{" "}
                      {item.kind === "move" ? t("Move") : t("Copy")} ·{" "}
                      {item.folder} → {item.target}
                    </p>
                    {item.receiptOrigin === "observed" &&
                      item.status === "completed" && (
                        <p className="text-sm text-muted-foreground">
                          {t(
                            "Destination full content and source verified read-only",
                          )}
                        </p>
                      )}
                    {item.error && (
                      <p className="text-sm text-destructive">{item.error}</p>
                    )}
                    {item.strategy === "copy-delete" && (
                      <p className="text-sm text-muted-foreground">
                        {t(
                          "Compatible move · Verify destination before removing source",
                        )}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {item.kind === "move" && item.status === "completed"
                        ? t("Move completed")
                        : item.kind === "move" && item.status === "queued"
                          ? t("Waiting to move")
                          : statuses[item.status]}
                    </Badge>
                    {item.status === "blocked" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => void action(item.id, "retry")}
                      >
                        {t("Retry")}
                      </Button>
                    )}
                    {(item.status === "confirmed" ||
                      item.status === "cleanup_uncertain" ||
                      item.status === "cleanup_blocked" ||
                      (item.kind === "move" &&
                        item.status === "uncertain")) && (
                      <Button
                        size="sm"
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
                          size="sm"
                          variant="outline"
                          disabled={!!busy}
                          onClick={() => void action(item.id, "continue_move")}
                        >
                          {t("Continue source removal")}
                        </Button>
                      )}
                    {["queued", "blocked"].includes(item.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => void action(item.id, "cancel")}
                      >
                        {t("Cancel task")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
