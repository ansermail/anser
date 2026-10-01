// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import App from "./App";
import { enterDemo, leaveDemo, snapshot } from "./lib/api";
import * as api from "./lib/api";
import type { Query } from "./lib/types";

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
  HTMLElement.prototype.scrollTo = vi.fn();
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
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("reading unread mail within its current category", () => {
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
        host.querySelector(".reader-loading .animate-spin"),
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
    expect(filter("未读")?.classList.contains("selected")).toBe(true);
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
      expect(host.querySelector('button[title="标记本地未读"]')).not.toBeNull();
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
    await click(host.querySelector('button[title="标记本地未读"]'));
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
