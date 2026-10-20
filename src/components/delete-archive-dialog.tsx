import { t } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { call, isDemo } from "@/lib/api";
import { formatSize } from "@/lib/providers";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Skeleton } from "./ui/skeleton";
import { Switch } from "./ui/switch";
import { Alert, AlertDescription } from "./ui/alert";
import { SelectField, SelectOption } from "./ui/select-field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export interface ArchiveDeletionPreview {
  count: number;
  bytes: number;
  offlineOnly: number;
  reviewToken: string;
  accounts: { accountId: string; name: string; email: string; count: number }[];
}
export function DeleteArchiveDialog({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<ArchiveDeletionPreview | null>(null);
  const [accounts, setAccounts] = useState<ArchiveDeletionPreview["accounts"]>(
    [],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopSaving, setStopSaving] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreview(null);
    setConfirmed(false);
    setError("");
    void call<ArchiveDeletionPreview>("archive_deletion_preview", { accountId })
      .then((value) => {
        if (!live) return;
        setPreview(value);
        if (!accountId) setAccounts(value.accounts);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [open, accountId, revision]);
  async function remove() {
    if (!preview || !confirmed || busy || !preview.count) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<{
        deleted: number;
        freedBytes: number;
        cleanupPending: boolean;
      }>("delete_local_archives", {
        accountId,
        stopSaving,
        expectedCount: preview.count,
        expectedToken: preview.reviewToken,
      });
      setOpen(false);
      onDeleted();
      toast.success(
        t("{value0}存档已删除 {value1} 封{value2}", {
          value0: isDemo() ? t("示例") : t("本地"),
          value1: result.deleted,
          value2: result.freedBytes
            ? `，释放 ${formatSize(result.freedBytes)}`
            : "",
        }),
      );
      if (result.cleanupPending)
        toast.warning(t("文件清理尚未完成，重新打开应用后会继续清理"));
    } catch (e) {
      setError(String(e));
      setConfirmed(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setAccountId("");
          setStopSaving(true);
          setOpen(true);
        }}
      >
        <Trash2 size={15} />
        {t("删除本地存档")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          showCloseButton={!busy}
          onEscapeKeyDown={(e) => {
            if (busy) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("删除本地存档")}</DialogTitle>
            <DialogDescription>
              {t("清理本机保存的邮件正文与附件，服务器上的邮件不受影响。")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="archive-delete-scope">{t("删除范围")}</Label>
            <SelectField
              id="archive-delete-scope"
              aria-label={t("删除范围")}
              value={accountId}
              onValueChange={setAccountId}
              disabled={busy || !preview}
            >
              <SelectOption value="">{t("全部账号")}</SelectOption>
              {accounts.map((a) => (
                <SelectOption key={a.accountId} value={a.accountId}>
                  {a.name} · {a.email}（{a.count}
                  {t(" 封）")}
                </SelectOption>
              ))}
            </SelectField>
          </div>
          {!preview && !error && <Skeleton className="h-16 w-full" />}
          {preview && (
            <div className="text-sm space-y-2">
              <p>
                {t("将删除 ")}
                <strong>
                  {preview.count}
                  {t(" 封")}
                </strong>
                {t("本地存档，原始邮件大小")} {formatSize(preview.bytes)}。
              </p>
              <p className="text-muted-foreground">
                {t(
                  "有服务器来源的邮件保留列表信息，之后联网查看正文；服务器已删除的邮件无法在线找回。",
                )}
              </p>
              {preview.offlineOnly > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {preview.offlineOnly}{" "}
                    {t(
                      "封没有可用的服务器来源，将从列表移除。删除后只能从已有备份恢复。",
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <p className="text-muted-foreground">
                {t("发送记录、草稿和已导出的备份单独保留。")}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="archive-stop-saving">
              {t("同时关闭所选账号后续的自动本地保存")}
            </Label>
            <Switch
              id="archive-stop-saving"
              checked={stopSaving}
              onCheckedChange={setStopSaving}
              disabled={busy}
            />
          </div>
          {!stopSaving && (
            <p className="text-sm text-muted-foreground">
              {t("仍开启本地保存的账号会在之后收取时重新下载存档。")}
            </p>
          )}
          <div className="flex items-start gap-2">
            <Checkbox
              id="archive-delete-confirm"
              checked={confirmed}
              disabled={busy || !preview?.count}
              onCheckedChange={(value) => setConfirmed(value === true)}
            />
            <Label htmlFor="archive-delete-confirm">
              {t("我确认删除所选本地存档，已保留需要的备份")}
            </Label>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {isDemo() && (
            <p className="text-sm text-muted-foreground">
              {t("演示模式仅清理示例邮件。")}
            </p>
          )}
          <DialogFooter>
            {error && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRevision((v) => v + 1)}
              >
                {t("重新查看范围")}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("取消")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !preview?.count || !confirmed}
              onClick={() => void remove()}
            >
              {busy && <LoaderCircle size={15} className="animate-spin" />}
              {busy ? t("正在删除…") : t("确认删除")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
