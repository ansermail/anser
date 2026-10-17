// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RemoteFolderList } from "./remote-folder-list";
import type { RemoteFolder } from "../lib/types";

it("renders Gmail system folders beside inbox and selects their original paths", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSelect = vi.fn();
  const folders: RemoteFolder[] = [
    {
      accountId: "a",
      name: "INBOX",
      displayName: "收件箱",
      delimiter: "/",
      selectable: true,
      roles: ["inbox"],
    },
    {
      accountId: "a",
      name: "[Gmail]",
      displayName: "[Gmail]",
      delimiter: "/",
      selectable: false,
    },
    {
      accountId: "a",
      name: "[Gmail]/Important",
      displayName: "[Gmail]/重要邮件",
      delimiter: "/",
      selectable: true,
      roles: ["important"],
    },
  ];
  await act(async () =>
    root.render(
      <RemoteFolderList
        folders={folders}
        selected="[Gmail]/Important"
        unread={{ "[Gmail]/Important": { direct: 3, tree: 3 } }}
        onSelect={onSelect}
      />,
    ),
  );
  const items = [...host.querySelectorAll(".folder-item")];
  expect(items.map((item) => item.querySelector("span")?.textContent)).toEqual([
    "收件箱",
    "重要邮件",
  ]);
  expect(host.querySelector(".remote-folder-children")).toBeNull();
  expect(items[1].getAttribute("aria-current")).toBe("page");
  expect(items[1].textContent).toContain("3");
  await act(async () => (items[1] as HTMLElement).click());
  expect(onSelect).toHaveBeenCalledWith("[Gmail]/Important", false, "");
  await act(async () => root.unmount());
  host.remove();
});

it("uses an existing flagged folder as the account's starred view", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSelect = vi.fn();
  const onSelectStarred = vi.fn();
  const onMarkRead = vi.fn();
  const folders: RemoteFolder[] = [
    {
      accountId: "a",
      name: "INBOX",
      displayName: "收件箱",
      delimiter: "/",
      selectable: true,
      roles: ["inbox"],
    },
    {
      accountId: "a",
      name: "Flagged",
      displayName: "星标邮件",
      delimiter: "/",
      selectable: true,
      roles: ["flagged"],
    },
  ];
  await act(async () =>
    root.render(
      <RemoteFolderList
        folders={folders}
        selected=""
        starredSelected
        starredUnread={2}
        onSelect={onSelect}
        onSelectStarred={onSelectStarred}
        onMarkRead={onMarkRead}
      />,
    ),
  );
  const starred = [...host.querySelectorAll(".folder-item")].filter(
    (button) => button.querySelector("span")?.textContent === "星标邮件",
  );
  expect(starred).toHaveLength(1);
  expect(starred[0].getAttribute("aria-current")).toBe("page");
  expect(starred[0].textContent).toContain("2");
  await act(async () => (starred[0] as HTMLElement).click());
  expect(onSelectStarred).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => {
    starred[0].dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }),
    );
  });
  const markRead = document.querySelector('[data-slot="context-menu-item"]');
  expect(markRead?.textContent).toBe("标记为已读");
  await act(async () => (markRead as HTMLElement).click());
  expect(onMarkRead).toHaveBeenCalledWith("", false, "", true);
  await act(async () => root.unmount());
  host.remove();
});
it("does not show unread badges for sent or drafts folders", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const folders: RemoteFolder[] = [
    {
      accountId: "a",
      name: "INBOX",
      displayName: "收件箱",
      delimiter: "/",
      selectable: true,
      roles: ["inbox"],
    },
    {
      accountId: "a",
      name: "Sent",
      displayName: "已发送",
      delimiter: "/",
      selectable: true,
      roles: ["sent"],
    },
    {
      accountId: "a",
      name: "Drafts",
      displayName: "草稿",
      delimiter: "/",
      selectable: true,
      roles: ["drafts"],
    },
  ];
  await act(async () =>
    root.render(
      <RemoteFolderList
        folders={folders}
        selected=""
        unread={{
          INBOX: { direct: 2, tree: 2 },
          Sent: { direct: 3, tree: 3 },
          Drafts: { direct: 4, tree: 4 },
        }}
        onSelect={vi.fn()}
      />,
    ),
  );
  const buttons = [...host.querySelectorAll(".folder-item")];
  expect(buttons[0].textContent).toContain("2");
  expect(buttons[1].querySelector("em")).toBeNull();
  expect(buttons[2].querySelector("em")).toBeNull();
  await act(async () => root.unmount());
  host.remove();
});

it("does not offer mark-as-read for inbox, sent, or drafts folders", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const folders: RemoteFolder[] = [
    {
      accountId: "a",
      name: "INBOX",
      displayName: "收件箱",
      delimiter: "/",
      selectable: true,
      roles: ["inbox"],
    },
    {
      accountId: "a",
      name: "Sent",
      displayName: "已发送",
      delimiter: "/",
      selectable: true,
      roles: ["sent"],
    },
    {
      accountId: "a",
      name: "Drafts",
      displayName: "草稿箱",
      delimiter: "/",
      selectable: true,
      roles: ["drafts"],
    },
  ];
  await act(async () =>
    root.render(
      <RemoteFolderList
        folders={folders}
        selected=""
        onSelect={vi.fn()}
        onMarkRead={vi.fn()}
      />,
    ),
  );
  for (const button of [...host.querySelectorAll(".folder-item")]) {
    await act(async () => {
      button.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
        }),
      );
    });
    expect(
      document.querySelector('[data-slot="context-menu-item"]'),
    ).toBeNull();
  }
  await act(async () => root.unmount());
  host.remove();
});
