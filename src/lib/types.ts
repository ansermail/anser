export interface Account {
  id: string;
  name: string;
  email: string;
  provider: string;
  protocol: "imap" | "pop3";
  incomingHost: string;
  incomingPort: number;
  incomingTls: "tls" | "starttls";
  smtpHost: string;
  smtpPort: number;
  smtpTls: "tls" | "starttls";
  username: string;
  smtpUsername: string;
  auth: "password" | "oauth";
  oauthClientId: string;
  enabled: boolean;
  lastSync: string | null;
  error: string | null;
}
export interface Mail {
  id: string;
  accountId: string;
  accountEmail: string;
  sender: string;
  recipients: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  isRead: boolean;
  starred: boolean;
  localFolder: string;
  trashed: boolean;
  hasAttachments: boolean;
  hash: string;
  size: number;
  savedAt: string;
  sourceFolder: string;
}
export interface Condition {
  field: string;
  operator: string;
  value: string;
}
export interface Rule {
  id: string;
  name: string;
  accountId: string;
  enabled: boolean;
  mode: "all" | "any";
  conditions: Condition[];
  action: string;
  destination: string;
  stop: boolean;
}
export interface Query {
  view: string;
  accountId: string;
  search: string;
  folder: string;
  limit: number;
  unreadOnly: boolean;
  starredOnly?: boolean;
  attachmentsOnly?: boolean;
  searchField?: string;
}
export interface Snapshot {
  accounts: Account[];
  messages: Mail[];
  rules: Rule[];
  folders: string[];
  stats: { total: number; unread: number; saved: number; bytes: number };
  logs: string[];
  dataDir: string;
  matched: number;
}
export interface Detail {
  mail: Mail;
  html: string;
  attachments: { index: number; name: string; size: number; mime: string }[];
  replyTo?: Address[];
  to?: Address[];
  cc?: Address[];
}
export interface Compose {
  id: string;
  accountId: string;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  html?: string;
  attachments: string[];
}
export interface Address {
  name: string;
  email: string;
}
export interface Contact extends Address {
  id: string;
}
export interface OutboxRecord {
  id: string;
  status: "sending" | "sent" | "failed" | "uncertain";
  draft: Compose;
  error: string;
  updatedAt: string;
  archived: boolean;
}
export interface Preferences {
  syncIntervalMinutes: number;
}
export interface ArchiveHealth {
  checked: number;
  healthy: number;
  checkedAt: string;
  problems: { mailId: string; subject: string; error: string }[];
}
