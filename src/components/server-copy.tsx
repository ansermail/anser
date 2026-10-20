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
    return t("待复制");
  },
  get preparing() {
    return t("核对来源");
  },
  get submitted() {
    return t("已提交");
  },
  get confirmed() {
    return t("待核对目标");
  },
  get verifying() {
    return t("核对目标中");
  },
  get completed() {
    return t("复制完成");
  },
  get uncertain() {
    return t("结果未确认");
  },
  get blocked() {
    return t("需要处理");
  },
  get cancelled() {
    return t("已取消");
  },
  get cleanup_pending() {
    return t("待完成移动");
  },
  get cleanup_running() {
    return t("核对两个副本");
  },
  get cleanup_submitted() {
    return t("移除原目录中");
  },
  get cleanup_uncertain() {
    return t("原目录结果未确认");
  },
  get cleanup_blocked() {
    return t("原目录未移除");
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
          title={t("服务器文件夹操作")}
          description={
            <>
              {t(
                "复制保留原邮件；移动确认后更新两个目录。结果未确认的任务不会自动重发。回执丢失的移动可先刷新目标目录，再只读核对。 兼容移动先复制并核验，再移除原目录；中断后需主动继续，继续前会重新核对两个副本。",
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
                <AlertTitle>{t("操作未完成")}</AlertTitle>
                <AlertDescription>{error || loadError}</AlertDescription>
              </Alert>
            )}
            {!items && (
              <Skeleton className="h-16" aria-label={t("正在加载文件夹操作")} />
            )}
            {items?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("暂无服务器文件夹操作。")}
              </p>
            )}
            <ul
              className="flex flex-col gap-4"
              aria-label={t("服务器文件夹任务")}
            >
              {items?.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="break-words">
                      {item.subject || t("（无主题）")}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.accountEmail} ·{" "}
                      {item.kind === "move" ? t("移动") : t("复制")} ·{" "}
                      {item.folder} → {item.target}
                    </p>
                    {item.receiptOrigin === "observed" &&
                      item.status === "completed" && (
                        <p className="text-sm text-muted-foreground">
                          {t("目标全文与原目录只读核查通过")}
                        </p>
                      )}
                    {item.error && (
                      <p className="text-sm text-destructive">{item.error}</p>
                    )}
                    {item.strategy === "copy-delete" && (
                      <p className="text-sm text-muted-foreground">
                        {t("兼容移动 · 先核验目标，再移除原目录")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {item.kind === "move" && item.status === "completed"
                        ? t("移动完成")
                        : item.kind === "move" && item.status === "queued"
                          ? t("待移动")
                          : statuses[item.status]}
                    </Badge>
                    {item.status === "blocked" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() => void action(item.id, "retry")}
                      >
                        {t("重试")}
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
                        {t("只读核对")}
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
                          {t("继续移除原目录")}
                        </Button>
                      )}
                    {["queued", "blocked"].includes(item.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() => void action(item.id, "cancel")}
                      >
                        {t("取消任务")}
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
