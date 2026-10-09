// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import App from "./App";
import { enterDemo, leaveDemo, snapshot } from "./lib/api";
import * as api from "./lib/api";
import type { Query } from "./lib/types";
import { toast } from "sonner";

let root: Root;
let host: HTMLDivElement;
const localQuery: Query = {
  view: "local",
  accountId: "",
  folder: "",
  search: "",
  limit: 200,
  unreadOnly: false,
};
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, button: 0 }),
    );
    (element as HTMLElement).click();
  });
}
function nav(title: string) {
  return (
    [...host.querySelectorAll("button.nav-item")].find((b) =>
      [...b.querySelectorAll("span")].some(
        (span) => span.childNodes[0]?.textContent === title,
      ),
    ) ?? null
  );
}
function filter(title: string) {
  return (
    [...host.querySelectorAll(".list-filters button")].find(
      (b) => b.textContent === title,
    ) ?? null
  );
}
async function seedReplyThread() {
  const seed = await snapshot(localQuery);
  const mail = seed.messages[0];
  mail.messageId = "<root@example.com>";
  seed.messages.push({
    ...mail,
    id: "older-reply",
    messageId: "<older@example.com>",
    inReplyTo: [mail.messageId],
    references: [mail.messageId],
    date: new Date(new Date(mail.date).getTime() - 1000).toISOString(),
  });
  localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
  api.restoreDemo();
}
async function chooseListMode(label: string) {
  await act(async () => {
    host
      .querySelector('[aria-label="邮件显示方式"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
  });
  await click(
    [...document.querySelectorAll('[role="menuitemradio"]')].find(
      (item) => item.textContent === label,
    ) ?? null,
  );
}
async function seedLargeMailbox() {
  const seed = await snapshot(localQuery);
  const mail = seed.messages[0];
  const newest = new Date(mail.date).getTime();
  seed.messages = Array.from({ length: 205 }, (_, index) => ({
    ...mail,
    id: `page-${index}`,
    subject: `Pagination mail ${index}`,
    date: new Date(newest - index * 1000).toISOString(),
    messageId: `<page-${index}@example.com>`,
    isRead: false,
    starred: true,
  }));
  localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
  api.restoreDemo();
  await click(nav("本地存档"));
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.scrollTo = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  enterDemo();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
});
afterEach(async () => {
  await act(async () => toast.dismiss());
  // Sonner keeps its exit-animation timeout alive after an immediate unmount.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("message and conversation display modes", () => {
  it("reloads selected content when archival changes the original hash", async () => {
    const seed = await snapshot(localQuery);
    seed.messages = [{ ...seed.messages[0], savedLocally: false }];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await chooseListMode("逐封邮件");
    let archived = false;
    const original = api.call;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "queue_archives") {
          archived = true;
          return { queued: 1, alreadySaved: 0, blocked: 0 } as T;
        }
        const result = await original<unknown>(command, args);
        if (command === "mail_detail") {
          const d = result as import("./lib/types").Detail;
          return {
            ...d,
            html: "",
            mail: {
              ...d.mail,
              hash: archived ? "full-hash" : "header-hash",
              savedLocally: archived,
              body: archived ? "Full archived original" : "Online body preview",
            },
          } as T;
        }
        if (command === "mail_metadata") {
          const m = result as import("./lib/types").Mail;
          return {
            ...m,
            hash: archived ? "full-hash" : "header-hash",
            savedLocally: archived,
            body: "",
          } as T;
        }
        return result as T;
      },
    );
    await click(host.querySelector("button.mail-row-main"));
    expect(host.textContent).toContain("Online body preview");
    await click(
      [...host.querySelectorAll(".message-metadata button")].find((b) =>
        b.textContent?.includes("完整保存到本地"),
      ) ?? null,
    );
    await click(host.querySelector('[title="星标"], [title="取消星标"]'));
    expect(host.textContent).toContain("Full archived original");
    expect(host.textContent).not.toContain("Online body preview");
  });
  it("queues a single online mail explicitly without changing account retention", async () => {
    const seed = await snapshot(localQuery);
    const mail = { ...seed.messages[0], savedLocally: false };
    seed.messages = [mail];
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await chooseListMode("逐封邮件");
    const original = api.call;
    const calls = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string, args: Record<string, unknown> = {}) =>
          command === "queue_archives"
            ? ({ queued: 1, alreadySaved: 0, blocked: 0 } as T)
            : original<T>(command, args),
      );
    await click(host.querySelector("button.mail-row-main"));
    await click(
      [...host.querySelectorAll(".message-metadata button")].find((b) =>
        b.textContent?.includes("完整保存到本地"),
      ) ?? null,
    );
    expect(calls).toHaveBeenCalledWith("queue_archives", {
      ids: [mail.id],
      conversations: false,
    });
    expect(
      calls.mock.calls.some(
        ([c]) => c === "edit_account_preferences" || c === "send_mail",
      ),
    ).toBe(false);
  });
  it("keeps grouped versus individual batch archival scope in the command", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    const original = api.call;
    const calls = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string, args: Record<string, unknown> = {}) =>
          command === "queue_archives"
            ? ({ queued: 1, alreadySaved: 1, blocked: 0 } as T)
            : original<T>(command, args),
      );
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(host.querySelector('.batch-toolbar [title="完整保存到本地"]'));
    expect(calls).toHaveBeenLastCalledWith("queue_archives", {
      ids: ["demo-0"],
      conversations: true,
    });
    await chooseListMode("逐封邮件");
    await click(host.querySelector('.row-check [role="checkbox"]'));
    await click(host.querySelector('.batch-toolbar [title="完整保存到本地"]'));
    expect(calls).toHaveBeenLastCalledWith("queue_archives", {
      ids: ["demo-0"],
      conversations: false,
    });
  });
  it("changes counts and keeps its preference across categories and reopening", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(8);
    await chooseListMode("逐封邮件");
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(9);
    expect(host.querySelector(".conversation-count")).toBeNull();
    expect(host.querySelector(".list-heading")?.textContent).toContain(
      "9 封邮件",
    );
    await click(nav("星标邮件"));
    expect(
      host.querySelector('[aria-label="邮件显示方式"]')?.textContent,
    ).toContain("逐封邮件");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<App />));
    expect(
      host.querySelector('[aria-label="邮件显示方式"]')?.textContent,
    ).toContain("逐封邮件");
    await chooseListMode("按对话分组");
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(8);
    expect(localStorage.getItem("mail-list-mode")).toBe("conversations");
  });
  it("reads and navigates single turns without loading or marking the rest of a thread", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".conversation-stream")).toBeNull();
    expect(host.querySelector(".reader-scroll .message-body")).not.toBeNull();
    expect(
      calls.mock.calls.some(([command]) => command === "mail_conversation"),
    ).toBe(false);
    const single = await snapshot({ ...localQuery, listMode: "messages" });
    expect(single.messages.find((m) => m.id === "demo-0")?.isRead).toBe(true);
    expect(single.messages.find((m) => m.id === "older-reply")?.isRead).toBe(
      false,
    );
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(calls).toHaveBeenCalledWith("mail_detail", { id: "older-reply" });
    expect(host.querySelectorAll(".mail-row.selected")).toHaveLength(1);
    await click(host.querySelector('[aria-label="上一封邮件"]'));
    expect(host.querySelectorAll(".mail-row.selected")).toHaveLength(1);
    await chooseListMode("按对话分组");
    expect(host.querySelectorAll(".conversation-turn")).toHaveLength(2);
  });
  it("applies a selected single-mail batch action without trashing its reply", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    await chooseListMode("逐封邮件");
    await click(host.querySelector('.row-check [role="checkbox"]'));
    expect(host.querySelector(".batch-toolbar")?.textContent).toContain(
      "已选 1 封邮件",
    );
    await click(host.querySelector('.batch-toolbar [title="移到本地废纸篓"]'));
    const list = await snapshot({ ...localQuery, listMode: "messages" });
    expect(list.messages.some((m) => m.id === "demo-0")).toBe(false);
    expect(list.messages.some((m) => m.id === "older-reply")).toBe(true);
  });
  it("cancels late conversation loading when the user switches to individual messages", async () => {
    await seedReplyThread();
    await click(nav("本地存档"));
    const originalCall = api.call;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "mail_conversation") await gate;
        return originalCall<T>(command, args);
      },
    );
    await click(host.querySelector("button.mail-row-main"));
    await chooseListMode("逐封邮件");
    await act(async () => {
      release();
      await gate;
    });
    expect(host.querySelector(".conversation-stream")).toBeNull();
    const list = await snapshot({ ...localQuery, listMode: "messages" });
    expect(list.messages.find((m) => m.id === "older-reply")?.isRead).toBe(
      false,
    );
  });
});
describe("reading across loaded page boundaries", () => {
  it.each(["按对话分组", "逐封邮件"])(
    "loads the next page and keeps previous navigation in %s mode",
    async (mode) => {
      await seedLargeMailbox();
      if (mode === "逐封邮件") await chooseListMode(mode);
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
      await click(host.querySelectorAll("button.mail-row-main")[199]);
      await click(host.querySelector('[aria-label="下一封邮件"]'));
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        "Pagination mail 200",
      );
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(205);
      await click(host.querySelector('[aria-label="上一封邮件"]'));
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        "Pagination mail 199",
      );
      await click(host.querySelectorAll("button.mail-row-main")[204]);
      expect(
        (host.querySelector('[aria-label="下一封邮件"]') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    },
    // This integration case renders 205 mails and performs several navigations.
    // Shared macOS runners can exceed Vitest's default five-second budget.
    15_000,
  );
  it("extends an unread boundary when the opened mail disappears from its filter", async () => {
    await seedLargeMailbox();
    await chooseListMode("逐封邮件");
    await click(filter("未读"));
    await click(host.querySelectorAll("button.mail-row-main")[199]);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 199",
    );
    expect(host.querySelectorAll(".mail-row.selected")).toHaveLength(0);
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 200",
    );
  });
  it("does not extend an old position when a new filter excludes the current mail", async () => {
    await seedLargeMailbox();
    await click(host.querySelector("button.mail-row-main"));
    await click(filter("未读"));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 0",
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
    expect(
      (host.querySelector('[aria-label="下一封邮件"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it("keeps the current mail on failure, prevents duplicate loading and allows retry", async () => {
    await seedLargeMailbox();
    await click(host.querySelectorAll("button.mail-row-main")[199]);
    const originalSnapshot = api.snapshot;
    let reject!: (error: Error) => void;
    const gate = new Promise<never>((_, fail) => {
      reject = fail;
    });
    const calls = vi.spyOn(api, "snapshot").mockImplementation(async (q) => {
      if (q.limit > 200) return gate;
      return originalSnapshot(q);
    });
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(
      host
        .querySelector('[aria-label="下一封邮件"]')
        ?.getAttribute("aria-busy"),
    ).toBe("true");
    await act(async () =>
      host.querySelector(".reader")!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(calls.mock.calls.filter(([q]) => q.limit > 200)).toHaveLength(1);
    await act(async () => {
      reject(new Error("Test unavailable"));
    });
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 199",
    );
    expect(document.body.textContent).toContain("加载更多邮件失败");
    calls.mockImplementation(originalSnapshot);
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      "Pagination mail 200",
    );
  });
  it.each(["category", "mode", "selection"])(
    "discards a delayed page after changing %s",
    async (change) => {
      await seedLargeMailbox();
      await click(host.querySelectorAll("button.mail-row-main")[199]);
      const originalSnapshot = api.snapshot;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(api, "snapshot").mockImplementation(async (q) => {
        if (q.limit > 200) await gate;
        return originalSnapshot(q);
      });
      await click(host.querySelector('[aria-label="下一封邮件"]'));
      if (change === "category") await click(nav("星标邮件"));
      if (change === "mode") await chooseListMode("逐封邮件");
      if (change === "selection")
        await click(host.querySelector("button.mail-row-main"));
      await act(async () => {
        release();
        await gate;
      });
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(200);
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        change === "category"
          ? undefined
          : change === "mode"
            ? "Pagination mail 199"
            : "Pagination mail 0",
      );
      expect(
        host
          .querySelector('[aria-label="下一封邮件"]')
          ?.getAttribute("aria-busy"),
      ).not.toBe("true");
    },
  );
});
describe("reading unread mail within its current category", () => {
  it("navigates adjacent messages in the current list and protects its boundary", async () => {
    const seed = await snapshot({ ...localQuery, view: "all" });
    await click(host.querySelector("button.mail-row-main"));
    expect(
      (host.querySelector('[aria-label="上一封邮件"]') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[1].subject,
    );
    await click(host.querySelector('[aria-label="上一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
  });
  it("continues to the next unread message after the open message leaves the filter", async () => {
    const seed = await snapshot({
      ...localQuery,
      view: "all",
      unreadOnly: true,
    });
    await click(filter("未读"));
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
      seed.messages.length - 1,
    );
    await click(host.querySelector('[aria-label="下一封邮件"]'));
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[1].subject,
    );
  });
  it("supports Alt navigation but leaves input and compose dialog keystrokes alone", async () => {
    const seed = await snapshot({ ...localQuery, view: "all" });
    await click(host.querySelector("button.mail-row-main"));
    async function key(target: Element, key: string) {
      await act(async () =>
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            altKey: true,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    }
    await key(host.querySelector('[aria-label="搜索邮件"]')!, "ArrowDown");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
    await key(host.querySelector(".reader")!, "ArrowDown");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[1].subject,
    );
    await key(host.querySelector(".reader")!, "ArrowUp");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
    await click(
      [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.startsWith("写邮件"),
      )!,
    );
    await key(document.querySelector('[role="dialog"] button')!, "ArrowDown");
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      seed.messages[0].subject,
    );
  });
  it.each(["回复", "转发"])(
    "%s retains the selected original HTML and sets the expected quoting default",
    async (action) => {
      const originalCall = api.call;
      vi.spyOn(api, "call").mockImplementation(
        async <T,>(
          command: string,
          args: Record<string, unknown> = {},
        ): Promise<T> => {
          const result = await originalCall<T>(command, args);
          if (command === "mail_detail")
            return {
              ...result,
              html: "<style>td{color:red}</style><table><tr><td>Original report</td></tr></table>",
            };
          return result;
        },
      );
      await click(host.querySelector("button.mail-row-main"));
      await click(
        [...host.querySelectorAll("button")].find(
          (b) =>
            b.getAttribute("aria-label") === action ||
            b.textContent?.trim() === action,
        ) ?? null,
      );
      expect(
        (
          document.querySelector(
            'textarea[aria-label="邮件正文"]',
          ) as HTMLTextAreaElement
        ).value,
      ).toBe("");
      const toggle = document.querySelector(
        '[role="switch"]',
      ) as HTMLButtonElement;
      expect(toggle.getAttribute("aria-checked")).toBe(
        String(action === "转发"),
      );
      if (action === "回复") await click(toggle);
      expect(
        document
          .querySelector('iframe[title="引用原文"]')
          ?.getAttribute("srcdoc"),
      ).toContain("Original report");
      expect(
        document
          .querySelector('iframe[title="引用原文"]')
          ?.getAttribute("srcdoc"),
      ).toContain("td{color:red}");
    },
  );
  it("shows inbox and sent turns in order and preserves a quick reply across navigation", async () => {
    const sendSpy = vi.spyOn(api, "call");
    const seed = await snapshot(localQuery);
    const original = seed.messages[0];
    original.messageId = "<root@example.com>";
    original.date = new Date(Date.now() - 180000).toISOString();
    const own = {
      ...original,
      id: "own-turn",
      messageId: "<own@example.com>",
      references: [original.messageId],
      inReplyTo: [original.messageId],
      sender: "Alex <alex@example.com>",
      recipients: "Lin <lin@example.com>",
      subject: "Re: Chat",
      body: "My outgoing reply",
      date: new Date(Date.now() - 120000).toISOString(),
      sourceFolder: "Sent",
      isRead: true,
    };
    const incoming = {
      ...original,
      id: "newest-turn",
      messageId: "<latest@example.com>",
      references: [original.messageId, own.messageId],
      inReplyTo: [own.messageId],
      subject: "Re: Chat",
      body: "Latest response",
      date: new Date(Date.now() - 60000).toISOString(),
    };
    seed.messages.push(own, incoming);
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await click(host.querySelector("button.mail-row-main"));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(
        [...host.querySelectorAll(".conversation-turn")].map((e) =>
          e.getAttribute("data-mail-id"),
        ),
      ).toEqual([original.id, own.id, incoming.id]);
    });
    expect(
      host.querySelector(".conversation-turn.outgoing")?.textContent,
    ).toContain("我");
    expect(
      host.querySelector(".conversation-turn.outgoing")?.textContent,
    ).toContain("My outgoing reply");
    expect(host.querySelector(".quick-reply-heading")?.textContent).toContain(
      "lin@example.com",
    );
    const input = host.querySelector(
      'textarea[aria-label="对话回复正文"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "Chat reply draft");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(nav("星标邮件"));
    const drafts =
      await api.call<import("./lib/types").Compose[]>("list_drafts");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      body: "Chat reply draft",
      inReplyTo: incoming.messageId,
      to: expect.stringContaining("lin@example.com"),
      replyAnchorId: incoming.id,
    });
    await click(nav("全部收件箱"));
    await click(host.querySelector("button.mail-row-main"));
    expect(
      (
        host.querySelector(
          'textarea[aria-label="对话回复正文"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Chat reply draft");
    await click(
      [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("完整编辑"),
      )!,
    );
    expect(
      (
        document.querySelector(
          'textarea[aria-label="邮件正文"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("Chat reply draft");
    expect(
      host.querySelector('textarea[aria-label="对话回复正文"]'),
    ).toBeNull();
  });
  it("does not overwrite a restored formatted reply through the plain quick editor", async () => {
    await seedReplyThread();
    const seed = await snapshot(localQuery);
    const mail = seed.messages[0];
    await api.call("save_draft", {
      draft: {
        ...api.newDraft(mail.accountId),
        replyAnchorId: mail.id,
        body: "Rich draft",
        html: "<b>Rich draft</b>",
        format: "rich",
        attachments: ["/tmp/report.pdf"],
      },
    });
    await click(host.querySelector("button.mail-row-main"));
    expect(
      host.querySelector('textarea[aria-label="对话回复正文"]'),
    ).toBeNull();
    expect(host.querySelector(".quick-rich-draft")?.textContent).toContain(
      "保留原格式和附件",
    );
    await click(nav("星标邮件"));
    const drafts =
      await api.call<import("./lib/types").Compose[]>("list_drafts");
    expect(drafts[0].html).toBe("<b>Rich draft</b>");
    expect(drafts[0].attachments).toEqual(["/tmp/report.pdf"]);
  });
  it("persists clearing a saved quick reply instead of reviving deleted text", async () => {
    await seedReplyThread();
    const seed = await snapshot(localQuery),
      mail = seed.messages[0];
    await api.call("save_draft", {
      draft: {
        ...api.newDraft(mail.accountId),
        replyAnchorId: mail.id,
        body: "Previously saved text",
      },
    });
    await click(host.querySelector("button.mail-row-main"));
    const input = host.querySelector(
      'textarea[aria-label="对话回复正文"]',
    ) as HTMLTextAreaElement;
    expect(input.value).toBe("Previously saved text");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, "");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click(nav("星标邮件"));
    const drafts =
      await api.call<import("./lib/types").Compose[]>("list_drafts");
    expect(drafts[0].body).toBe("");
  });
  it("keeps the selected body loaded while changing list filters", async () => {
    const calls = vi.spyOn(api, "call");
    await click(host.querySelector("button.mail-row-main"));
    const before = calls.mock.calls.filter(
      ([command]) => command === "mail_detail",
    ).length;
    expect(before).toBeGreaterThan(0);
    await click(filter("未读"));
    await click(filter("全部"));
    expect(
      calls.mock.calls.filter(([command]) => command === "mail_detail"),
    ).toHaveLength(before);
    expect(
      host.querySelector(".message-body")?.textContent?.length,
    ).toBeGreaterThan(10);
  });
  it("reads a standalone mail without chat cards or a quick reply", async () => {
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".conversation-turn")).toBeNull();
    expect(host.querySelector(".quick-reply")).toBeNull();
    expect(host.querySelector(".conversation-start")).toBeNull();
    expect(
      host.querySelector(".message-body")?.textContent?.length,
    ).toBeGreaterThan(10);
    expect(host.querySelector(".storage-note")).toBeNull();
  });
  it("expands server folders and filters mail by the selected server folder", async () => {
    await click(
      host.querySelector('button[aria-label="展开 工作邮箱 的服务器文件夹"]'),
    );
    const sent = [...host.querySelectorAll(".remote-folder-list button")].find(
      (b) => b.textContent === "已发送",
    )!;
    await click(sent);
    expect(host.querySelector(".list-heading h1")?.textContent).toBe("已发送");
    expect(host.querySelectorAll(".mail-row-main")).toHaveLength(0);
    const inbox = [...host.querySelectorAll(".remote-folder-list button")].find(
      (b) => b.textContent === "收件箱",
    )!;
    await click(inbox);
    expect(host.querySelector(".list-heading h1")?.textContent).toBe("收件箱");
    expect(host.querySelectorAll(".mail-row-main").length).toBeGreaterThan(0);
  });
  it("opens an isolated directory explanation without automatically retrying its server selection", async () => {
    const seed = await snapshot(localQuery);
    const folder = {
      accountId: seed.accounts[0].id,
      name: "Unsafe",
      displayName: "异常目录",
      delimiter: "/",
      selectable: true,
      roles: [],
      syncError: "服务器响应不可靠",
    };
    await act(async () => root.unmount());
    leaveDemo();
    vi.spyOn(api, "snapshot").mockResolvedValue({
      ...seed,
      messages: [],
      remoteFolders: [folder],
    });
    const commands = vi
      .spyOn(api, "call")
      .mockImplementation(
        async <T,>(command: string): Promise<T> =>
          (command === "account_folders" ? [folder] : []) as T,
      );
    root = createRoot(host);
    await act(async () => root.render(<App />));
    await click(
      host.querySelector('button[aria-label="展开 工作邮箱 的服务器文件夹"]'),
    );
    await click(
      [...host.querySelectorAll(".remote-folder-list button")].find((button) =>
        button.textContent?.includes("异常目录"),
      ) ?? null,
    );
    expect(host.textContent).toContain("目录来源已隔离");
    expect(
      commands.mock.calls.some(([command]) => command === "sync_remote_folder"),
    ).toBe(false);
  });
  it("blocks native context menus on blank areas and inputs without stopping custom handlers", () => {
    const input = host.querySelector('input[aria-label="搜索邮件"]')!;
    const custom = vi.fn();
    input.addEventListener("contextmenu", custom);
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    expect(input.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(custom).toHaveBeenCalledOnce();
    expect(
      document.body.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    ).toBe(false);
  });
  it("keeps manually saved contact names in recipient suggestions", async () => {
    const seed = await snapshot(localQuery);
    const sender = seed.messages.find((m) => m.sender.includes("<"))!.sender;
    const email = sender.match(/<([^>]+)>/)![1];
    await api.call("save_contact", {
      contact: { id: "manual-contact", name: "My saved name", email },
    });
    const suggestions = await api.call<{ name: string; email: string }[]>(
      "contact_suggestions",
    );
    expect(
      suggestions.filter((a) => a.email.toLowerCase() === email.toLowerCase()),
    ).toEqual([{ id: "manual-contact", name: "My saved name", email }]);
  });
  it("shows loading while fetching and ignores a previous mail arriving late", async () => {
    const seed = await snapshot({ ...localQuery, view: "all" });
    const [first, second] = seed.messages;
    const originalCall = api.call;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "mail_detail") {
          if (args.id === first.id) await firstGate;
          if (args.id === second.id) await secondGate;
        }
        return originalCall<T>(command, args);
      },
    );
    try {
      await click(host.querySelector("button.mail-row-main"));
      expect(host.querySelector(".reader-loading")?.textContent).toContain(
        "正在加载邮件",
      );
      expect(
        host.querySelector('.reader-loading [data-slot="skeleton"]'),
      ).not.toBeNull();
      await click(host.querySelectorAll("button.mail-row-main")[1]);
      await act(async () => {
        releaseSecond();
        await secondGate;
      });
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        second.subject,
      );
      expect(host.querySelector(".reader-loading")).toBeNull();
      await act(async () => {
        releaseFirst();
        await firstGate;
      });
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        second.subject,
      );
    } finally {
      releaseFirst();
      releaseSecond();
    }
  });
  it("offers retry after a mail load fails and removes the redundant folder badge", async () => {
    const originalCall = api.call;
    let fail = true;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "mail_detail" && fail) throw new Error("模拟读取失败");
        return originalCall<T>(command, args);
      },
    );
    await click(host.querySelector("button.mail-row-main"));
    expect(host.querySelector(".reader-loading")?.textContent).toContain(
      "邮件加载失败",
    );
    expect(host.querySelector(".reader-loading .animate-spin")).toBeNull();
    fail = false;
    await click(host.querySelector(".reader-loading button"));
    expect(host.querySelector(".message-heading")).not.toBeNull();
    expect(
      host.querySelector(".message-metadata [data-slot=badge]"),
    ).toBeNull();
    expect(host.querySelector(".message-metadata time")).not.toBeNull();
    expect(host.querySelector(".message-metadata .saved-chip")).not.toBeNull();
  });
  it("expands and restores the current unread reader without remounting its content", async () => {
    await click(nav("本地存档"));
    await click(filter("未读"));
    await click(host.querySelector("button.mail-row-main"));
    const content = host.querySelector(".reader-scroll")!;
    const subject = host.querySelector(".message-heading h1")?.textContent;
    content.scrollTop = 120;
    await click(host.querySelector('button[aria-label="最大化阅读区域"]'));
    expect(host.querySelector(".app-shell.reader-expanded")).not.toBeNull();
    expect(host.querySelector(".reader-scroll")).toBe(content);
    expect(content.scrollTop).toBe(120);
    await click(host.querySelector('button[aria-label="还原阅读区域"]'));
    expect(host.querySelector(".app-shell.reader-expanded")).toBeNull();
    await click(host.querySelector('button[aria-label="最大化阅读区域"]'));
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".app-shell.reader-expanded")).toBeNull();
    expect(host.querySelector(".reader-scroll")).toBe(content);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      subject,
    );
    expect(host.querySelector(".list-heading h1")?.textContent).toBe(
      "本地存档",
    );
    expect(filter("未读")?.getAttribute("aria-selected") === "true").toBe(true);
  });
  it.each(["全部收件箱", "本地存档", "项目协作", "星标邮件", "工作邮箱"])(
    "keeps an opened message readable in %s after marking it read",
    async (scope) => {
      await click(nav(scope));
      await click(filter("未读"));
      const row = host.querySelector("button.mail-row-main");
      const subject = row?.querySelector(".row-subject")?.textContent;
      expect(subject).toBeTruthy();
      const before = host.querySelectorAll("button.mail-row-main").length;
      await click(row);
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        subject,
      );
      expect(
        host.querySelector(".message-body")?.textContent?.length,
      ).toBeGreaterThan(10);
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
        before - 1,
      );
      expect(host.querySelector('button[title="标记未读"]')).not.toBeNull();
      const title = host.querySelector(".list-heading h1")?.textContent;
      await click(filter("全部"));
      expect(host.querySelector(".list-heading h1")?.textContent).toBe(title);
      expect(host.querySelector(".message-heading h1")?.textContent).toBe(
        subject,
      );
    },
  );
  it("keeps the final unread message open when the category becomes empty and supports marking unread again", async () => {
    await click(nav("项目协作"));
    await click(filter("未读"));
    let lastSubject = "";
    while (host.querySelector("button.mail-row-main")) {
      const row = host.querySelector("button.mail-row-main")!;
      lastSubject = row.querySelector(".row-subject")!.textContent!;
      await click(row);
    }
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      lastSubject,
    );
    await click(host.querySelector('button[title="标记未读"]'));
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(1);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      lastSubject,
    );
    await click(
      [...host.querySelectorAll("button")].find(
        (b) => b.textContent === "撤销",
      ) ?? null,
    );
    expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(0);
    expect(host.querySelector(".message-heading h1")?.textContent).toBe(
      lastSubject,
    );
    await click(nav("本地存档"));
    expect(host.querySelector(".message-heading")).toBeNull();
    expect(
      host.querySelectorAll("button.mail-row-main").length,
    ).toBeGreaterThan(1);
  });
  it("refreshes the current category when a read operation finishes after navigation", async () => {
    const seed = await snapshot(localQuery);
    seed.messages[0].sourceFolder = "Archive";
    localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(seed));
    api.restoreDemo();
    await click(nav("全部收件箱"));
    await click(filter("未读"));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalCall = api.call;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(
        command: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (command === "update_mail" && args.action === "read") await gate;
        return originalCall<T>(command, args);
      },
    );
    try {
      await click(host.querySelector("button.mail-row-main"));
      await click(nav("本地存档"));
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
        seed.messages.length,
      );
      await act(async () => {
        release();
        await gate;
      });
      expect(host.querySelector(".list-heading h1")?.textContent).toBe(
        "本地存档",
      );
      expect(host.querySelectorAll("button.mail-row-main")).toHaveLength(
        seed.messages.length,
      );
      expect(host.querySelector(".message-heading")).toBeNull();
    } finally {
      release();
    }
  });
  it("returns only unread messages within each demo category", async () => {
    for (const query of [
      { ...localQuery, view: "all" },
      { ...localQuery, view: "starred" },
      { ...localQuery, view: "sent" },
      { ...localQuery, view: "trash" },
      { ...localQuery, folder: "项目协作" },
      { ...localQuery, accountId: "demo-work" },
    ]) {
      const all = await snapshot(query);
      const unread = await snapshot({ ...query, unreadOnly: true });
      expect(unread.messages.map((m) => m.id)).toEqual(
        all.messages.filter((m) => !m.isRead).map((m) => m.id),
      );
      expect(unread.matched).toBe(unread.messages.length);
    }
  });
});

