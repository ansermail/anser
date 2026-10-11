import { describe, expect, it } from "vitest";
import { DemoPager } from "./mail-pages";
import { makeDemo } from "./demo";
import type { Query } from "./types";
const query: Query = {
  view: "local",
  accountId: "",
  search: "",
  folder: "",
  limit: 197,
  unreadOnly: false,
};
function seed(size: number) {
  const data = makeDemo(),
    base = data.messages[0];
  data.messages = Array.from({ length: size }, (_, i) => ({
    ...base,
    id: `fictional-${String(i).padStart(5, "0")}`,
    messageId: `<row-${i}@example.com>`,
    references: i > 0 && i % 10 === 0 ? [`<row-${i - 1}@example.com>`] : [],
    date: i === size - 1 ? "" : "2026-10-10T19:53:37.001+08:00",
    isRead: i % 3 === 0,
  }));
  return data;
}
describe("memory-only page protocol", () => {
  it.each(["messages", "conversations"] as const)(
    "continues beyond 5000 without duplicate %s or bodies",
    (mode) => {
      const data = seed(6103),
        pager = new DemoPager(),
        q = { ...query, listMode: mode };
      const ids: string[] = [],
        roots: string[] = [];
      let cursor = "";
      let matched = 0;
      do {
        const page = pager.page(data, q, cursor);
        expect(page.messages.length).toBeLessThanOrEqual(197);
        expect(page.messages.every((m) => !m.body)).toBe(true);
        ids.push(...page.messages.map((m) => m.id));
        roots.push(...page.messages.map((m) => m.conversationId || m.id));
        matched = page.matched;
        cursor = page.nextCursor || "";
      } while (cursor);
      expect(ids.length).toBeGreaterThan(5000);
      expect(ids).toHaveLength(matched);
      expect(new Set(ids).size).toBe(ids.length);
      expect(new Set(roots).size).toBe(ids.length);
      expect(ids.at(-1)).toBe("fictional-06102");
    },
  );
  it("rejects foreign scope and resets changed data instead of combining stale pages", () => {
    const data = seed(21),
      pager = new DemoPager();
    const first = pager.page(data, query);
    const cursor = pager.page(data, { ...query, limit: 2 }).nextCursor!;
    expect(() =>
      pager.page(data, { ...query, folder: "other" }, cursor),
    ).toThrow("范围已变化");
    data.messages[0].subject = "Changed";
    pager.changed();
    const next = pager.page(data, { ...query, limit: 2 }, cursor);
    expect(next.reset).toBe(true);
    expect(next.revision).toBeGreaterThan(first.revision);
    expect(next.messages[0].subject).toBe("Changed");
  });
  it("seeks far unread anchors without returning the same thread or changing the page stream", () => {
    const data = seed(6103),
      pager = new DemoPager(),
      q = { ...query, unreadOnly: true, listMode: "conversations" as const };
    data.messages[5000].isRead = true;
    pager.changed();
    const first = pager.page(data, q);
    const next = pager.neighbor(data, q, data.messages[5000].id, "next");
    expect(next.mail?.id).toBe("fictional-05002");
    expect(next.mail?.body).toBe("");
    const previous = pager.neighbor(
      data,
      q,
      data.messages[5000].id,
      "previous",
    );
    expect(previous.mail?.id).toBe("fictional-04997");
    expect(pager.page(data, q, first.nextCursor!).reset).toBe(false);
    expect(() =>
      pager.neighbor(
        data,
        { ...q, accountId: "foreign" },
        data.messages[5000].id,
        "next",
      ),
    ).toThrow("可用来源");
  });
  it("applies inclusive/exclusive instants and reports body coverage before search", () => {
    const data = seed(7),
      pager = new DemoPager();
    data.messages[0].savedLocally = false;
    data.messages[0].body = "";
    const q = {
      ...query,
      view: "all",
      dateFrom: "2026-10-10T11:53:37.001Z",
      dateBefore: "2026-10-10T11:53:37.002Z",
      search: "not found",
      searchField: "body",
    };
    const page = pager.page(data, q);
    expect(page.messages).toHaveLength(0);
    expect(page.bodyCoverage).toEqual({ known: 5, unknown: 1 });
    expect(() => pager.page(data, { ...q, dateBefore: q.dateFrom })).toThrow(
      "结束时间",
    );
  });
});
