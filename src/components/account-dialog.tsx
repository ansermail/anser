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
          (editing ? "账号设置已保存" : "邮箱已连接，收发服务器验证通过"),
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
              ? "编辑邮箱配置"
              : account
                ? "连接你的邮箱"
                : "把邮箱，放在一起"}
          </DialogTitle>
          <DialogDescription>
            {account
              ? "配置邮箱服务器与本地留存方式。"
              : "无论工作还是生活，在一个安静的空间里处理邮件。"}
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
                  <strong>{p.name}</strong>
                  <ArrowRight size={15} />
                </Button>
              ))}
            </div>
            <div className="privacy-note">
              <LockKeyhole size={15} />
              密码和令牌安全保存在 macOS 钥匙串中
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
                className="text-link"
                onClick={() => setAccount(null)}
                disabled={busy}
              >
                <ArrowLeft size={14} />
                选择其他邮箱
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
                <Label htmlFor="name">账号名称</Label>
                <Input
                  id="name"
                  placeholder="例如：工作邮箱"
                  value={account.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </div>
              {account.auth === "password" ? (
                <div className="field">
                  <Label htmlFor="password">
                    {editing
                      ? "更换密码 / 授权码（留空保留）"
                      : "密码 / 客户端授权码"}
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
                        ? "保留钥匙串中已保存的凭据"
                        : "部分邮箱需先开启 IMAP/POP3 并生成授权码"
                    }
                  />
                </div>
              ) : (
                <div className="oauth-note">
                  <ShieldCheck size={19} />
                  <div>
                    通过 {account.provider === "gmail" ? "Google" : "Microsoft"}{" "}
                    安全登录
                    <small>
                      将打开系统浏览器完成授权。开发版需配置桌面应用 Client ID。
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
                  重新进行浏览器授权
                </Label>
              )}
              <Button
                variant="ghost"
                className="advanced-toggle"
                type="button"
                onClick={() => setAdvanced(!advanced)}
              >
                服务器与高级配置
                <ChevronDown
                  size={15}
                  className={advanced ? "rotate-180" : ""}
                />
              </Button>
              {advanced && (
                <div className="advanced-fields">
                  <div className="field-row">
                    <div className="field">
                      <Label>收件协议</Label>
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
                          IMAP（同步邮箱）
                        </SelectOption>
                        <SelectOption value="pop3">
                          POP3（下载邮件）
                        </SelectOption>
                      </SelectField>
                    </div>
                    <div className="field">
                      <Label>认证方式</Label>
                      <SelectField
                        value={account.auth}
                        onValueChange={(value) =>
                          update({ auth: value as Account["auth"] })
                        }
                      >
                        <SelectOption value="password">
                          密码 / 授权码
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
                    <Label>收件用户名</Label>
                    <Input
                      value={account.username}
                      onChange={(e) => update({ username: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <Label>SMTP 用户名（留空使用收件用户名）</Label>
                    <Input
                      value={account.smtpUsername}
                      onChange={(e) => update({ smtpUsername: e.target.value })}
                    />
                  </div>
                  {account.auth === "password" ? (
                    <div className="field">
                      <Label>
                        {editing
                          ? "更换 SMTP 密码（留空保留）"
                          : "SMTP 密码（留空使用收件密码）"}
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
                          SMTP 使用收件密码 / 授权码
                        </Label>
                      )}
                    </div>
                  ) : (
                    <div className="field">
                      <Label>OAuth Client ID</Label>
                      <Input
                        value={account.oauthClientId}
                        placeholder="桌面 / 公共客户端应用的 Client ID"
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
                <Label htmlFor="save-locally">收到的邮件保存在本地</Label>
                <small>
                  {account.saveLocally !== false
                    ? "保存完整正文与附件，服务器删除后仍可阅读。"
                    : "仅保存列表信息，打开正文时从服务器加载。已有存档保留。"}
                  {account.protocol === "imap" &&
                    " 此项为账号默认，文件夹可在设置中单独选择保存范围。"}
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
                  ? "正在取消授权…"
                  : stage === "browser"
                    ? "等待浏览器授权…"
                    : stage === "token"
                      ? "正在交换授权令牌…"
                      : stage === "incoming"
                        ? "正在验证收件服务器…"
                        : stage === "smtp"
                          ? "正在验证发件服务器…"
                          : stage === "saving"
                            ? "正在保存账号…"
                            : needsValidation
                              ? "正在验证连接…"
                              : "正在保存设置…"
                : editing
                  ? needsValidation
                    ? "验证并保存配置"
                    : "保存设置"
                  : account.auth === "oauth"
                    ? "授权并连接"
                    : "验证并连接邮箱"}
            </Button>
            {busy && stage === "browser" && (
              <div className="flex flex-col gap-2" role="status">
                <p className="text-sm text-muted-foreground">
                  请在新打开的系统浏览器页面完成授权，再返回雁信。等待超过 3
                  分钟会自动结束。
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
                  取消授权
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
        <Label>{kind === "incoming" ? "收件服务器" : "SMTP 服务器"}</Label>
        <Input
          required
          value={account[host]}
          placeholder="mail.example.com"
          onChange={(e) => update({ [host]: e.target.value })}
        />
      </div>
      <div className="field">
        <Label>端口</Label>
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
        <Label>加密</Label>
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
