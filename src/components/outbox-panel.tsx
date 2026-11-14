import { dateLocale, t } from "@/lib/i18n";
import { useConfirmation } from "@/hooks/use-confirmation";
import { useEffect, useState } from "react";
import {
  RefreshCw,
  Eye,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Clock3,
} from "lucide-react";
import type { Compose, OutboxRecord } from "@/lib/types";
import { call } from "@/lib/api";
import { addressTokens, displayAddress, parseAddresses } from "@/lib/addresses";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { toast } from "sonner";
import { localDateTime, scheduledIso } from "@/lib/schedule-time";
import { SchedulePicker } from "./schedule-picker";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { TaskCellText, TaskDataTable } from "./task-data-table";

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

function displayTime(value: string) {
  return value
    ? new Date(value).toLocaleString(dateLocale(), { hour12: false })
    : "";
}

function OutboxAddressList({ value }: { value: string }) {
  const tokens = addressTokens(value).filter(Boolean);
  return (
    <ul className="outbox-detail-address-list">
      {tokens.map((token, index) => {
        const address = parseAddresses(token)[0];
        const label = address ? displayAddress(address) : token;
        return (
          <li key={`${index}:${token}`} className="outbox-detail-address">
            <span title={label}>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function OutboxRecipientCell({ record }: { record: OutboxRecord }) {
  const groups = [
    { label: t("To: "), value: record.draft.to || "" },
    { label: t("Cc: "), value: record.draft.cc || "" },
    { label: t("Bcc: "), value: record.draft.bcc || "" },
  ].map((group) => ({
    ...group,
    tokens: addressTokens(group.value).filter(Boolean),
  }));
  const primary = groups.find((group) => group.tokens.length);
  if (!primary) return null;

  const firstToken = primary.tokens[0];
  const address = parseAddresses(firstToken)[0];
  const firstLabel = address ? displayAddress(address) : firstToken;
  const remaining = primary.tokens.length - 1;
  const detail = groups
    .filter((group) => group.tokens.length)
    .map((group) => `${group.label}${group.tokens.join(", ")}`)
    .join("\n");

  return (
    <span className="outbox-recipient-cell" title={detail} aria-label={detail}>
      <span>{firstLabel}</span>
      {remaining > 0 && (
        <span className="outbox-recipient-count" aria-hidden="true">
          +{remaining}
        </span>
      )}
    </span>
  );
}

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
  const [detailsId, setDetailsId] = useState("");
  const [editing, setEditing] = useState(""),
    [time, setTime] = useState(localDateTime);
  const [now, setNow] = useState(Date.now);
  const selected = records.find((record) => record.id === detailsId);

  async function refresh() {
    try {
      setRecords(await call<OutboxRecord[]>("list_outbox"));
      setFailure("");
    } catch (error) {
      setFailure(String(error));
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

  useEffect(() => {
    if (detailsId && !records.some((record) => record.id === detailsId)) {
      setDetailsId("");
      setEditing("");
    }
  }, [detailsId, records]);

  function statusText(record: OutboxRecord) {
    if (record.status === "scheduled" && record.sendKind === "undo")
      return t("Waiting to send · {value0}s", {
        value0: Math.max(
          0,
          Math.ceil((Date.parse(record.scheduledAt || "") - now) / 1000),
        ),
      });
    return labels[record.status];
  }

  function statusGlyph(record: OutboxRecord) {
    if (["scheduled", "overdue", "paused", "cancelled"].includes(record.status))
      return <Clock3 size={14} aria-hidden="true" />;
    if (record.status === "sent")
      return <CheckCircle2 size={14} aria-hidden="true" />;
    if (record.status === "sending")
      return (
        <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
      );
    return <AlertCircle size={14} aria-hidden="true" />;
  }

  function copyText(record: OutboxRecord) {
    if (record.status !== "sent") return "";
    if (record.serverCopy)
      return (
        uploadLabels[record.serverCopy.status] ||
        t("Save status needs verification")
      );
    return record.archived ? t("Local sent copy saved") : "";
  }

  async function sendNow(record: OutboxRecord) {
    setBusy(record.id);
    try {
      await call("send_queued_now", { id: record.id });
      await refresh();
      toast.success(
        t("Handed to the send queue. Check Send history for the SMTP result."),
      );
    } catch (error) {
      toast.error(String(error));
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function cancel(record: OutboxRecord) {
    setBusy(record.id);
    try {
      const draft = await call<Compose>("cancel_schedule", { id: record.id });
      await refresh();
      toast.success(
        t("Schedule canceled. Body and attachments restored as a draft."),
      );
      setDetailsId("");
      setEditing("");
      onDraft(draft);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy("");
    }
  }

  async function reschedule(id: string, selectedTime = time) {
    let scheduledAt: string;
    try {
      scheduledAt = scheduledIso(selectedTime);
    } catch (error) {
      toast.error(String(error));
      return;
    }
    setBusy(id);
    try {
      await call("reschedule_mail", { id, scheduledAt });
      setEditing("");
      await refresh();
      toast.success(t("Scheduled time updated"));
    } catch (error) {
      toast.error(String(error));
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
      const draft = await call<Compose>("retry_outbox", {
        id: record.id,
        confirmDuplicate: uncertain,
      });
      setDetailsId("");
      onDraft(draft);
    } catch (error) {
      toast.error(String(error));
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
    } catch (error) {
      toast.error(String(error));
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
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy("");
    }
  }

  const rows = records.map((record) => {
    const copy = copyText(record);
    return {
      id: record.id,
      status: (
        <span
          className={`outbox-status ${record.status}`}
          title={statusText(record)}
        >
          {statusGlyph(record)}
          <span className="truncate">{statusText(record)}</span>
        </span>
      ),
      task: (
        <TaskCellText
          text={record.draft.subject || t("(No subject)")}
          detail={record.draft.subject || t("(No subject)")}
        />
      ),
      recipient:
        record.draft.to || record.draft.cc || record.draft.bcc ? (
          <OutboxRecipientCell record={record} />
        ) : (
          ""
        ),
      scheduled:
        record.scheduledAt && record.sendKind !== "undo"
          ? displayTime(record.scheduledAt)
          : "",
      time: record.updatedAt
        ? displayTime(record.updatedAt)
        : t("Earlier send history"),
      copy: copy ? (
        <TaskCellText text={copy} detail={record.serverCopy?.error || copy} />
      ) : (
        ""
      ),
      actions: (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={t("View details for {value0}", {
            value0: record.draft.subject || t("No subject"),
          })}
          onClick={() => {
            setDetailsId(record.id);
            setEditing("");
          }}
        >
          <Eye size={13} aria-hidden="true" />
          {t("Details")}
        </Button>
      ),
    };
  });

  const empty = loading
    ? t("Loading send history…")
    : failure
      ? t("Could not read")
      : t(
          "Review send results here. Failed messages can be prepared for resending.",
        );

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
      {failure && records.length > 0 && (
        <p className="form-error" role="alert">
          {failure}
        </p>
      )}
      <TaskDataTable
        label={t("Send history")}
        rows={rows}
        empty={empty}
        pageSize={15}
        fields={[
          "status",
          "task",
          "recipient",
          "scheduled",
          "time",
          "copy",
          "actions",
        ]}
      />
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setDetailsId("");
            setEditing("");
          }
        }}
      >
        <DialogContent className="outbox-details-dialog">
          {selected && (
            <>
              <DialogHeader className="outbox-detail-header">
                <DialogTitle className="pr-8 break-words">
                  {selected.draft.subject || t("(No subject)")}
                </DialogTitle>
                <DialogDescription className="outbox-detail-description">
                  <span
                    className={`outbox-status ${selected.status}`}
                    title={statusText(selected)}
                  >
                    {statusGlyph(selected)}
                    <span>{statusText(selected)}</span>
                  </span>
                </DialogDescription>
              </DialogHeader>
              <dl className="outbox-detail-meta">
                <div className="outbox-detail-address-field">
                  <dt>
                    {t("Recipient")}
                    {!!selected.draft.to && (
                      <span className="outbox-detail-address-count">
                        {
                          addressTokens(selected.draft.to).filter(Boolean)
                            .length
                        }
                      </span>
                    )}
                  </dt>
                  <dd>
                    {selected.draft.to ? (
                      <OutboxAddressList value={selected.draft.to} />
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                {!!selected.draft.cc?.trim() && (
                  <div className="outbox-detail-address-field">
                    <dt>
                      {t("Cc")}
                      <span className="outbox-detail-address-count">
                        {
                          addressTokens(selected.draft.cc).filter(Boolean)
                            .length
                        }
                      </span>
                    </dt>
                    <dd>
                      <OutboxAddressList value={selected.draft.cc} />
                    </dd>
                  </div>
                )}
                {!!selected.draft.bcc?.trim() && (
                  <div className="outbox-detail-address-field">
                    <dt>
                      {t("Bcc")}
                      <span className="outbox-detail-address-count">
                        {
                          addressTokens(selected.draft.bcc).filter(Boolean)
                            .length
                        }
                      </span>
                    </dt>
                    <dd>
                      <OutboxAddressList value={selected.draft.bcc} />
                    </dd>
                  </div>
                )}
                {selected.scheduledAt && selected.sendKind !== "undo" && (
                  <div>
                    <dt>{t("Scheduled time")}</dt>
                    <dd>{displayTime(selected.scheduledAt)}</dd>
                  </div>
                )}
                <div
                  className={
                    selected.scheduledAt && selected.sendKind !== "undo"
                      ? undefined
                      : "outbox-detail-time-only"
                  }
                >
                  <dt>{t("Time")}</dt>
                  <dd>
                    {selected.updatedAt
                      ? displayTime(selected.updatedAt)
                      : t("Earlier send history")}
                  </dd>
                </div>
              </dl>
              <div className="outbox-detail-content">
                {selected.status === "uncertain" && (
                  <div className="outbox-detail-result is-attention">
                    <AlertCircle aria-hidden="true" />
                    <p>
                      {t(
                        "Send was not confirmed; the message may have arrived. Check the server's Sent folder first.",
                      )}
                    </p>
                  </div>
                )}
                {selected.status === "sent" && (
                  <div className="outbox-detail-result is-sent">
                    <CheckCircle2 aria-hidden="true" />
                    <div>
                      <p>
                        {t(
                          "The outgoing server accepted the message. This does not confirm recipient delivery.",
                        )}
                      </p>
                      <span>
                        {selected.archived
                          ? t("Local sent copy saved")
                          : t(
                              "Local copy is not yet archived. The original remains in Send history.",
                            )}
                      </span>
                    </div>
                  </div>
                )}
                {selected.error && selected.status !== "sent" && (
                  <div className="outbox-detail-result is-error">
                    <AlertCircle aria-hidden="true" />
                    <p>{selected.error}</p>
                  </div>
                )}
                {selected.status === "sent" && selected.serverCopy && (
                  <div className="outbox-detail-copy">
                    <div className="outbox-detail-copy-heading">
                      <span>{t("Server copy")}</span>
                      <Badge variant="secondary">
                        {uploadLabels[selected.serverCopy.status] ||
                          t("Save status needs verification")}
                      </Badge>
                    </div>
                    {selected.serverCopy.target && (
                      <p className="outbox-detail-copy-note">
                        {t("Server folder: ")}
                        {selected.serverCopy.targetLabel ||
                          selected.serverCopy.target}
                      </p>
                    )}
                    {selected.serverCopy.error && (
                      <p className="form-error">{selected.serverCopy.error}</p>
                    )}
                    {selected.serverCopy.origin === "existing" && (
                      <p className="outbox-detail-copy-note">
                        {t(
                          "An identical copy exists on the server. No duplicate upload.",
                        )}
                      </p>
                    )}
                    {selected.serverCopy.origin === "smtpReported" && (
                      <p className="outbox-detail-copy-note">
                        {selected.serverCopy.status === "completed"
                          ? t(
                              "The server reported an SMTP-saved copy. The unique copy was verified; no duplicate upload.",
                            )
                          : ["checking", "verifying"].includes(
                                selected.serverCopy.status,
                              )
                            ? t(
                                "The server reported an SMTP-saved copy. Checking the unique copy; no repeat upload.",
                              )
                            : t(
                                "The server reported an SMTP-saved copy, but the result is unconfirmed. Read-only verification only; no repeat upload.",
                              )}
                      </p>
                    )}
                    {selected.serverCopy.status === "uncertain" && (
                      <p className="outbox-detail-copy-note">
                        {t(
                          "SMTP sending succeeded and the copy may already be saved. Verification only; no automatic repeat upload.",
                        )}
                      </p>
                    )}
                  </div>
                )}
                {selected.status === "sent" && selected.error && (
                  <div className="outbox-detail-result is-error">
                    <AlertCircle aria-hidden="true" />
                    <p>{selected.error}</p>
                  </div>
                )}
                {selected.status === "scheduled" &&
                  selected.sendKind === "undo" && (
                    <div className="outbox-detail-pending">
                      <Progress
                        value={Math.min(
                          100,
                          Math.max(
                            0,
                            100 -
                              (Date.parse(selected.scheduledAt || "") - now) /
                                80,
                          ),
                        )}
                        aria-label={t("Send delay progress")}
                      />
                      <p>{statusText(selected)}</p>
                    </div>
                  )}
              </div>
              {editing === selected.id && (
                <SchedulePicker
                  value={time}
                  onChange={setTime}
                  onConfirm={(next) => void reschedule(selected.id, next)}
                  onCancel={() => setEditing("")}
                  busy={!!busy}
                />
              )}
              <DialogFooter className="outbox-detail-footer">
                <div className="outbox-actions">
                  {selected.status === "scheduled" &&
                    selected.sendKind === "undo" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void cancel(selected)}
                        >
                          {t("Cancel & edit")}
                        </Button>
                        <Button
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void sendNow(selected)}
                        >
                          {t("Send now")}
                        </Button>
                      </>
                    )}
                  {selected.status === "sent" &&
                    selected.serverCopyAvailable &&
                    !selected.serverCopy && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void upload(selected, "queue")}
                      >
                        {t("Save to server Sent folder")}
                      </Button>
                    )}
                  {selected.status === "sent" &&
                    selected.serverCopy?.status === "blocked" &&
                    selected.serverCopy.origin !== "smtpReported" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void upload(selected, "retry")}
                      >
                        {t("Retry saving copy")}
                      </Button>
                    )}
                  {selected.status === "sent" &&
                    (["uncertain", "confirmed"].includes(
                      selected.serverCopy?.status || "",
                    ) ||
                      (selected.serverCopy?.status === "blocked" &&
                        !!selected.serverCopy.target &&
                        selected.serverCopy.validity > 0)) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void upload(selected, "verify")}
                      >
                        {t("Verify copy (read-only)")}
                      </Button>
                    )}
                  {["scheduled", "overdue", "paused"].includes(
                    selected.status,
                  ) &&
                    selected.sendKind !== "undo" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => {
                            setEditing(selected.id);
                            setTime(
                              localDateTime(
                                new Date(
                                  Math.max(
                                    Date.now() + 3600000,
                                    new Date(
                                      selected.scheduledAt || "",
                                    ).getTime() || 0,
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
                          onClick={() => void cancel(selected)}
                        >
                          {t("Cancel schedule & edit")}
                        </Button>
                      </>
                    )}
                  {(selected.status === "failed" ||
                    selected.status === "uncertain") && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void retry(selected)}
                    >
                      {busy === selected.id
                        ? t("Preparing…")
                        : t("Edit & prepare resend")}
                    </Button>
                  )}
                  {selected.status === "sent" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void retry(selected)}
                    >
                      {t("Edit this message as new")}
                    </Button>
                  )}
                  {selected.status === "sent" && !selected.archived && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void archive(selected)}
                    >
                      {t("Restore local copy")}
                    </Button>
                  )}
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </section>
  );
}
