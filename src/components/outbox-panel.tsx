import { dateLocale, t } from "@/lib/i18n";
import { useConfirmation } from "@/hooks/use-confirmation";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  Send,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Clock3,
} from "lucide-react";
import type { Compose, OutboxRecord } from "@/lib/types";
import { call } from "@/lib/api";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { toast } from "sonner";
import { localDateTime, scheduledIso } from "@/lib/schedule-time";
import { SchedulePicker } from "./schedule-picker";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";

const uploadLabels: Record<string, string> = {
  get queued() {
    return t("Waiting to save to server");
  },
  get preparing() {
    return t("Checking Sent folder");
  },
  get submitted() {
    return t("Upload submitted");
  },
  get confirmed() {
    return t("Receipt saved; awaiting verification");
  },
  get verifying() {
    return t("Checking server copy");
  },
  get checking() {
    return t("Awaiting read-only verification");
  },
  get completed() {
    return t("Server sent copy verified");
  },
  get blocked() {
    return t("Not uploaded; needs attention");
  },
  get uncertain() {
    return t("Save result unconfirmed");
  },
};

const labels = {
  get sending() {
    return t("Sending");
  },
  get sent() {
    return t("Sent · SMTP confirmed");
  },
  get failed() {
    return t("Send failed");
  },
  get uncertain() {
    return t("Result unconfirmed");
  },
  get scheduled() {
    return t("Scheduled");
  },
  get overdue() {
    return t("Scheduled time missed");
  },
  get paused() {
    return t("Schedule paused");
  },
  get cancelled() {
    return t("Schedule canceled");
  },
};
export function OutboxPanel({
  onDraft,
}: {
  onDraft: (draft: Compose) => void;
}) {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const [records, setRecords] = useState<OutboxRecord[]>([]),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState("");
  const [editing, setEditing] = useState(""),
    [time, setTime] = useState(localDateTime);
  const [now, setNow] = useState(Date.now);
  async function refresh() {
    try {
      setRecords(await call<OutboxRecord[]>("list_outbox"));
      setFailure("");
    } catch (e) {
      setFailure(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      !records.some(
        (record) => record.status === "scheduled" && record.sendKind === "undo",
      )
    )
      return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [records]);
  async function sendNow(record: OutboxRecord) {
    setBusy(record.id);
    try {
      await call("send_queued_now", { id: record.id });
      await refresh();
      toast.success(
        t("Handed to the send queue. Check Send history for the SMTP result."),
      );
    } catch (e) {
      toast.error(String(e));
      await refresh();
    } finally {
      setBusy("");
    }
  }
  async function cancel(r: OutboxRecord) {
    setBusy(r.id);
    try {
      const draft = await call<Compose>("cancel_schedule", { id: r.id });
      await refresh();
      toast.success(
        t("Schedule canceled. Body and attachments restored as a draft."),
      );
      onDraft(draft);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function reschedule(id: string, selectedTime = time) {
    let scheduledAt: string;
    try {
      scheduledAt = scheduledIso(selectedTime);
    } catch (e) {
      toast.error(String(e));
      return;
    }
    setBusy(id);
    try {
      await call("reschedule_mail", { id, scheduledAt });
      setEditing("");
      await refresh();
      toast.success(t("Scheduled time updated"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function retry(record: OutboxRecord) {
    const uncertain = record.status === "uncertain";
    if (
      uncertain &&
      !(await askConfirmation({
        title: t("Prepare to resend an unconfirmed message?"),
        description: t(
          "This message may have arrived. Check the server's Sent folder first. Continuing creates an editable draft; resending may produce duplicates.",
        ),
        action: t("Create resend draft"),
      }))
    )
      return;
    setBusy(record.id);
    try {
      onDraft(
        await call<Compose>("retry_outbox", {
          id: record.id,
          confirmDuplicate: uncertain,
        }),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function archive(record: OutboxRecord) {
    setBusy(record.id);
    try {
      await call("archive_outbox", { id: record.id });
      await refresh();
      toast.success(t("Local sent archive restored"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  async function upload(record: OutboxRecord, action: string) {
    setBusy(record.id);
    try {
      await call("sent_upload_action", { id: record.id, action });
      await refresh();
      toast.success(
        action === "verify"
          ? t("Read-only verification queued. No repeat upload or send.")
          : t("Copy saving queued. The message will not be sent again."),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="workspace-panel">
      <div className="panel-heading">
        <div>
          <div className="page-title-row">
            <SidebarTrigger />
            <h1>{t("Send history")}</h1>
          </div>
          <p>{t("Review successful, failed and unconfirmed send receipts")}</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          {t("Refresh")}
        </Button>
      </div>
      <div className="outbox-list">
        {records.map((r) => (
          <Collapsible key={r.id}>
            <article className="outbox-card">
              <div className="outbox-summary">
                <div className="outbox-summary-primary">
                  <span className={`outbox-status ${r.status}`}>
                    {["scheduled", "overdue", "paused", "cancelled"].includes(
                      r.status,
                    ) ? (
                      <Clock3 size={17} />
                    ) : r.status === "sent" ? (
                      <CheckCircle2 size={17} />
                    ) : r.status === "sending" ? (
                      <LoaderCircle size={17} className="animate-spin" />
                    ) : (
                      <AlertCircle size={17} />
                    )}{" "}
                    {r.status === "scheduled" && r.sendKind === "undo"
                      ? t("Waiting to send · {value0}s", {
                          value0: Math.max(
                            0,
                            Math.ceil(
                              (Date.parse(r.scheduledAt || "") - now) / 1000,
                            ),
                          ),
                        })
                      : labels[r.status]}
                  </span>
                  <h3>{r.draft.subject || t("(No subject)")}</h3>
                  <p className="outbox-recipient">
                    {t("To: ")}
                    {r.draft.to}
                  </p>
                </div>
                <div className="outbox-summary-meta">
                  <small>
                    {r.scheduledAt && r.sendKind !== "undo" && (
                      <>
                        {t("Scheduled: ")}
                        {new Date(r.scheduledAt).toLocaleString(dateLocale(), {
                          hour12: false,
                        })}{" "}
                        ·{" "}
                      </>
                    )}
                    {r.updatedAt
                      ? new Date(r.updatedAt).toLocaleString(dateLocale(), {
                          hour12: false,
                        })
                      : t("Earlier send history")}
                  </small>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("View details for {value0}", {
                        value0: r.draft.subject || t("No subject"),
                      })}
                    >
                      {t("Details")}
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>
              {r.status === "scheduled" && r.sendKind === "undo" && (
                <div className="outbox-pending-send">
                  <Progress
                    value={Math.min(
                      100,
                      Math.max(
                        0,
                        100 - (Date.parse(r.scheduledAt || "") - now) / 80,
                      ),
                    )}
                    aria-label={t("Send delay progress")}
                    className="mt-2"
                  />
                  <div className="outbox-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void cancel(r)}
                    >
                      {t("Cancel & edit")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void sendNow(r)}
                    >
                      {t("Send now")}
                    </Button>
                  </div>
                </div>
              )}
              <CollapsibleContent className="outbox-details">
                {r.error && r.status !== "sent" && (
                  <p className="form-error">{r.error}</p>
                )}
                {r.status === "uncertain" && (
                  <p className="outbox-hint">
                    {t(
                      "Send was not confirmed; the message may have arrived. Check the server's Sent folder first.",
                    )}
                  </p>
                )}
                {r.status === "sent" && (
                  <p className="outbox-hint">
                    {t(
                      "The outgoing server accepted the message. This does not confirm recipient delivery.",
                    )}{" "}
                    {r.archived
                      ? t("Local sent copy saved")
                      : t(
                          "Local copy is not yet archived. The original remains in Send history.",
                        )}
                  </p>
                )}
                {r.status === "sent" && r.serverCopy && (
                  <div className="outbox-hint">
                    <Badge variant="secondary">
                      {uploadLabels[r.serverCopy.status] ||
                        t("Save status needs verification")}
                    </Badge>
                    {r.serverCopy.target && (
                      <p>
                        {t("Server folder: ")}
                        {r.serverCopy.targetLabel || r.serverCopy.target}
                      </p>
                    )}
                    {r.serverCopy.error && (
                      <p className="form-error">{r.serverCopy.error}</p>
                    )}
                    {r.serverCopy.origin === "existing" && (
                      <p>
                        {t(
                          "An identical copy exists on the server. No duplicate upload.",
                        )}
                      </p>
                    )}
                    {r.serverCopy.origin === "smtpReported" && (
                      <p>
                        {r.serverCopy.status === "completed"
                          ? t(
                              "The server reported an SMTP-saved copy. The unique copy was verified; no duplicate upload.",
                            )
                          : ["checking", "verifying"].includes(
                                r.serverCopy.status,
                              )
                            ? t(
                                "The server reported an SMTP-saved copy. Checking the unique copy; no repeat upload.",
                              )
                            : t(
                                "The server reported an SMTP-saved copy, but the result is unconfirmed. Read-only verification only; no repeat upload.",
                              )}
                      </p>
                    )}
                    {r.serverCopy.status === "uncertain" && (
                      <p>
                        {t(
                          "SMTP sending succeeded and the copy may already be saved. Verification only; no automatic repeat upload.",
                        )}
                      </p>
                    )}
                  </div>
                )}
                {r.status === "sent" && r.error && (
                  <p className="form-error">{r.error}</p>
                )}
                <div className="outbox-actions">
                  {r.status === "sent" &&
                    r.serverCopyAvailable &&
                    !r.serverCopy && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void upload(r, "queue")}
                      >
                        {t("Save to server Sent folder")}
                      </Button>
                    )}
                  {r.status === "sent" &&
                    r.serverCopy?.status === "blocked" &&
                    r.serverCopy.origin !== "smtpReported" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void upload(r, "retry")}
                      >
                        {t("Retry saving copy")}
                      </Button>
                    )}
                  {r.status === "sent" &&
                    (["uncertain", "confirmed"].includes(
                      r.serverCopy?.status || "",
                    ) ||
                      (r.serverCopy?.status === "blocked" &&
                        !!r.serverCopy.target &&
                        r.serverCopy.validity > 0)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void upload(r, "verify")}
                      >
                        {t("Verify copy (read-only)")}
                      </Button>
                    )}
                  {["scheduled", "overdue", "paused"].includes(r.status) &&
                    r.sendKind !== "undo" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => {
                            setEditing(r.id);
                            setTime(
                              localDateTime(
                                new Date(
                                  Math.max(
                                    Date.now() + 3600000,
                                    new Date(r.scheduledAt || "").getTime() ||
                                      0,
                                  ),
                                ),
                              ),
                            );
                          }}
                        >
                          {t("Change time")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void cancel(r)}
                        >
                          {t("Cancel schedule & edit")}
                        </Button>
                      </>
                    )}
                  {(r.status === "failed" || r.status === "uncertain") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void retry(r)}
                    >
                      {busy === r.id
                        ? t("Preparing…")
                        : t("Edit & prepare resend")}
                    </Button>
                  )}
                  {r.status === "sent" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void retry(r)}
                    >
                      {t("Edit this message as new")}
                    </Button>
                  )}
                  {r.status === "sent" && !r.archived && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void archive(r)}
                    >
                      {t("Restore local copy")}
                    </Button>
                  )}
                </div>
                {editing === r.id && (
                  <SchedulePicker
                    value={time}
                    onChange={setTime}
                    onConfirm={(time) => void reschedule(r.id, time)}
                    onCancel={() => setEditing("")}
                    busy={!!busy}
                  />
                )}
              </CollapsibleContent>
            </article>
          </Collapsible>
        ))}
        {!records.length && (
          <div className="panel-empty">
            <Send size={32} />
            <h3>
              {loading
                ? t("Loading send history…")
                : failure
                  ? t("Could not read")
                  : t("No send history yet")}
            </h3>
            <p>
              {failure ||
                t(
                  "Review send results here. Failed messages can be prepared for resending.",
                )}
            </p>
          </div>
        )}
      </div>
      {confirmationDialog}
    </section>
  );
}
