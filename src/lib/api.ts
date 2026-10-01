import { ruleMatches } from "./rule-match";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Snapshot, Query, Mail, Rule, Detail, Compose } from "./types";
import { makeDemo } from "./demo";
import { parseAddresses } from "./addresses";
import type { Address, Contact } from "./types";
export const native = isTauri();
const key = "mail-desktop-demo-v1";
let demo: Snapshot | null = null;
export function isDemo() {
  return demo !== null;
}
export function enterDemo() {
  demo = makeDemo();
  localStorage.setItem(key, JSON.stringify(demo));
}
export function leaveDemo() {
  demo = null;
  localStorage.removeItem(key);
  localStorage.removeItem(key + "-drafts");
  localStorage.removeItem(key + "-contacts");
  localStorage.removeItem(key + "-preferences");
}
export function restoreDemo() {
  try {
    const data = localStorage.getItem(key);
    if (data) demo = JSON.parse(data);
  } catch {
    localStorage.removeItem(key);
  }
}
const empty = (): Snapshot => ({
  accounts: [],
  messages: [],
  rules: [],
  folders: [],
  stats: { total: 0, unread: 0, saved: 0, bytes: 0 },
  logs: [],
  dataDir: "请在桌面客户端中管理本地存档",
  matched: 0,
});
export async function snapshot(query: Query): Promise<Snapshot> {
  if (demo) {
    const all = demo.messages;
    const messages = all.filter(
      (m) =>
        (!query.accountId || m.accountId === query.accountId) &&
        (!query.folder || m.localFolder === query.folder) &&
        (query.view === "trash" ? m.trashed : !m.trashed) &&
        (!query.unreadOnly || !m.isRead) &&
        (!query.starredOnly || m.starred) &&
        (!query.attachmentsOnly || m.hasAttachments) &&
        (query.view !== "all" || m.sourceFolder.toUpperCase() === "INBOX") &&
        (query.view !== "unread" || !m.isRead) &&
        (query.view !== "starred" || m.starred) &&
        (query.view !== "sent" || m.sourceFolder === "Sent") &&
        (query.searchField &&
        ["subject", "sender", "recipients", "body"].includes(query.searchField)
          ? m[query.searchField as "subject" | "sender" | "recipients" | "body"]
          : `${m.subject} ${m.sender} ${m.recipients} ${m.body}`
        )
          .toLowerCase()
          .includes(query.search.toLowerCase()),
    );
    return {
      ...structuredClone(demo),
      messages: structuredClone(messages.slice(0, query.limit)),
      matched: messages.length,
      folders: [...new Set(all.map((m) => m.localFolder))].filter(
        (f) => f !== "全部存档",
      ),
      stats: {
        total: all.length,
        saved: all.length,
        unread: all.filter((m) => !m.isRead && !m.trashed).length,
        bytes: all.reduce((n, m) => n + m.size, 0),
      },
    };
  }
  return native ? invoke("snapshot", { query }) : empty();
}
export async function call<T = void>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (demo) {
    let result: unknown;
    switch (command) {
      case "mail_detail":
        result = {
          mail: structuredClone(demo.messages.find((m) => m.id === args.id)!),
          html: "",
          attachments: [],
        } satisfies Detail;
        break;
      case "update_mail": {
        const m = demo.messages.find((m) => m.id === args.id)!;
        if (args.action === "read") m.isRead = args.value === "true";
        if (args.action === "star") m.starred = args.value === "true";
        if (args.action === "trash") m.trashed = args.value === "true";
        if (args.action === "folder") m.localFolder = String(args.value);
        break;
      }
      case "save_rules":
        demo.rules = args.rules as Rule[];
        break;
      case "preview_rule":
        result = demo.messages
          .filter((m) =>
            ruleMatches({ ...(args.rule as Rule), enabled: true }, m),
          )
          .map((m) => m.subject);
        break;
      case "run_rules": {
        let count = 0;
        for (const m of demo.messages) {
          for (const r of demo.rules) {
            if (ruleMatches(r, m)) {
              if (r.action === "folder") m.localFolder = r.destination;
              if (r.action === "read") m.isRead = true;
              if (r.action === "unread") m.isRead = false;
              if (r.action === "star") m.starred = true;
              if (r.action === "trash") m.trashed = true;
              count++;
              if (r.stop) break;
            }
          }
        }
        result = count;
        break;
      }
      case "save_draft": {
        const list = JSON.parse(
          localStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        const draft = args.draft as Compose;
        localStorage.setItem(
          key + "-drafts",
          JSON.stringify([draft, ...list.filter((d) => d.id !== draft.id)]),
        );
        break;
      }
      case "list_drafts":
        result = JSON.parse(localStorage.getItem(key + "-drafts") || "[]");
        break;
      case "delete_draft": {
        const list = JSON.parse(
          localStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        localStorage.setItem(
          key + "-drafts",
          JSON.stringify(list.filter((d) => d.id !== args.id)),
        );
        break;
      }
      case "account_action":
        if (args.remove)
          demo.accounts = demo.accounts.filter((a) => a.id !== args.id);
        else {
          const a = demo.accounts.find((a) => a.id === args.id);
          if (a) a.enabled = !a.enabled;
        }
        break;
      case "edit_account": {
        const account = args.account as Snapshot["accounts"][number];
        const index = demo.accounts.findIndex((a) => a.id === account.id);
        if (index < 0) throw new Error("账号不存在");
        if (demo.accounts[index].email !== account.email)
          throw new Error("修改邮箱地址请添加新账号");
        demo.accounts[index] = structuredClone(account);
        break;
      }
      case "list_contacts":
        result = JSON.parse(localStorage.getItem(key + "-contacts") || "[]");
        break;
      case "save_contact": {
        const list = JSON.parse(
          localStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        const c = args.contact as Contact;
        if (
          list.some(
            (x) =>
              x.id !== c.id && x.email.toLowerCase() === c.email.toLowerCase(),
          )
        )
          throw new Error("该邮箱已存在于通讯录中");
        localStorage.setItem(
          key + "-contacts",
          JSON.stringify([c, ...list.filter((x) => x.id !== c.id)]),
        );
        break;
      }
      case "delete_contact": {
        const list = JSON.parse(
          localStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        localStorage.setItem(
          key + "-contacts",
          JSON.stringify(list.filter((x) => x.id !== args.id)),
        );
        break;
      }
      case "contact_suggestions": {
        const saved = JSON.parse(
          localStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        const addresses = [
          ...demo.messages.flatMap((m) => parseAddresses(m.sender)),
          ...saved,
        ];
        result = [
          ...new Map(addresses.map((a) => [a.email.toLowerCase(), a])).values(),
        ] satisfies Address[];
        break;
      }
      case "list_outbox":
        result = [];
        break;
      case "get_preferences":
        result = JSON.parse(
          localStorage.getItem(key + "-preferences") ||
            '{"syncIntervalMinutes":5}',
        );
        break;
      case "save_preferences":
        localStorage.setItem(
          key + "-preferences",
          JSON.stringify(args.preferences),
        );
        break;
      case "archive_health":
        result = {
          checked: demo.messages.length,
          healthy: demo.messages.length,
          problems: [],
          checkedAt: new Date().toISOString(),
        };
        break;
      default:
        throw new Error(
          command === "send_mail"
            ? "演示模式不会发送真实邮件，请连接你的邮箱后使用。"
            : "此功能需要退出演示，在 macOS 桌面客户端中使用。",
        );
    }
    localStorage.setItem(key, JSON.stringify(demo));
    return result as T;
  }
  if (!native) throw new Error("请在 macOS 桌面客户端中使用此功能。");
  return invoke<T>(command, args);
}
export function initialSnapshot() {
  return empty();
}
export function newDraft(accountId: string): Compose {
  return {
    id: crypto.randomUUID(),
    accountId,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    attachments: [],
  };
}
export type { Mail };
