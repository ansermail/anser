// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationReader } from "./conversation-reader";
import { makeDemo } from "../lib/demo";
import type { Detail, Mail } from "../lib/types";

const backend = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("../lib/api", () => ({ call: backend.call, newDraft: vi.fn() }));
vi.mock("./translatable-mail-body", () => ({
  TranslatableMailBody: ({ body }: { body: string }) => <p>{body}</p>,
}));
let host: HTMLDivElement, root: Root;
let resizeStream: () => void;
let selectedOffset: number;
let nextFrame: FrameRequestCallback;
async function resize() {
  await act(async () => {
    resizeStream();
    nextFrame(0);
  });
}
let selected: Detail;
const scrollRef = createRef<HTMLDivElement>();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  selected = {
    mail: { ...makeDemo().messages[0], conversationCount: 41 },
    html: "",
    attachments: [],
  };
  selectedOffset = 24;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private changed: () => void) {}
      observe(element: Element) {
        if (element.classList.contains("conversation-stream"))
          resizeStream = this.changed;
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top =
        this.dataset.mailId === selected.mail.id
          ? selectedOffset - (scrollRef.current?.scrollTop || 0)
          : 0;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 600,
        bottom: top + 100,
        width: 600,
        height: 100,
        toJSON() {},
      };
    },
  );
  backend.call.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the selected header in view as a 41-message conversation loads, then respects manual scrolling", async () => {
  let deliver!: (list: Mail[]) => void;
  backend.call.mockImplementation((command: string, args: { id: string }) => {
    if (command === "mail_conversation")
      return new Promise<Mail[]>((resolve) => {
        deliver = resolve;
      });
    if (command === "mail_detail")
      return Promise.resolve({
        ...selected,
        mail: { ...selected.mail, id: args.id },
      });
    return Promise.resolve([]);
  });
  const noop = vi.fn();
  await act(async () =>
    root.render(
      <ConversationReader
        selected={selected}
        revision={[]}
        accounts={[]}
        demo
        editorOpen={false}
        scrollRef={scrollRef}
        translationActions={null}
        onReply={noop}
        onReedit={noop}
        onEdit={noop}
        onSent={noop}
        onExport={noop}
        onAttachment={async () => {}}
        onAction={noop}
        onLink={noop}
      />,
    ),
  );
  Object.defineProperties(scrollRef.current!, {
    scrollHeight: { value: 60000 },
    clientHeight: { value: 500 },
  });
  await resize();
  expect(scrollRef.current?.scrollTop).toBe(24);
  selectedOffset = 40000;
  await act(async () =>
    deliver([
      ...Array.from({ length: 40 }, (_, i) => ({
        ...selected.mail,
        id: `older-${i}`,
      })),
      selected.mail,
    ]),
  );
  await resize();
  expect(host.querySelectorAll(".conversation-turn")).toHaveLength(41);
  expect(scrollRef.current?.scrollTop).toBe(40000);
  selectedOffset = 45000;
  await act(async () => {
    scrollRef.current!.scrollTop = 42000;
    scrollRef.current!.dispatchEvent(new Event("scroll"));
  });
  await resize();
  expect(scrollRef.current?.scrollTop).toBe(45000);
  await act(async () => {
    scrollRef.current!.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true }),
    );
    scrollRef.current!.scrollTop = 10000;
    scrollRef.current!.dispatchEvent(new Event("scroll"));
  });
  selectedOffset = 50000;
  await resize();
  expect(scrollRef.current?.scrollTop).toBe(10000);
  expect(
    scrollRef.current?.contains(host.querySelector(".conversation-reply")),
  ).toBe(false);
});

it("shows the delegating sender only when the message carries one", async () => {
  const delegated = {
    ...selected.mail,
    conversationCount: 2,
    senderOnBehalfOf: "bounce@mail.example.com",
  };
  backend.call.mockImplementation((command: string) =>
    Promise.resolve(
      command === "mail_conversation"
        ? [delegated]
        : { ...selected, mail: delegated },
    ),
  );
  const noop = vi.fn();
  await act(async () =>
    root.render(
      <ConversationReader
        selected={{ ...selected, mail: delegated }}
        revision={[]}
        accounts={[]}
        demo
        editorOpen={false}
        scrollRef={scrollRef}
        translationActions={null}
        onReply={noop}
        onReedit={noop}
        onEdit={noop}
        onSent={noop}
        onExport={noop}
        onAttachment={async () => {}}
        onAction={noop}
        onLink={noop}
      />,
    ),
  );
  const via = host.querySelector(".turn-sender-via");
  expect(via?.textContent).toBe("由 bounce@mail.example.com 代发");
  const plain = { ...selected.mail, conversationCount: 2 };
  backend.call.mockImplementation((command: string) =>
    Promise.resolve(
      command === "mail_conversation" ? [plain] : { ...selected, mail: plain },
    ),
  );
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () =>
    root.render(
      <ConversationReader
        selected={{ ...selected, mail: plain }}
        revision={[]}
        accounts={[]}
        demo
        editorOpen={false}
        scrollRef={scrollRef}
        translationActions={null}
        onReply={noop}
        onReedit={noop}
        onEdit={noop}
        onSent={noop}
        onExport={noop}
        onAttachment={async () => {}}
        onAction={noop}
        onLink={noop}
      />,
    ),
  );
  expect(host.querySelector(".turn-sender-via")).toBeNull();
});
