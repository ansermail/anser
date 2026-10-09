import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Download, FileInput, Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";
import { native } from "../lib/api";
import type { Detail } from "../lib/types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { MailContent } from "./mail-content";
interface EmlDocument {
  token: string;
  filename: string;
  detail: Detail;
}
export function EmlViewer() {
  const [visible, setVisible] = useState(false);
  const [document, setDocument] = useState<EmlDocument | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState<string[]>([]);
  const generation = useRef(0);
  const active = useRef<EmlDocument | null>(null);
  const queued = useRef<string[]>([]);
  const viewing = useRef(false);
  const loadQueue = useRef(Promise.resolve());
  async function load(path: string) {
    const request = ++generation.current;
    viewing.current = true;
    setVisible(true);
    setLoading(true);
    setError("");
    setDocument(null);
    const task = loadQueue.current.then(async () => {
      if (request !== generation.current) return;
      const previous = active.current;
      active.current = null;
      if (previous) await invoke("close_eml_file", { token: previous.token });
      try {
        const result = await invoke<EmlDocument>("open_eml_file", { path });
        if (request !== generation.current) {
          await invoke("close_eml_file", { token: result.token });
          return;
        }
        active.current = result;
        setDocument(result);
      } catch (cause) {
        if (request === generation.current) setError(String(cause));
      } finally {
        if (request === generation.current) setLoading(false);
      }
    });
    loadQueue.current = task.catch((cause) => {
      if (request === generation.current) {
        setError(String(cause));
        setLoading(false);
      }
    });
    await loadQueue.current;
  }

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let draining = false;
    let again = false;
    let unlisten: (() => void) | undefined;
    async function drain() {
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        do {
          again = false;
          const paths = await invoke<string[]>("take_eml_paths");
          if (disposed) return;
          queued.current = [...new Set([...queued.current, ...paths])];
          if (!viewing.current && queued.current.length)
            void load(queued.current.shift()!);
          setRemaining([...queued.current]);
        } while (again);
      } catch (cause) {
        if (!disposed) toast.error(`无法打开邮件文件：${String(cause)}`);
      } finally {
        draining = false;
      }
    }
    void listen("eml-files-available", () => void drain())
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          void drain();
        }
      })
      .catch((cause) => {
        if (!disposed) toast.error(String(cause));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  function close() {
    ++generation.current;
    viewing.current = false;
    setVisible(false);
    setDocument(null);
    setError("");
    const previous = active.current;
    active.current = null;
    if (previous)
      void invoke("close_eml_file", { token: previous.token }).catch(() => {});
    if (queued.current.length) {
      const next = queued.current.shift()!;
      setRemaining([...queued.current]);
      void load(next);
    }
  }
  async function choose() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "EML 邮件", extensions: ["eml"] }],
      });
      if (typeof path === "string") await load(path);
    } catch (cause) {
      toast.error(String(cause));
    }
  }
  async function attachment(index: number, name: string, download: boolean) {
    if (!document || busy || loading) return;
    const token = document.token;
    setBusy(true);
    try {
      if (download) {
        // Never use attachment-provided directories as the save dialog's path.
        const filename = name.split(/[\\/]/).pop() || "附件";
        const path = await save({ defaultPath: filename });
        if (path) await invoke("save_eml_attachment", { token, index, path });
      } else await invoke("preview_eml_attachment", { token, index });
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setBusy(false);
    }
  }
  if (!native) return null;
  const detail = document?.detail;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        title="打开本地 .eml 邮件文件"
        onClick={() => void choose()}
      >
        <FileInput data-icon="inline-start" />
        打开 EML
      </Button>
      <Dialog
        open={visible}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{detail?.mail.subject || "打开邮件文件"}</DialogTitle>
            <DialogDescription>
              {document?.filename || "本地 EML 文件"} ·
              只读查看，不导入邮箱或存档
            </DialogDescription>
          </DialogHeader>
          {loading && (
            <div className="flex items-center gap-2" role="status">
              <Loader2 className="animate-spin" />
              正在读取邮件文件…
            </div>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {detail && (
            <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm break-words">
                <dt className="text-muted-foreground">发件人</dt>
                <dd>{detail.mail.sender || "未提供"}</dd>
                <dt className="text-muted-foreground">收件人</dt>
                <dd>{detail.mail.recipients || "未提供"}</dd>
                {(detail.cc?.length ?? 0) > 0 && (
                  <>
                    <dt className="text-muted-foreground">抄送</dt>
                    <dd>
                      {detail.cc
                        ?.map((x) =>
                          x.name ? `${x.name} <${x.email}>` : x.email,
                        )
                        .join(", ")}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">日期</dt>
                <dd>{detail.mail.date || "原邮件未提供日期"}</dd>
              </dl>
              {detail.mail.parseWarnings?.length ? (
                <Alert>
                  <AlertDescription>
                    {detail.mail.parseWarnings.join("；")}
                  </AlertDescription>
                </Alert>
              ) : null}
              <MailContent
                html={detail.html}
                onOpenLink={(href) => {
                  void invoke("open_mail_link", { url: href }).catch((cause) =>
                    toast.error(String(cause)),
                  );
                }}
              />
              {detail.attachments.map((item) => (
                <div
                  key={item.index}
                  className="flex flex-wrap items-center gap-2"
                >
                  <Paperclip className="size-4" />
                  <span className="min-w-0 flex-1 break-all">{item.name}</span>
                  <Badge variant="secondary">
                    {(item.size / 1024).toFixed(1)} KB
                  </Badge>
                  {item.error ? (
                    <span className="text-sm text-destructive">
                      {item.error}
                    </span>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || loading}
                        onClick={() =>
                          void attachment(item.index, item.name, false)
                        }
                      >
                        预览
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || loading}
                        onClick={() =>
                          void attachment(item.index, item.name, true)
                        }
                      >
                        <Download data-icon="inline-start" />
                        另存为
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {remaining.length > 0 && (
            <Button
              variant="outline"
              disabled={busy || loading}
              onClick={() => {
                const path = queued.current.shift();
                setRemaining([...queued.current]);
                if (path) void load(path);
              }}
            >
              下一份邮件文件（剩余 {remaining.length}）
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
