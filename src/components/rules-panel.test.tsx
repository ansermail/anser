// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RulesPanel } from "./rules-panel";
import { SidebarProvider } from "./ui/sidebar";
import * as api from "@/lib/api";
import { makeDemo } from "@/lib/demo";
import type { FolderSettings, Rule } from "@/lib/types";
import type { RuleExecution } from "./rule-executions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
let root: Root, host: HTMLDivElement, hits: RuleExecution[];
const data = makeDemo();
const account = data.accounts[1];
const folders = ["INBOX", "Archive", "&UXZO1mWHTvZZOQ-", "Isolated"].map(
  (name, i) => ({
    accountId: account.id,
    name,
    displayName: ["收件箱", "归档", "其他文件夹", "异常目录"][i],
    delimiter: "/",
    selectable: true,
    roles: [],
    syncError: name === "Isolated" ? "目录已隔离" : undefined,
  }),
);
const settings: FolderSettings = { folders, mappings: [] };
const showTasks = vi.fn();
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function select(label: string, option: string) {
  await act(async () =>
    document
      .querySelector(`[aria-label="${label}"]`)!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const item = [...document.querySelectorAll('[role="option"]')].find(
    (e) => e.textContent === option,
  );
  expect(item).toBeTruthy();
  await act(async () => (item as HTMLElement).click());
}
async function render(rules: Rule[] = []) {
  await act(async () =>
    root.render(
      <SidebarProvider>
        <RulesPanel
          data={{ ...data, rules }}
          onChange={vi.fn()}
          onShowTasks={showTasks}
        />
      </SidebarProvider>,
    ),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  hits = [];
  showTasks.mockClear();
  vi.spyOn(api, "call").mockImplementation(async <T,>(command: string) => {
    if (command === "folder_settings") return settings as T;
    if (command === "rule_executions") return hits as T;
    if (command === "rule_runs") return [] as T;
    if (command === "preview_rule") return ["example subject"] as T;
    return undefined as T;
  });
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

it("requires account/source/target, excludes isolated and same folders, and only previews before saving", async () => {
  await render();
  await click("新建规则");
  await select("规则执行动作", "移动到服务器文件夹");
  expect(
    (document.querySelector("#rule-source") as HTMLButtonElement).disabled,
  ).toBe(true);
  await select("规则适用账号", account.email);
  await select("规则来源文件夹", "收件箱");
  await act(async () =>
    document
      .querySelector("#rule-target")!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const options = [...document.querySelectorAll('[role="option"]')].map(
    (e) => e.textContent,
  );
  expect(options).not.toContain("收件箱");
  expect(options).not.toContain("异常目录");
  expect(options).toContain("其他文件夹");
  const target = [...document.querySelectorAll('[role="option"]')].find(
    (e) => e.textContent === "其他文件夹",
  )!;
  await act(async () => (target as HTMLElement).click());
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenCalledWith("preview_rule", {
    rule: expect.objectContaining({
      action: "serverMove",
      accountId: account.id,
      sourceFolder: "INBOX",
      destination: "&UXZO1mWHTvZZOQ-",
    }),
  });
  expect(api.call).not.toHaveBeenCalledWith("run_rules");
  expect(document.body.textContent).toContain("example subject");
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(api.call).toHaveBeenCalledWith("save_rules", {
    rules: [
      expect.objectContaining({
        sourceFolder: "INBOX",
        destination: "&UXZO1mWHTvZZOQ-",
        action: "serverMove",
      }),
    ],
  });
});
it("clears destinations when switching back to local actions", async () => {
  await render();
  await click("新建规则");
  await select("规则执行动作", "复制到服务器文件夹");
  await select("规则适用账号", account.email);
  await select("规则来源文件夹", "收件箱");
  await select("规则目标文件夹", "归档");
  await select("规则执行动作", "归入本地文件夹");
  expect(document.querySelector("#rule-source")).toBeNull();
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      sourceFolder: "",
      destination: "",
      action: "folder",
    }),
  });
});
it("shows task uncertainty without offering replay and retries only a failed enqueue", async () => {
  hits = ["uncertain", "blocked", "completed"].map((status) => ({
    id: status,
    ruleName: "发票归类",
    accountEmail: account.email,
    subject: status,
    action: "serverMove",
    source: "收件箱",
    target: "归档",
    status,
    error: status === "uncertain" ? "连接中断，结果未确认" : "",
    operationId: status === "blocked" ? null : "task",
    updatedAt: "",
  }));
  await render();
  expect(document.body.textContent).toContain("结果未确认");
  expect(document.body.textContent).toContain("连接中断，结果未确认");
  await click("查看服务器任务");
  expect(showTasks).toHaveBeenCalledOnce();
  await click("重新检查并入队");
  expect(api.call).toHaveBeenCalledWith("retry_rule_execution", {
    id: "blocked",
  });
  expect(api.call).not.toHaveBeenCalledWith(
    "directory_operation_action",
    expect.anything(),
  );
});
it("does not expose a full-address Gmail account as a supported remote rule account", async () => {
  await render();
  await click("新建规则");
  await select("规则执行动作", "复制到服务器文件夹");
  await act(async () =>
    document
      .querySelector('[aria-label="规则适用账号"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const gmail = [...document.querySelectorAll('[role="option"]')].find(
    (e) => e.textContent === data.accounts[0].email,
  )!;
  expect(gmail.getAttribute("data-disabled")).not.toBeNull();
});

it("offers complete save without a folder and save-and-classify with a local destination", async () => {
  await render();
  await click("新建规则");
  await select("规则执行动作", "完整保存到本地");
  expect(
    document.querySelector('input[placeholder="例如：项目 / 设计"]'),
  ).toBeNull();
  await select("规则执行动作", "完整保存并归入本地文件夹");
  expect(
    document.querySelector('input[placeholder="例如：项目 / 设计"]'),
  ).not.toBeNull();
  await select("条件字段", "正文");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      action: "saveFolder",
      conditions: [expect.objectContaining({ field: "body" })],
    }),
  });
  expect(api.call).not.toHaveBeenCalledWith("run_rules");
});
