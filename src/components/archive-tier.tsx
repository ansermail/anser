import { TaskRefreshButton } from "./task-panel-header";
import { useSettingsTabActive } from "./settings-layout";
import { dateLocale, t } from "@/lib/i18n";
import { formatSize } from "@/lib/providers";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowDownToLine,
  ChevronDown,
  FolderOpen,
  HardDrive,
  LoaderCircle,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { call, isDemo, native } from "@/lib/api";
import type { ArchiveTierStatus } from "@/lib/types";
import { useConfirmation } from "@/hooks/use-confirmation";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Label } from "./ui/label";
import { ArchivePath } from "./archive-path";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

const retentionOptions = [1, 3, 7, 14, 30, 90, 180, 365];

function formatArchiveSize(bytes: number) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  return formatSize(bytes);
}

export function ArchiveSizeMetric({ bytes }: { bytes: number }) {
  const [value, unit] = formatArchiveSize(bytes).split(" ");
  return (
    <strong>
      {value} <small>{unit}</small>
    </strong>
  );
}

function actionLabel(action: string) {
  if (action === "archive") return t("Archived");
  if (action === "retrieve") return t("Retrieved to local");
  if (action === "normalize") return t("Normalized directory");
  return action;
}

export function ArchiveTier({ onChanged }: { onChanged: () => void }) {
  const tabActive = useSettingsTabActive();
  const [status, setStatus] = useState<ArchiveTierStatus | null>(null);
  const [retentionDraft, setRetentionDraft] = useState<number>();
  const retention = retentionDraft ?? status?.retentionDays ?? 7;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const live = useRef(true);
  const requestSequence = useRef(0);
  const polling = useRef(false);
  const mutating = useRef(false);

  async function reload() {
    if (polling.current || mutating.current) return;
    polling.current = true;
    const request = ++requestSequence.current;
    try {
      const value = await call<ArchiveTierStatus>("archive_tier_status");
      if (live.current && request === requestSequence.current) {
        setStatus(value);
        setError("");
      }
    } catch (e) {
      if (live.current && request === requestSequence.current) {
        setError(String(e));
      }
    } finally {
      polling.current = false;
    }
  }

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!tabActive) return;
    void reload().finally(() => {
      if (live.current) setLoading(false);
    });
    const timer = setInterval(() => void reload(), 2500);
    return () => {
      clearInterval(timer);
    };
  }, [tabActive]);

  async function run(
    command: string,
    args: Record<string, unknown> = {},
    success?: string,
  ) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(command);
    setError("");
    const request = ++requestSequence.current;
    try {
      const value = await call<ArchiveTierStatus>(command, args);
      if (live.current && request === requestSequence.current) {
        setStatus(value);
        if (command === "configure_archive_tier") setRetentionDraft(undefined);
        if (success) toast.success(success);
        onChanged();
      }
    } catch (e) {
      if (live.current && request === requestSequence.current) {
        setError(String(e));
      }
    } finally {
      mutating.current = false;
      if (live.current) setBusy("");
    }
  }

  async function chooseDirectory() {
    if (!native || isDemo() || busy) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: t("Select a folder for the attached archive"),
    });
    if (typeof selected !== "string") return;
    await run(
      "configure_archive_tier",
      { path: selected, retentionDays: retention },
      t("Attached archive folder updated"),
    );
  }

  async function changeRetention(value: string) {
    const days = Number(value);
    setRetentionDraft(
      status?.configured && days === status.retentionDays ? undefined : days,
    );
    if (
      !status?.configured ||
      !status.available ||
      days === status.retentionDays
    )
      return;
    await run(
      "configure_archive_tier",
      { path: status.path, retentionDays: days },
      t("Retention updated"),
    );
  }

  async function archiveNow() {
    const count = status?.pendingCount || 0;
    if (
      !(await askConfirmation({
        title: t("Archive old originals now?"),
        description: t(
          "Move {value0} complete messages older than {value1} days to the attached archive. Each file is copied and verified before the local copy is removed.",
          { value0: count, value1: retention },
        ),
        action: t("Archive now"),
      }))
    )
      return;
    await run("archive_tier_now", {}, t("Archive task started"));
  }

  async function retrieveLocal() {
    if (
      !(await askConfirmation({
        title: t("Retrieve attached archives?"),
        description: t(
          "Copy {value0} messages ({value1}) back to this computer. They stay local and are skipped by automatic archiving until you archive them manually.",
          {
            value0: status?.archivedCount || 0,
            value1: formatArchiveSize(status?.archivedBytes || 0),
          },
        ),
        action: t("Retrieve local copies"),
      }))
    )
      return;
    await run(
      "archive_tier_retrieve",
      {},
      t("Retrieving attached archive originals"),
    );
  }

  async function normalize() {
    if (
      !(await askConfirmation({
        title: t("Normalize the attached archive?"),
        description: t(
          "Rebuild the year and month folders from each message date and regenerate index.html. Files are verified before they are moved.",
        ),
        action: t("Normalize directory"),
      }))
    )
      return;
    await run(
      "archive_tier_normalize",
      {},
      t("Normalizing the attached archive"),
    );
  }

  const running = !!status?.running;
  const disabled = !!busy || running || !native || isDemo();
  const configured = !!status?.configured;
  const available = !!status?.available;

  return (
    <>
      <Card className="storage-card">
        <div className="storage-card-header">
          <span>
            <Archive size={20} />
          </span>
          <div>
            <h3>{t("Attached archive")}</h3>
            <p>
              {t(
                "Move older originals to a connected disk. Keep the disk connected to open those messages.",
              )}
            </p>
          </div>
          <Badge variant={available ? "secondary" : "outline"}>
            {configured
              ? available
                ? t("Connected")
                : t("Disconnected")
              : t("Not configured")}
          </Badge>
        </div>
        <div className="flex flex-col gap-4">
          {configured && (
            <div className="storage-metrics">
              <div>
                <strong>
                  {status?.archivedCount || 0}
                  <small>{t("messages (attached)")}</small>
                </strong>
                <span>{t("Attached originals")}</span>
              </div>
              <div>
                <ArchiveSizeMetric bytes={status?.archivedBytes ?? 0} />
                <span>{t("Attached original size")}</span>
              </div>
              <div>
                <strong>
                  {status?.pendingCount || 0}
                  <small>{t("messages pending")}</small>
                </strong>
                <span>{t("Waiting to archive")}</span>
              </div>
            </div>
          )}

          <div className="settings-archive-location">
            <div className="min-w-0">
              <h4>{t("Storage location")}</h4>
              <div className="min-w-0 text-xs text-muted-foreground">
                {status?.path ? (
                  <ArchivePath path={status.path} />
                ) : (
                  t("No attached archive folder selected yet.")
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant={configured ? "outline" : "default"}
                disabled={disabled}
                onClick={() => void chooseDirectory()}
              >
                <HardDrive data-icon="inline-start" />
                {configured ? t("Change directory") : t("Choose directory")}
              </Button>
              <TaskRefreshButton
                iconOnly
                label={t("Refresh attached archive")}
                onRefresh={reload}
              />
            </div>
          </div>

          <div className="settings-archive-location">
            <Label htmlFor="archive-tier-retention">
              {t("Local retention before archiving")}
            </Label>
            <Select
              value={String(retention)}
              onValueChange={(value) => void changeRetention(value)}
              disabled={disabled || (configured && !available)}
            >
              <SelectTrigger
                id="archive-tier-retention"
                className="w-28"
                aria-label={t("Attached archive retention days")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {retentionOptions.map((days) => (
                  <SelectItem key={days} value={String(days)}>
                    {t("{value0} days", { value0: days })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {configured && (
            <div className="storage-actions flex-wrap">
              <Button
                variant="outline"
                disabled={disabled || !configured || !available}
                onClick={() =>
                  void call("open_archive_tier").catch((e) =>
                    toast.error(String(e)),
                  )
                }
              >
                <FolderOpen data-icon="inline-start" />
                {t("Open archive")}
              </Button>
              <Button
                variant="outline"
                disabled={disabled || !configured || !available}
                onClick={() => void archiveNow()}
              >
                <Archive data-icon="inline-start" />
                {t("Archive now")}
              </Button>
              <Button
                variant="outline"
                disabled={
                  disabled ||
                  !configured ||
                  !available ||
                  (status?.archivedCount || 0) === 0
                }
                onClick={() => void retrieveLocal()}
              >
                <ArrowDownToLine data-icon="inline-start" />
                {t("Retrieve local copies")}
              </Button>
              <Button
                variant="outline"
                disabled={
                  disabled ||
                  !configured ||
                  !available ||
                  (status?.archivedCount || 0) === 0
                }
                onClick={() => void normalize()}
              >
                <Wand2 data-icon="inline-start" />
                {t("Normalize directory")}
              </Button>
            </div>
          )}

          {running && (
            <div className="flex flex-col gap-2">
              <Progress
                value={
                  status?.total
                    ? ((status.completed || 0) / status.total) * 100
                    : null
                }
              />
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="animate-spin" size={15} />
                {status?.total
                  ? t("Attached archive task: {value0} / {value1}", {
                      value0: status.completed,
                      value1: status.total,
                    })
                  : t("Preparing the attached archive task…")}
              </p>
            </div>
          )}

          {!!status?.pendingBytes && (
            <p className="text-xs text-muted-foreground">
              {t("Pending originals: {value0}", {
                value0: formatArchiveSize(status.pendingBytes),
              })}
            </p>
          )}

          {(error || !!status?.error) && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertDescription>{error || status?.error}</AlertDescription>
            </Alert>
          )}

          {(status?.recent.length || 0) > 0 && (
            <Collapsible className="rounded-md border border-border/70">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="group h-auto w-full justify-between px-3 py-2 text-left whitespace-normal"
                >
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">
                      {t("Recent archive activity")}
                    </span>
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("Last {value0} records", {
                        value0: status?.recent.length || 0,
                      })}
                    </span>
                  </span>
                  <ChevronDown className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex max-h-72 flex-col gap-2 overflow-auto border-t border-border/70 p-3">
                  {status?.recent.map((record) => (
                    <div
                      key={record.id}
                      className="flex flex-col gap-1 rounded-md bg-muted/40 px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {actionLabel(record.action)}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date(record.time).toLocaleString(dateLocale(), {
                            hour12: false,
                          })}
                        </span>
                      </div>
                      <span className="text-muted-foreground">
                        {t("{value0} messages · {value1}", {
                          value0: record.moved,
                          value1: formatArchiveSize(record.bytes),
                        })}
                      </span>
                      {!!record.error && (
                        <span className="break-words text-destructive">
                          {record.error}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {loading && (
            <p className="text-xs text-muted-foreground">
              {t("Reading attached archive status…")}
            </p>
          )}
          {(!native || isDemo()) && (
            <p className="text-xs text-muted-foreground">
              {t(
                "Web previews and sample mailboxes do not move or open local files.",
              )}
            </p>
          )}
        </div>
      </Card>
      {confirmationDialog}
    </>
  );
}
