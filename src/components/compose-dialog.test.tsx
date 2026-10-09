// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ComposeDialog } from "./compose-dialog";
import { call, enterDemo, leaveDemo, newDraft, snapshot } from "@/lib/api";
import type { Compose, OutboxRecord } from "@/lib/types";
import { localDateTime } from "@/lib/schedule-time";
let root: Root, host: HTMLDivElement;
let seed: Compose;
let renderHarness: () => Promise<void>;
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (e) =>
      e.textContent?.trim() === label || e.getAttribute("aria-label") === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function input(selector: string, value: string) {
  const e = document.querySelector(selector) as HTMLInputElement;
  await act(async () => {
    const prototype =
      e.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(e, value);
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function format(value: string) {
  await act(async () => {
    document
      .querySelector('button[aria-label="正文格式"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
  });
  const labels: Record<string, string> = {
    plain: "纯文本",
    rich: "富文本",
    markdown: "Markdown",
    html: "HTML 源码",
  };
  const item = [...document.querySelectorAll('[role="option"]')].find((e) =>
    e.textContent?.includes(labels[value]),
  );
  expect(item).toBeTruthy();
  await act(async () => (item as HTMLElement).click());
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(cb, 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  localStorage.clear();
  enterDemo();
  const data = await snapshot({
    view: "all",
    accountId: "",
    folder: "",
    search: "",
    limit: 100,
    unreadOnly: false,
  });
  seed = {
    ...newDraft(data.accounts[0].id),
    to: "receiver@example.com",
    subject: "Source test",
  };
  function Harness() {
    const [draft, setDraft] = useState<Compose | null>(seed);
    return (
      <ComposeDialog
        draft={draft}
        accounts={data.accounts}
        onClose={() => setDraft(null)}
        onSent={() => {}}
      />
    );
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renderHarness = async () => {
    await act(async () => root.render(<Harness key={seed.id} />));
  };
  await renderHarness();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  leaveDemo();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("compose formats and scheduling", () => {
  it("renders original separately, previews delivery, and saves the include-original choice", async () => {
    seed = {
      ...seed,
      id: "quote-test",
      body: "新写内容",
      quote: {
        kind: "forward",
        included: true,
        sender: "lin@example.com",
        recipients: "me@example.com",
        date: "2026-10-01T10:00:00Z",
        subject: "Report",
        body: "Original",
        html: '<style>.report td{color:red}</style><table class="report"><tr><td>Original</td></tr></table>',
      },
    };
    await renderHarness();
    expect(
      (
        document.querySelector(
          'textarea[aria-label="邮件正文"]',
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("新写内容");
    expect(
      document
        .querySelector('iframe[title="引用原文"]')
        ?.getAttribute("srcdoc"),
    ).toContain('<table class="report">');
    await click("发送预览");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).toContain("新写内容");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).toContain("Original");
    await act(async () =>
      (
        document.querySelector(
          '.delivery-preview-dialog button[data-slot="dialog-close"]',
        ) as HTMLButtonElement
      ).click(),
    );
    const toggle = document.querySelector(
      '[role="switch"]',
    ) as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(document.querySelector('iframe[title="引用原文"]')).toBeNull();
    await click("发送预览");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).not.toContain("Original");
    await act(async () =>
      (
        document.querySelector(
          '.delivery-preview-dialog button[data-slot="dialog-close"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await click("保存草稿并关闭");
    const saved = (await call<Compose[]>("list_drafts"))[0];
    expect(saved.quote?.included).toBe(false);
    expect(saved.quote?.html).toContain("<table");
    expect(saved.body).toBe("新写内容");
  });
  it("can maximize and restore without losing typed content", async () => {
    await input('textarea[aria-label="邮件正文"]', "Still here");
    await click("最大化写信窗口");
    expect(document.querySelector(".compose-expanded")).toBeTruthy();
    await click("还原写信窗口");
    expect(document.querySelector(".compose-expanded")).toBeNull();
    expect(
      (document.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("Still here");
  });
  it("saves Markdown source and preview, reopens without switching to rich text", async () => {
    await format("markdown");
    await input(
      'textarea[aria-label="Markdown 源码"]',
      "# Heading\n\n**bold**",
    );
    expect(
      document
        .querySelector('iframe[title="写信正文预览"]')
        ?.getAttribute("srcdoc"),
    ).toContain("<strong>bold</strong>");
    await click("保存草稿并关闭");
    const drafts = await call<Compose[]>("list_drafts");
    expect(drafts[0].format).toBe("markdown");
    expect(drafts[0].source).toContain("**bold**");
    expect(drafts[0].body).not.toContain("**");
  });
  it("creates a frozen demo plan and cancellation returns a new editable draft", async () => {
    seed = {
      ...seed,
      id: "scheduled-quote",
      quote: {
        kind: "forward",
        included: true,
        sender: "lin@example.com",
        recipients: "",
        date: "2026-10-01T10:00:00Z",
        subject: "Report",
        body: "original quote",
        html: "<p>original quote</p>",
      },
    };
    await renderHarness();
    await format("html");
    await input(
      'textarea[aria-label="HTML 源码"]',
      "<style>td{color:red}</style><table><tr><td>planned</td></tr></table>",
    );
    await click("定时发送");
    const selectedTime = localDateTime(new Date(Date.now() + 86400000));
    await click("选择发送日期");
    const nextDay = new Date(selectedTime);
    const day = document.querySelector(
      `[data-day="${nextDay.toLocaleDateString()}"]`,
    ) as HTMLButtonElement;
    expect(day).toBeTruthy();
    await act(async () => day.click());
    for (const [label, time] of [
      ["发送小时", selectedTime.slice(11, 13)],
      ["发送分钟", selectedTime.slice(14, 16)],
    ]) {
      await act(async () => {
        document
          .querySelector(`button[aria-label="${label}"]`)!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
          );
      });
      const option = [...document.querySelectorAll('[role="option"]')].find(
        (e) => e.textContent?.trim() === time,
      );
      expect(option).toBeTruthy();
      await act(async () => (option as HTMLElement).click());
    }
    await click("确认定时发送");
    const records = await call<OutboxRecord[]>("list_outbox");
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("scheduled");
    expect(records[0].scheduledAt).toBe(new Date(selectedTime).toISOString());
    expect(records[0].draft.html).toContain("td{color:red}");
    expect(records[0].draft.deliveryHtml).toContain("original quote");
    expect(records[0].draft.html).not.toContain("original quote");
    expect(await call<Compose[]>("list_drafts")).toHaveLength(0);
    const restored = await call<Compose>("cancel_schedule", { id: seed.id });
    expect(restored.id).not.toBe(seed.id);
    expect(restored.source).toContain("<table>");
    expect(restored.quote?.included).toBe(true);
    expect(restored.quote?.html).toBe("<p>original quote</p>");
    expect((await call<OutboxRecord[]>("list_outbox"))[0].status).toBe(
      "cancelled",
    );
  });
});

it("uses a shadcn confirmation for an empty subject and cancellation keeps the draft", async () => {
  seed = { ...seed, id: "empty-subject", subject: "" };
  await renderHarness();
  await click("定时发送");
  await click("确认定时发送");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "邮件主题为空",
  );
  const cancel = [
    ...document.querySelectorAll('[role="alertdialog"] button'),
  ].find(
    (button) => button.textContent?.trim() === "取消",
  ) as HTMLButtonElement;
  await act(async () => cancel.click());
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(document.querySelector(".compose-dialog")).toBeTruthy();
  expect(document.body.textContent).not.toContain("撤销发送 · 8s");
});

describe("signature composition", () => {
  it("loads the account signature, saves a disabled choice and retains the draft snapshot", async () => {
    await call("save_mail_signature", {
      accountId: seed.accountId,
      signature: {
        enabled: true,
        useHtml: false,
        text: "Snapshot signature",
        fileName: "",
        fileText: "",
        fileHtml: "",
      },
    });
    seed = { ...seed, id: "signature-test", signature: undefined };
    await renderHarness();
    expect(
      document
        .querySelector('iframe[title="本封邮件签名"]')
        ?.getAttribute("srcdoc"),
    ).toContain("Snapshot signature");
    await act(async () =>
      (
        document.querySelector(
          '[id^="include-signature-"]',
        ) as HTMLButtonElement
      ).click(),
    );
    await click("保存草稿并关闭");
    const saved = (await call<Compose[]>("list_drafts")).find(
      (d) => d.id === seed.id,
    )!;
    expect(saved.body).toBe(seed.body);
    expect(saved.signature?.included).toBe(false);
    expect(saved.signature?.body).toBe("Snapshot signature");
    await call("save_mail_signature", {
      accountId: seed.accountId,
      signature: {
        enabled: true,
        useHtml: false,
        text: "Changed settings",
        fileName: "",
        fileText: "",
        fileHtml: "",
      },
    });
    seed = { ...saved, id: "signature-reopen" };
    await renderHarness();
    expect(document.querySelector('iframe[title="本封邮件签名"]')).toBeNull();
    await act(async () =>
      (
        document.querySelector(
          '[id^="include-signature-"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(
      document
        .querySelector('iframe[title="本封邮件签名"]')
        ?.getAttribute("srcdoc"),
    ).toContain("Snapshot signature");
    expect(
      document
        .querySelector('iframe[title="本封邮件签名"]')
        ?.getAttribute("srcdoc"),
    ).not.toContain("Changed settings");
  });
});