it("opens saving guidance after a new account connects without submitting folder changes", async () => {
  await click(nav("设置与账号"));
  await click(
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "添加账号",
    ) || null,
  );
  await click(
    [...document.querySelectorAll("button.provider")].find((b) =>
      b.textContent?.includes("QQ 邮箱"),
    ) || null,
  );
  const input = document.querySelector("#email") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "fictional-test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const realCall = api.call;
  let connected: import("./lib/types").Account | undefined;
  const mock = vi
    .spyOn(api, "call")
    .mockImplementation(async (command, args) => {
      if (command === "connect_account") {
        connected = args?.account as import("./lib/types").Account;
        expect(connected.email).toBe("fictional-test@qq.com");
        return "verified fixture" as never;
      }
      if (command === "retention_settings" && args?.id === connected?.id)
        return {
          account: connected,
          defaultSave: true,
          folders: [],
          overrides: [],
          summary: {
            dataDir: "/fixture",
            known: 0,
            saved: 0,
            savedBytes: 0,
            pending: 0,
            failedJobs: 0,
            lastSync: null,
            receiveError: null,
            warning: null,
          },
        } as never;
      return realCall(command, args);
    });
  await act(async () =>
    document
      .querySelector("form.account-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(document.body.textContent).toContain("邮箱已连接");
  expect(document.body.textContent).toContain("本地保存状态");
  expect(document.body.textContent).toContain("fictional-test@qq.com");
  expect(mock).not.toHaveBeenCalledWith("save_retention", expect.anything());
  await click(
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "以后再设置",
    ) || null,
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
