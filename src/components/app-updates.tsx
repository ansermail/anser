import { dateLocale, t } from "@/lib/i18n";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { version as buildVersion } from "../../package.json";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCw, RotateCw, Github } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Progress } from "./ui/progress";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertDescription } from "./ui/alert";
import { externalUrl, renderReleaseNotes } from "../lib/release-notes";

import {
  checkedHistory,
  releaseRange,
  releaseVersion,
  type ReleaseRecord,
} from "../lib/release-history";

type HistoryState = {
  range: string;
  phase: "loading" | "ready" | "error";
  releases: ReleaseRecord[];
  error: string;
};
const releasePage = "https://github.com/ansermail/anser/releases";
type Phase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "installed"
  | "restarting";

export function useAppUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [version, setVersion] = useState(buildVersion);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryState | null>(null);
  const historyRequest = useRef(0);
  const resource = useRef<Update | null>(null);
  const busy = useRef(false);
  const pinned = useRef(false);
  const mounted = useRef(false);
  const native = isTauri();
  const preview = import.meta.env.DEV;

  const checkNow = useCallback(async () => {
    if (!native || busy.current || pinned.current) return;
    busy.current = true;
    setError("");
    setPhase("checking");
    try {
      const next = await check({ timeout: 15000 });
      if (!mounted.current) {
        await next?.close();
        return;
      }
      const previous = resource.current;
      resource.current = next;
      setUpdate(next);
      setHistory(null);
      setPhase(next ? "available" : "idle");
      await previous?.close().catch(() => {});
    } catch (e) {
      if (mounted.current) {
        setError(t("无法检查更新：{value0}", { value0: String(e) }));
        setPhase(resource.current ? "available" : "idle");
      }
    } finally {
      busy.current = false;
    }
  }, [native]);

  useEffect(() => {
    mounted.current = true;
    if (native)
      void getVersion()
        .then((v) => {
          if (mounted.current) setVersion(v);
        })
        .catch(() => {});
    const timer =
      native && !preview
        ? window.setTimeout(() => void checkNow(), 3000)
        : undefined;
    const interval =
      native && !preview
        ? window.setInterval(() => void checkNow(), 6 * 60 * 60 * 1000)
        : undefined;
    return () => {
      mounted.current = false;
      historyRequest.current++;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      void resource.current?.close().catch(() => {});
      resource.current = null;
    };
  }, [checkNow, native, preview]);

  const loadHistory = useCallback(async () => {
    const current = resource.current;
    if (!native || !current || !mounted.current) return;
    const request = ++historyRequest.current;
    const range = releaseRange(current.currentVersion, current.version);
    setHistory({ range, phase: "loading", releases: [], error: "" });
    try {
      const value = await invoke("update_release_history", {
        currentVersion: current.currentVersion,
        targetVersion: current.version,
      });
      const data = checkedHistory(
        value,
        current.currentVersion,
        current.version,
      );
      if (
        !mounted.current ||
        historyRequest.current !== request ||
        resource.current !== current
      )
        return;
      setHistory({ range, phase: "ready", releases: data.releases, error: "" });
    } catch (error) {
      if (
        !mounted.current ||
        historyRequest.current !== request ||
        resource.current !== current
      )
        return;
      setHistory({ range, phase: "error", releases: [], error: String(error) });
    }
  }, [native]);
  useEffect(() => {
    if (!native || !open || !update) return;
    void loadHistory();
    return () => {
      historyRequest.current++;
    };
  }, [native, open, update, loadHistory]);

  const download = async () => {
    const current = resource.current;
    if (!current || busy.current || preview) return;
    busy.current = true;
    setPhase("downloading");
    setError("");
    setProgress(null);
    let received = 0,
      total: number | undefined;
    try {
      await current.download(
        (event) => {
          if (!mounted.current) return;
          if (event.event === "Started") total = event.data.contentLength;
          if (event.event === "Progress") received += event.data.chunkLength;
          setProgress(
            event.event === "Finished"
              ? 100
              : total
                ? Math.min(100, Math.round((received / total) * 100))
                : null,
          );
        },
        { timeout: 120000 },
      );
      if (mounted.current) {
        pinned.current = true;
        setPhase("ready");
      }
    } catch (e) {
      if (mounted.current) {
        setError(t("下载或签名校验失败：{value0}", { value0: String(e) }));
        setPhase("available");
      }
    } finally {
      busy.current = false;
    }
  };
  const restart = async () => {
    if (busy.current || preview) return;
    busy.current = true;
    setError("");
    setPhase("restarting");
    try {
      await invoke("restart_for_update");
    } catch (e) {
      setError(t("安装已完成，但重启失败：{value0}", { value0: String(e) }));
      setPhase("installed");
    } finally {
      busy.current = false;
    }
  };
  const install = async () => {
    const current = resource.current;
    if (!current || phase !== "ready" || busy.current || preview) return;
    busy.current = true;
    setError("");
    setPhase("installing");
    try {
      await current.install();
      setPhase("installed");
    } catch (e) {
      setError(t("安装失败：{value0}", { value0: String(e) }));
      setPhase("ready");
      busy.current = false;
      return;
    }
    busy.current = false;
    await restart();
  };
  return {
    update,
    version,
    phase,
    error,
    open,
    setOpen,
    progress,
    history,
    loadHistory,
    native,
    preview,
    checkNow,
    download,
    install,
    restart,
  };
}
type Updates = ReturnType<typeof useAppUpdate>;

