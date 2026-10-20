import { t } from "./i18n";
import type { Mail, MailPage, MailNeighbor, Query, Snapshot } from "./types";
import { conversationIndex, conversationSummaries } from "./conversations";

export function compareMail(a: Mail, b: Mail) {
  const instant = (mail: Mail) => {
    const value = Date.parse(mail.date);
    return Number.isFinite(value) ? value : -Infinity;
  };
  return instant(b) - instant(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function bounds(query: Query) {
  const from = query.dateFrom ? Date.parse(query.dateFrom) : -Infinity;
  const before = query.dateBefore ? Date.parse(query.dateBefore) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(before))
    throw new Error(t("Invalid date filter format"));
  if (from >= before) throw new Error(t("End date must be after start date"));
  return { from, before };
}
const lower = (text: string) =>
  text.replace(/[A-Z]/g, (char) => char.toLowerCase());
export function filteredMail(all: Mail[], query: Query, searching = true) {
  const { from, before } = bounds(query);
  return all
    .filter((mail) => {
      const time = Date.parse(mail.date);
      const text =
        query.searchField &&
        ["subject", "sender", "recipients", "body"].includes(query.searchField)
          ? mail[
              query.searchField as "subject" | "sender" | "recipients" | "body"
            ]
          : `${mail.subject} ${mail.sender} ${mail.recipients} ${mail.body}`;
      return (
        (!query.accountId || mail.accountId === query.accountId) &&
        (!query.folder || mail.localFolder === query.folder) &&
        (!query.remoteFolder ||
          mail.sourceFolder === query.remoteFolder ||
          (query.remoteFolderTree &&
            !!query.remoteFolderDelimiter &&
            mail.sourceFolder.startsWith(
              query.remoteFolder + query.remoteFolderDelimiter,
            ))) &&
        (query.view !== "local" || mail.savedLocally !== false) &&
        (query.view === "trash" ? mail.trashed : !mail.trashed) &&
        (!query.unreadOnly || !mail.isRead) &&
        (!query.starredOnly || mail.starred) &&
        (!query.attachmentsOnly || mail.hasAttachments) &&
        (query.view !== "unread" || !mail.isRead) &&
        (query.view !== "starred" || mail.starred) &&
        (query.view !== "sent" || mail.sourceFolder === "Sent") &&
        (!query.dateFrom || time >= from) &&
        (!query.dateBefore || time < before) &&
        (!searching || lower(text).includes(lower(query.search)))
      );
    })
    .sort(compareMail);
}
function units(all: Mail[], query: Query) {
  const filtered = filteredMail(all, query);
  return query.listMode === "messages"
    ? filtered.map((mail) => ({
        ...mail,
        conversationId: undefined,
        conversationCount: 1,
      }))
    : conversationSummaries(filtered, all);
}
function scope(query: Query) {
  return JSON.stringify({
    view: query.view,
    accountId: query.accountId,
    search: query.search,
    folder: query.folder,
    unreadOnly: query.unreadOnly,
    starredOnly: !!query.starredOnly,
    attachmentsOnly: !!query.attachmentsOnly,
    searchField: query.searchField || "",
    remoteFolder: query.remoteFolder || "",
    remoteFolderTree: !!query.remoteFolderTree,
    remoteFolderDelimiter: query.remoteFolderDelimiter || "",
    listMode: query.listMode || "conversations",
    dateFrom: query.dateFrom || "",
    dateBefore: query.dateBefore || "",
  });
}
function bodyKnown(mail: Mail) {
  return (
    mail.savedLocally !== false &&
    !mail.parseWarnings?.some(
      (warning) =>
        warning.startsWith("text/plain 正文片段无法解码：") ||
        warning.startsWith("text/html 正文片段无法解码："),
    )
  );
}
type DemoCursor = { revision: number; scope: string; anchor: Mail };
// Opaque memory-only tokens: never encode query text/mailbox data into a URL.
export class DemoPager {
  revision = Date.now();
  private cursors = new Map<string, DemoCursor>();
  changed() {
    this.revision++;
  }
  page(base: Snapshot, query: Query, token = ""): MailPage {
    const filter = scope(query),
      cursor = token ? this.cursors.get(token) : undefined;
    if (token && !cursor)
      throw new Error(t("Invalid page cursor. Search again."));
    if (cursor && cursor.scope !== filter)
      throw new Error(t("Page scope changed. Search again."));
    const reset = !!cursor && cursor.revision !== this.revision;
    const list = units(base.messages, query);
    const offset =
      cursor && !reset
        ? list.findIndex((mail) => compareMail(mail, cursor.anchor) === 0) + 1
        : 0;
    if (cursor && !reset && offset === 0)
      throw new Error(t("Invalid page position. Search again."));
    const size = Math.max(1, Math.min(query.limit, 200)),
      current = list.slice(offset, offset + size);
    let nextCursor: string | null = null;
    if (offset + current.length < list.length && current.length) {
      nextCursor = `demo:${crypto.randomUUID()}`;
      this.cursors.set(nextCursor, {
        revision: this.revision,
        scope: filter,
        anchor: { ...current[current.length - 1], body: "" },
      });
      if (this.cursors.size > 4096)
        this.cursors.delete(this.cursors.keys().next().value!);
    }
    const covered = filteredMail(base.messages, query, false),
      known = covered.filter(bodyKnown).length;
    const saved = base.messages.filter((mail) => mail.savedLocally !== false);
    const unread = base.messages.filter(
      (mail) => !mail.isRead && !mail.trashed,
    );
    const folderCounts = new Map<
      string,
      {
        accountId: string;
        name: string;
        direct: Set<string>;
        tree: Set<string>;
      }
    >();
    const countFor = (accountId: string, name: string) => {
      const key = `${accountId}\0${name}`;
      let count = folderCounts.get(key);
      if (!count) {
        count = { accountId, name, direct: new Set(), tree: new Set() };
        folderCounts.set(key, count);
      }
      return count;
    };
    for (const folder of base.remoteFolders || [])
      countFor(folder.accountId, folder.name);
    for (const mail of unread) {
      const delimiter =
        base.remoteFolders?.find(
          (folder) =>
            folder.accountId === mail.accountId &&
            folder.name === mail.sourceFolder,
        )?.delimiter || "/";
      const parts = mail.sourceFolder.split(delimiter);
      for (let index = 1; index <= parts.length; index++) {
        const name = parts.slice(0, index).join(delimiter);
        const count = countFor(mail.accountId, name);
        count.tree.add(mail.id);
        if (index === parts.length) count.direct.add(mail.id);
      }
    }
    const remoteFolderUnread = [...folderCounts.values()].map((count) => ({
      accountId: count.accountId,
      name: count.name,
      direct: count.direct.size,
      tree: count.tree.size,
    }));
    const accountStarredUnread = base.accounts.map((account) => ({
      accountId: account.id,
      unread: unread.filter(
        (mail) => mail.accountId === account.id && mail.starred,
      ).length,
    }));
    return {
      ...structuredClone({ ...base, messages: [] }),
      messages: structuredClone(current.map((mail) => ({ ...mail, body: "" }))),
      matched: list.length,
      nextCursor,
      revision: this.revision,
      reset,
      bodyCoverage: { known, unknown: covered.length - known },
      folders: [
        ...new Set(base.messages.map((mail) => mail.localFolder)),
      ].filter((folder) => folder !== "全部存档"),
      stats: {
        total: base.messages.length,
        saved: saved.length,
        unread: base.messages.filter((mail) => !mail.isRead && !mail.trashed)
          .length,
        bytes: saved.reduce((n, mail) => n + mail.size, 0),
      },
      remoteFolderUnread,
      accountStarredUnread,
    };
  }
  neighbor(
    base: Snapshot,
    query: Query,
    id: string,
    direction: "previous" | "next",
  ): MailNeighbor {
    const anchor = base.messages.find(
      (mail) =>
        mail.id === id &&
        (!query.accountId || query.accountId === mail.accountId),
    );
    if (!anchor)
      throw new Error(
        t("This message no longer has a usable source for navigation"),
      );
    const root = conversationIndex(base.messages).get(id);
    const list = units(base.messages, query).filter(
      (mail) => query.listMode === "messages" || mail.conversationId !== root,
    );
    const mail =
      direction === "next"
        ? list.find((mail) => compareMail(mail, anchor) > 0)
        : [...list].reverse().find((mail) => compareMail(mail, anchor) < 0);
    return {
      mail: mail ? structuredClone({ ...mail, body: "" }) : null,
      revision: this.revision,
    };
  }
}
