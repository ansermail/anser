// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { RuleRunsPanel, type RuleRun } from "./rule-runs";
let root: Root, host: HTMLDivElement, items: RuleRun[];
const show = vi.fn();
function task(status: string): RuleRun {
  return {
    id: status,
    subject: `example ${status}`,
    accountEmail: "test@example.com",
    step: "完整保存",
    cursor: 1,
    total: 2,
    applied: 1,
    status,
    error: status === "blocked" ? "来源已隔离" : "",
    updatedAt: "",
  };
}
async function click(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function render() {
  await act(async () => root.render(<RuleRunsPanel onShowTasks={show} />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  items = [];
  show.mockClear();
  vi.spyOn(api, "call").mockImplementation(async (command) =>
    command === "rule_runs" ? (items as never) : (undefined as never),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("starts collapsed, shows pending count and exposes pause/resume/retry without replaying server tasks", async () => {
  items = [task("running"), task("paused"), task("blocked"), task("completed")];
  await render();
  expect(host.textContent).toContain("3 项待处理");
  expect(host.textContent).not.toContain("example running");
  await click("展开规则处理任务");
  expect(host.textContent).toContain("来源已隔离");
  expect(host.textContent).toContain("最后检查：完整保存");
  for (const [label, id, action] of [
    ["暂停", "running", "pause"],
    ["继续", "paused", "resume"],
    ["重新核对并执行剩余规则", "blocked", "retry"],
  ]) {
    await click(label);
    expect(api.call).toHaveBeenCalledWith("rule_run_action", { id, action });
  }
  await click("查看保存与服务器任务");
  expect(show).toHaveBeenCalledOnce();
  expect(api.call).not.toHaveBeenCalledWith(
    "directory_operation_action",
    expect.anything(),
  );
});
it("locks duplicate actions while pending and reports a rejected action", async () => {
  items = [task("running")];
  await render();
  await click("展开规则处理任务");
  let reject!: (error: Error) => void;
  vi.mocked(api.call).mockImplementation(async (command) =>
    command === "rule_run_action"
      ? (new Promise((_, r) => {
          reject = r;
        }) as never)
      : (items as never),
  );
  await click("取消剩余规则");
  await click("暂停");
  expect(
    vi.mocked(api.call).mock.calls.filter(([c]) => c === "rule_run_action"),
  ).toHaveLength(1);
  await act(async () => reject(new Error("任务代际已变化")));
  expect(host.textContent).toContain("任务代际已变化");
});
it("reports loading failures even when collapsed", async () => {
  vi.mocked(api.call).mockRejectedValue(new Error("无法读取任务"));
  await render();
  expect(host.textContent).toContain("无法读取任务");
});
