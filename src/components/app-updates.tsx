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
        setError(
          t("Could not check for updates: {value0}", { value0: String(e) }),
        );
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
        setError(
          t("Download or signature verification failed: {value0}", {
            value0: String(e),
          }),
        );
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
      setError(
        t("Installed, but restart failed: {value0}", { value0: String(e) }),
      );
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
      setError(t("Installation failed: {value0}", { value0: String(e) }));
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
          t("Could not open release notes link: {value0}", {
            value0: String(error),
          }),
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
            {t("No release notes are available for this version.")}
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
          {t("Loading release history…")}
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
            {t(
              "Could not load the complete history. Only the target version's notes are shown.",
            )}
            {state.error}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void u.loadHistory()}
          >
            {t("Reload release history")}
          </Button>
        </AlertDescription>
      </Alert>
      <VersionNotes
        native={u.native}
        release={{
          version: releaseVersion(next.version),
          name: t("Target version notes"),
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
      aria-label={t("New version available. Open update center.")}
      title={t("Anser {value0} is available", {
        value0: updates.update.version,
      })}
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
        <CardTitle>{t("About & updates")}</CardTitle>
        <CardDescription>
          {t("Anser ")}
          {updates.version || "—"}
          {t(" · Updates from GitHub Releases")}
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
          {t("Check for updates")}
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
                  t("Could not open project repository: {value0}", {
                    value0: String(error),
                  }),
                ),
              );
            }}
          >
            <Github data-icon="inline-start" />
            {t("Project repository")}
          </a>
        </Button>
        {updates.update && (
          <Button variant="ghost" onClick={() => updates.setOpen(true)}>
            {t("View update")}
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
          <DialogTitle>{t("Update center")}</DialogTitle>
          <DialogDescription>
            {u.update
              ? `${u.update.currentVersion} → ${u.update.version}${history?.phase === "ready" ? t(" · {value0} releases", { value0: history.releases.length }) : t(" · Release history")}`
              : t("Current version {value0}", { value0: u.version || "—" })}
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          role="region"
          aria-label={t("Release history")}
        >
          {u.update ? (
            <UpdateHistory updates={u} />
          ) : (
            <p className="text-sm leading-relaxed">
              {u.phase === "checking"
                ? t("Checking for updates…")
                : u.error
                  ? t("Update information is temporarily unavailable.")
                  : t("No updates available.")}
            </p>
          )}
        </div>
        {u.preview && (
          <Alert>
            <AlertDescription>
              {t(
                "Development previews can check for updates. Download and install from the released app to avoid replacing the development instance.",
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
              {t(
                "Finish composing and close the editor before installing an update.",
              )}
            </AlertDescription>
          </Alert>
        )}
        {u.phase === "downloading" && (
          <div className="flex flex-col gap-2" role="status">
            <Progress
              value={u.progress}
              aria-label={t("Update download progress")}
            />
            <p className="text-sm text-muted-foreground">
              {u.progress === null
                ? t("Downloading…")
                : t("Downloaded {value0}%", { value0: u.progress })}
            </p>
          </div>
        )}
        {u.phase === "ready" && (
          <p role="status" className="text-sm">
            {t(
              "Download and signature verification complete. Ready to install.",
            )}
          </p>
        )}
        {u.phase === "restarting" && (
          <p role="status" className="text-sm">
            {t(
              "Waiting for current mail operations to finish, then restarting…",
            )}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              void invoke("open_mail_link", { url: releasePage }).catch(
                (error) =>
                  toast.error(
                    t("Could not open release page: {value0}", {
                      value0: String(error),
                    }),
                  ),
              )
            }
            disabled={!u.native || locked}
          >
            {t("Open release page")}
          </Button>
          {u.update && u.phase === "available" && (
            <Button disabled={u.preview} onClick={() => void u.download()}>
              <Download data-icon="inline-start" />
              {t("Download update")}
            </Button>
          )}
          {u.phase === "ready" && (
            <Button
              disabled={blocked || u.preview}
              onClick={() => void u.install()}
            >
              <RotateCw data-icon="inline-start" />
              {t("Install & restart")}
            </Button>
          )}
          {u.phase === "installed" && (
            <Button disabled={blocked} onClick={() => void u.restart()}>
              {t("Restart again")}
            </Button>
          )}
          {locked && (
            <Button disabled>
              {t("In progress: ")}
              {u.phase === "installing" ? t("Install") : t("Restart")}…
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
