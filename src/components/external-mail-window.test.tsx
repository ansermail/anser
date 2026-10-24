// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExternalMailWindow } from "./external-mail-window";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  call: vi.fn(),
  printMail: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("../lib/api", () => ({
  call: mocks.call,
  native: true,
  newDraft: (accountId: string) => ({
    id: "draft",
    accountId,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: "",
    format: "rich",
    attachments: [],
  }),
}));
vi.mock("../lib/mail-print", () => ({ printMail: mocks.printMail }));
vi.mock("./conversation-reader", () => ({
  ConversationReader: ({
    onReply,
    onAttachment,
    onAttachmentPreview,
  }: {
    onReply: (detail: unknown, forward?: boolean, all?: boolean) => void;
    onAttachment: (mail: unknown, index: number, name: string) => void;
    onAttachmentPreview: (mail: unknown, index: number, name: string) => void;
  }) => (
    <div>
      <button onClick={() => onReply(null)}>reply</button>
      <button onClick={() => onReply(null, false, true)}>reply-all</button>
      <button onClick={() => onReply(null, true)}>forward</button>
      <button onClick={() => onAttachment(null, 2, "sample.bin")}>
        download
      </button>
      <button onClick={() => onAttachmentPreview(null, 2, "sample.bin")}>
        preview
      </button>
    </div>
  ),
}));
vi.mock("./compose-dialog", () => ({
  ComposeDialog: ({
    draft,
  }: {
    draft: { externalForwardToken?: string; to: string } | null;
  }) => (
    <div>
      compose:{draft?.externalForwardToken || "none"}|to:{draft?.to || ""}
    </div>
  ),
}));

const documentResult = {
  token: "document-token",
  filename: "sample.eml",
  detail: {
    originalHash: "hash",
    mail: {
      id: "external-sample",
      accountId: "external-eml",
      accountEmail: "",
      sender: "Sender <sender@example.com>",
      recipients: "reader@example.com",
      subject: "External sample",
      preview: "",
      body: "Body",
      date: "2026-10-23T09:00:00+08:00",
      isRead: true,
      starred: false,
      localFolder: "",
      trashed: false,
      hasAttachments: true,
      hash: "hash",
      size: 1,
      savedAt: "",
      sourceFolder: "",
      savedLocally: false,
      senderOnBehalfOf: "bounce@mail.example.com",
    },
    html: "<p>Body</p>",
    attachments: [
      {
        index: 2,
        name: "sample.bin",
        size: 4,
        mime: "application/octet-stream",
      },
    ],
    replyTo: [{ name: "Sender", email: "sender@example.com" }],
    to: [{ name: "", email: "reader@example.com" }],
    cc: [{ name: "Copy", email: "copy@example.com" }],
    bcc: [{ name: "", email: "hidden@example.com" }],
  },
};

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.invoke.mockReset();
  mocks.call.mockReset();
  mocks.printMail.mockReset();
  mocks.invoke.mockResolvedValue(documentResult);
  mocks.call.mockResolvedValue({
    accounts: [
      {
        id: "account",
        name: "Mail",
        email: "me@example.com",
        enabled: true,
      },
    ],
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<ExternalMailWindow />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("renders the external document in the normal reader window with disabled navigation", () => {
  expect(host.textContent).toContain("External sample");
  expect(host.textContent).toContain("reader@example.com");
  expect(host.textContent).toContain("sample.eml");
  expect(host.textContent).toContain("由 bounce@mail.example.com 代发");
  expect(
    [...host.querySelectorAll(".recipient-fields dt")].map(
      (n) => n.textContent,
    ),
  ).toEqual(["收件人：", "抄送：", "密送："]);
  expect(
    [...host.querySelectorAll(".recipient-fields dd")].map(
      (n) => n.textContent,
    ),
  ).toEqual([
    "reader@example.com",
    "Copy <copy@example.com>",
    "hidden@example.com",
  ]);
  expect(host.querySelectorAll("button:disabled")).toHaveLength(2);
  expect(mocks.invoke).toHaveBeenCalledWith("current_external_mail");
});

it("prepares mailbox replies and forwards from the external document", async () => {
  const buttons = [...host.querySelectorAll("button")];
  await act(async () =>
    buttons.find((button) => button.textContent === "reply")!.click(),
  );
  expect(host.textContent).toContain("compose:none");
  await act(async () =>
    buttons.find((button) => button.textContent === "forward")!.click(),
  );
  expect(host.textContent).toContain("compose:document-token");
});

it("opens the external composer for an individual recipient", async () => {
  const recipient = host.querySelector<HTMLElement>(
    '[aria-label="邮箱地址操作：reader@example.com"]',
  )!;
  await act(async () => {
    recipient.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }),
    );
  });
  const compose = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "写邮件")!;
  await act(async () => compose.click());
  expect(host.textContent).toContain("compose:none|to:reader@example.com");
});

it("routes attachment save and preview to the external document token", async () => {
  const buttons = [...host.querySelectorAll("button")];
  await act(async () =>
    buttons.find((button) => button.textContent === "preview")!.click(),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("preview_eml_attachment", {
    token: "document-token",
    index: 2,
  });
});
