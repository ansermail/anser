// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TranslatableMailBody } from "./translatable-mail-body";
import type { TranslationPart } from "../lib/mail-translation";
const mock = vi.hoisted(() => ({ call: vi.fn(), docs: [] as Document[] }));
vi.mock("../lib/api", () => ({
  call: (...args: unknown[]) => mock.call(...args),
}));
vi.mock("./mail-content", () => ({
  MailContent: ({
    html,
    onDocumentReady,
  }: {
    html: string;
    onDocumentReady: (doc: Document | null) => void;
  }) => {
    useEffect(() => {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(html);
      doc.close();
      mock.docs.push(doc);
      onDocumentReady(doc);
      return () => {
        onDocumentReady(null);
        frame.remove();
      };
    }, [html, onDocumentReady]);
    return <div>邮件正文</div>;
  },
}));
let root: Root, host: HTMLElement, actions: HTMLElement;
let pending: ((value: TranslationPart[]) => void) | undefined;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.docs = [];
  pending = undefined;
  mock.call.mockReset();
  mock.call.mockImplementation((command: string) => {
    if (command === "get_translation_settings")
      return Promise.resolve({
        baseUrl: "http://localhost/v1",
        model: "test",
        targetLanguage: "zh-CN",
        revision: "r",
        hasApiKey: false,
      });
    if (command === "translate_mail_parts")
      return new Promise((resolve) => {
        pending = resolve;
      });
    return Promise.resolve();
  });
  actions = document.createElement("div");
  actions.innerHTML = "<h1>示例邮件标题</h1>";
  host = document.createElement("div");
  document.body.append(actions, host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
});
async function render(html = "<p>Hello <b>world</b></p>") {
  await act(async () =>
    root.render(
      <TranslatableMailBody
        html={html}
        body=""
        actionsContainer={actions}
        onOpenLink={() => {}}
      />,
    ),
  );
}
async function click(label: string) {
  await act(async () => {
    [...actions.querySelectorAll("button")]
      .find((b) => b.getAttribute("aria-label") === label)!
      .click();
  });
}
it("never sends text on opening and displays returned plain text below each original paragraph only after clicking", async () => {
  await render();
  expect(mock.call).not.toHaveBeenCalled();
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).not.toContain("保留原文，逐段显示译文");
  const button = actions.querySelector('button[aria-label="翻译"]')!;
  expect(button.textContent).toBe("");
  expect(button.querySelector("svg")).not.toBeNull();
  expect(actions.firstElementChild?.tagName).toBe("H1");
  await click("翻译");
  expect(actions.querySelector('button[aria-label="取消翻译"]')).not.toBeNull();
  expect(host.querySelector('[role="progressbar"]')).not.toBeNull();
  const args = mock.call.mock.calls.find(
    (c) => c[0] === "translate_mail_parts",
  )![1];
  expect(args.parts).toEqual([
    { id: "p0_t0", text: "Hello " },
    { id: "p0_t1", text: "world" },
  ]);
  await act(async () =>
    pending!(
      args.parts.map((p: TranslationPart) => ({
        id: p.id,
        text: p.id.endsWith("0") ? "你好 " : "世界",
      })),
    ),
  );
  expect(mock.docs[0].body.textContent).toBe("Hello world你好 世界");
  await click("隐藏译文");
  expect(mock.docs[0].body.textContent).toBe("Hello world");
});
it("cancels on mail replacement and discards a late result instead of changing either the next or old mail", async () => {
  await render();
  await click("翻译");
  const resolve = pending!;
  const args = mock.call.mock.calls.find(
    (c) => c[0] === "translate_mail_parts",
  )![1];
  const old = mock.docs[0].querySelector("p")!;
  await render("<p>Next mail</p>");
  expect(mock.call).toHaveBeenCalledWith("cancel_translation", {
    requestId: args.requestId,
  });
  await act(async () =>
    resolve(
      args.parts.map((p: TranslationPart) => ({ ...p, text: "迟到译文" })),
    ),
  );
  expect(old.textContent).toBe("Hello world");
  expect(mock.docs.at(-1)!.body.textContent).toBe("Next mail");
  expect(host.textContent).not.toContain("迟到译文");
});
it("cancels pending work after configuration changes and rejects malformed paragraph output", async () => {
  await render();
  await click("翻译");
  const late = pending!;
  await act(async () =>
    window.dispatchEvent(new Event("anser-translation-config-changed")),
  );
  await act(async () => late([{ id: "p0_t0", text: "late" }]));
  expect(mock.docs[0].querySelector("[data-anser-translation]")).toBeNull();
  await click("翻译");
  await act(async () =>
    pending!([{ id: "wrong", text: "<script>bad()</script>" }]),
  );
  expect(host.textContent).toContain("完整段落");
  expect(mock.docs[0].querySelector("[data-anser-translation]")).toBeNull();
});

