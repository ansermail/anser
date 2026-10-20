import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
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
  CardContent,
  CardAction,
} from "./ui/card";
import { RefreshCw } from "lucide-react";

export type RuleExecution = {
  id: string;
  ruleName: string;
  accountEmail: string;
  subject: string;
  action: string;
  source: string;
  target: string;
  status: string;
  error: string;
  operationId: string | null;
  updatedAt: string;
};
const states: Record<string, string> = {
  get queued() {
    return t("待执行");
  },
  get preparing() {
    return t("准备中");
  },
  get submitted() {
    return t("等待回执");
  },
  get confirmed() {
    return t("待核对");
  },
  get verifying() {
    return t("核对中");
  },
  get completed() {
    return t("已完成");
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
    return t("待移除来源");
  },
  get cleanup_running() {
    return t("核对来源中");
  },
  get cleanup_submitted() {
    return t("来源移除待确认");
  },
  get cleanup_uncertain() {
    return t("来源移除未确认");
  },
  get cleanup_blocked() {
    return t("来源移除需处理");
  },
};
export function RuleExecutions({ onShowTasks }: { onShowTasks: () => void }) {
  const [items, setItems] = useState<RuleExecution[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState<() => Promise<void>>(
    () => async () => {},
  );
  useEffect(() => {
    let live = true;
    const update = coalesceRefresh(async () => {
      try {
        const data = await call<RuleExecution[]>("rule_executions");
        if (live) {
          setItems(data);
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
  async function retry(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await call("retry_rule_execution", { id });
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
        <CardTitle>{t("服务器规则执行记录")}</CardTitle>
        <CardDescription>
          {t(
            "最近 50 次命中。任务完成后才显示成功；结果未确认时不会自动重发。",
          )}
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={() => void reload()}>
            <RefreshCw />
            {t("刷新")}
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
          <Skeleton className="h-16" aria-label={t("正在加载规则记录")} />
        )}
        {items?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {t("暂无服务器规则命中。预览匹配不会创建任务。")}
          </p>
        )}
        <ul
          className="flex flex-col gap-4"
          aria-label={t("服务器规则命中记录")}
        >
          {items?.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="break-words">
                  {item.ruleName} · {item.subject || t("（无主题）")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {item.accountEmail} ·{" "}
                  {item.action === "serverMove" ? t("移动") : t("复制")} ·{" "}
                  {item.source} → {item.target}
                </p>
                {item.error && (
                  <p className="text-sm text-destructive">{item.error}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {states[item.status] || item.status}
                </Badge>
                {!item.operationId && item.status === "blocked" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void retry(item.id)}
                  >
                    {t("重新检查并入队")}
                  </Button>
                )}
                {item.operationId &&
                  item.status !== "completed" &&
                  item.status !== "cancelled" && (
                    <Button variant="outline" size="sm" onClick={onShowTasks}>
                      {t("查看服务器任务")}
                    </Button>
                  )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
