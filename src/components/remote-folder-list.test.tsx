// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RemoteFolderList } from "./remote-folder-list";
import type { RemoteFolder } from "../lib/types";

it("uses an existing flagged folder as the account's starred view", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSelect = vi.fn();
  const onSelectStarred = vi.fn();
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
  await act(async () => root.unmount());
  host.remove();
});
