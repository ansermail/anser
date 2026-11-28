import { useState } from "react";
import { t } from "@/lib/i18n";
import { call } from "@/lib/api";
import type { Detail, PgpMessageInfo } from "@/lib/types";
import {
  KeyRound,
  Lock,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";
import { PasswordInput } from "./password-input";
import { toast } from "sonner";

export function formatFingerprint(fp: string): string {
  const clean = fp.replace(/\s+/g, "").toUpperCase();
  if (!clean) return "";
  return clean.match(/.{1,4}/g)?.join(" ") ?? clean;
}

function pgpStatusMeta(pgp: PgpMessageInfo) {
  const isWarning =
    pgp.encryptionState === "failed" ||
    pgp.encryptionState === "missingKey" ||
    pgp.signatureState === "invalid" ||
    pgp.signatureState === "error" ||
    pgp.signatureState === "revokedKey" ||
    pgp.signatureState === "expiredKey" ||
    (pgp.signatureState === "valid" && !pgp.senderMatchesSigner);

  const isGood =
    (!pgp.encrypted || pgp.encryptionState === "decrypted") &&
    (!pgp.signed ||
      (pgp.signatureState === "valid" && pgp.senderMatchesSigner));

  const titleParts: string[] = [];
  if (pgp.encrypted) {
    if (pgp.encryptionState === "decrypted") {
      titleParts.push(t("OpenPGP encrypted (decrypted)"));
    } else if (pgp.encryptionState === "passphraseRequired") {
      titleParts.push(t("OpenPGP encrypted — passphrase required"));
    } else if (pgp.encryptionState === "missingKey") {
      titleParts.push(t("OpenPGP encrypted — matching private key not found"));
    } else {
      titleParts.push(t("OpenPGP decryption failed"));
    }
  }
  if (pgp.signed) {
    if (pgp.signatureState === "valid") {
      titleParts.push(
        pgp.senderMatchesSigner
          ? t("Signature verified")
          : t("Valid signature, but signer does not match sender"),
      );
    } else if (pgp.signatureState === "invalid") {
      titleParts.push(t("Invalid digital signature"));
    } else if (pgp.signatureState === "missingKey") {
      titleParts.push(t("Signed — sender public key not imported"));
    } else if (pgp.signatureState === "expiredKey") {
      titleParts.push(t("Signed with an expired key"));
    } else if (pgp.signatureState === "revokedKey") {
      titleParts.push(t("Signed with a revoked key"));
    } else if (pgp.signatureState === "error") {
      titleParts.push(t("Could not verify digital signature"));
    }
  }
  if (!titleParts.length && pgp.hasAttachedPublicKey) {
    titleParts.push(t("Contains an OpenPGP public key attachment"));
  }

  const Icon = isWarning
    ? ShieldAlert
    : pgp.encrypted
      ? Lock
      : isGood && pgp.signed
        ? ShieldCheck
        : pgp.signed
          ? ShieldQuestion
          : KeyRound;

  return { isWarning, isGood, title: titleParts.join(" · "), Icon };
}

/**
 * Compact lock/shield icon button for the message metadata bar.
 * Clicking opens a popover with full OpenPGP encryption/signature details,
 * attached public key import, and passphrase unlock controls.
 */
export function OpenPgpIndicator({
  mailId,
  pgp,
  attachments,
  onReload,
}: {
  mailId: string;
  pgp?: PgpMessageInfo | null;
  attachments: Detail["attachments"];
  onReload?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [importingKey, setImportingKey] = useState(false);

  if (!pgp || (!pgp.encrypted && !pgp.signed && !pgp.hasAttachedPublicKey)) {
    return null;
  }

  const keyAttachment = attachments.find(
    (a) =>
      a.mime.toLowerCase() === "application/pgp-keys" ||
      a.name.toLowerCase().endsWith(".asc"),
  );
  const { isWarning, isGood, title, Icon } = pgpStatusMeta(pgp);

  async function handleUnlock() {
    if (!pgp?.decryptionKeyFingerprint || !passphrase) return;
    setUnlocking(true);
    try {
      await call("unlock_pgp_key", {
        fingerprint: pgp.decryptionKeyFingerprint,
        passphrase,
        remember,
      });
      setPassphrase("");
      setOpen(false);
      toast.success(t("OpenPGP key unlocked"));
      onReload?.();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setUnlocking(false);
    }
  }

  async function handleImportAttachedKey() {
    if (!keyAttachment) return;
    setImportingKey(true);
    try {
      const result = await call<{ imported: { fingerprint: string }[] }>(
        "import_pgp_key_from_attachment",
        { mailId, index: keyAttachment.index },
      );
      toast.success(
        t("Imported {value0} OpenPGP key(s)", {
          value0: result.imported.length,
        }),
      );
      onReload?.();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setImportingKey(false);
    }
  }

  const iconTone = isWarning
    ? "text-destructive hover:text-destructive"
    : isGood
      ? "text-primary hover:text-primary"
      : "text-muted-foreground hover:text-foreground";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={iconTone}
          aria-label={title}
          title={title}
          data-openpgp-indicator=""
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] space-y-3 p-3.5">
        <div className="flex items-start gap-2">
          <Icon
            className={`mt-0.5 size-4 shrink-0 ${isWarning ? "text-destructive" : isGood ? "text-primary" : "text-muted-foreground"}`}
            aria-hidden="true"
          />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium leading-snug text-foreground">
              {title}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {pgp.format === "inlinePgp" && (
                <Badge variant="outline" className="text-[11px] font-normal">
                  Inline PGP
                </Badge>
              )}
              {pgp.encrypted && (
                <Badge variant="secondary" className="text-[11px] font-normal">
                  {t("AI disabled for encrypted mail")}
                </Badge>
              )}
            </div>
          </div>
        </div>

        {(pgp.encryptionError || pgp.signatureError) && (
          <p className="text-xs text-destructive">
            {[pgp.encryptionError, pgp.signatureError]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}

        {(pgp.signed ||
          pgp.signerFingerprint ||
          pgp.decryptionKeyFingerprint ||
          (pgp.encryptionState === "missingKey" &&
            pgp.recipientKeyIds &&
            pgp.recipientKeyIds.length > 0)) && (
          <>
            <Separator />
            <div className="space-y-1.5 text-xs">
              {pgp.signed && (
                <div>
                  <span className="text-muted-foreground">{t("Signer")}: </span>
                  <span className="break-all">
                    {pgp.signerUserId || pgp.signerKeyId || t("Unknown signer")}
                  </span>
                </div>
              )}
              {pgp.signerFingerprint && (
                <div className="font-mono text-[11px] break-words">
                  <span className="font-sans text-muted-foreground">
                    {t("Signer fingerprint")}:{" "}
                  </span>
                  {formatFingerprint(pgp.signerFingerprint)}
                </div>
              )}
              {pgp.decryptionKeyFingerprint && (
                <div className="font-mono text-[11px] break-words">
                  <span className="font-sans text-muted-foreground">
                    {t("Decryption key")}:{" "}
                  </span>
                  {formatFingerprint(pgp.decryptionKeyFingerprint)}
                </div>
              )}
              {pgp.encryptionState === "missingKey" &&
                pgp.recipientKeyIds &&
                pgp.recipientKeyIds.length > 0 && (
                  <div className="font-mono text-[11px] break-all">
                    <span className="font-sans text-muted-foreground">
                      {t("Encrypted for key IDs")}:{" "}
                    </span>
                    {pgp.recipientKeyIds.join(", ")}
                  </div>
                )}
            </div>
          </>
        )}

        {pgp.encryptionState === "passphraseRequired" && (
          <>
            <Separator />
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleUnlock();
              }}
            >
              <PasswordInput
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={t("Enter OpenPGP key passphrase")}
                aria-label={t("Enter OpenPGP key passphrase")}
              />
              <Label className="flex items-center gap-1.5 text-xs font-normal">
                <Checkbox
                  checked={remember}
                  onCheckedChange={(v) => setRemember(v === true)}
                />
                {t("Remember passphrase in encrypted vault")}
              </Label>
              <Button
                type="submit"
                size="sm"
                className="w-full"
                disabled={unlocking || !passphrase}
              >
                {unlocking ? t("Unlocking…") : t("Unlock & decrypt")}
              </Button>
            </form>
          </>
        )}

        {keyAttachment && (
          <>
            <Separator />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={importingKey}
              onClick={() => void handleImportAttachedKey()}
            >
              <KeyRound className="size-3.5" aria-hidden="true" />
              {t("Import public key")}
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline OpenPGP alert shown only when an encrypted message cannot be read
 * until unlocked or fixed (passphraseRequired / missingKey / failed).
 * Normal decrypted/signed messages use the compact lock icon in the header.
 */
export function OpenPgpBanner({
  pgp,
  onReload,
}: {
  mailId: string;
  pgp?: PgpMessageInfo | null;
  attachments: Detail["attachments"];
  onReload?: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(false);
  const [unlocking, setUnlocking] = useState(false);

  const needsInlineAction =
    !!pgp?.encrypted &&
    (pgp.encryptionState === "passphraseRequired" ||
      pgp.encryptionState === "missingKey" ||
      pgp.encryptionState === "failed");

  if (!pgp || !needsInlineAction) {
    return null;
  }

  const { isWarning, title, Icon } = pgpStatusMeta(pgp);

  async function handleUnlock() {
    if (!pgp?.decryptionKeyFingerprint || !passphrase) return;
    setUnlocking(true);
    try {
      await call("unlock_pgp_key", {
        fingerprint: pgp.decryptionKeyFingerprint,
        passphrase,
        remember,
      });
      setPassphrase("");
      toast.success(t("OpenPGP key unlocked"));
      onReload?.();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setUnlocking(false);
    }
  }

  return (
    <Alert
      variant={isWarning ? "destructive" : "default"}
      className="mb-3 flex items-start gap-2.5 py-3 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg+div]:translate-y-0 [&>svg~*]:pl-0"
      data-openpgp-banner=""
    >
      <Icon className="size-4" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTitle className="m-0 text-sm font-medium">{title}</AlertTitle>
          <Badge variant="secondary" className="text-[11px] font-normal">
            {t("AI disabled for encrypted mail")}
          </Badge>
        </div>

        {pgp.encryptionState === "passphraseRequired" && (
          <form
            className="flex flex-wrap items-center gap-2 pt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
          >
            <div className="w-60 max-w-full">
              <PasswordInput
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder={t("Enter OpenPGP key passphrase")}
                aria-label={t("Enter OpenPGP key passphrase")}
              />
            </div>
            <Button type="submit" size="sm" disabled={unlocking || !passphrase}>
              {unlocking ? t("Unlocking…") : t("Unlock & decrypt")}
            </Button>
            <Label className="flex items-center gap-1.5 text-xs font-normal">
              <Checkbox
                checked={remember}
                onCheckedChange={(v) => setRemember(v === true)}
              />
              {t("Remember passphrase in encrypted vault")}
            </Label>
          </form>
        )}

        {pgp.encryptionError && (
          <AlertDescription className="text-xs">
            {pgp.encryptionError}
          </AlertDescription>
        )}

        {pgp.encryptionState === "missingKey" &&
          pgp.recipientKeyIds &&
          pgp.recipientKeyIds.length > 0 && (
            <AlertDescription className="font-mono text-[11px] break-all">
              <span className="font-sans text-muted-foreground">
                {t("Encrypted for key IDs")}:{" "}
              </span>
              {pgp.recipientKeyIds.join(", ")}
            </AlertDescription>
          )}
      </div>
    </Alert>
  );
}
