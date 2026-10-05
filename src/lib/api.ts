import {
  conversationIndex,
  conversationMessages,
  conversationSummaries,
} from "./conversations";
import { ruleMatches } from "./rule-match";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Snapshot, Query, Mail, Rule, Detail, Compose } from "./types";
import { makeDemo } from "./demo";
import { parseAddresses } from "./addresses";
import type { Address, Contact, OutboxRecord } from "./types";
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
  localStorage.removeItem(key + "-outbox");
  localStorage.removeItem(key + "-auto-start");
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
        (!query.remoteFolder || m.sourceFolder === query.remoteFolder) &&
        (query.view !== "local" || m.savedLocally !== false) &&
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
    const summaries = conversationSummaries(
      messages.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
      ),
      all,
    );
    return {
      ...structuredClone({ ...demo, messages: [] }),
      messages: structuredClone(summaries.slice(0, query.limit)),
      matched: summaries.length,
      folders: [...new Set(all.map((m) => m.localFolder))].filter(
        (f) => f !== "全部存档",
      ),
      stats: {
        total: all.length,
        saved: all.filter((m) => m.savedLocally !== false).length,
        unread: all.filter((m) => !m.isRead && !m.trashed).length,
        bytes: all
          .filter((m) => m.savedLocally !== false)
          .reduce((n, m) => n + m.size, 0),
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
      case "account_folders": {
        const names = new Set([
          "INBOX",
          "Sent",
          "Drafts",
          ...demo.messages
            .filter((m) => m.accountId === args.id)
            .map((m) => m.sourceFolder),
        ]);
        result = [...names].map((name) => ({
          accountId: String(args.id),
          name,
          displayName:
            (
              { INBOX: "收件箱", Sent: "已发送", Drafts: "草稿" } as Record<
                string,
                string
              >
            )[name] || name,
          delimiter: "/",
          selectable: true,
        }));
        break;
      }
      case "sync_remote_folder":
        result = 0;
        break;

      case "mail_conversation": {
        const selected = demo.messages.find((m) => m.id === args.id);
        if (!selected) throw new Error("邮件不存在");
        result = structuredClone(conversationMessages(demo.messages, selected));
        break;
      }
      case "mail_metadata":
      case "mail_detail":
        result = {
          mail: {
            ...structuredClone(demo.messages.find((m) => m.id === args.id)!),
            conversationId: conversationIndex(demo.messages).get(
              String(args.id),
            ),
            conversationCount: conversationMessages(
              demo.messages,
              demo.messages.find((m) => m.id === args.id)!,
            ).length,
          },
          html: "",
          attachments: [],
        } satisfies Detail;
        if (command === "mail_metadata")
          result = { ...(result as Detail).mail, body: "" };
        break;
      case "update_mail": {
        const selected = demo.messages.find((m) => m.id === args.id)!;
        for (const m of demo.messages.filter(
          (m) =>
            m.id === selected.id ||
            (!!selected.messageId &&
              m.messageId === selected.messageId &&
              m.accountId === selected.accountId),
        )) {
          if (args.action === "read") m.isRead = args.value === "true";
          if (args.action === "star") m.starred = args.value === "true";
          if (args.action === "trash") m.trashed = args.value === "true";
          if (args.action === "folder") m.localFolder = String(args.value);
        }
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
      case "folder_health":
        result = [];
        break;
      case "server_operations":
        result = { pending: 0, blocked: 0, completed: 0, items: [] };
        break;
      case "list_outbox":
        result = JSON.parse(localStorage.getItem(key + "-outbox") || "[]");
        break;
      case "schedule_mail": {
        const draft = args.draft as Compose;
        if (
          new Date(args.scheduledAt as string).getTime() <= Date.now() ||
          !Number.isFinite(new Date(args.scheduledAt as string).getTime())
        )
          throw new Error("请选择未来的发送时间");
        const records = JSON.parse(
          localStorage.getItem(key + "-outbox") || "[]",
        ) as OutboxRecord[];
        if (records.some((r) => r.id === draft.id))
          throw new Error("已有发送计划，请在发送记录中检查");
        records.unshift({
          id: draft.id,
          draft,
          status: "scheduled",
          scheduledAt: args.scheduledAt as string,
          updatedAt: new Date().toISOString(),
          archived: false,
          error: "",
        });
        localStorage.setItem(key + "-outbox", JSON.stringify(records));
        const drafts = JSON.parse(
          localStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        localStorage.setItem(
          key + "-drafts",
          JSON.stringify(drafts.filter((d) => d.id !== draft.id)),
        );
        break;
      }
      case "reschedule_mail":
      case "cancel_schedule": {
        const records = JSON.parse(
          localStorage.getItem(key + "-outbox") || "[]",
        ) as OutboxRecord[];
        const record = records.find((r) => r.id === args.id);
        if (
          !record ||
          !["scheduled", "overdue", "paused"].includes(record.status)
        )
          throw new Error("此计划不可修改");
        if (command === "cancel_schedule") {
          record.status = "cancelled";
          result = { ...record.draft, id: crypto.randomUUID() };
          const drafts = JSON.parse(
            localStorage.getItem(key + "-drafts") || "[]",
          ) as Compose[];
          localStorage.setItem(
            key + "-drafts",
            JSON.stringify([result, ...drafts]),
          );
        } else {
          const at = new Date(args.scheduledAt as string);
          if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now())
            throw new Error("请选择未来的发送时间");
          record.scheduledAt = at.toISOString();
          record.status = "scheduled";
          record.error = "";
        }
        record.updatedAt = new Date().toISOString();
        localStorage.setItem(key + "-outbox", JSON.stringify(records));
        break;
      }
      case "desktop_settings":
        result = {
          autoStart: localStorage.getItem(key + "-auto-start") === "true",
          autoStartAvailable: true,
        };
        break;
      case "set_auto_start":
        localStorage.setItem(key + "-auto-start", String(args.enabled));
        break;
      case "test_notification":
        break;
      case "get_preferences":
        result = JSON.parse(
          localStorage.getItem(key + "-preferences") ||
            '{"syncIntervalMinutes":5,"newMailNotifications":true,"sendResultNotifications":true}',
        );
        break;
      case "save_preferences":
        localStorage.setItem(
          key + "-preferences",
          JSON.stringify(args.preferences),
        );
        break;
      case "archive_deletion_preview": {
        const mails = demo.messages.filter(
          (m) =>
            m.savedLocally !== false &&
            (!args.accountId || m.accountId === args.accountId),
        );
        const scopes = new Map<
          string,
          { accountId: string; name: string; email: string; count: number }
        >();
        for (const m of mails) {
          const scope = scopes.get(m.accountId) || {
            accountId: m.accountId,
            name:
              demo.accounts.find((a) => a.id === m.accountId)?.name ||
              "已移除账号",
            email: m.accountEmail,
            count: 0,
          };
          scope.count++;
          scopes.set(m.accountId, scope);
        }
        result = {
          count: mails.length,
          bytes: mails.reduce((n, m) => n + m.size, 0),
          offlineOnly: mails.filter(
            (m) =>
              !demo!.accounts.some((a) => a.id === m.accountId) ||
              m.sourceFolder === "Sent",
          ).length,
          reviewToken: JSON.stringify(
            mails
              .map((m) => [
                m.id,
                m.hash,
                !demo!.accounts.some((a) => a.id === m.accountId) ||
                  m.sourceFolder === "Sent",
              ])
              .sort(),
          ),
          accounts: [...scopes.values()],
        };
        break;
      }
      case "delete_local_archives": {
        const mails = demo.messages.filter(
          (m) =>
            m.savedLocally !== false &&
            (!args.accountId || m.accountId === args.accountId),
        );
        const token = JSON.stringify(
          mails
            .map((m) => [
              m.id,
              m.hash,
              !demo!.accounts.some((a) => a.id === m.accountId) ||
                m.sourceFolder === "Sent",
            ])
            .sort(),
        );
        if (mails.length !== args.expectedCount || token !== args.expectedToken)
          throw new Error("存档范围已变化，请重新查看删除范围后确认");
        if (!mails.length) throw new Error("所选范围没有本地存档");
        let offlineRemoved = 0;
        const offline = new Set<string>();
        for (const m of mails) {
          if (
            !demo.accounts.some((a) => a.id === m.accountId) ||
            m.sourceFolder === "Sent"
          ) {
            offline.add(m.id);
            offlineRemoved++;
          } else {
            m.savedLocally = false;
            m.body = "";
          }
        }
        demo.messages = demo.messages.filter((m) => !offline.has(m.id));
        if (args.stopSaving)
          for (const a of demo.accounts)
            if (!args.accountId || a.id === args.accountId)
              a.saveLocally = false;
        result = {
          deleted: mails.length,
          offlineRemoved,
          freedBytes: mails.reduce((n, m) => n + m.size, 0),
          cleanupPending: false,
        };
        break;
      }
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
    if (
      ![
        "mail_conversation",
        "mail_detail",
        "mail_metadata",
        "account_folders",
        "sync_remote_folder",
        "list_drafts",
        "list_contacts",
        "get_preferences",
        "list_outbox",
        "server_operations",
        "folder_health",
      ].includes(command)
    )
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
