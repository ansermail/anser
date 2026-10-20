import { t } from "@/lib/i18n";
import { TaskPanelHeader } from "./task-panel-header";
import { useEffect, useState } from "react";
import { call } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { Card, CardContent, CardFooter } from "./ui/card";
export type ArchiveJob = {
  id: string;
  mailId: string;
  accountEmail: string;
  subject: string;
  folder: string;
  status: string;
  error: string;
  updatedAt: string;
};
const states: Record<string, string> = {
  get queued() {
    return t("Waiting to save");
  },
  get running() {
    return t("Downloading & verifying");
  },
  get paused() {
    return t("Paused");
  },
  get blocked() {
    return t("Save failed");
  },
  get completed() {
    return t("Fully saved");
  },
  get cancelled() {
    return t("Canceled");
  },
};
export function ArchiveJobsPanel({
  defaultCollapsed = false,
}: { defaultCollapsed?: boolean } = {}) {
  const [items, setItems] = useState<ArchiveJob[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState<() => Promise<void>>(
    () => async () => {},
  );
  useEffect(() => {
    let live = true;
    const update = coalesceRefresh(async () => {
      try {
        const next = await call<ArchiveJob[]>("archive_jobs");
        if (live) {
          setItems(next);
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
  async function action(id: string, action: string) {
    if (busy) return;
    setBusy(true);
    try {
      await call("archive_job_action", { id, action });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Collapsible defaultOpen={!defaultCollapsed} asChild>
      <Card>
        <TaskPanelHeader
          title={t("Full-message saving tasks")}
          description={
            <>
              {t(
                "The latest 100 manual saves. Save complete messages even for online-only accounts. Tasks continue after closing the window and resume after relaunch. Canceling keeps saved originals.",
              )}
            </>
          }
          onRefresh={() => reload()}
        />
        <CollapsibleContent className="flex flex-col gap-6">
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!items && !error && (
              <Skeleton
                className="h-20"
                aria-label={t("Loading saving tasks")}
              />
            )}
            {items?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t(
                  "No manual saving tasks. Select messages in the list or reader, then choose Save complete message locally.",
                )}
              </p>
            )}
            <ul
              className="flex flex-col gap-4"
              aria-label={t("Full-message saving history")}
            >
              {items?.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-start justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <p className="break-words">
                      {job.subject || t("(No subject)")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {job.accountEmail} ·{" "}
                      {job.folder || t("Source needs review")}
                    </p>
                    {job.error && (
                      <p className="text-sm text-destructive">{job.error}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">
                      {states[job.status] || job.status}
                    </Badge>
                    {["queued", "running"].includes(job.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void action(job.id, "pause")}
                      >
                        {t("Pause")}
                      </Button>
                    )}
                    {job.status === "paused" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void action(job.id, "resume")}
                      >
                        {t("Resume saving")}
                      </Button>
                    )}
                    {job.status === "blocked" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void action(job.id, "retry")}
                      >
                        {t("Recheck & save")}
                      </Button>
                    )}
                    {["queued", "running", "paused", "blocked"].includes(
                      job.status,
                    ) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void action(job.id, "cancel")}
                      >
                        {t("Cancel task")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void action("", "pause")}
            >
              {t("Pause all pending saves")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void action("", "resume")}
            >
              {t("Resume all paused saves")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void action("", "cancel")}
            >
              {t("Cancel all unfinished")}
            </Button>
          </CardFooter>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
