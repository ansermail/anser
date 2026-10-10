import { memoryStorage } from "./demo-storage";
import { emptySignature } from "./signatures";
import {
  conversationIndex,
  conversationMessages,
  conversationSummaries,
} from "./conversations";
import { ruleMatchState } from "./rule-match";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  Account,
  Snapshot,
  Query,
  Mail,
  Rule,
  Detail,
  Compose,
} from "./types";
import { makeDemo } from "./demo";
import { parseAddresses } from "./addresses";
import type { Address, Contact, OutboxRecord } from "./types";
export const publicPreview = import.meta.env.MODE === "preview";
export const native = !publicPreview && isTauri();
const demoStorage = publicPreview ? memoryStorage() : localStorage;
const key = "mail-desktop-demo-v1";
let demo: Snapshot | null = null;
export function isDemo() {
  return demo !== null;
}
export function enterDemo() {
  if (native && !import.meta.env.DEV) throw new Error("正式应用不开放示例邮箱");
  demo = makeDemo();
  demoStorage.setItem(key, JSON.stringify(demo));
}
export function leaveDemo() {
  if (publicPreview) return;
  demo = null;
  demoStorage.removeItem(key);
  demoStorage.removeItem(key + "-drafts");
  demoStorage.removeItem(key + "-contacts");
  demoStorage.removeItem(key + "-preferences");
  demoStorage.removeItem(key + "-outbox");
  demoStorage.removeItem(key + "-auto-start");
  for (let i = demoStorage.length - 1; i >= 0; i--) {
    const stored = demoStorage.key(i);
    if (stored?.startsWith(key + "-signature-")) demoStorage.removeItem(stored);
  }
}
export function restoreDemo() {
  if (publicPreview) {
    enterDemo();
    return;
  }
  if (native && !import.meta.env.DEV) {
    leaveDemo();
    return;
  }
  try {
    const data = demoStorage.getItem(key);
    if (data) demo = JSON.parse(data);
  } catch {
    demoStorage.removeItem(key);
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
    messages.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const summaries =
      query.listMode === "messages"
        ? messages.map((mail) => ({
            ...mail,
            conversationId: undefined,
            conversationCount: 1,
          }))
        : conversationSummaries(messages, all);
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
  if (
    publicPreview &&
    [
      "connect_account",
      "edit_account",
      "send_mail",
      "schedule_mail",
      "set_auto_start",
      "test_notification",
      "delete_local_archives",
      "export_mail",
      "save_attachment",
      "preview_attachment",
      "backup_archive",
      "restore_archive",
      "open_data_folder",
      "move_archive_location",
      "cleanup_archive_migration",
    ].includes(command)
  )
    throw new Error(
      "页面预览不连接邮箱、收发邮件或操作本机文件，请下载 Anser 客户端。",
    );
  if (demo) {
    let result: unknown;
    switch (command) {
      case "archive_location":
        result = {
          path: demo.dataDir,
          defaultPath: demo.dataDir,
          available: true,
          error: "",
          external: false,
          cleanupPending: false,
          migrating: false,
          completed: 0,
          total: 0,
        };
        break;
      case "move_archive_location":
      case "cleanup_archive_migration":
        throw new Error("示例邮箱不会迁移本机文件");
      case "mail_signature":
        result =
          JSON.parse(
            demoStorage.getItem(key + "-signature-" + args.accountId) || "null",
          ) || emptySignature();
        break;
      case "save_mail_signature":
        demoStorage.setItem(
          key + "-signature-" + args.accountId,
          JSON.stringify(args.signature),
        );
        result = null;
        break;
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
      case "folder_settings":
        result = { folders: await call("account_folders", args), mappings: [] };
        break;
      case "archive_jobs":
        result = [];
        break;
      case "queue_archives":
      case "archive_job_action":
        throw new Error(
          "演示模式不下载服务器原件，请在桌面客户端中使用真实邮箱测试补存",
        );
      case "cancel_retention_inspection":
        return undefined as T;
      case "inspect_retention_budget":
        throw new Error(
          "示例邮箱不连接真实服务器或读取磁盘，请在桌面客户端中检查预算",
        );
      case "retention_settings": {
        const account = demo.accounts.find((a) => a.id === args.id);
        if (!account) throw new Error("账号不存在");
        const folders = await call<import("./types").RemoteFolder[]>(
          "account_folders",
          args,
        );
        const overrides = JSON.parse(
          demoStorage.getItem(`${key}:retention:${args.id}`) || "[]",
        ) as import("./types").FolderRetention[];
        const mails = demo.messages.filter((m) => m.accountId === account.id);
        const saved = mails.filter((m) => m.savedLocally !== false);
        const wanted = folders
          .filter((f) => f.selectable)
          .filter((f) => {
            const override = overrides.find((o) => o.folder === f.name);
            return (
              (override?.saveLocally ?? account.saveLocally !== false) &&
              (!(f.roles || []).some((r) => ["junk", "trash"].includes(r)) ||
                override?.saveLocally === true)
            );
          });
        result = {
          account,
          defaultSave: account.saveLocally !== false,
          folders,
          overrides,
          summary: {
            dataDir: demo.dataDir,
            known: mails.length,
            saved: saved.length,
            savedBytes: saved.reduce((n, m) => n + m.size, 0),
            pending: mails.filter(
              (m) =>
                m.savedLocally === false &&
                wanted.some((f) => f.name === m.sourceFolder),
            ).length,
            failedJobs: 0,
            lastSync: account.lastSync,
            receiveError: account.error,
            warning: null,
          },
        };
        break;
      }
      case "save_retention": {
        const account = args.account as Account;
        const days = account.serverRetentionDays;
        if (
          days != null &&
          (!Number.isInteger(days) || days < 1 || days > 3650)
        )
          throw new Error("服务器保留期请填写 1–3650 天，未知时留空");
        demoStorage.setItem(
          `${key}:retention:${account.id}`,
          JSON.stringify(args.overrides),
        );
        const current = demo.accounts.find((a) => a.id === account.id);
        if (current) current.serverRetentionDays = days ?? null;
        break;
      }
      case "preview_rule": {
        const rule = { ...(args.rule as Rule), enabled: true };
        result = demo.messages.flatMap((mail) => {
          const state = ruleMatchState(rule, mail);
          if (
            state === "noMatch" ||
            (["serverCopy", "serverMove"].includes(rule.action) &&
              mail.sourceFolder !== rule.sourceFolder)
          )
            return [];
          return [
            state === "needsBody"
              ? `${mail.subject}（等待正文核对）`
              : mail.subject,
          ];
        });
        break;
      }
      case "run_rules": {
        if (
          demo.rules.some(
            (r) => r.enabled && ["serverCopy", "serverMove"].includes(r.action),
          )
        )
          throw new Error("演示模式不执行服务器规则，请在真实桌面预览中测试");
        let count = 0;
        const planned = demo.messages.map((mail) => ({ ...mail }));
        for (const mail of planned) {
          for (const rule of demo.rules) {
            const state = ruleMatchState(rule, mail);
            if (state === "needsBody")
              throw new Error(
                "示例预览不下载在线正文或附件，未知内容需在桌面客户端核对",
              );
            if (state !== "match") continue;
            if (
              ["save", "saveFolder"].includes(rule.action) &&
              mail.savedLocally === false
            )
              throw new Error(
                "示例仅对已有完整邮件演示保存与归类，不提供实际下载",
              );
            switch (rule.action) {
              case "folder":
              case "saveFolder":
                mail.localFolder = rule.destination;
                break;
              case "read":
                mail.isRead = true;
                break;
              case "unread":
                mail.isRead = false;
                break;
              case "star":
                mail.starred = true;
                break;
              case "trash":
                mail.trashed = true;
                break;
            }
            count++;
            if (rule.stop) break;
          }
        }
        demo.messages = planned;
        result = count;
        break;
      }
      case "save_draft": {
        const list = JSON.parse(
          demoStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        const draft = args.draft as Compose;
        demoStorage.setItem(
          key + "-drafts",
          JSON.stringify([draft, ...list.filter((d) => d.id !== draft.id)]),
        );
        break;
      }
      case "list_drafts":
        result = JSON.parse(demoStorage.getItem(key + "-drafts") || "[]");
        break;
      case "delete_draft": {
        const list = JSON.parse(
          demoStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        demoStorage.setItem(
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
        result = JSON.parse(demoStorage.getItem(key + "-contacts") || "[]");
        break;
      case "save_contact": {
        const list = JSON.parse(
          demoStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        const c = args.contact as Contact;
        if (
          list.some(
            (x) =>
              x.id !== c.id && x.email.toLowerCase() === c.email.toLowerCase(),
          )
        )
          throw new Error("该邮箱已存在于通讯录中");
        demoStorage.setItem(
          key + "-contacts",
          JSON.stringify([c, ...list.filter((x) => x.id !== c.id)]),
        );
        break;
      }
      case "delete_contact": {
        const list = JSON.parse(
          demoStorage.getItem(key + "-contacts") || "[]",
        ) as Contact[];
        demoStorage.setItem(
          key + "-contacts",
          JSON.stringify(list.filter((x) => x.id !== args.id)),
        );
        break;
      }
      case "contact_suggestions": {
        const saved = JSON.parse(
          demoStorage.getItem(key + "-contacts") || "[]",
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
      case "rule_runs":
        result = [];
        break;
      case "rule_run_action":
        throw new Error("示例预览不执行异步规则任务，请在桌面客户端查看");
      case "folder_health":
      case "directory_operations":
      case "rule_executions":
        result = [];
        break;
      case "copy_sources":
        result = [
          demo.messages.find((m) => m.id === args.id)?.sourceFolder,
        ].filter(Boolean);
        break;
      case "queue_server_copy":
      case "queue_server_move":
      case "directory_operation_action":
      case "retry_rule_execution":
        throw new Error(
          "演示模式不执行服务器文件夹操作，请在真实桌面预览中测试",
        );
      case "server_operations":
        result = { pending: 0, blocked: 0, completed: 0, items: [] };
        break;
      case "list_outbox":
        result = JSON.parse(demoStorage.getItem(key + "-outbox") || "[]");
        break;
      case "schedule_mail": {
        const draft = args.draft as Compose;
        if (
          new Date(args.scheduledAt as string).getTime() <= Date.now() ||
          !Number.isFinite(new Date(args.scheduledAt as string).getTime())
        )
          throw new Error("请选择未来的发送时间");
        const records = JSON.parse(
          demoStorage.getItem(key + "-outbox") || "[]",
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
        demoStorage.setItem(key + "-outbox", JSON.stringify(records));
        const drafts = JSON.parse(
          demoStorage.getItem(key + "-drafts") || "[]",
        ) as Compose[];
        demoStorage.setItem(
          key + "-drafts",
          JSON.stringify(drafts.filter((d) => d.id !== draft.id)),
        );
        break;
      }
      case "reschedule_mail":
      case "cancel_schedule": {
        const records = JSON.parse(
          demoStorage.getItem(key + "-outbox") || "[]",
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
            demoStorage.getItem(key + "-drafts") || "[]",
          ) as Compose[];
          demoStorage.setItem(
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
        demoStorage.setItem(key + "-outbox", JSON.stringify(records));
        break;
      }
      case "desktop_settings":
        result = {
          autoStart: demoStorage.getItem(key + "-auto-start") === "true",
          autoStartAvailable: true,
        };
        break;
      case "set_auto_start":
        demoStorage.setItem(key + "-auto-start", String(args.enabled));
        break;
      case "test_notification":
        break;
      case "get_preferences":
        result = JSON.parse(
          demoStorage.getItem(key + "-preferences") ||
            '{"syncIntervalMinutes":5,"newMailNotifications":true,"sendResultNotifications":true}',
        );
        break;
      case "save_preferences":
        demoStorage.setItem(
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
        "directory_operations",
        "rule_executions",
        "folder_settings",
        "retention_settings",
        "archive_jobs",
        "copy_sources",
      ].includes(command)
    )
      demoStorage.setItem(key, JSON.stringify(demo));
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
