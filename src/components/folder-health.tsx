import { TaskCellText, TaskDataTable } from "./task-data-table";
import { dateLocale, t } from "@/lib/i18n";
import { TaskPanelHeader } from "./task-panel-header";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, RefreshCw } from "lucide-react";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Badge } from "./ui/badge";
import { Card, CardContent } from "./ui/card";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
export type SelectionEvidence = {
  exists: number | null;
  uidCount: number | null;
  inboxUidOverlap: number | null;
};
export type FolderHealthItem = {
  accountId: string;
  accountEmail: string;
  folder: string;
  displayName: string;
  reason: string;
  checkedAt: string;
  evidence: SelectionEvidence;
  sources: number;
  alternateSources: number;
  saved: number;
};
export function FolderHealthPanel({
  defaultCollapsed = false,
}: { defaultCollapsed?: boolean } = {}) {
  const [items, setItems] = useState<FolderHealthItem[] | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{
    key: string;
    evidence: SelectionEvidence;
  } | null>(null);
  const live = useRef(false);
  const request = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    live.current = true;
    let subscribed = true;
    const update = coalesceRefresh(async () => {
      try {
        const data = await call<FolderHealthItem[]>("folder_health");
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
      live.current = false;
      clearInterval(timer);
      unlisten?.();
    };
  }, []);
  async function probe(item: FolderHealthItem) {
    if (request.current) return;
    request.current = true;
    const key = JSON.stringify([item.accountId, item.folder]);
    setBusy(key);
    setResult(null);
    setError("");
    try {
      const evidence = await call<SelectionEvidence>("probe_remote_folder", {
        accountId: item.accountId,
        folder: item.folder,
      });
      if (live.current) {
        await reload.current();
        if (live.current) setResult({ key, evidence });
      }
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
          title={t("Folder source checks")}
          description={
            <>
              {t("Inconsistent folders are suspended. Local archives remain.")}
            </>
          }
          onRefresh={() => reload.current()}
        />
        <CollapsibleContent asChild>
          <CardContent className="flex flex-col gap-4">
            {(error || loadError) && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>{t("Review incomplete")}</AlertTitle>
                <AlertDescription>{error || loadError}</AlertDescription>
              </Alert>
            )}
            {!items && !error && !loadError && (
              <Skeleton
                className="h-16 w-full"
                aria-label={t("Loading folder checks")}
              />
            )}
            {items && (
              <TaskDataTable
                actionsWidth={7}
                label={t("Folder source checks")}
                empty={t("No quarantined folders.")}
                fields={[
                  "folder",
                  "account",
                  "status",
                  "reason",
                  "checked",
                  "actions",
                ]}
                rows={items.map((item) => {
                  const key = JSON.stringify([item.accountId, item.folder]);
                  const review =
                    result?.key === key
                      ? result.evidence.exists === 0 &&
                        (result.evidence.uidCount || 0) > 0
                        ? t(
                            "Folder responses are still inconsistent. Quarantine continues.",
                          )
                        : result.evidence.exists === null ||
                            result.evidence.uidCount === null
                          ? t(
                              "Could not confirm the folder opened. Quarantine continues.",
                            )
                          : t(
                              "Folder responses recovered. Fetch this folder again to review old sources.",
                            )
                      : "";
                  const details =
                    t("Keeping ") +
                    item.sources +
                    t(" old sources; ") +
                    item.alternateSources +
                    " " +
                    t(" have another usable source; ") +
                    item.saved +
                    t(" have full local archives.");
                  const checked = new Date(item.checkedAt);
                  return {
                    id: key,
                    folder: <TaskCellText text={item.displayName} />,
                    account: item.accountEmail && (
                      <TaskCellText text={item.accountEmail} />
                    ),
                    reason: (
                      <TaskCellText
                        text={review || item.reason || details}
                        detail={[review, item.reason, details]
                          .filter(Boolean)
                          .join("\n")}
                        status={!!review}
                      />
                    ),
                    checked: Number.isFinite(+checked) ? (
                      <TaskCellText
                        text={checked.toLocaleString(dateLocale(), {
                          hour12: false,
                        })}
                      />
                    ) : undefined,
                    status: (
                      <Badge variant="secondary">
                        {t("Source quarantined")}
                      </Badge>
                    ),
                    actions: (
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={!!busy}
                          onClick={() => void probe(item)}
                          aria-label={t("Recheck {value0} {value1}", {
                            value0: item.accountEmail,
                            value1: item.displayName,
                          })}
                        >
                          <RefreshCw
                            className={busy === key ? "animate-spin" : ""}
                          />
                          {busy === key ? t("Rechecking…") : t("Recheck")}
                        </Button>
                      </div>
                    ),
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
