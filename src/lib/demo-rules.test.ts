// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { makeDemo } from "./demo";
import type { Rule, Snapshot } from "./types";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));
afterEach(() => {
  vi.resetModules();
  localStorage.clear();
});
const query = {
  view: "all",
  accountId: "",
  folder: "",
  search: "",
  limit: 100,
  unreadOnly: false,
  listMode: "messages",
} as const;
const rule: Rule = {
  id: "test-save",
  name: "保存示例",
  accountId: "",
  enabled: true,
  mode: "all",
  conditions: [
    { field: "subject", operator: "notContains", value: "not-existing" },
  ],
  action: "saveFolder",
  destination: "保存示例",
  stop: false,
};
async function setup(data: Snapshot) {
  localStorage.setItem("mail-desktop-demo-v1", JSON.stringify(data));
  const api = await import("./api");
  api.restoreDemo();
  return api;
}
it("classifies already complete fictional mail without providing asynchronous downloads", async () => {
  const api = await setup(makeDemo());
  await api.call("save_rules", { rules: [rule] });
  expect(await api.call<number>("run_rules")).toBeGreaterThan(0);
  expect(
    (await api.snapshot(query)).messages.every(
      (m) => m.localFolder === "保存示例",
    ),
  ).toBe(true);
  expect(await api.call("rule_runs")).toEqual([]);
  await expect(
    api.call("rule_run_action", { id: "test", action: "retry" }),
  ).rejects.toThrow("示例预览不执行异步规则任务");
});
it("unknown preview does not claim a negative body match and failed download leaves all data unchanged", async () => {
  const data = makeDemo();
  data.messages[data.messages.length - 1].savedLocally = false;
  data.messages[data.messages.length - 1].body = "";
  const api = await setup(data);
  const before = await api.snapshot(query);
  await api.call("save_rules", { rules: [rule] });
  await expect(api.call("run_rules")).rejects.toThrow("不提供实际下载");
  expect((await api.snapshot(query)).messages).toEqual(before.messages);
  const bodyRule = {
    ...rule,
    conditions: [
      { field: "body", operator: "notContains", value: "not-existing" },
    ],
  };
  const preview = await api.call<string[]>("preview_rule", { rule: bodyRule });
  expect(preview.some((s) => s.includes("等待正文核对"))).toBe(true);
  const { invoke } = await import("@tauri-apps/api/core");
  expect(invoke).not.toHaveBeenCalled();
});
