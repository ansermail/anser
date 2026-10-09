import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, RefreshCw, ChevronDown } from "lucide-react";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./ui/collapsible";
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
export type SelectionEvidence = {
  exists: number | null;
  uidCount: number | null;
  inboxUidOverlap: number | null;
};
export type FolderHealthItem = {
  accountId: string;
  accountEmail: string;
  folder: string;
  displayName: string;
  reason: string;
  checkedAt: string;
  evidence: SelectionEvidence;
  sources: number;
  alternateSources: number;
  saved: number;
};
export function FolderHealthPanel({
  defaultCollapsed = false,
}: { defaultCollapsed?: boolean } = {}) {
  const [items, setItems] = useState<FolderHealthItem[] | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState<{
    key: string;
    evidence: SelectionEvidence;
  } | null>(null);
  const live = useRef(false);
  const request = useRef(false);
  const reload = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    live.current = true;
    let subscribed = true;
    const update = coalesceRefresh(async () => {
      try {
        const data = await call<FolderHealthItem[]>("folder_health");
        if (subscribed) {
          setItems(data);
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
      void listen("server-operations-updated", () => void update())
        .then((off) => {
          if (subscribed) unlisten = off;
          else off();
        })
        .catch((e) => {
          if (subscribed) setError(String(e));
        });
    return () => {
      subscribed = false;
      live.current = false;
      clearInterval(timer);
      unlisten?.();
    };
  }, []);
  async function probe(item: FolderHealthItem) {
    if (request.current) return;
    request.current = true;
    const key = JSON.stringify([item.accountId, item.folder]);
    setBusy(key);
    setResult(null);
    setError("");
    try {
      const evidence = await call<SelectionEvidence>("probe_remote_folder", {
        accountId: item.accountId,
        folder: item.folder,
      });
      if (live.current) {
        await reload.current();
        if (live.current) setResult({ key, evidence });
      }
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
        <CardHeader>
          <CardTitle>目录来源检查</CardTitle>
          <CardDescription>异常目录暂停同步，本地存档保留。</CardDescription>
          <CardAction className="flex items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="展开或收起目录来源检查"
                className="group"
              >
                <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void reload.current()}
            >
              <RefreshCw />
              刷新
            </Button>
          </CardAction>
        </CardHeader>
        <CollapsibleContent asChild>
          <CardContent className="flex flex-col gap-4">
            {(error || loadError) && (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>核查未完成</AlertTitle>
                <AlertDescription>{error || loadError}</AlertDescription>
              </Alert>
            )}
            {!items && !error && !loadError && (
              <Skeleton className="h-16 w-full" aria-label="正在加载目录检查" />
            )}
            {items?.length === 0 && (
              <p className="text-sm text-muted-foreground">暂无隔离的目录。</p>
            )}
            {items?.map((item) => {
              const key = JSON.stringify([item.accountId, item.folder]);
              return (
                <Alert key={key}>
                  <AlertCircle />
                  <AlertTitle className="flex flex-wrap items-center gap-2">
                    {item.displayName}
                    <Badge variant="secondary">来源已隔离</Badge>
                  </AlertTitle>
                  <AlertDescription className="gap-2">
                    <p>{item.accountEmail}</p>
                    <p>{item.reason}</p>
                    <p>
                      保留 {item.sources} 条旧来源，其中 {item.alternateSources}{" "}
                      条另有可用来源，{item.saved} 条有完整本地存档。
                    </p>
                    {result?.key === key && (
                      <p role="status">
                        {result.evidence.exists === 0 &&
                        (result.evidence.uidCount || 0) > 0
                          ? "核查后目录响应仍矛盾，继续隔离。"
                          : result.evidence.exists === null ||
                              result.evidence.uidCount === null
                            ? "仍无法确认目录已打开，继续隔离。"
                            : "目录响应已恢复，请重新收取此目录以核对旧来源。"}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void probe(item)}
                        aria-label={`重新核查 ${item.accountEmail} ${item.displayName}`}
                      >
                        <RefreshCw
                          className={busy === key ? "animate-spin" : ""}
                        />
                        {busy === key ? "正在核查…" : "重新核查"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        核查时间{" "}
                        {new Date(item.checkedAt).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </span>
                    </div>
                  </AlertDescription>
                </Alert>
              );
            })}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
