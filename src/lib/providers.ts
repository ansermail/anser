import type { Account } from "./types";
export const providers = [
  {
    id: "gmail",
    name: "Gmail",
    letter: "G",
    domain: "gmail.com",
    imap: "imap.gmail.com",
    pop: "pop.gmail.com",
    smtp: "smtp.gmail.com",
    oauth: true,
    color: "#ba6255",
  },
  {
    id: "outlook",
    name: "Outlook",
    letter: "O",
    domain: "outlook.com",
    imap: "outlook.office365.com",
    pop: "outlook.office365.com",
    smtp: "smtp-mail.outlook.com",
    oauth: true,
    color: "#4b84b9",
  },
  {
    id: "microsoft365",
    name: "Microsoft 365",
    letter: "M",
    domain: "",
    imap: "outlook.office365.com",
    pop: "outlook.office365.com",
    smtp: "smtp.office365.com",
    oauth: true,
    color: "#8179ac",
  },
  {
    id: "qq",
    name: "QQ 邮箱",
    letter: "Q",
    domain: "qq.com",
    imap: "imap.qq.com",
    pop: "pop.qq.com",
    smtp: "smtp.qq.com",
    oauth: false,
    color: "#c19442",
  },
  {
    id: "netease",
    name: "网易邮箱",
    letter: "易",
    domain: "163.com",
    imap: "imap.163.com",
    pop: "pop.163.com",
    smtp: "smtp.163.com",
    oauth: false,
    color: "#b96561",
  },
  {
    id: "exmail",
    name: "腾讯企业邮",
    letter: "企",
    domain: "",
    imap: "imap.exmail.qq.com",
    pop: "pop.exmail.qq.com",
    smtp: "smtp.exmail.qq.com",
    oauth: false,
    color: "#579580",
  },
  {
    id: "neteaseWork",
    name: "网易企业邮",
    letter: "企",
    domain: "",
    imap: "imap.qiye.163.com",
    pop: "pop.qiye.163.com",
    smtp: "smtp.qiye.163.com",
    oauth: false,
    color: "#747b91",
  },
  {
    id: "custom",
    name: "自定义邮箱",
    letter: "@",
    domain: "",
    imap: "",
    pop: "",
    smtp: "",
    oauth: false,
    color: "#6c8274",
  },
];
export function makeAccount(provider = "custom"): Account {
  const p = providers.find((p) => p.id === provider)!;
  return {
    id: crypto.randomUUID(),
    name: p.name,
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
