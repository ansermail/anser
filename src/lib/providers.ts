import { t } from "./i18n";
import type { Account } from "./types";
export const providers = [
  {
    id: "gmail",
    name: "Gmail",
    domain: "gmail.com",
    imap: "imap.gmail.com",
    pop: "pop.gmail.com",
    smtp: "smtp.gmail.com",
    oauth: true,
  },
  {
    id: "outlook",
    name: "Outlook",
    domain: "outlook.com",
    imap: "outlook.office365.com",
    pop: "outlook.office365.com",
    smtp: "smtp-mail.outlook.com",
    oauth: true,
  },
  {
    id: "microsoft365",
    name: "Microsoft 365",
    domain: "",
    imap: "outlook.office365.com",
    pop: "outlook.office365.com",
    smtp: "smtp.office365.com",
    oauth: true,
  },
  {
    id: "qq",
    name: "QQ Mail",
    domain: "qq.com",
    imap: "imap.qq.com",
    pop: "pop.qq.com",
    smtp: "smtp.qq.com",
    oauth: false,
  },
  {
    id: "netease",
    name: "NetEase Mail",
    domain: "163.com",
    imap: "imap.163.com",
    pop: "pop.163.com",
    smtp: "smtp.163.com",
    oauth: false,
  },
  {
    id: "exmail",
    name: "Tencent Exmail",
    domain: "",
    imap: "imap.exmail.qq.com",
    pop: "pop.exmail.qq.com",
    smtp: "smtp.exmail.qq.com",
    oauth: false,
  },
  {
    id: "neteaseWork",
    name: "NetEase Enterprise Mail",
    domain: "",
    imap: "imap.qiye.163.com",
    pop: "pop.qiye.163.com",
    smtp: "smtp.qiye.163.com",
    oauth: false,
  },
  {
    id: "custom",
    name: "Custom email",
    domain: "",
    imap: "",
    pop: "",
    smtp: "",
    oauth: false,
  },
];
export function makeAccount(provider = "custom"): Account {
  const p = providers.find((p) => p.id === provider)!;
  return {
    id: crypto.randomUUID(),
    name: t(p.name),
    email: "",
    provider,
    protocol: "imap",
    incomingHost: p.imap,
    incomingPort: 993,
    incomingTls: "tls",
    smtpHost: p.smtp,
    smtpPort: p.oauth ? 587 : 465,
    smtpTls: p.oauth ? "starttls" : "tls",
    username: "",
    smtpUsername: "",
    auth: p.oauth ? "oauth" : "password",
    oauthClientId: "",
    enabled: true,
    saveLocally: true,
    lastSync: null,
    error: null,
  };
}
export function senderName(sender: string) {
  return (
    sender
      .replace(/<.*>/, "")
      .replaceAll('"', "")
      .replace(/[;,]\s*$/, "")
      .trim() || sender
  );
}
export function senderAddress(sender: string) {
  return sender.match(/<([^>]+)>/)?.[1] || sender;
}
export function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