function ReleaseNotes({ body, native }: { body: string; native: boolean }) {
  const html = useMemo(() => renderReleaseNotes(body), [body]);
  const openLink = (event: MouseEvent<HTMLDivElement>) => {
    if (!native) return;
    const target = event.target;
    const anchor = target instanceof Element ? target.closest("a[href]") : null;
    if (!anchor || !event.currentTarget.contains(anchor)) return;
    event.preventDefault();
    const url = externalUrl(anchor.getAttribute("href") || "");
    if (url)
      void invoke("open_mail_link", { url }).catch((error) =>
        toast.error(
          t("无法打开更新说明链接：{value0}", { value0: String(error) }),
        ),
      );
  };
  return (
    <div
      className="release-notes text-sm leading-relaxed"
      onClick={openLink}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function VersionNotes({
  release,
  native,
}: {
  release: ReleaseRecord;
  native: boolean;
}) {
  const date = new Date(release.publishedAt);
  return (
    <Card>
      <CardHeader>
        <CardTitle>v{release.version}</CardTitle>
        <CardDescription>
          {release.name && <span>{release.name}</span>}
          {release.name && !Number.isNaN(date.getTime()) && " · "}
          {!Number.isNaN(date.getTime()) && (
            <time dateTime={release.publishedAt}>
              {date.toLocaleDateString(dateLocale(), {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </time>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {release.body.trim() ? (
          <ReleaseNotes body={release.body} native={native} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("此版本未提供更新说明。")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
function UpdateHistory({ updates: u }: { updates: Updates }) {
  const next = u.update!;
  const state =
    u.history?.range === releaseRange(next.currentVersion, next.version)
      ? u.history
      : null;
  if (!state || state.phase === "loading")
    return (
      <div role="status" className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t("正在获取各版本更新记录…")}
        </p>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (state.phase === "ready")
    return (
      <div className="flex flex-col gap-6">
        {state.releases.map((release) => (
          <VersionNotes
            key={release.version}
            release={release}
            native={u.native}
          />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col gap-6">
      <Alert>
        <AlertDescription className="flex flex-col gap-3">
          <p>
            {t("版本历史未能完整加载，当前仅展示目标版本说明。")}
            {state.error}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void u.loadHistory()}
          >
            {t("重新加载更新记录")}
          </Button>
        </AlertDescription>
      </Alert>
      <VersionNotes
        native={u.native}
        release={{
          version: releaseVersion(next.version),
          name: t("目标版本说明"),
          body: next.body || "",
          publishedAt: "",
        }}
      />
    </div>
  );
}

export function UpdateIndicator({ updates }: { updates: Updates }) {
  if (!updates.update) return null;
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      aria-label={t("有新版本，打开更新中心")}
      title={t("雁信 {value0} 可更新", { value0: updates.update.version })}
      onClick={() => updates.setOpen(true)}
    >
      <Download />
    </Button>
  );
}
export function UpdateSettings({ updates }: { updates: Updates }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("关于与更新")}</CardTitle>
        <CardDescription>
          {t("Anser · 雁信 ")}
          {updates.version || "—"}
          {t(" · 从 GitHub Release 获取更新")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={
            !updates.native ||
            updates.phase === "checking" ||
            [
              "downloading",
              "ready",
              "installing",
              "installed",
              "restarting",
            ].includes(updates.phase)
          }
          onClick={() => {
            updates.setOpen(true);
            void updates.checkNow();
          }}
        >
          <RefreshCw data-icon="inline-start" />
          {t("检查更新")}
        </Button>
        <Button variant="ghost" asChild>
          <a
            href="https://github.com/ansermail/anser"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (!updates.native) return;
              event.preventDefault();
              void invoke("open_mail_link", {
                url: "https://github.com/ansermail/anser",
              }).catch((error) =>
                toast.error(
                  t("无法打开项目仓库：{value0}", { value0: String(error) }),
                ),
              );
            }}
          >
            <Github data-icon="inline-start" />
            {t("项目仓库")}
          </a>
        </Button>
        {updates.update && (
          <Button variant="ghost" onClick={() => updates.setOpen(true)}>
            {t("查看更新")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
export function UpdateDialog({
  updates: u,
  blocked,
}: {
  updates: Updates;
  blocked: boolean;
}) {
  const locked = u.phase === "installing" || u.phase === "restarting";
  const history =
    u.update &&
    u.history?.range === releaseRange(u.update.currentVersion, u.update.version)
      ? u.history
      : null;
  return (
    <Dialog
      open={u.open}
      onOpenChange={(value) => {
        if (!locked) u.setOpen(value);
      }}
    >
      <DialogContent
        className="flex max-h-[80vh] flex-col sm:max-w-2xl"
        showCloseButton={!locked}
        onEscapeKeyDown={(e) => {
          if (locked) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (locked) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("更新中心")}</DialogTitle>
          <DialogDescription>
            {u.update
              ? `${u.update.currentVersion} → ${u.update.version}${history?.phase === "ready" ? t(" · 共 {value0} 个版本", { value0: history.releases.length }) : t(" · 版本更新记录")}`
              : t("当前版本 {value0}", { value0: u.version || "—" })}
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          role="region"
          aria-label={t("版本更新记录")}
        >
          {u.update ? (
            <UpdateHistory updates={u} />
          ) : (
            <p className="text-sm leading-relaxed">
              {u.phase === "checking"
                ? t("正在检查更新…")
                : u.error
                  ? t("暂时无法获取更新信息。")
                  : t("当前没有可用更新。")}
            </p>
          )}
        </div>
        {u.preview && (
          <Alert>
            <AlertDescription>
              {t(
                "开发预览可以检查更新。下载和安装请使用正式应用，以免覆盖开发实例。",
              )}
            </AlertDescription>
          </Alert>
        )}
        {u.error && (
          <Alert variant="destructive">
            <AlertDescription>{u.error}</AlertDescription>
          </Alert>
        )}
        {blocked && (
          <Alert>
            <AlertDescription>
              {t("请先完成写信并关闭编辑窗口，再安装更新。")}
            </AlertDescription>
          </Alert>
        )}
        {u.phase === "downloading" && (
          <div className="flex flex-col gap-2" role="status">
            <Progress value={u.progress} aria-label={t("更新下载进度")} />
            <p className="text-sm text-muted-foreground">
              {u.progress === null
                ? t("正在下载…")
                : t("已下载 {value0}%", { value0: u.progress })}
            </p>
          </div>
        )}
        {u.phase === "ready" && (
          <p role="status" className="text-sm">
            {t("下载及签名校验完成，可以安装。")}
          </p>
        )}
        {u.phase === "restarting" && (
          <p role="status" className="text-sm">
            {t("等待正在进行的邮件处理完成，然后重启…")}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              void invoke("open_mail_link", { url: releasePage }).catch(
                (error) =>
                  toast.error(
                    t("无法打开发布页：{value0}", { value0: String(error) }),
                  ),
              )
            }
            disabled={!u.native || locked}
          >
            {t("打开发布页")}
          </Button>
          {u.update && u.phase === "available" && (
            <Button disabled={u.preview} onClick={() => void u.download()}>
              <Download data-icon="inline-start" />
              {t("下载更新")}
            </Button>
          )}
          {u.phase === "ready" && (
            <Button
              disabled={blocked || u.preview}
              onClick={() => void u.install()}
            >
              <RotateCw data-icon="inline-start" />
              {t("安装并重启")}
            </Button>
          )}
          {u.phase === "installed" && (
            <Button disabled={blocked} onClick={() => void u.restart()}>
              {t("重新启动")}
            </Button>
          )}
          {locked && (
            <Button disabled>
              {t("正在")}
              {u.phase === "installing" ? t("安装") : t("重启")}…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
