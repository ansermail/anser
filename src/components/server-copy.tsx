import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call, native, isDemo } from "@/lib/api";
import { coalesceRefresh } from "@/lib/refresh-queue";
import { remoteFolderLabel } from "@/lib/remote-folders";
import type { Mail, RemoteFolder } from "@/lib/types";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { FieldGroup, Field, FieldLabel } from "./ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./ui/select";

export function ServerCopyDialog({
  mail,
  initialSource,
  onClose,
}: {
  mail: Mail | null;
  initialSource: string;
  onClose: () => void;
}) {
  const [folders, setFolders] = useState<RemoteFolder[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(false);
  const current = useRef(mail?.id);
  current.current = mail?.id;
  useEffect(() => {
    let live = true;
    setError("");
    setSource("");
    setTarget("");
    setFolders([]);
    setSources([]);
    if (!mail) return;
    setLoading(true);
    void Promise.all([
      call<string[]>("copy_sources", { id: mail.id }),
      call<RemoteFolder[]>("account_folders", { id: mail.accountId }),
    ])
      .then(([sources, folders]) => {
        if (!live) return;
        setSources(sources);
        setFolders(folders);
        setSource(
          sources.includes(initialSource) ? initialSource : sources[0] || "",
        );
        if (!sources.length)
          setError("这封邮件没有可信的 IMAP 来源，无法复制到服务器。");
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [mail?.id, mail?.accountId, initialSource]);
  const targets = folders.filter(
    (f) =>
      f.selectable &&
      !f.syncError &&
      f.name.toLowerCase() !== source.toLowerCase(),
  );
  const label = (name: string) => {
    const folder = folders.find((f) => f.name === name);
    return folder ? remoteFolderLabel(folder) : name;
  };
  async function submit() {
    if (!mail || !source || !target || request.current) return;
    request.current = true;
    setBusy(true);
    setError("");
    const id = mail.id;
    try {
      await call("queue_server_copy", { id, source, target });
      if (current.current === id) {
        toast.success("复制任务已记录，可在设置中查看结果");
        onClose();
      }
    } catch (e) {
      if (current.current === id) setError(String(e));
    } finally {
      request.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={!!mail}
      onOpenChange={(open) => {
        if (!open && !request.current) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>复制到服务器文件夹</DialogTitle>
          <DialogDescription>
            {mail?.subject || "（无主题）"}
            。复制到同一邮箱的目标文件夹，原邮件保留。
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <Skeleton className="h-32" aria-label="正在加载可复制目录" />
        ) : (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="copy-source">来源文件夹</FieldLabel>
              <Select
                value={source}
                onValueChange={(value) => {
                  setSource(value);
                  setTarget("");
                }}
                disabled={busy || !sources.length}
              >
                <SelectTrigger id="copy-source">
                  <SelectValue placeholder="没有可用来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {sources.map((name) => (
                      <SelectItem key={name} value={name}>
                        {label(name)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="copy-target">目标文件夹</FieldLabel>
              <Select
                value={target}
                onValueChange={setTarget}
                disabled={busy || !targets.length}
              >
                <SelectTrigger id="copy-target">
                  <SelectValue placeholder="选择服务器文件夹" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {targets.map((folder) => (
                      <SelectItem key={folder.name} value={folder.name}>
                        {remoteFolderLabel(folder)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>暂时无法复制</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={
              loading ||
              busy ||
              !source ||
              !targets.some((f) => f.name === target)
            }
            onClick={() => void submit()}
          >
            <Copy data-icon="inline-start" />
            {busy ? "正在记录…" : "复制邮件"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export type DirectoryOperation = {
  id: string;
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
    | "cancelled";
  error: string;
};
const statuses = {
  queued: "待复制",
  preparing: "核对来源",
  submitted: "已提交",
  confirmed: "待核对目标",
  verifying: "核对目标中",
  completed: "复制完成",
  uncertain: "结果未确认",
  blocked: "需要处理",
  cancelled: "已取消",
};
export function DirectoryOperationsPanel() {
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
    <Card>
      <CardHeader>
        <CardTitle>服务器文件夹操作</CardTitle>
        <CardDescription>
          复制后核对目标邮件，原邮件保留。结果未确认的任务不会自动重复复制。
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void reload.current()}
          >
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {(loadError || error) && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{error || loadError}</AlertDescription>
          </Alert>
        )}
        {!items && (
          <Skeleton className="h-16" aria-label="正在加载文件夹操作" />
        )}
        {items?.length === 0 && (
          <p className="text-sm text-muted-foreground">暂无服务器复制任务。</p>
        )}
        <ul className="flex flex-col gap-4" aria-label="服务器文件夹任务">
          {items?.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="break-words">{item.subject || "（无主题）"}</p>
                <p className="text-sm text-muted-foreground">
                  {item.accountEmail} · {item.folder} → {item.target}
                </p>
                {item.error && (
                  <p className="text-sm text-destructive">{item.error}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{statuses[item.status]}</Badge>
                {item.status === "blocked" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void action(item.id, "retry")}
                  >
                    重试
                  </Button>
                )}
                {item.status === "confirmed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void action(item.id, "verify")}
                  >
                    只读核对
                  </Button>
                )}
                {["queued", "blocked"].includes(item.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() => void action(item.id, "cancel")}
                  >
                    取消任务
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
