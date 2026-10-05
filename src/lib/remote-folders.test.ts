import { describe, expect, it } from "vitest";
import { remoteFolderTree } from "./remote-folders";
import type { RemoteFolder } from "./types";
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
