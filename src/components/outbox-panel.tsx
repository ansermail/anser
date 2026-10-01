import { useEffect, useState } from "react";
import {
  RefreshCw,
  Send,
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";
import type { Compose, OutboxRecord } from "@/lib/types";
import { call } from "@/lib/api";
import { Button } from "./ui/button";
import { SidebarTrigger } from "./ui/sidebar";
import { toast } from "sonner";

const labels = {
  sending: "发送中",
  sent: "SMTP 已确认",
  failed: "服务器拒绝",
  uncertain: "结果未确认",
};
export function OutboxPanel({
  onDraft,
}: {
  onDraft: (draft: Compose) => void;
}) {
  const [records, setRecords] = useState<OutboxRecord[]>([]),
    [busy, setBusy] = useState(""),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState("");
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
  }, []);
  async function retry(record: OutboxRecord) {
    const uncertain = record.status === "uncertain";
    if (
      uncertain &&
      !window.confirm(
        "此邮件可能已送达。请先检查服务端已发送文件夹；继续会创建一封可编辑草稿，重复发送可能产生重复邮件。仍要准备重发吗？",
      )
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
      toast.success("已发送邮件的本地存档已恢复");
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
            <h1>发送记录</h1>
          </div>
          <p>查看 SMTP 确认结果与本地副本</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw size={15} />
          刷新
        </Button>
      </div>
      <div className="outbox-list">
        {records.map((r) => (
          <article key={r.id} className="outbox-card">
            <span className={`outbox-status ${r.status}`}>
              {r.status === "sent" ? (
                <CheckCircle2 size={17} />
              ) : r.status === "sending" ? (
                <LoaderCircle size={17} className="animate-spin" />
              ) : (
                <AlertCircle size={17} />
              )}{" "}
              {labels[r.status]}
            </span>
            <h3>{r.draft.subject || "（无主题）"}</h3>
            <p className="outbox-recipient">收件人：{r.draft.to}</p>
            <small>
              {r.updatedAt
                ? new Date(r.updatedAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })
                : "此前的发送记录"}
            </small>
            {r.error && r.status !== "sent" && (
              <p className="form-error">{r.error}</p>
            )}
            {r.status === "uncertain" && (
              <p className="outbox-hint">
                未取得发送确认，可能已送达。先核对服务端已发送邮件。
              </p>
            )}
            {r.status === "sent" && (
              <p className="outbox-hint">
                {r.archived
                  ? "本地已发送副本已保存"
                  : "本地副本尚未归档，原始邮件仍保存在发送记录中"}
              </p>
            )}
            <div className="outbox-actions">
              {(r.status === "failed" || r.status === "uncertain") && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void retry(r)}
                >
                  {busy === r.id ? "正在准备…" : "编辑并准备重发"}
                </Button>
              )}
              {r.status === "sent" && !r.archived && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => void archive(r)}
                >
                  恢复本地副本
                </Button>
              )}
            </div>
          </article>
        ))}
        {!records.length && (
          <div className="panel-empty">
            <Send size={32} />
            <h3>
              {loading
                ? "正在读取发送记录…"
                : failure
                  ? "读取失败"
                  : "暂无发送记录"}
            </h3>
            <p>{failure || "从这里查询发送结果，失败邮件可准备重发。"}</p>
          </div>
        )}
      </div>
    </section>
  );
}
