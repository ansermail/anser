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
        t("{value0}Deleted {value1} archived messages{value2}", {
          value0: isDemo() ? t("Demo") : t("Local"),
          value1: result.deleted,
          value2: result.freedBytes
            ? `，释放 ${formatSize(result.freedBytes)}`
            : "",
        }),
      );
      if (result.cleanupPending)
        toast.warning(
          t("File cleanup is incomplete and will continue after relaunch"),
        );
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
        {t("Delete local archives")}
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
            <DialogTitle>{t("Delete local archives")}</DialogTitle>
            <DialogDescription>
              {t(
                "Remove locally saved message bodies and attachments. Server messages are unaffected.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="archive-delete-scope">{t("Deletion scope")}</Label>
            <SelectField
              id="archive-delete-scope"
              aria-label={t("Deletion scope")}
              value={accountId}
              onValueChange={setAccountId}
              disabled={busy || !preview}
            >
              <SelectOption value="">{t("All accounts")}</SelectOption>
              {accounts.map((a) => (
                <SelectOption key={a.accountId} value={a.accountId}>
                  {a.name} · {a.email}（{a.count}
                  {t(" messages)")}
                </SelectOption>
              ))}
            </SelectField>
          </div>
          {!preview && !error && <Skeleton className="h-16 w-full" />}
          {preview && (
            <div className="text-sm space-y-2">
              <p>
                {t("Delete ")}
                <strong>
                  {preview.count}
                  {t("messages (storage)")}
                </strong>
                {t("local archives, original size: ")}{" "}
                {formatSize(preview.bytes)}。
              </p>
              <p className="text-muted-foreground">
                {t(
                  "Messages with a server source remain in the list and can load bodies online. Messages already deleted from the server cannot be recovered online.",
                )}
              </p>
              {preview.offlineOnly > 0 && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {preview.offlineOnly}{" "}
                    {t(
                      " messages have no available server source and will be removed from the list. Restore only from an existing backup after deletion.",
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <p className="text-muted-foreground">
                {t(
                  "Send history, drafts and exported backups are kept separately.",
                )}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="archive-stop-saving">
              {t(
                "Also disable future automatic local saving for selected accounts",
              )}
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
              {t(
                "Accounts with local saving enabled will download archives again during future checks.",
              )}
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
              {t(
                "I confirm deletion of the selected archives and have kept the backups I need",
              )}
            </Label>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {isDemo() && (
            <p className="text-sm text-muted-foreground">
              {t("Demo mode only clears sample messages.")}
            </p>
          )}
          <DialogFooter>
            {error && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRevision((v) => v + 1)}
              >
                {t("Review scope again")}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !preview?.count || !confirmed}
              onClick={() => void remove()}
            >
              {busy && <LoaderCircle size={15} className="animate-spin" />}
              {busy ? t("Deleting…") : t("Confirm deletion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
