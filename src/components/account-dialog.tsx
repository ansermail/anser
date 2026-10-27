import { t } from "@/lib/i18n";
import { Switch } from "./ui/switch";
import { Checkbox } from "./ui/checkbox";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  ShieldCheck,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { call, native, isDemo } from "@/lib/api";
import { Channel } from "@tauri-apps/api/core";
import { makeAccount, providers } from "@/lib/providers";
import type { Account } from "@/lib/types";
import { toast } from "sonner";
import { AccountEmailField } from "./account-email-field";
export function AccountDialog({
  open,
  onOpenChange,
  onDone,
  editing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: (connected?: Account) => void;
  editing?: Account | null;
}) {
  const [account, setAccount] = useState<Account | null>(null),
    [password, setPassword] = useState(""),
    [smtpPassword, setSmtpPassword] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [busy, setBusy] = useState(false),
    [reauthorize, setReauthorize] = useState(false),
    [smtpUseIncoming, setSmtpUseIncoming] = useState(false),
    [stage, setStage] = useState(""),
    [cancelling, setCancelling] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setAccount(editing ? { ...editing } : null);
    setAdvanced(!!editing);
    setPassword("");
    setSmtpPassword("");
    setReauthorize(false);
    setSmtpUseIncoming(false);
    setError("");
  }, [open, editing]);
  function close(v: boolean) {
    if (busy) return;
    onOpenChange(v);
    if (!v) {
      setAccount(null);
      setPassword("");
      setSmtpPassword("");
      setError("");
    }
  }
  function update(p: Partial<Account>) {
    setAccount((a) => (a ? { ...a, ...p } : a));
  }
  async function connect() {
    if (!account) return;
    setBusy(true);
    setStage("");
    setCancelling(false);
    setError("");
    let active = true;
    try {
      const progress = native && !isDemo() ? new Channel<string>() : undefined;
      if (progress)
        progress.onmessage = (value) => {
          if (active) setStage(value);
        };
      const result = await call<string>(
        editing ? "edit_account" : "connect_account",
        {
          account: {
            ...account,
            username: account.username || account.email,
            name: account.name || account.email,
          },
          password,
          smtpPassword,
          reauthorize,
          smtpUseIncoming,
          onProgress: progress,
        },
      );
      setPassword("");
      setSmtpPassword("");
      onDone(
        editing
          ? undefined
          : {
              ...account,
              username: account.username || account.email,
              name: account.name || account.email,
            },
      );
      onOpenChange(false);
      setAccount(null);
      toast.success(
        result ||
          (editing
            ? t("Account settings saved")
            : t("Mailbox connected. Incoming and outgoing servers verified.")),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      active = false;
      setBusy(false);
      setStage("");
      setCancelling(false);
    }
  }
  const needsValidation =
    !editing ||
    !account ||
    !!password ||
    !!smtpPassword ||
    reauthorize ||
    smtpUseIncoming ||
    (
      [
        "email",
        "provider",
        "protocol",
        "incomingHost",
        "incomingPort",
        "incomingTls",
        "smtpHost",
        "smtpPort",
        "smtpTls",
        "username",
        "smtpUsername",
        "auth",
        "oauthClientId",
      ] as const
    ).some((key) => account[key] !== editing[key]);
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="account-dialog sm:max-w-[590px]"
        onInteractOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <div className="dialog-symbol">
            <Mail size={22} />
          </div>
          <DialogTitle>
            {editing
              ? t("Edit email settings")
              : account
                ? t("Connect your mailbox")
                : t("Your mailboxes, together")}
          </DialogTitle>
          <DialogDescription>
            {account
              ? t("Configure mail servers and local retention.")
              : t("A quiet space for work and personal mail.")}
          </DialogDescription>
        </DialogHeader>
        {!account ? (
          <>
            <div className="providers">
              {providers.map((p) => (
                <Button
                  variant="ghost"
                  key={p.id}
                  className="provider"
                  onClick={() => {
                    setAccount(makeAccount(p.id));
                    setAdvanced(p.id === "custom");
                  }}
                >
                  <span style={{ color: p.color, background: p.color + "12" }}>
                    {p.letter}
                  </span>
                  <strong>{t(p.name)}</strong>
                  <ArrowRight size={15} />
                </Button>
              ))}
            </div>
            <div className="privacy-note">
              <LockKeyhole size={15} />
              {t(
                "Passwords and tokens are encrypted locally; the key is protected by the system credential store.",
              )}
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
            className="account-form"
          >
            {!editing && (
              <Button
                variant="ghost"
                type="button"
                className="text-link self-start justify-start"
                onClick={() => setAccount(null)}
                disabled={busy}
              >
                <ArrowLeft size={14} />
                {t("Back to other providers")}
              </Button>
            )}
            <fieldset disabled={busy}>
              <AccountEmailField
                key={account.id}
                provider={account.provider}
                value={account.email}
                disabled={!!editing}
                onChange={(email) => {
                  const domain = email.split("@")[1];
                  update({
                    email,
                    username: email,
                    ...(account.provider === "netease" &&
                    ["163.com", "126.com", "yeah.net"].includes(domain)
                      ? {
                          incomingHost: `${account.protocol === "imap" ? "imap" : "pop"}.${domain}`,
                          smtpHost: `smtp.${domain}`,
                        }
                      : {}),
                  });
                }}
              />
              <div className="field">
                <Label htmlFor="name">{t("Account name")}</Label>
                <Input
                  id="name"
                  placeholder={t("For example: Work")}
                  value={account.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </div>
              {account.auth === "password" ? (
                <div className="field">
                  <Label htmlFor="password">
                    {editing
                      ? t("New password / app password (leave blank to keep)")
                      : t("Password / app password")}
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="off"
                    required={!editing || editing.auth !== "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      editing
                        ? t("Keep the credentials already saved in Keychain")
                        : t(
                            "Some providers require enabling IMAP/POP3 and generating an app password",
                          )
                    }
                  />
                </div>
              ) : (
                <div className="oauth-note">
                  <ShieldCheck size={19} />
                  <div>
                    {t("Sign in with ")}
                    {account.provider === "gmail" ? "Google" : "Microsoft"}{" "}
                    {t("Secure sign-in")}
                    <small>
                      {t(
                        "Authorization opens in your system browser. Development builds require a desktop Client ID.",
                      )}
                    </small>
                  </div>
                </div>
              )}
              {editing && account.auth === "oauth" && (
                <Label className="check-line">
                  <Checkbox
                    checked={reauthorize}
                    onCheckedChange={(value) => setReauthorize(value === true)}
                  />
                  {t("Authorize again in browser")}
                </Label>
              )}
              <Button
                variant="ghost"
                className="advanced-toggle"
                type="button"
                onClick={() => setAdvanced(!advanced)}
              >
                {t("Servers & advanced settings")}
                <ChevronDown
                  size={15}
                  className={advanced ? "rotate-180" : ""}
                />
              </Button>
              {advanced && (
                <div className="advanced-fields">
                  <div className="field-row">
                    <div className="field">
                      <Label>{t("Incoming protocol")}</Label>
                      <SelectField
                        value={account.protocol}
                        onValueChange={(value) => {
                          const protocol = value as "imap" | "pop3";
                          const p =
                            providers.find((p) => p.id === account.provider) ??
                            providers.find((p) => p.id === "custom")!;
                          update({
                            protocol,
                            incomingHost:
                              account.provider === "custom"
                                ? account.incomingHost
                                : account.provider === "netease" &&
                                    ["163.com", "126.com", "yeah.net"].includes(
                                      account.email.split("@")[1],
                                    )
                                  ? `${protocol === "imap" ? "imap" : "pop"}.${account.email.split("@")[1]}`
                                  : protocol === "imap"
                                    ? p.imap
                                    : p.pop,
                            incomingPort: protocol === "imap" ? 993 : 995,
                            incomingTls: "tls",
                          });
                        }}
                      >
                        <SelectOption value="imap">
                          {t("IMAP (sync mailbox)")}
                        </SelectOption>
                        <SelectOption value="pop3">
                          {t("POP3 (download mail)")}
                        </SelectOption>
                      </SelectField>
                    </div>
                    <div className="field">
                      <Label>{t("Authentication")}</Label>
                      <SelectField
                        value={account.auth}
                        onValueChange={(value) =>
                          update({ auth: value as Account["auth"] })
                        }
                      >
                        <SelectOption value="password">
                          {t("Password / app password")}
                        </SelectOption>
                        {["gmail", "outlook", "microsoft365"].includes(
                          account.provider,
                        ) && (
                          <SelectOption value="oauth">OAuth 2.0</SelectOption>
                        )}
                      </SelectField>
                    </div>
                  </div>
                  <ServerFields
                    kind="incoming"
                    account={account}
                    update={update}
                  />
                  <ServerFields kind="smtp" account={account} update={update} />
                  <div className="field">
                    <Label>{t("Incoming username")}</Label>
                    <Input
                      value={account.username}
                      onChange={(e) => update({ username: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <Label>
                      {t("SMTP username (blank uses incoming username)")}
                    </Label>
                    <Input
                      value={account.smtpUsername}
                      onChange={(e) => update({ smtpUsername: e.target.value })}
                    />
                  </div>
                  {account.auth === "password" ? (
                    <div className="field">
                      <Label>
                        {editing
                          ? t("New SMTP password (leave blank to keep)")
                          : t("SMTP password (blank uses incoming password)")}
                      </Label>
                      <Input
                        type="password"
                        value={smtpPassword}
                        disabled={smtpUseIncoming}
                        onChange={(e) => setSmtpPassword(e.target.value)}
                      />
                      {editing && (
                        <Label className="check-line">
                          <Checkbox
                            checked={smtpUseIncoming}
                            onCheckedChange={(value) =>
                              setSmtpUseIncoming(value === true)
                            }
                          />
                          {t("Use incoming password / app password for SMTP")}
                        </Label>
                      )}
                    </div>
                  ) : (
                    <div className="field">
                      <Label>OAuth Client ID</Label>
                      <Input
                        value={account.oauthClientId}
                        placeholder={t(
                          "Desktop / public client application Client ID",
                        )}
                        onChange={(e) =>
                          update({ oauthClientId: e.target.value })
                        }
                      />
                    </div>
                  )}
                </div>
              )}
            </fieldset>
            <div className="archive-promise">
              <Switch
                id="save-locally"
                checked={account.saveLocally !== false}
                disabled={busy}
                onCheckedChange={(value) => update({ saveLocally: value })}
              />
              <div>
                <Label htmlFor="save-locally">
                  {t("Save received messages locally")}
                </Label>
                <small>
                  {account.saveLocally !== false
                    ? t(
                        "Keep full messages and attachments, even after server deletion.",
                      )
                    : t(
                        "Keep list information only; load bodies from the server when opened. Existing archives remain.",
                      )}
                  {account.protocol === "imap" &&
                    t(
                      " This is the account default. Choose folder-specific retention in settings.",
                    )}
                </small>
              </div>
            </div>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <KeyRound />}
              {busy
                ? cancelling
                  ? t("Canceling authorization…")
                  : stage === "browser"
                    ? t("Waiting for browser authorization…")
                    : stage === "token"
                      ? t("Exchanging authorization tokens…")
                      : stage === "incoming"
                        ? t("Verifying incoming server…")
                        : stage === "smtp"
                          ? t("Verifying outgoing server…")
                          : stage === "saving"
                            ? t("Saving account…")
                            : needsValidation
                              ? t("Verifying connection…")
                              : t("Saving settings…")
                : editing
                  ? needsValidation
                    ? t("Verify & save configuration")
                    : t("Save settings")
                  : account.auth === "oauth"
                    ? t("Authorize & connect")
                    : t("Verify & connect mailbox")}
            </Button>
            {busy && stage === "browser" && (
              <div className="flex flex-col gap-2" role="status">
                <p className="text-sm text-muted-foreground">
                  {t(
                    "Complete authorization in the browser, then return to Anser. The request expires after 3 minutes.",
                  )}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={cancelling}
                  onClick={async () => {
                    setCancelling(true);
                    try {
                      await call("cancel_authorization", { id: account.id });
                    } catch (e) {
                      setCancelling(false);
                      setError(String(e));
                    }
                  }}
                >
                  {t("Cancel authorization")}
                </Button>
              </div>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
function ServerFields({
  kind,
  account,
  update,
}: {
  kind: "incoming" | "smtp";
  account: Account;
  update: (p: Partial<Account>) => void;
}) {
  const host = kind === "incoming" ? "incomingHost" : "smtpHost",
    port = kind === "incoming" ? "incomingPort" : "smtpPort",
    tls = kind === "incoming" ? "incomingTls" : "smtpTls";
  return (
    <div className="server-row">
      <div className="field">
        <Label>
          {kind === "incoming" ? t("Incoming server") : t("SMTP server")}
        </Label>
        <Input
          required
          value={account[host]}
          placeholder="mail.example.com"
          onChange={(e) => update({ [host]: e.target.value })}
        />
      </div>
      <div className="field">
        <Label>{t("Port")}</Label>
        <Input
          type="number"
          min={1}
          max={65535}
          required
          value={account[port]}
          onChange={(e) => update({ [port]: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <Label>{t("Encryption")}</Label>
        <SelectField
          value={account[tls]}
          onValueChange={(value) => update({ [tls]: value })}
        >
          <SelectOption value="tls">TLS</SelectOption>
          <SelectOption value="starttls">STARTTLS</SelectOption>
        </SelectField>
      </div>
    </div>
  );
}
