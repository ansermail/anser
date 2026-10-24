import { mailFileError as importError } from "@/lib/mail-file-errors";
import { useEffect, useRef, useState } from "react";
import { FileInput } from "lucide-react";
import { call, isDemo, native } from "@/lib/api";
import { t } from "@/lib/i18n";
import { formatSize } from "@/lib/providers";
import type { Account } from "@/lib/types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
import { ScrollArea } from "./ui/scroll-area";
import { Card, CardContent } from "./ui/card";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { TaskPanelHeader } from "./task-panel-header";

export type ImportJob = {
  id: string;
  accountId: string;
  folder: string;
  status: string;
  total: number;
  bytes: number;
  processed: number;
  added: number;
  upgraded: number;
  duplicate: number;
  failed: number;
  warnings: number;
  error: string;
  items: {
    ordinal: number;
    filename: string;
    status: string;
    error: string;
    warnings: number;
    mailId: string;
  }[];
};
const active = (j: ImportJob) => ["queued", "running"].includes(j.status);
function stateText(status: string) {
  switch (status) {
    case "prepared":
      return t("Ready to import");
    case "queued":
      return t("Waiting to import");
    case "running":
      return t("Importing");
    case "completed":
      return t("Import finished");
    case "cancelled":
      return t("Import canceled");
    default:
      return t("Import interrupted");
  }
}
function Counts({ job }: { job: ImportJob }) {
  return (
    <div className="flex shrink-0 flex-col gap-2" aria-live="polite">
      <p>
        {t("Processed {done} of {total}", {
          done: job.processed,
          total: job.total,
        })}
      </p>
      <Progress
        value={job.total ? (job.processed / job.total) * 100 : 0}
        aria-label={t("Import progress")}
      />
      <p className="text-sm text-muted-foreground">
        {t(
          "Added {added} · Completed originals {upgraded} · Duplicates {duplicate} · Failed {failed} · With warnings {warnings}",
          {
            added: job.added,
            upgraded: job.upgraded,
            duplicate: job.duplicate,
            failed: job.failed,
            warnings: job.warnings,
          },
        )}
      </p>
    </div>
  );
}
export function EmlImports({
  accounts,
  folders,
  onView,
  onChanged,
  taskPanel = false,
}: {
  accounts: Account[];
  folders: string[];
  onView: (accountId: string, folder: string) => void;
  onChanged: () => Promise<void>;
  taskPanel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [folderChoice, setFolderChoice] = useState("new");
  const [folderName, setFolderName] = useState(() => t("Imported mail"));
  const [job, setJob] = useState<ImportJob | null>(null);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const jobsRead = useRef(0);
  const detailRead = useRef(0);
  const mounted = useRef(false);
  const pending = useRef(false);
  const starting = useRef(false);
  const jobRef = useRef(job);
  jobRef.current = job;
  const refreshRef = useRef(onChanged);
  refreshRef.current = onChanged;
  const target =
    folderChoice === "new" ? folderName.trim() : folderChoice.slice(9);
  const locked = !!job && job.status !== "prepared";

  async function discard(id: string) {
    await call("eml_import_action", { id, action: "cancel" });
    await call("eml_import_action", { id, action: "clear" });
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      jobsRead.current++;
      detailRead.current++;
      const current = jobRef.current;
      if (!starting.current && current?.status === "prepared")
        void discard(current.id).catch(() => {});
    };
  }, []);
  async function reload() {
    const ticket = ++jobsRead.current;
    const next = await call<ImportJob[]>("eml_import_jobs");
    if (mounted.current && ticket === jobsRead.current) setJobs(next);
  }
  useEffect(() => {
    if (!taskPanel) return;
    let live = true,
      reading = false;
    const update = async () => {
      if (reading) return;
      reading = true;
      try {
        await reload();
      } catch (e) {
        if (live) setError(importError(e));
      } finally {
        reading = false;
      }
    };
    void update();
    const timer = setInterval(() => void update(), 3000);
    return () => {
      live = false;
      jobsRead.current++;
      clearInterval(timer);
    };
  }, [taskPanel]);
  useEffect(() => {
    if (!open || !job || !active(job)) return;
    let live = true,
      reading = false;
    const timer = setInterval(async () => {
      if (reading || pending.current) return;
      reading = true;
      const ticket = ++detailRead.current;
      try {
        const next = await call<ImportJob>("eml_import_job", { id: job.id });
        if (live && ticket === detailRead.current) {
          setJob(next);
          if (!active(next)) await refreshRef.current();
        }
      } catch (e) {
        if (live) setError(importError(e));
      } finally {
        reading = false;
      }
    }, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, job?.id, job?.status]);

  async function invalidate(update: () => void) {
    const ticket = ++generation.current;
    const old = job;
    setJob(null);
    update();
    setError("");
    if (old?.status === "prepared") {
      try {
        await discard(old.id);
      } catch (e) {
        if (mounted.current && ticket === generation.current)
          setError(importError(e));
      }
    }
  }
  async function close() {
    if (starting.current) return;
    const ticket = ++generation.current;
    const old = jobRef.current;
    if (old?.status === "prepared") {
      try {
        await discard(old.id);
      } catch (e) {
        setError(importError(e));
        return;
      }
      if (!mounted.current || ticket !== generation.current) return;
      setJob(null);
    }
    setOpen(false);
  }
  async function choose() {
    if (pending.current || !accountId || !target || !native || isDemo()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    const ticket = ++generation.current;
    try {
      const { open: select } = await import("@tauri-apps/plugin-dialog");
      const paths = await select({
        multiple: true,
        directory: false,
        filters: [
          {
            name: t("Mail files"),
            extensions: [
              "eml",
              "emlx",
              "mbox",
              "mbx",
              "msg",
              "EML",
              "EMLX",
              "MBOX",
              "MBX",
              "MSG",
            ],
          },
        ],
        title: t("Select mail files to import"),
      });
      if (!paths || !mounted.current || ticket !== generation.current) return;
      const previous = jobRef.current;
      if (previous?.status === "prepared") {
        await discard(previous.id);
        setJob(null);
      }
      const next = await call<ImportJob>("prepare_eml_import", {
        paths: Array.isArray(paths) ? paths : [paths],
        accountId,
        folder: target,
      });
      if (!mounted.current || ticket !== generation.current) {
        await discard(next.id);
        return;
      }
      setJob(next);
    } catch (e) {
      if (mounted.current && ticket === generation.current)
        setError(importError(e));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function action(id: string, action: string) {
    if (pending.current) return;
    pending.current = true;
    starting.current = action === "start";
    detailRead.current++;
    setBusy(true);
    setError("");
    try {
      await call("eml_import_action", { id, action });
      if (!mounted.current) return;
      if (action === "clear") {
        if (job?.id === id) {
          setJob(null);
          setOpen(false);
        }
      } else if (job?.id === id)
        setJob(await call<ImportJob>("eml_import_job", { id }));
      if (taskPanel) await reload();
      await refreshRef.current();
    } catch (e) {
      if (mounted.current) setError(importError(e));
    } finally {
      starting.current = false;
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function show(id: string) {
    const ticket = ++generation.current;
    try {
      const next = await call<ImportJob>("eml_import_job", { id });
      if (mounted.current && generation.current === ticket) {
        setJob(next);
        setError("");
        setOpen(true);
      }
    } catch (e) {
      if (mounted.current) setError(importError(e));
    }
  }
  const view = (current: ImportJob) => {
    setOpen(false);
    onView(current.accountId, current.folder);
  };
  return (
    <>
      {taskPanel ? (
        <Collapsible asChild>
          <Card>
            <TaskPanelHeader
              title={t("Mail import tasks")}
              description={t(
                "Local imports keep completed messages when canceled. Interrupted imports need file selection again.",
              )}
              onRefresh={reload}
            />
            <CollapsibleContent>
              <CardContent className="flex flex-col gap-4">
                {error && !open && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                {!jobs.length && (
                  <p className="text-sm text-muted-foreground">
                    {t("No mail imports yet.")}
                  </p>
                )}
                {jobs.map((current) => (
                  <div
                    key={current.id}
                    className="flex flex-col gap-3 rounded-md border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="min-w-0 break-words">
                        {accounts.find((a) => a.id === current.accountId)
                          ?.email || t("Removed account")}{" "}
                        · {current.folder}
                      </strong>
                      <Badge variant="secondary">
                        {stateText(current.status)}
                      </Badge>
                    </div>
                    <Counts job={current} />
                    {current.error && (
                      <p className="text-sm text-destructive">
                        {importError(current.error)}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void show(current.id)}
                      >
                        {t("Import details")}
                      </Button>
                      <Button variant="outline" onClick={() => view(current)}>
                        {t("View imported mail")}
                      </Button>
                      {active(current) ? (
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => void action(current.id, "cancel")}
                        >
                          {t("Cancel import")}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => void action(current.id, "clear")}
                        >
                          {t("Clear task record")}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      ) : (
        <Button
          variant="outline"
          onClick={() => {
            setError("");
            if (!job || !active(job)) setJob(null);
            if (!accountId) setAccountId(accounts[0]?.id || "");
            setOpen(true);
          }}
        >
          <FileInput size={15} data-icon="inline-start" />
          {t("Import mail")}
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) void close();
        }}
      >
        <DialogContent
          className={`flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-xl ${job ? "h-[min(48rem,calc(100dvh-2rem))]" : ""}`}
        >
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle>{t("Import mail")}</DialogTitle>
            <DialogDescription>
              {t(
                "Saved locally only. This does not upload messages to the mail server.",
              )}
            </DialogDescription>
          </DialogHeader>
          {(!job || job.status === "prepared") && (
            <FieldGroup className="shrink-0 gap-3">
              <Field
                orientation="horizontal"
                className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"
              >
                <FieldLabel
                  className="whitespace-nowrap"
                  htmlFor={`import-account-${taskPanel}`}
                >
                  {t("Target account")}
                </FieldLabel>
                <Select
                  value={accountId}
                  disabled={busy || locked}
                  onValueChange={(value) =>
                    void invalidate(() => setAccountId(value))
                  }
                >
                  <SelectTrigger
                    id={`import-account-${taskPanel}`}
                    className="w-full max-w-80 min-w-0 justify-self-end"
                  >
                    <SelectValue placeholder={t("Choose an account")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} · {a.email}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field
                orientation="horizontal"
                className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"
              >
                <FieldLabel
                  className="whitespace-nowrap"
                  htmlFor={`import-folder-${taskPanel}`}
                >
                  {t("Local folder")}
                </FieldLabel>
                <Select
                  value={folderChoice}
                  disabled={busy || locked}
                  onValueChange={(value) =>
                    void invalidate(() => setFolderChoice(value))
                  }
                >
                  <SelectTrigger
                    id={`import-folder-${taskPanel}`}
                    className="w-full max-w-80 min-w-0 justify-self-end"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="new">
                        {t("New local folder")}
                      </SelectItem>
                      {folders.map((f) => (
                        <SelectItem key={f} value={`existing:${f}`}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              {folderChoice === "new" && (
                <Field
                  orientation="horizontal"
                  className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"
                >
                  <FieldLabel
                    className="whitespace-nowrap"
                    htmlFor={`import-name-${taskPanel}`}
                  >
                    {t("Folder name")}
                  </FieldLabel>
                  <Input
                    id={`import-name-${taskPanel}`}
                    className="w-full max-w-80 min-w-0 justify-self-end"
                    value={folderName}
                    maxLength={120}
                    disabled={busy || locked}
                    onChange={(e) =>
                      void invalidate(() => setFolderName(e.target.value))
                    }
                  />
                </Field>
              )}
              <div className="flex items-center gap-3">
                <FieldDescription className="min-w-0 flex-1 text-xs leading-snug">
                  {t("Supports EML, MBOX, EMLX and Outlook MSG.")}{" "}
                  {t(
                    "Select mail files totaling up to 1 GiB, with at most 1,000 messages per batch.",
                  )}{" "}
                  {t(
                    "Each message can be up to 64 MiB. New messages are marked read; automatic rules and notifications do not run.",
                  )}
                </FieldDescription>
                <Button
                  variant="outline"
                  className="shrink-0"
                  disabled={
                    busy || !accountId || !target || !native || isDemo()
                  }
                  onClick={() => void choose()}
                >
                  {busy ? t("Checking files…") : t("Choose mail files")}
                </Button>
              </div>
              {!accounts.length && (
                <Alert>
                  <AlertDescription>
                    {t("Add a mailbox before importing mail.")}
                  </AlertDescription>
                </Alert>
              )}
              {(!native || isDemo()) && (
                <Alert>
                  <AlertDescription>
                    {t("Sample mode does not read or import local files.")}
                  </AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {job && (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              <div className="flex shrink-0 items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm">
                  {accounts.find((a) => a.id === job.accountId)?.email ||
                    t("Removed account")}{" "}
                  · {job.folder} · {formatSize(job.bytes)}
                </p>
                <Badge variant="secondary" className="shrink-0">
                  {stateText(job.status)}
                </Badge>
              </div>
              <Counts job={job} />
              {job.error && (
                <Alert variant="destructive">
                  <AlertDescription>{importError(job.error)}</AlertDescription>
                </Alert>
              )}
              {job.upgraded > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Completed originals keep their existing folders and flags.",
                  )}
                </p>
              )}
              {!!job.items.length && (
                <ScrollArea
                  className="min-h-0 flex-1 basis-48 overflow-hidden rounded-md border"
                  type="always"
                  aria-label={t("Import file results")}
                >
                  <div className="flex flex-col gap-3 p-3">
                    {job.items.map((item) => (
                      <div key={item.ordinal} className="text-sm break-words">
                        <span>{item.filename}</span>
                        <span className="ml-2 text-muted-foreground">
                          {item.status === "failed"
                            ? importError(item.error)
                            : item.status === "duplicate"
                              ? t("Duplicate skipped")
                              : item.status === "pending"
                                ? t("Pending")
                                : item.status === "upgraded"
                                  ? t("Original completed")
                                  : t("Imported")}
                        </span>
                        {item.error && item.status !== "failed" && (
                          <p>{importError(item.error)}</p>
                        )}
                        {item.warnings > 0 && (
                          <p className="text-muted-foreground">
                            {t(
                              "Original kept; some content has decoding warnings.",
                            )}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
          <DialogFooter className="shrink-0 flex-row flex-wrap justify-end border-t pt-3">
            <Button variant="outline" onClick={() => void close()}>
              {job && active(job) ? t("Continue in background") : t("Close")}
            </Button>
            {job?.status === "prepared" && (
              <Button
                disabled={busy}
                onClick={() => void action(job.id, "start")}
              >
                {t("Start import")}
              </Button>
            )}
            {job && active(job) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void action(job.id, "cancel")}
              >
                {t("Cancel import")}
              </Button>
            )}
            {job && job.status !== "prepared" && (
              <Button onClick={() => view(job)}>
                {t("View imported mail")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