it("translates plain-text paragraphs without including surrounding application text", async () => {
  const outside = document.createElement("div");
  outside.textContent = "Private account address must stay local";
  document.body.append(outside);
  await act(async () =>
    root.render(
      <TranslatableMailBody
        html=""
        body={"Hello world\n\nSecond paragraph"}
        actionsContainer={actions}
        onOpenLink={() => {}}
      />,
    ),
  );
  expect(host.querySelector(".message-body")?.textContent).toBe(
    "Hello world\n\nSecond paragraph",
  );
  await click("翻译");
  const args = mock.call.mock.calls.find(
    (c) => c[0] === "translate_mail_parts",
  )![1];
  expect(args.parts).toEqual([
    { id: "p0_t0", text: "Hello world" },
    { id: "p1_t0", text: "Second paragraph" },
  ]);
  await act(async () =>
    pending!(
      args.parts.map((p: TranslationPart) => ({ ...p, text: "中文段落" })),
    ),
  );
  expect(host.querySelectorAll("[data-anser-translation]")).toHaveLength(2);
  expect(outside.textContent).toBe("Private account address must stay local");
});

it("keeps icon-only cancel, retry and hide actions working without applying cancelled output", async () => {
  await render("<p>Hello</p>");
  await click("翻译");
  const late = pending!;
  const args = mock.call.mock.calls.find(
    (c) => c[0] === "translate_mail_parts",
  )![1];
  await click("取消翻译");
  expect(mock.call).toHaveBeenCalledWith("cancel_translation", {
    requestId: args.requestId,
  });
  expect(host.textContent).toContain("翻译已取消");
  expect(host.querySelector('[role="progressbar"]')).toBeNull();
  await click("重试翻译");
  const current = pending!;
  await act(async () => late([{ id: "p0_t0", text: "迟到译文" }]));
  expect(mock.docs[0].querySelector("[data-anser-translation]")).toBeNull();
  await act(async () => current([{ id: "p0_t0", text: "你好" }]));
  expect(mock.docs[0].body.textContent).toBe("Hello你好");
  expect(actions.querySelectorAll("button")).toHaveLength(1);
  expect(actions.querySelector("button")?.textContent).toBe("");
  await click("隐藏译文");
  expect(mock.docs[0].body.textContent).toBe("Hello");
  expect(actions.querySelector('button[aria-label="翻译"]')).not.toBeNull();
});

it("removes title actions on unmount and cancels their pending translation", async () => {
  await render("<p>Hello</p>");
  await click("翻译");
  const late = pending!;
  await act(async () => root.render(null));
  expect(actions.querySelector("button")).toBeNull();
  expect(mock.call).toHaveBeenCalledWith(
    "cancel_translation",
    expect.any(Object),
  );
  await act(async () => late([{ id: "p0_t0", text: "迟到译文" }]));
  expect(actions.textContent).toBe("示例邮件标题");
});
