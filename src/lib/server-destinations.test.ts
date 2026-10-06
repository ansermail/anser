import { describe, expect, it } from "vitest";
import { directoryShortcuts, directorySource } from "./server-destinations";
import type { Mail, RemoteFolder } from "./types";
const mail = { sourceFolder: "OldRoot" } as Mail;
const folder = (
  name: string,
  roles: RemoteFolder["roles"] = [],
): RemoteFolder => ({
  accountId: "a",
  name,
  roles,
  selectable: true,
  delimiter: "/",
  displayName: name,
});
describe("source and special-use destination decisions", () => {
  it("matches canonical inbox before stale historical source, but a specific view wins", () => {
    expect(directorySource(mail, ["OldRoot", "INBOX"], [], "account")).toBe(
      "INBOX",
    );
    expect(
      directorySource(mail, ["OldRoot", "INBOX"], [], "account", "OldRoot"),
    ).toBe("OldRoot");
  });
  it("rejects isolated, absent and ambiguous sources instead of moving an arbitrary copy", () => {
    expect(() => directorySource(mail, ["A", "B"], [], "local")).toThrow(
      "多个服务器来源",
    );
    expect(() => directorySource(mail, ["A"], [], "all")).toThrow(
      "收件箱来源已失效",
    );
    expect(() =>
      directorySource(
        mail,
        ["A"],
        [{ ...folder("A"), syncError: "isolated" }],
        "account",
        "A",
      ),
    ).toThrow("已不在");
    expect(() => directorySource(mail, ["A"], [], "sent")).toThrow("无法确定");
  });
  it("does not treat all-mail as archive or use stale disabled mappings", () => {
    const choices = directoryShortcuts(
      [
        folder("All", ["all"]),
        { ...folder("Trash", ["trash"]), selectable: false },
      ],
      "INBOX",
    );
    expect(choices[0].folder).toBeUndefined();
    expect(choices[0].reason).toContain("设置目标");
    expect(choices[2].reason).toBe("目标目录不可用");
  });
});
