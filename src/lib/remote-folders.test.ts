import { describe, expect, it } from "vitest";
import {
  remoteFolderTree,
  sidebarAccountError,
  sidebarFolderError,
} from "./remote-folders";
import type { Account, RemoteFolder } from "./types";
const folder = (
  name: string,
  delimiter: string | null = "/",
  selectable = true,
): RemoteFolder => ({
  accountId: "a",
  name,
  displayName: name,
  delimiter,
  selectable,
});
describe("server folder hierarchy", () => {
  it("builds real parent-child relationships even when children arrive first", () => {
    const roots = remoteFolderTree([
      folder("其他文件夹/恰饭"),
      folder("其他文件夹/订单/2021"),
      folder("其他文件夹", "/", false),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].label).toBe("其他文件夹");
    expect(roots[0].folder?.selectable).toBe(false);
    expect(roots[0].children.map((n) => n.label).sort()).toEqual([
      "恰饭",
      "订单",
    ]);
    const orders = roots[0].children.find((n) => n.label === "订单")!;
    expect(orders.folder).toBeUndefined();
    expect(orders.children[0].folder?.name).toBe("其他文件夹/订单/2021");
  });
  it("uses server delimiters and isolates accounts instead of assuming slash", () => {
    const roots = remoteFolderTree([
      folder("INBOX.Work", "."),
      folder("literal/name", null),
      { ...folder("INBOX.Work", "."), accountId: "b" },
    ]);
    expect(roots).toHaveLength(3);
    expect(roots.filter((n) => n.label === "INBOX")).toHaveLength(2);
    expect(roots.find((n) => n.label === "literal/name")?.children).toEqual([]);
  });
  it("omits an isolated empty placeholder but keeps a parent with real children", () => {
    const empty = {
      ...folder("其他文件夹"),
      syncError: "目录响应不可靠",
    };
    expect(remoteFolderTree([empty])).toHaveLength(0);
    const roots = remoteFolderTree([empty, folder("其他文件夹/归档")]);
    expect(roots).toHaveLength(1);
    expect(roots[0].path).toBe("其他文件夹");
    expect(roots[0].children[0].path).toBe("其他文件夹/归档");
  });
});

it("sorts special-use locations without changing their wire paths", () => {
  const roots = remoteFolderTree([
    { ...folder("CompanySent"), displayName: "已发送", roles: ["sent"] },
    folder("个人资料"),
    { ...folder("CompanyTrash"), displayName: "已删除", roles: ["trash"] },
    { ...folder("INBOX"), displayName: "收件箱", roles: ["inbox"] },
  ]);
  expect(roots.map((n) => n.label)).toEqual([
    "收件箱",
    "已发送",
    "已删除",
    "个人资料",
  ]);
  expect(roots[1].folder?.name).toBe("CompanySent");
});

it("flattens Gmail system grouping while retaining exact IMAP paths", () => {
  const roots = remoteFolderTree([
    {
      ...folder("[Gmail]/Important"),
      displayName: "[Gmail]/重要邮件",
      roles: ["important"],
    },
    {
      ...folder("[Gmail]/Starred"),
      displayName: "[Gmail]/星标邮件",
      roles: ["flagged"],
    },
    { ...folder("[Gmail]", "/", false), displayName: "[Gmail]" },
    folder("购物"),
  ]);
  expect(roots.map((node) => node.label)).toEqual([
    "星标邮件",
    "重要邮件",
    "购物",
  ]);
  expect(roots[1].path).toBe("[Gmail]/Important");
  expect(roots[1].folder?.name).toBe("[Gmail]/Important");
  expect(roots[1].children).toEqual([]);
});

it("keeps nested user labels and literal slash names when flattening Google Mail", () => {
  const roots = remoteFolderTree([
    folder("[Google Mail]", "/", false),
    folder("[Google Mail]/Custom/Nested"),
    folder("literal/name", null),
  ]);
  expect(roots.map((node) => node.path)).toContain("[Google Mail]/Custom");
  expect(roots.find((node) => node.label === "Custom")?.children[0].path).toBe(
    "[Google Mail]/Custom/Nested",
  );
  expect(roots.find((node) => node.label === "literal/name")?.children).toEqual(
    [],
  );
});

it("suppresses known grouping failures without hiding other account failures", () => {
  const root = { ...folder("其他文件夹", "/", false) };
  const error =
    "服务器报告该文件夹为空，但又返回邮件 UID，目录响应相互矛盾；已停止读取，原来源与本地存档保留";
  const account = {
    id: "a",
    incomingHost: "imap.qq.com",
    error: `文件夹「其他文件夹」查询邮件 UID失败：${error}；其余文件夹已继续检查，本次新增 0 封邮件`,
  } as Account;
  expect(sidebarAccountError(account, [root])).toBeNull();
  expect(sidebarFolderError({ ...root, syncError: error })).toBeUndefined();
  const other = "文件夹「INBOX」打开文件夹失败：连接已断开";
  expect(
    sidebarAccountError({ ...account, incomingHost: "imap.example.com" }, [
      root,
    ]),
  ).toBe(account.error);
  expect(sidebarFolderError({ ...root, syncError: "连接已断开" })).toBe(
    "连接已断开",
  );
  expect(sidebarFolderError({ ...folder("INBOX"), syncError: error })).toBe(
    error,
  );
  const mixed = {
    ...account,
    error: `文件夹「其他文件夹」查询邮件 UID失败：${error}；${other}；其余文件夹已继续检查，本次新增 0 封邮件`,
  };
  expect(sidebarAccountError(mixed, [root])).toBe(
    `${other}；其余文件夹已继续检查，本次新增 0 封邮件`,
  );
  const gmail = {
    ...account,
    incomingHost: "imap.gmail.com",
    error:
      "文件夹「[Gmail]」打开文件夹失败：No Response: [NONEXISTENT] Unknown Mailbox: [Gmail]",
  };
  expect(
    sidebarAccountError(gmail, [folder("[Gmail]", "/", false)]),
  ).toBeNull();
  expect(sidebarAccountError({ ...gmail, error: "连接已断开" }, [root])).toBe(
    "连接已断开",
  );
});
