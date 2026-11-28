import { useState } from "react";
import { t } from "@/lib/i18n";
import { call } from "@/lib/api";
import type { Detail, PgpMessageInfo } from "@/lib/types";
import {
  ChevronDown,
  ChevronUp,
  KeyRound,
  Lock,
  LockOpen,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { PasswordInput } from "./password-input";
import { toast } from "sonner";

export function formatFingerprint(fp: string): string {
  const clean = fp.replace(/\s+/g, "").toUpperCase();
  if (!clean) return "";
  return clean.match(/.{1,4}/g)?.join(" ") ?? clean;
}

export function OpenPgpBanner({
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
  const [expanded, setExpanded] = useState(false);
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

  const Icon = isWarning
    ? ShieldAlert
    : pgp.encrypted && pgp.encryptionState !== "decrypted"
      ? Lock
      : isGood && pgp.signed
        ? ShieldCheck
        : pgp.encrypted
          ? LockOpen
          : pgp.signed
            ? ShieldQuestion
            : KeyRound;

  return (
    <Alert
      variant={isWarning ? "destructive" : "default"}
      className="mb-3 py-2.5"
      data-openpgp-banner=""
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <AlertTitle className="m-0 text-sm font-medium">
              {titleParts.join(" · ")}
            </AlertTitle>
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
          <div className="flex items-center gap-1.5">
            {keyAttachment && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={importingKey}
                onClick={() => void handleImportAttachedKey()}
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                {t("Import public key")}
              </Button>
            )}
            {(pgp.encrypted || pgp.signed) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                {t("Details")}
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
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

        {(pgp.encryptionError || pgp.signatureError) && (
          <AlertDescription className="text-xs">
            {[pgp.encryptionError, pgp.signatureError]
              .filter(Boolean)
              .join(" · ")}
          </AlertDescription>
        )}

        {expanded && (
          <AlertDescription className="mt-1 space-y-1 border-t pt-2 text-xs">
            {pgp.signed && (
              <div>
                <span className="text-muted-foreground">{t("Signer")}: </span>
                <span>
                  {pgp.signerUserId || pgp.signerKeyId || t("Unknown signer")}
                </span>
              </div>
            )}
            {pgp.signerFingerprint && (
              <div className="font-mono text-[11px] break-all">
                <span className="font-sans text-muted-foreground">
                  {t("Signer fingerprint")}:{" "}
                </span>
                {formatFingerprint(pgp.signerFingerprint)}
              </div>
            )}
            {pgp.decryptionKeyFingerprint && (
              <div className="font-mono text-[11px] break-all">
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
          </AlertDescription>
        )}
      </div>
    </Alert>
  );
}
