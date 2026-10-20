import { t } from "@/lib/i18n";
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
        title: t("Move local archives?"),
        description: t(
          "Original messages and attachments will move to {value0}. After verification, the location switches and migrated files at the old location are cleaned up. Accounts, indexes and settings stay on this Mac. Keep external disks connected.",
          {
            value0: parent
              ? `${parent}/Anser-Archive/archive`
              : status?.defaultPath,
          },
        ),
        action: t("Start migration"),
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
        toast.success(
          t("Archive location updated. Originals and attachments migrated."),
        );
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
      title: t("Select an archive disk or folder"),
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
      <div
        className="flex flex-col gap-4"
        role="group"
        aria-label={t("Archive management")}
      >
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
            {t("Change archive location")}
          </Button>
          {status?.external && (
            <Button
              variant="outline"
              disabled={busy || status.migrating || !status.available}
              onClick={() => void move("")}
            >
              {t("Restore default location")}
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
            {t("Open storage location")}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Refresh archive location")}
            onClick={() => void reload()}
          >
            <RefreshCw />
          </Button>
        </div>
        <p className="break-all text-xs text-muted-foreground">
          {status?.path || initialPath || t("Reading archive location…")}
        </p>
        {(error || status?.error) && (
          <Alert variant="destructive">
            <AlertDescription>{error || status?.error}</AlertDescription>
          </Alert>
        )}
        {status?.external && (
          <p className="text-sm text-muted-foreground">
            {t(
              "Keep the archive disk connected. The message list remains available when disconnected; original access, backups and saving pause without falling back to this Mac.",
            )}
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
              {t("Migrating & verifying: ")}
              {status?.completed || 0} / {status?.total || 0}{" "}
              {t(" originals. The location switches when complete.")}
            </p>
          </div>
        )}
        {status?.cleanupPending && (
          <Alert>
            <AlertDescription>
              {t(
                "The new location holds all originals. Some files at the old location still need cleanup. Connect the disks to continue.",
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy || status.migrating}
                onClick={() => void cleanup()}
              >
                {t("Continue cleanup at old location")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {(!native || isDemo()) && (
          <p className="text-sm text-muted-foreground">
            {t(
              "Web previews and sample mailboxes do not migrate local files. Choose a location in the desktop app.",
            )}
          </p>
        )}
      </div>
      {confirmationDialog}
    </>
  );
}
