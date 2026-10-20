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
    return t("等待保存到服务器");
  },
  get preparing() {
    return t("正在核对已发送目录");
  },
  get submitted() {
    return t("上传已提交");
  },
  get confirmed() {
    return t("回执已保存，等待核对");
  },
  get verifying() {
    return t("正在核对服务器副本");
  },
  get checking() {
    return t("等待只读核对");
  },
  get completed() {
    return t("服务器已发送副本已核对");
  },
  get blocked() {
    return t("尚未上传，需要处理");
  },
  get uncertain() {
    return t("保存结果未确认");
  },
};

const labels = {
  get sending() {
    return t("发送中");
  },
  get sent() {
    return t("发送成功 · SMTP 已确认");
  },
  get failed() {
    return t("发送失败");
  },
  get uncertain() {
    return t("结果未确认");
  },
  get scheduled() {
    return t("待定时发送");
  },
  get overdue() {
    return t("已错过时间");
  },
  get paused() {
    return t("计划已暂停");
  },
  get cancelled() {
    return t("计划已取消");
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
      toast.success(t("已交给发送队列；SMTP 结果请查看发送记录"));
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
      toast.success(t("计划已取消，正文与附件已恢复为草稿"));
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
      toast.success(t("发送时间已更新"));
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
        title: t("准备重发结果未确认的邮件？"),
        description: t(
          "此邮件可能已送达。请先检查服务端已发送文件夹；继续会创建一封可编辑草稿，重复发送可能产生重复邮件。",
        ),
        action: t("创建重发草稿"),
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
      toast.success(t("已发送邮件的本地存档已恢复"));
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
          ? t("已安排只读核对，不会重复上传或发送")
          : t("已安排保存副本，不会重新发送邮件"),
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
            <h1>{t("发送记录")}</h1>
          </div>
          <p>{t("查看发送成功、失败和结果未确认的回执")}</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          {t("刷新")}
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
                      ? t("等待发送 · {value0} 秒", {
                          value0: Math.max(
                            0,
                            Math.ceil(
                              (Date.parse(r.scheduledAt || "") - now) / 1000,
                            ),
                          ),
                        })
                      : labels[r.status]}
                  </span>
                  <h3>{r.draft.subject || t("（无主题）")}</h3>
                  <p className="outbox-recipient">
                    {t("收件人：")}
                    {r.draft.to}
                  </p>
                </div>
                <div className="outbox-summary-meta">
                  <small>
                    {r.scheduledAt && r.sendKind !== "undo" && (
                      <>
                        {t("计划时间：")}
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
                      : t("此前的发送记录")}
                  </small>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("查看 {value0} 的详情", {
                        value0: r.draft.subject || t("无主题"),
                      })}
                    >
                      {t("详情")}
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
                    aria-label={t("发送等待进度")}
                    className="mt-2"
                  />
                  <div className="outbox-actions">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void cancel(r)}
                    >
                      {t("取消发送并编辑")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void sendNow(r)}
                    >
                      {t("立即发送")}
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
                    {t("未取得发送确认，可能已送达。先核对服务端已发送邮件。")}
                  </p>
                )}
                {r.status === "sent" && (
                  <p className="outbox-hint">
                    {t("发送服务器已接受，尚不代表收件人已收到。")}{" "}
                    {r.archived
                      ? t("本地已发送副本已保存")
                      : t("本地副本尚未归档，原始邮件仍保存在发送记录中")}
                  </p>
                )}
                {r.status === "sent" && r.serverCopy && (
                  <div className="outbox-hint">
                    <Badge variant="secondary">
                      {uploadLabels[r.serverCopy.status] || t("保存状态待核对")}
                    </Badge>
                    {r.serverCopy.target && (
                      <p>
                        {t("服务器目录：")}
                        {r.serverCopy.targetLabel || r.serverCopy.target}
                      </p>
                    )}
                    {r.serverCopy.error && (
                      <p className="form-error">{r.serverCopy.error}</p>
                    )}
                    {r.serverCopy.origin === "existing" && (
                      <p>{t("服务器已有相同副本，未重复上传。")}</p>
                    )}
                    {r.serverCopy.origin === "smtpReported" && (
                      <p>
                        {r.serverCopy.status === "completed"
                          ? t(
                              "服务器报告 SMTP 已保存，唯一副本已核对；未重复上传。",
                            )
                          : ["checking", "verifying"].includes(
                                r.serverCopy.status,
                              )
                            ? t(
                                "服务器报告 SMTP 已保存，正在核对唯一副本；不会再次上传。",
                              )
                            : t(
                                "服务器报告 SMTP 已保存，结果尚未确认；只能只读核对，不会再次上传。",
                              )}
                      </p>
                    )}
                    {r.serverCopy.status === "uncertain" && (
                      <p>
                        {t(
                          "SMTP 发送已经成功，副本可能已保存。仅核对结果，不会自动再次上传。",
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
                        {t("保存到服务器已发送")}
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
                        {t("重试保存副本")}
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
                        {t("只读核对副本")}
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
                          {t("修改时间")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void cancel(r)}
                        >
                          {t("取消计划并编辑")}
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
                      {busy === r.id ? t("正在准备…") : t("编辑并准备重发")}
                    </Button>
                  )}
                  {r.status === "sent" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void retry(r)}
                    >
                      {t("重新编辑此邮件")}
                    </Button>
                  )}
                  {r.status === "sent" && !r.archived && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void archive(r)}
                    >
                      {t("恢复本地副本")}
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
                ? t("正在读取发送记录…")
                : failure
                  ? t("读取失败")
                  : t("暂无发送记录")}
            </h3>
            <p>{failure || t("从这里查询发送结果，失败邮件可准备重发。")}</p>
          </div>
        )}
      </div>
      {confirmationDialog}
    </section>
  );
}
