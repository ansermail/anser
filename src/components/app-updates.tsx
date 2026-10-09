import { useCallback, useEffect, useRef, useState } from "react";
import { version as buildVersion } from "../../package.json";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { Download, RefreshCw, RotateCw, Github } from "lucide-react";
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
import { Alert, AlertDescription } from "./ui/alert";

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
      setPhase(next ? "available" : "idle");
      await previous?.close().catch(() => {});
    } catch (e) {
      if (mounted.current) {
        setError(`无法检查更新：${String(e)}`);
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
      window.clearTimeout(timer);
      window.clearInterval(interval);
      void resource.current?.close().catch(() => {});
      resource.current = null;
    };
  }, [checkNow, native, preview]);

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
        setError(`下载或签名校验失败：${String(e)}`);
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
      setError(`安装已完成，但重启失败：${String(e)}`);
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
      setError(`安装失败：${String(e)}`);
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
    native,
    preview,
    checkNow,
    download,
    install,
    restart,
  };
}
type Updates = ReturnType<typeof useAppUpdate>;

export function UpdateIndicator({ updates }: { updates: Updates }) {
  if (!updates.update) return null;
  return (
    <Button
      variant="secondary"
      size="icon-sm"
      aria-label="有新版本，打开更新中心"
      title={`雁信 ${updates.update.version} 可更新`}
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
        <CardTitle>关于与更新</CardTitle>
        <CardDescription>
          Anser · 雁信 {updates.version || "—"} · 从 GitHub Release 获取更新
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
          检查更新
        </Button>
        <Button variant="ghost" asChild>
          <a
            href="https://github.com/ansermail/anser"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github data-icon="inline-start" />
            项目仓库
          </a>
        </Button>
        {updates.update && (
          <Button variant="ghost" onClick={() => updates.setOpen(true)}>
            查看更新
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
          <DialogTitle>更新中心</DialogTitle>
          <DialogDescription>
            {u.update
              ? `雁信 ${u.update.version} 已发布，当前版本 ${u.update.currentVersion}。`
              : `当前版本 ${u.version || "—"}`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
          {u.update?.body ||
            (u.phase === "checking"
              ? "正在检查更新…"
              : u.error
                ? "暂时无法获取更新信息。"
                : "当前没有可用更新。")}
        </div>
        {u.preview && (
          <Alert>
            <AlertDescription>
              开发预览可以检查更新。下载和安装请使用正式应用，以免覆盖开发实例。
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
              请先完成写信并关闭编辑窗口，再安装更新。
            </AlertDescription>
          </Alert>
        )}
        {u.phase === "downloading" && (
          <div className="flex flex-col gap-2" role="status">
            <Progress value={u.progress} aria-label="更新下载进度" />
            <p className="text-sm text-muted-foreground">
              {u.progress === null ? "正在下载…" : `已下载 ${u.progress}%`}
            </p>
          </div>
        )}
        {u.phase === "ready" && (
          <p role="status" className="text-sm">
            下载及签名校验完成，可以安装。
          </p>
        )}
        {u.phase === "restarting" && (
          <p role="status" className="text-sm">
            等待正在进行的邮件处理完成，然后重启…
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              void invoke("open_mail_link", { url: releasePage }).catch(
                () => {},
              )
            }
            disabled={!u.native || locked}
          >
            打开发布页
          </Button>
          {u.update && u.phase === "available" && (
            <Button disabled={u.preview} onClick={() => void u.download()}>
              <Download data-icon="inline-start" />
              下载更新
            </Button>
          )}
          {u.phase === "ready" && (
            <Button
              disabled={blocked || u.preview}
              onClick={() => void u.install()}
            >
              <RotateCw data-icon="inline-start" />
              安装并重启
            </Button>
          )}
          {u.phase === "installed" && (
            <Button disabled={blocked} onClick={() => void u.restart()}>
              重新启动
            </Button>
          )}
          {locked && (
            <Button disabled>
              正在{u.phase === "installing" ? "安装" : "重启"}…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
