import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { call } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
} from "./ui/card";
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
  queued: "待保存",
  running: "下载与校验中",
  paused: "已暂停",
  blocked: "保存失败",
  completed: "完整已保存",
  cancelled: "已取消",
};
export function ArchiveJobsPanel() {
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
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>完整保存任务</CardTitle>
        <CardDescription>
          最近 100
          项手动补存。账号在线阅读时也可主动完整保存；关闭窗口后继续，退出应用后下次恢复。已保存的原件不会因取消任务而删除。
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => void reload()}>
            <RefreshCw />
            刷新
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!items && !error && (
          <Skeleton className="h-20" aria-label="正在加载保存任务" />
        )}
        {items?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            尚无手动补存任务。在阅读面板或列表选择邮件后，点击“完整保存到本地”。
          </p>
        )}
        <ul className="flex flex-col gap-4" aria-label="完整保存任务记录">
          {items?.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-start justify-between gap-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="break-words">{job.subject || "（无主题）"}</p>
                <p className="text-sm text-muted-foreground">
                  {job.accountEmail} · {job.folder || "来源需核查"}
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
                    暂停
                  </Button>
                )}
                {job.status === "paused" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void action(job.id, "resume")}
                  >
                    继续保存
                  </Button>
                )}
                {job.status === "blocked" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void action(job.id, "retry")}
                  >
                    重新检查并保存
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
                    取消任务
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
          暂停全部待保存
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void action("", "resume")}
        >
          继续全部已暂停
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void action("", "cancel")}
        >
          取消全部未完成
        </Button>
      </CardFooter>
    </Card>
  );
}
