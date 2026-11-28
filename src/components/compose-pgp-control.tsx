import { useCallback, useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { call } from "@/lib/api";
import type { PgpComposeCheck, PgpImportResult } from "@/lib/types";
import {
  Check,
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { PasswordInput } from "./password-input";
import { toast } from "sonner";

export function ComposePgpControl({
  accountId,
  recipients,
  sign,
  encrypt,
  attachPublicKey,
  disabled,
  onChange,
}: {
  accountId: string;
  recipients: string[];
  sign: boolean;
  encrypt: boolean;
  attachPublicKey: boolean;
  disabled?: boolean;
  onChange: (next: {
    pgpSign?: boolean;
    pgpEncrypt?: boolean;
    pgpAttachPublicKey?: boolean;
  }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [check, setCheck] = useState<PgpComposeCheck | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const recipientsKey = recipients.join("\0");

  const refresh = useCallback(async () => {
    if (!accountId) return;
    try {
      const result = await call<PgpComposeCheck>("check_pgp_compose", {
        accountId,
        recipients,
      });
      setCheck(result);
    } catch {
      setCheck(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, recipientsKey]);

  useEffect(() => {
    if (open || sign || encrypt || attachPublicKey) {
      void refresh();
    }
  }, [open, sign, encrypt, attachPublicKey, refresh]);

  async function handleUnlock() {
    if (!check?.senderFingerprint || !passphrase) return;
    setUnlocking(true);
    try {
      await call("unlock_pgp_key", {
        fingerprint: check.senderFingerprint,
        passphrase,
        remember: false,
      });
      setPassphrase("");
      await refresh();
      toast.success(t("OpenPGP key unlocked"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setUnlocking(false);
    }
  }

  async function handleQuickImport() {
    if (!importText.trim()) return;
    setImporting(true);
    try {
      const res = await call<PgpImportResult>("import_pgp_keys", {
        armored: importText,
        accountId: null,
        passphrase: null,
        rememberPassphrase: false,
      });
      setImportOpen(false);
      setImportText("");
      await refresh();
      toast.success(
        t("Imported {value0} OpenPGP key(s)", { value0: res.imported.length }),
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setImporting(false);
    }
  }

  const activeLabel =
    sign && encrypt
      ? t("Sign & encrypt")
      : encrypt
        ? t("Encrypted")
        : sign
          ? t("Signed")
          : "OpenPGP";

  const hasWarning =
    (encrypt && check && !check.allRecipientsReady) ||
    (sign && check && !check.senderHasSecretKey);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant={sign || encrypt ? "secondary" : "outline"}
            disabled={disabled}
            aria-label={t("OpenPGP security options")}
          >
            {hasWarning ? (
              <ShieldAlert className="h-4 w-4 text-destructive" />
            ) : encrypt ? (
              <Lock className="h-4 w-4" />
            ) : sign ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <KeyRound className="h-4 w-4" />
            )}
            <span>{activeLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={10}
          className="w-80 space-y-3 p-3.5"
        >
          <div className="space-y-0.5">
            <h4 className="text-sm font-medium">{t("OpenPGP (PGP/MIME)")}</h4>
            <p className="text-xs text-muted-foreground">
              {t("Standard RFC 3156 signing and end-to-end encryption.")}
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="compose-pgp-sign"
                className="flex flex-col items-start gap-0.5 font-normal"
              >
                <span className="text-sm font-medium">
                  {t("Digitally sign")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {check && !check.senderHasSecretKey
                    ? t("No personal key bound to this account")
                    : t("Prove sender identity and integrity")}
                </span>
              </Label>
              <Switch
                id="compose-pgp-sign"
                checked={sign}
                disabled={disabled || (!!check && !check.senderHasSecretKey)}
                onCheckedChange={(checked) => onChange({ pgpSign: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="compose-pgp-encrypt"
                className="flex flex-col items-start gap-0.5 font-normal"
              >
                <span className="text-sm font-medium">
                  {t("Encrypt message")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("Requires public keys for all recipients")}
                </span>
              </Label>
              <Switch
                id="compose-pgp-encrypt"
                checked={encrypt}
                disabled={disabled}
                onCheckedChange={(checked) => onChange({ pgpEncrypt: checked })}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor="compose-pgp-attach-key"
                className="flex flex-col items-start gap-0.5 font-normal"
              >
                <span className="text-sm font-medium">
                  {t("Attach my public key")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("Include .asc public key for replies")}
                </span>
              </Label>
              <Switch
                id="compose-pgp-attach-key"
                checked={attachPublicKey}
                disabled={disabled || (!!check && !check.senderHasSecretKey)}
                onCheckedChange={(checked) =>
                  onChange({ pgpAttachPublicKey: checked })
                }
              />
            </div>
          </div>

          {check?.senderPassphraseNeeded && sign && (
            <>
              <Separator />
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">
                  {t("Unlock your signing key for this session:")}
                </p>
                <div className="flex items-center gap-1.5">
                  <PasswordInput
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder={t("Enter OpenPGP key passphrase")}
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={unlocking || !passphrase}
                    onClick={() => void handleUnlock()}
                  >
                    {t("Unlock")}
                  </Button>
                </div>
              </div>
            </>
          )}

          {encrypt && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    {t("Recipient public keys")}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload className="h-3 w-3" aria-hidden="true" />
                    {t("Import key")}
                  </Button>
                </div>
                {!check || check.recipients.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("Add recipients to verify their OpenPGP keys.")}
                  </p>
                ) : (
                  <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
                    {check.recipients.map((r) => (
                      <li
                        key={r.email}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{r.email}</span>
                        {r.hasKey ? (
                          <Badge
                            variant="secondary"
                            className="shrink-0 gap-1 text-[10px]"
                          >
                            <Check className="h-3 w-3" aria-hidden="true" />
                            {t("Ready")}
                          </Badge>
                        ) : (
                          <Badge
                            variant="destructive"
                            className="shrink-0 text-[10px]"
                          >
                            {r.revoked
                              ? t("Revoked")
                              : r.expired
                                ? t("Expired")
                                : t("Missing key")}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t("Import recipient public key")}</DialogTitle>
            <DialogDescription>
              {t("Paste an ASCII-armored OpenPGP public key block.")}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={6}
            className="font-mono text-xs"
            placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => setImportOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={importing || !importText.trim()}
              onClick={() => void handleQuickImport()}
            >
              {importing ? t("Importing…") : t("Import key")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
