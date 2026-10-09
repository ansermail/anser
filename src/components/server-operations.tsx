import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, RefreshCw } from "lucide-react";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "./ui/card";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";

export type ServerOperation = {
  id: string;
  accountEmail: string;
  subject: string;
  folder: string;
  action: "read" | "star";
  value: boolean;
  status:
    "queued" | "running" | "completed" | "blocked" | "paused" | "isolated";
  attempts: number;
  error: string;
};
export type OperationSnapshot = {
  pending: number;
  blocked: number;
  completed: number;
  isolated?: number;
  items: ServerOperation[];
};
const states = {
  queued: "待同步",
  running: "同步中",
  completed: "已同步",
  blocked: "需要处理",
  paused: "账号已暂停",
  isolated: "来源已隔离",
};
export function ServerOperations({
  defaultCollapsed = false,
}: { defaultCollapsed?: boolean } = {}) {
  const [data, setData] = useState<OperationSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // The effect owns requests and event subscriptions, including pending listen().
  const [reload, setReload] = useState<() => Promise<void>>(
    () => async () => {},
  );
  useEffect(() => {
    let live = true;
    const update = coalesceRefresh(async () => {
      try {
        const result = await call<OperationSnapshot>("server_operations");
        if (live) {
          setData(result);
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e));
      }
    });
    setReload(() => update);
    void update();
    const timer = setInterval(() => void update(), 5000);
    let unlisten: (() => void) | undefined;
    if (native && !isDemo()) {
      void listen("server-operations-updated", () => void update())
        .then((off) => {
          if (live) unlisten = off;
          else off();
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    }
    return () => {
      live = false;
      clearInterval(timer);
      unlisten?.();
    };
  }, []);
  async function retry(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await call("retry_server_operation", { id });
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Collapsible defaultOpen={!defaultCollapsed} asChild>
      <Card>
        <CardHeader>
          <CardTitle>服务器状态同步</CardTitle>
          <CardDescription>
            已读和星标自动同步到 IMAP 邮箱，断网后自动重试。POP3
            与仅本地邮件保留本地状态。
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="展开或收起服务器状态同步"
                className="group"
              >
                <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </CollapsibleTrigger>
            <Button variant="ghost" size="sm" onClick={() => void reload()}>
              <RefreshCw />
              刷新
            </Button>
          </CardAction>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>无法更新同步任务</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {!data && !error && (
              <Skeleton className="h-16 w-full" aria-label="正在加载同步任务" />
            )}
            {data && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">待同步 {data.pending}</Badge>
                  <Badge variant={data.blocked ? "destructive" : "secondary"}>
                    需要处理 {data.blocked}
                  </Badge>
                  <Badge variant="outline">已同步 {data.completed}</Badge>
                  {!!data.isolated && (
                    <Badge variant="secondary">
                      来源已隔离 {data.isolated}
                    </Badge>
                  )}
                </div>
                {data.items.length ? (
                  <ul
                    className="flex flex-col gap-4"
                    aria-label="服务器同步任务"
                  >
                    {data.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-start justify-between gap-4"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-sm font-medium">
                            {item.subject || "（无主题）"}
                          </p>
                          <p className="break-words text-xs text-muted-foreground">
                            {item.accountEmail} · {item.folder} ·{" "}
                            {item.action === "read"
                              ? item.value
                                ? "标记已读"
                                : "标记未读"
                              : item.value
                                ? "加星标"
                                : "取消星标"}
                          </p>
                          {item.error && (
                            <p className="break-words text-sm text-destructive">
                              {item.error}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={
                              item.status === "blocked"
                                ? "destructive"
                                : "outline"
                            }
                          >
                            {item.status === "queued" && item.error
                              ? "等待重试"
                              : states[item.status]}
                          </Badge>
                          {(item.status === "blocked" ||
                            (item.status === "queued" && item.error)) && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy !== null}
                              onClick={() => void retry(item.id)}
                            >
                              {busy === item.id ? "正在重试…" : "重试"}
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">暂无同步任务</p>
                )}
                {data.items.length >= 50 && (
                  <p className="text-xs text-muted-foreground">
                    最多显示 50 条，优先展示待处理任务。
                  </p>
                )}
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
