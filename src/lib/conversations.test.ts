import { describe, expect, it } from "vitest";
import {
  conversationIndex,
  conversationMessages,
  conversationSummaries,
  replyHeaders,
} from "./conversations";
import { makeDemo } from "./demo";
import type { Mail } from "./types";
const base = makeDemo().messages[0];
const mail = (
  id: string,
  refs: string[] = [],
  extra: Partial<Mail> = {},
): Mail => ({
  ...base,
  id,
  messageId: `<${id}@example.com>`,
  references: refs,
  ...extra,
});
describe("RFC email conversations", () => {
  it("links branches and missing ancestors without conflating equal subjects or accounts", () => {
    const list = [
      mail("a"),
      mail("b", ["<a@example.com>"]),
      mail("c", ["<absent@example.com>"]),
      mail("d", ["<absent@example.com>", "<b@example.com>"]),
      mail("same-subject"),
      mail("other-account", ["<a@example.com>"], { accountId: "other" }),
    ];
    const graph = conversationIndex(list);
    expect(new Set(list.slice(0, 4).map((m) => graph.get(m.id))).size).toBe(1);
    expect(graph.get("same-subject")).not.toBe(graph.get("a"));
    expect(graph.get("other-account")).not.toBe(graph.get("a"));
  });
  it("orders turns oldest first, deduplicates sent copies, isolates trash and retains unread summaries", () => {
    const a = mail("a", [], { date: "2026-10-01T01:00:00Z", isRead: false });
    const b = mail("b", [a.messageId!], {
      date: "2026-10-01T03:00:00Z",
      isRead: true,
      sourceFolder: "Sent",
    });
    const duplicate = { ...b, id: "b-copy", date: "2026-10-01T03:01:00Z" };
    const trash = mail("trash", [a.messageId!], { trashed: true });
    const all = [duplicate, b, trash, a];
    expect(conversationMessages(all, a).map((m) => m.id)).toEqual([
      "a",
      "b-copy",
    ]);
    const summary = conversationSummaries([b, a], all);
    expect(summary).toHaveLength(1);
    expect(summary[0].conversationCount).toBe(2);
    expect(summary[0].isRead).toBe(false);
  });
  it("adds reply ancestry even without a quoted body and bounds long chains", () => {
    expect(replyHeaders(mail("reply", ["<root@example.com>"]))).toEqual({
      inReplyTo: "<reply@example.com>",
      references: ["<root@example.com>", "<reply@example.com>"],
    });
    const result = replyHeaders(
      mail(
        "reply",
        Array.from({ length: 150 }, (_, i) => `<${i}@example.com>`),
      ),
    );
    expect(result.references).toHaveLength(100);
    expect(result.references?.[0]).toBe("<0@example.com>");
    expect(result.references?.at(-1)).toBe("<reply@example.com>");
    expect(replyHeaders({ ...base, messageId: undefined })).toEqual({});
  });
  it("links a verified server identifier without losing the original and uses it in replies", () => {
    const sent = mail("sent", [], {
      serverMessageId: "<rewritten@example.com>",
    });
    const reply = mail("reply", ["<rewritten@example.com>"]);
    const originalRef = mail("old-link", [sent.messageId!]);
    const all = [sent, reply, originalRef];
    expect(new Set(conversationIndex(all).values()).size).toBe(1);
    expect(replyHeaders(sent)).toEqual({
      inReplyTo: "<rewritten@example.com>",
      references: ["<rewritten@example.com>"],
    });
  });
});
