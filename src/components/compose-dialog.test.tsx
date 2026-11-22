// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ComposeDialog } from "./compose-dialog";
import * as api from "@/lib/api";
import { toast } from "sonner";
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
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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
    format: "plain",
    to: "receiver@example.com",
    subject: "Source test",
  };
  function Harness() {
    const [draft, setDraft] = useState<Compose | null>(seed);
    return (
      <ComposeDialog
        dark
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
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(
      document.querySelector(
        ".compose-dialog + .compose-assistant-host + .compose-preview-panel",
      ),
    ).not.toBeNull();
    await input('textarea[aria-label="邮件正文"]', "边写边预览");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).toContain("边写边预览");
    await input('textarea[aria-label="邮件正文"]', "新写内容");
    const toggle = document.querySelector(
      '[role="switch"]',
    ) as HTMLButtonElement;
    await act(async () => toggle.click());
    expect(document.querySelector('iframe[title="引用原文"]')).toBeNull();
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
        ?.getAttribute("srcdoc"),
    ).not.toContain("Original");
    await click("关闭发送预览");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("发送预览");
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
  it("updates the side preview from Markdown and saves the original source", async () => {
    await act(async () => {
      await import("./rich-editor");
    });
    await format("markdown");
    const source = 'textarea[aria-label="Markdown 源码"]';
    await vi.waitFor(() =>
      expect(document.querySelector(".rich-body")).toBeTruthy(),
    );
    expect(document.querySelector(source)).toBeNull();
    expect(document.querySelector(".compose-body-card iframe")).toBeNull();
    expect(document.querySelector(".compose-preview-panel")).toBeNull();
    await click("Markdown 源码");
    await click("发送预览");
    await input(
      source,
      "# Heading\n\n**bold** with `sample.id`\n\n- [x] 已完成\n- [ ] 待处理\n\n```ts\nconst x = 1\n```\n\n> Quote\n\n| Title | Status |\n|---|---|\n| Example | Ready |",
    );
    const frame = document.querySelector('iframe[title="发送效果预览正文"]');
    const preview = new DOMParser().parseFromString(
      frame?.getAttribute("srcdoc") || "",
      "text/html",
    );
    expect(preview.querySelector("h1")?.style.marginTop).toBe("0px");
    expect(preview.querySelector("h1")?.style.fontSize).toBe("1.75em");
    expect(preview.querySelector("pre")?.style.borderRadius).toBe("8px");
    expect(preview.querySelector("pre code")?.textContent).toBe("const x = 1");
    expect(
      preview.querySelector<HTMLElement>("pre code")?.style.backgroundColor,
    ).toBe("");
    const badge = preview.querySelector<HTMLElement>("p code")!;
    expect(badge.style.borderRadius).toBe("4px");
    expect(badge.style.padding).toBe("2px 4px");
    expect(badge.style.backgroundColor).toBe("rgb(38, 38, 38)");
    const quoteRail = preview.querySelector<HTMLElement>(
      "blockquote > [data-anser-quote-rail]",
    );
    expect(quoteRail?.style.borderRadius).toBe("999px");
    expect(quoteRail?.style.backgroundColor).toBe("rgb(168, 203, 189)");
    expect(preview.querySelector("th")?.style.backgroundColor).toBe(
      "rgb(37, 37, 37)",
    );
    expect(
      preview.querySelector<HTMLElement>("[data-anser-authored]")?.style
        .backgroundColor,
    ).toBe("rgb(24, 24, 24)");
    expect(preview.querySelector("strong")?.textContent).toBe("bold");
    expect(
      [...preview.querySelectorAll("li")].map((item) => item.textContent),
    ).toEqual(["☑\u00a0已完成", "☐\u00a0待处理"]);
    expect(preview.querySelector("input")).toBeNull();
    await click("Markdown 源码");
    await vi.waitFor(() =>
      expect(document.querySelector(".rich-body h1")?.textContent).toBe(
        "Heading",
      ),
    );
    expect(document.querySelector(".rich-body strong")?.textContent).toBe(
      "bold",
    );
    expect(document.querySelector(".compose-body-card iframe")).toBeNull();
    await click("保存草稿并关闭");
    const drafts = await call<Compose[]>("list_drafts");
    expect(drafts[0].format).toBe("markdown");
    expect(drafts[0].source).toContain("**bold**");
    expect(drafts[0].body).not.toContain("**");
  });
  it("renders a Markdown file on the canvas and preserves its original source", async () => {
    await act(async () => {
      await import("./rich-editor");
    });
    const source = "## Imported\n\n- [x] Reviewed";
    const file = new File([source], "notes.md", { type: "text/markdown" });
    const picker = document.querySelector(
      'input[aria-label="导入正文文件"]',
    ) as HTMLInputElement;
    Object.defineProperty(picker, "files", {
      value: [file],
      configurable: true,
    });
    await act(async () =>
      picker.dispatchEvent(new Event("change", { bubbles: true })),
    );
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.querySelector(".rich-body h2")?.textContent).toBe(
          "Imported",
        ),
      );
    });
    expect(
      document.querySelector<HTMLInputElement>(
        '.rich-body input[type="checkbox"]',
      )?.checked,
    ).toBe(true);
    await click("Markdown 源码");
    expect(
      document.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Markdown 源码"]',
      )?.value,
    ).toBe(source);
  });
  it.each(["html", "markdown"] as const)(
    "freezes the %s preview in the demo plan and restores the editable source on cancellation",
    async (bodyFormat) => {
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
      await format(bodyFormat);
      if (bodyFormat === "markdown") await click("Markdown 源码");
      const authoredSource =
        bodyFormat === "html"
          ? "<style>td{color:red}</style><table><tr><td>planned</td></tr></table>"
          : "# Planned\n\nUse `sample.id`.\n\n> Sample quote";
      await input(
        `textarea[aria-label="${bodyFormat === "html" ? "HTML" : "Markdown"} 源码"]`,
        authoredSource,
      );
      await click("发送预览");
      const previewFrame = document.querySelector<HTMLIFrameElement>(
        'iframe[title="发送效果预览正文"]',
      );
      const parser = new DOMParser();
      const preview = parser.parseFromString(
        previewFrame?.srcdoc || "",
        "text/html",
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
        await input(`input[aria-label="${label}"]`, time);
      }
      await click("确认定时发送");
      const records = await call<OutboxRecord[]>("list_outbox");
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe("scheduled");
      expect(records[0].scheduledAt).toBe(new Date(selectedTime).toISOString());
      const delivery = parser.parseFromString(
        records[0].draft.deliveryHtml || "",
        "text/html",
      );
      expect(delivery.body.innerHTML).toBe(preview.body.innerHTML);
      expect(records[0].draft.deliveryHtml).toContain("original quote");
      expect(records[0].draft.html).not.toContain("original quote");
      expect(await call<Compose[]>("list_drafts")).toHaveLength(0);
      const restored = await call<Compose>("cancel_schedule", { id: seed.id });
      expect(restored.id).not.toBe(seed.id);
      expect(restored.source).toBe(authoredSource);
      expect(restored.quote?.included).toBe(true);
      expect(restored.quote?.html).toBe("<p>original quote</p>");
      expect((await call<OutboxRecord[]>("list_outbox"))[0].status).toBe(
        "cancelled",
      );
    },
  );
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

