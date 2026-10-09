import { useEffect, useRef, useState, type ReactNode } from "react";
import { FolderOpen, HardDrive, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call, native, isDemo } from "@/lib/api";
import { useConfirmation } from "@/hooks/use-confirmation";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
export interface ArchiveLocationStatus {
  path: string;
  defaultPath: string;
  available: boolean;
  error: string;
  external: boolean;
  cleanupPending: boolean;
  migrating: boolean;
  completed: number;
  total: number;
}
export function ArchiveLocation({
  onChanged,
  initialPath,
  children,
}: {
  onChanged: () => void;
  initialPath?: string;
  children?: ReactNode;
}) {
  const [status, setStatus] = useState<ArchiveLocationStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const live = useRef(true),
    request = useRef(false),
    loading = useRef(false);
  async function reload() {
    if (loading.current) return;
    loading.current = true;
    try {
      const value = await call<ArchiveLocationStatus>("archive_location");
      if (live.current) {
        setStatus(value);
      }
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      loading.current = false;
    }
  }
  useEffect(() => {
    live.current = true;
    void reload();
    const timer = setInterval(() => void reload(), 2000);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, []);
  async function move(parent: string) {
    if (request.current || !native || isDemo()) return;
    if (
      !(await askConfirmation({
        title: "迁移本地存档？",
        description: `邮件原件与附件将迁移至${parent ? `${parent}/Anser-Archive/archive` : status?.defaultPath}。完成校验后切换位置并清理原位置的已迁移文件。账号、列表和设置仍保存在本机；使用外置磁盘时请保持连接。`,
        action: "开始迁移",
      }))
    )
      return;
    request.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await call<ArchiveLocationStatus>(
        "move_archive_location",
        { parent },
      );
      if (live.current) {
        setStatus(result);
        onChanged();
        toast.success("存档路径已更新，原件与附件迁移完成");
      }
    } catch (e) {
      if (live.current) {
        setError(String(e));
        await reload();
        onChanged();
      }
    } finally {
      request.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function select() {
    if (!native || isDemo() || request.current) return;
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      directory: true,
      multiple: false,
      title: "选择存档磁盘或文件夹",
    });
    if (typeof selected === "string") await move(selected);
  }
  async function cleanup() {
    if (request.current) return;
    request.current = true;
    setBusy(true);
    setError("");
    try {
      const value = await call<ArchiveLocationStatus>(
        "cleanup_archive_migration",
      );
      if (live.current) setStatus(value);
    } catch (e) {
      if (live.current) setError(String(e));
    } finally {
      request.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-col gap-4" role="group" aria-label="存档管理">
        <div className="storage-actions flex-wrap">
          {children}
          <Button
            variant="outline"
            disabled={
              !native ||
              isDemo() ||
              busy ||
              !!status?.migrating ||
              !status?.available
            }
            onClick={() => void select()}
          >
            <HardDrive data-icon="inline-start" />
            修改存档位置
          </Button>
          {status?.external && (
            <Button
              variant="outline"
              disabled={busy || status.migrating || !status.available}
              onClick={() => void move("")}
            >
              恢复默认位置
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={!status?.available}
            onClick={() =>
              void call("open_data_folder").catch((e) => toast.error(String(e)))
            }
          >
            <FolderOpen data-icon="inline-start" />
            打开存储位置
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="刷新存档位置"
            onClick={() => void reload()}
          >
            <RefreshCw />
          </Button>
        </div>
        <p className="break-all text-xs text-muted-foreground">
          {status?.path || initialPath || "正在读取存档位置…"}
        </p>
        {(error || status?.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error || status?.error}</AlertDescription>
          </Alert>
        )}
        {status?.external && (
          <p className="text-sm text-muted-foreground">
            请保持存档磁盘连接。未连接时可以查看邮件列表，完整原件读取、备份和保存会暂停，不会自动改存到本机。
          </p>
        )}
        {(busy || status?.migrating) && (
          <div className="flex flex-col gap-2">
            <Progress
              value={
                status?.total ? (status.completed / status.total) * 100 : null
              }
            />
            <p className="text-sm text-muted-foreground">
              正在迁移与校验：{status?.completed || 0} / {status?.total || 0}{" "}
              个原件。完成后自动切换位置。
            </p>
          </div>
        )}
        {status?.cleanupPending && (
          <Alert>
            <AlertDescription>
              新位置已保留完整原件，原位置还有待清理文件。连接相关磁盘后可继续清理。
              <Button
                variant="outline"
                size="sm"
                disabled={busy || status.migrating}
                onClick={() => void cleanup()}
              >
                继续清理原位置
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {(!native || isDemo()) && (
          <p className="text-sm text-muted-foreground">
            网页预览与示例邮箱不迁移本机文件，请在桌面应用中选择位置。
          </p>
        )}
      </div>
      {confirmationDialog}
    </>
  );
}
