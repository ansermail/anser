import { useCallback, useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { call, native } from "@/lib/api";
import type { Account, PgpImportResult, PgpKeyInfo } from "@/lib/types";
import { useConfirmation } from "@/hooks/use-confirmation";
import { formatFingerprint } from "./openpgp-banner";
import {
  Copy,
  Download,
  KeyRound,
  Lock,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
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
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Separator } from "./ui/separator";
import { SelectField, SelectOption } from "./ui/select-field";
import { PasswordInput } from "./password-input";
import { toast } from "sonner";

export function OpenPgpSettings({ accounts }: { accounts: Account[] }) {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  const [keys, setKeys] = useState<PgpKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Generate form
  const [genAccountId, setGenAccountId] = useState(accounts[0]?.id ?? "");
  const [genName, setGenName] = useState(accounts[0]?.name ?? "");
  const [genEmail, setGenEmail] = useState(accounts[0]?.email ?? "");
  const [genAlgorithm, setGenAlgorithm] = useState("ed25519");
  const [genPassphrase, setGenPassphrase] = useState("");
  const [genExpires, setGenExpires] = useState("730");

  // Import form
  const [importText, setImportText] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importRemember, setImportRemember] = useState(true);
  const [importAccountId, setImportAccountId] = useState("");

  const refresh = useCallback(async () => {
    try {
      const list = await call<PgpKeyInfo[]>("list_pgp_keys");
      setKeys(list);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!genAccountId && accounts[0]) {
      setGenAccountId(accounts[0].id);
      setGenName(accounts[0].name);
      setGenEmail(accounts[0].email);
    }
  }, [accounts, genAccountId]);

  const ownKeys = keys.filter((k) => k.isSecret);
  const contactKeys = keys.filter((k) => !k.isSecret);

  function selectGenAccount(id: string) {
    setGenAccountId(id);
    const acc = accounts.find((a) => a.id === id);
    if (acc) {
      setGenName(acc.name);
      setGenEmail(acc.email);
    }
  }

  async function handleGenerate() {
    if (!genEmail.trim()) return;
    setBusy(true);
    try {
      await call<PgpKeyInfo>("generate_pgp_key", {
        accountId: genAccountId,
        name: genName.trim(),
        email: genEmail.trim(),
        algorithm: genAlgorithm,
        passphrase: genPassphrase || null,
        expiresDays: genExpires === "0" ? null : Number(genExpires),
      });
      setGenerateOpen(false);
      setGenPassphrase("");
      await refresh();
      toast.success(t("OpenPGP key pair generated"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleImportText() {
    if (!importText.trim()) return;
    setBusy(true);
    try {
      const result = await call<PgpImportResult>("import_pgp_keys", {
        armored: importText,
        accountId: importAccountId || null,
        passphrase: importPassphrase || null,
        rememberPassphrase: importRemember,
      });
      setImportOpen(false);
      setImportText("");
      setImportPassphrase("");
      await refresh();
      toast.success(
        t("Imported {value0} OpenPGP key(s)", {
          value0: result.imported.length,
        }),
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile() {
    if (!native) {
      toast.error(t("File import is available in the desktop app."));
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        filters: [
          { name: "OpenPGP Keys", extensions: ["asc", "gpg", "pgp", "txt"] },
        ],
      });
      if (!selected || Array.isArray(selected)) return;
      setBusy(true);
      const result = await call<PgpImportResult>("import_pgp_key_from_file", {
        path: selected,
        accountId: importAccountId || null,
        passphrase: importPassphrase || null,
        rememberPassphrase: importRemember,
      });
      setImportOpen(false);
      setImportPassphrase("");
      await refresh();
      toast.success(
        t("Imported {value0} OpenPGP key(s)", {
          value0: result.imported.length,
        }),
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyPublic(fingerprint: string) {
    try {
      const armored = await call<string>("export_pgp_public_key", {
        fingerprint,
      });
      await navigator.clipboard.writeText(armored);
      toast.success(t("Public key copied to clipboard"));
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function handleExportFile(key: PgpKeyInfo, secret: boolean) {
    if (secret) {
      const confirmed = await askConfirmation({
        title: t("Export private key backup"),
        description: t(
          "Your private key grants access to decrypt your messages and sign as you. Store the exported file in a secure offline location and never share it.",
        ),
        action: t("Export private key"),
        destructive: true,
      });
      if (!confirmed) return;
    }
    if (!native) {
      toast.error(t("File export is available in the desktop app."));
      return;
    }
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const defaultPath = `${key.email || key.keyId}-${secret ? "secret" : "public"}.asc`;
      const path = await save({
        defaultPath,
        filters: [{ name: "OpenPGP Armor", extensions: ["asc"] }],
      });
      if (!path) return;
      await call("save_pgp_key_file", {
        fingerprint: key.fingerprint,
        secret,
        path,
      });
      toast.success(
        secret ? t("Private key backup saved") : t("Public key saved"),
      );
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function handleDelete(key: PgpKeyInfo) {
    const confirmed = await askConfirmation({
      title: key.isSecret
        ? t("Delete own OpenPGP key")
        : t("Remove contact public key"),
      description: key.isSecret
        ? t(
            "Removing this private key from Anser means previously encrypted emails using it can no longer be decrypted unless you have a backup.",
          )
        : t(
            "Remove the saved OpenPGP public key for {value0}. Existing emails are not modified.",
            { value0: key.email || key.keyId },
          ),
      action: t("Delete key"),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await call("delete_pgp_key", { fingerprint: key.fingerprint });
      await refresh();
      toast.success(t("OpenPGP key removed"));
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function handleBindAccount(fingerprint: string, accountId: string) {
    try {
      await call("bind_pgp_account_key", {
        accountId: accountId === "__none__" ? "" : accountId,
        fingerprint: accountId === "__none__" ? "" : fingerprint,
      });
      await refresh();
      toast.success(t("Account key updated"));
    } catch (error) {
      toast.error(String(error));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>{t("OpenPGP encryption & keys")}</CardTitle>
          <CardDescription>
            {t(
              "Sign and encrypt messages using standard PGP/MIME. Private keys stay in the local encrypted vault and decrypted mail is never indexed or sent to AI.",
            )}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportOpen(true)}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {t("Import key")}
          </Button>
          <Button type="button" size="sm" onClick={() => setGenerateOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {t("Generate key")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">{t("My private keys")}</h3>
            {ownKeys.some((k) => k.isPassphraseProtected) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  void call("lock_pgp_session")
                    .then(() => toast.success(t("Session passphrases cleared")))
                    .catch((e) => toast.error(String(e)))
                }
              >
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {t("Lock session keys")}
              </Button>
            )}
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground">{t("Loading…")}</p>
          ) : ownKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                "No personal OpenPGP key yet. Generate a new key pair or import an existing secret key to sign and decrypt emails.",
              )}
            </p>
          ) : (
            <div className="space-y-2.5">
              {ownKeys.map((key) => (
                <div
                  key={key.fingerprint}
                  className="flex flex-col gap-2 rounded-lg border p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {key.userIds[0] || key.email || key.keyId}
                        </span>
                        <Badge variant="secondary" className="text-[11px]">
                          {key.algorithm}
                        </Badge>
                        {key.isPassphraseProtected && (
                          <Badge variant="outline" className="text-[11px]">
                            {t("Passphrase protected")}
                          </Badge>
                        )}
                        {key.expired && (
                          <Badge variant="destructive" className="text-[11px]">
                            {t("Expired")}
                          </Badge>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground break-all">
                        {formatFingerprint(key.fingerprint)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleCopyPublic(key.fingerprint)}
                      >
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("Copy public key")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleExportFile(key, false)}
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("Public")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleExportFile(key, true)}
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("Backup private")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("Delete key")}
                        onClick={() => void handleDelete(key)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  {accounts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-xs text-muted-foreground">
                        {t("Bound account")}:
                      </span>
                      <div className="w-60 max-w-full">
                        <SelectField
                          value={key.accountId || "__none__"}
                          onValueChange={(value) =>
                            void handleBindAccount(key.fingerprint, value)
                          }
                          aria-label={t("Bound account")}
                        >
                          <SelectOption value="__none__">
                            {t("Match by email automatically")}
                          </SelectOption>
                          {accounts.map((acc) => (
                            <SelectOption key={acc.id} value={acc.id}>
                              {acc.name
                                ? `${acc.name} (${acc.email})`
                                : acc.email}
                            </SelectOption>
                          ))}
                        </SelectField>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              {t("Contact public keys")}
              {contactKeys.length > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                  {contactKeys.length}
                </span>
              )}
            </h3>
          </div>
          {contactKeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t(
                "No contact public keys imported yet. Import a recipient's .asc public key here, in Contacts, or directly from a received email attachment.",
              )}
            </p>
          ) : (
            <div className="space-y-2">
              {contactKeys.map((key) => (
                <div
                  key={key.fingerprint}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium">
                        {key.userIds[0] || key.email || key.keyId}
                      </span>
                      <Badge variant="secondary" className="text-[11px]">
                        {key.algorithm}
                      </Badge>
                      {key.expired && (
                        <Badge variant="destructive" className="text-[11px]">
                          {t("Expired")}
                        </Badge>
                      )}
                      {key.revoked && (
                        <Badge variant="destructive" className="text-[11px]">
                          {t("Revoked")}
                        </Badge>
                      )}
                    </div>
                    <p className="font-mono text-[11px] text-muted-foreground break-all">
                      {formatFingerprint(key.fingerprint)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Copy public key")}
                      onClick={() => void handleCopyPublic(key.fingerprint)}
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Export public key")}
                      onClick={() => void handleExportFile(key, false)}
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Delete key")}
                      onClick={() => void handleDelete(key)}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{t("Generate OpenPGP key pair")}</DialogTitle>
            <DialogDescription>
              {t(
                "Creates a new OpenPGP key pair locally. The private key is stored encrypted in the local vault.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {accounts.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("Email account")}</Label>
                <SelectField
                  value={genAccountId}
                  onValueChange={selectGenAccount}
                  aria-label={t("Email account")}
                  className="w-full"
                >
                  {accounts.map((acc) => (
                    <SelectOption key={acc.id} value={acc.id}>
                      {acc.name ? `${acc.name} (${acc.email})` : acc.email}
                    </SelectOption>
                  ))}
                </SelectField>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pgp-gen-name">{t("Name")}</Label>
                <Input
                  id="pgp-gen-name"
                  value={genName}
                  onChange={(e) => setGenName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pgp-gen-email">{t("Email")}</Label>
                <Input
                  id="pgp-gen-email"
                  type="email"
                  value={genEmail}
                  onChange={(e) => setGenEmail(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("Algorithm")}</Label>
                <SelectField
                  value={genAlgorithm}
                  onValueChange={setGenAlgorithm}
                  aria-label={t("Algorithm")}
                  className="w-full"
                >
                  <SelectOption value="ed25519">
                    Ed25519 / Curve25519
                  </SelectOption>
                  <SelectOption value="rsa4096">RSA 4096</SelectOption>
                </SelectField>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Validity")}</Label>
                <SelectField
                  value={genExpires}
                  onValueChange={setGenExpires}
                  aria-label={t("Validity")}
                  className="w-full"
                >
                  <SelectOption value="365">{t("1 year")}</SelectOption>
                  <SelectOption value="730">{t("2 years")}</SelectOption>
                  <SelectOption value="1825">{t("5 years")}</SelectOption>
                  <SelectOption value="0">{t("Never expires")}</SelectOption>
                </SelectField>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pgp-gen-passphrase">
                {t("Passphrase (optional)")}
              </Label>
              <PasswordInput
                id="pgp-gen-passphrase"
                value={genPassphrase}
                onChange={(e) => setGenPassphrase(e.target.value)}
                placeholder={t("Optional extra protection for key backups")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setGenerateOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy || !genEmail.trim()}
              onClick={() => void handleGenerate()}
            >
              {busy ? t("Generating…") : t("Generate key")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t("Import OpenPGP key")}</DialogTitle>
            <DialogDescription>
              {t(
                "Import a public or private OpenPGP key from a file (.asc / .gpg) or paste ASCII-armored key text.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="pgp-import-text">
                {t("ASCII-armored key block")}
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleImportFile()}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {t("Choose key file…")}
              </Button>
            </div>
            <Textarea
              id="pgp-import-text"
              rows={6}
              className="font-mono text-xs"
              placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
            />
            {accounts.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("Bind imported private key to account")}</Label>
                <SelectField
                  value={importAccountId || "__auto__"}
                  onValueChange={(v) =>
                    setImportAccountId(v === "__auto__" ? "" : v)
                  }
                  aria-label={t("Bind imported private key to account")}
                >
                  <SelectOption value="__auto__">
                    {t("Match by email automatically")}
                  </SelectOption>
                  {accounts.map((acc) => (
                    <SelectOption key={acc.id} value={acc.id}>
                      {acc.name ? `${acc.name} (${acc.email})` : acc.email}
                    </SelectOption>
                  ))}
                </SelectField>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pgp-import-pass">
                {t("Private key passphrase (if protected)")}
              </Label>
              <PasswordInput
                id="pgp-import-pass"
                value={importPassphrase}
                onChange={(e) => setImportPassphrase(e.target.value)}
              />
            </div>
            <Label className="flex items-center gap-2 text-xs font-normal">
              <Checkbox
                checked={importRemember}
                onCheckedChange={(v) => setImportRemember(v === true)}
              />
              {t("Remember passphrase in encrypted vault")}
            </Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setImportOpen(false)}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy || !importText.trim()}
              onClick={() => void handleImportText()}
            >
              {busy ? t("Importing…") : t("Import key")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmationDialog}
    </Card>
  );
}