describe("attachment reminder", () => {
  it("shows when the authored body mentions an attachment and hides after selecting a file", async () => {
    seed = { ...seed, id: "attachment-warning" };
    await renderHarness();
    await input(
      'textarea[aria-label="邮件正文"]',
      "详细内容参见附件，我会附上最新报告。",
    );
    const reminder = document.querySelector(".compose-attachment-reminder");
    expect(reminder?.parentElement?.classList.contains("compose-footer")).toBe(
      true,
    );
    expect(reminder?.textContent).toContain("没有添加附件");
    expect(reminder?.textContent).toContain("参见附件");
    await click("关闭提醒");
    expect(document.querySelector(".compose-attachment-reminder")).toBeNull();

    seed = {
      ...seed,
      id: "attachment-present",
      body: "详细内容参见附件。",
      attachments: ["/tmp/report.pdf"],
    };
    await renderHarness();
    expect(document.querySelector(".compose-attachment-reminder")).toBeNull();
  });

  it("requires confirmation before scheduling a message without the mentioned file", async () => {
    seed = {
      ...seed,
      id: "attachment-confirmation",
      body: "请查收附件中的报价单。",
    };
    await renderHarness();
    expect(
      document.querySelector(".compose-attachment-reminder"),
    ).not.toBeNull();
    await click("关闭提醒");
    expect(document.querySelector(".compose-attachment-reminder")).toBeNull();
    await click("定时发送");
    await click("确认定时发送");
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("附件提醒");
    expect(
      document.querySelector('[role="alertdialog"]')?.textContent,
    ).toContain("请查收附件");
    const cancel = [
      ...document.querySelectorAll('[role="alertdialog"] button'),
    ].find(
      (button) => button.textContent?.trim() === "取消",
    ) as HTMLButtonElement;
    await act(async () => cancel.click());
    expect(await call<OutboxRecord[]>("list_outbox")).toHaveLength(0);
    expect(document.querySelector(".compose-dialog")).toBeTruthy();
  });
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
    expect(document.querySelector('iframe[title="本封邮件签名"]')).toBeNull();
    await click("发送预览");
    expect(
      document
        .querySelector('iframe[title="发送效果预览正文"]')
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
    expect(document.querySelector('iframe[title="本封邮件签名"]')).toBeNull();
    await click("发送预览");
    const preview = document
      .querySelector('iframe[title="发送效果预览正文"]')
      ?.getAttribute("srcdoc");
    expect(preview).toContain("Snapshot signature");
    expect(preview).not.toContain("Changed settings");
  });
});
describe("empty drafts", () => {
  it("never autosaves a new empty message with an automatic signature and discards it on close", async () => {
    seed = {
      ...newDraft(seed.accountId),
      id: "blank-new",
      signature: {
        accountId: seed.accountId,
        included: true,
        body: "Automatic signature",
        html: "<p>Automatic signature</p>",
      },
    };
    await renderHarness();
    expect(document.body.textContent).toContain("空白邮件不会保存");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(await call<Compose[]>("list_drafts")).toEqual([]);
    await click("舍弃空白邮件");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(await call<Compose[]>("list_drafts")).toEqual([]);
  });
  it("still saves a message that only has a recipient", async () => {
    seed = {
      ...newDraft(seed.accountId),
      id: "recipient-only",
      to: "recipient@example.com",
    };
    await renderHarness();
    await click("保存草稿并关闭");
    expect(
      (await call<Compose[]>("list_drafts")).find((d) => d.id === seed.id)?.to,
    ).toBe("recipient@example.com");
  });
  it("waits for an in-flight autosave before deleting content that was cleared, so the draft cannot reappear", async () => {
    seed = {
      ...newDraft(seed.accountId),
      format: "plain",
      id: "blank-after-edit",
    };
    await renderHarness();
    const original = api.call;
    let finishSave!: () => Promise<void>;
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "save_draft")
          return new Promise<T>((resolve) => {
            finishSave = async () => {
              const result = await original<T>(command, args);
              resolve(result);
            };
          });
        return original<T>(command, args);
      },
    );
    await input('textarea[aria-label="邮件正文"]', "Temporary content");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(finishSave).toBeTypeOf("function");
    await input('textarea[aria-label="邮件正文"]', "");
    await click("舍弃空白邮件");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => finishSave());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(await call<Compose[]>("list_drafts")).toEqual([]);
  });
  it("keeps the editor open and reports a failure when empty-draft cleanup fails", async () => {
    seed = { ...newDraft(seed.accountId), id: "blank-delete-fails" };
    await renderHarness();
    const original = api.call;
    const error = vi.spyOn(toast, "error").mockReturnValue(0);
    vi.spyOn(api, "call").mockImplementation(
      async <T,>(command: string, args: Record<string, unknown> = {}) => {
        if (command === "delete_draft") throw new Error("database unavailable");
        return original<T>(command, args);
      },
    );
    await click("舍弃空白邮件");
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(error).toHaveBeenCalledWith(
      "空白邮件舍弃失败：Error: database unavailable",
    );
  });
});
