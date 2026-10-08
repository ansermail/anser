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
  saveLocally?: boolean;
  lastSync: string | null;
  error: string | null;
}
export interface Mail {
  parseWarnings?: string[];
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
  savedLocally?: boolean;
  serverDate?: string;
  sourceFolder: string;
  messageId?: string;
  serverMessageId?: string;
  inReplyTo?: string[];
  references?: string[];
  conversationId?: string;
  conversationCount?: number;
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
  sourceFolder?: string;
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
  remoteFolder?: string;
  listMode?: "conversations" | "messages";
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
  remoteFolders?: RemoteFolder[];
}
export interface Detail {
  mail: Mail;
  html: string;
  attachments: {
    index: number;
    name: string;
    size: number;
    mime: string;
    error?: string;
  }[];
  replyTo?: Address[];
  to?: Address[];
  cc?: Address[];
}
export interface QuotedMail {
  kind: "reply" | "forward";
  included: boolean;
  sender: string;
  recipients: string;
  date: string;
  subject: string;
  body: string;
  html: string;
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
  format?: "plain" | "rich" | "markdown" | "html";
  source?: string;
  attachments: string[];
  quote?: QuotedMail;
  replyAnchorId?: string;
  inReplyTo?: string;
  references?: string[];
  deliveryBody?: string;
  deliveryHtml?: string;
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
  status:
    | "sending"
    | "sent"
    | "failed"
    | "uncertain"
    | "scheduled"
    | "overdue"
    | "paused"
    | "cancelled";
  draft: Compose;
  error: string;
  updatedAt: string;
  archived: boolean;
  scheduledAt?: string;
  serverCopyAvailable?: boolean;
  serverCopy?: {
    targetLabel?: string;
    origin?: string;
    status: string;
    target: string;
    error: string;
    validity: number;
    uid?: number;
  };
}
export interface Preferences {
  syncIntervalMinutes: number;
  newMailNotifications?: boolean;
  sendResultNotifications?: boolean;
}
export interface ArchiveHealth {
  checked: number;
  healthy: number;
  checkedAt: string;
  problems: { mailId: string; subject: string; error: string }[];
}

export interface RemoteFolder {
  accountId: string;
  name: string;
  displayName: string;
  delimiter: string | null;
  selectable: boolean;
  syncError?: string;
  roles?: FolderRole[];
  detectedRoles?: FolderRole[];
}

export type FolderRole =
  | "inbox"
  | "sent"
  | "drafts"
  | "trash"
  | "junk"
  | "archive"
  | "all"
  | "flagged";
export interface FolderMapping {
  role: FolderRole;
  folder: string | null;
}
export interface FolderSettings {
  folders: RemoteFolder[];
  mappings: FolderMapping[];
}
