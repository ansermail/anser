// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { RulesPanel } from "./rules-panel";
import { SidebarProvider } from "./ui/sidebar";
import * as api from "@/lib/api";
import { setInterfaceLanguage } from "@/lib/i18n";
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
function legacyServerRule(action: "serverCopy" | "serverMove"): Rule {
  return {
    id: "existing-server-rule",
    name: "已有服务器规则",
    accountId: "",
    enabled: true,
    mode: "all",
    conditions: [{ field: "subject", operator: "contains", value: "" }],
    action,
    destination: "",
    sourceFolder: "",
    actions: [{ action, destination: "", sourceFolder: "" }],
    stop: true,
  };
}
async function openExistingRule() {
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[title="编辑规则"]')!.click(),
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
  await render([legacyServerRule("serverMove")]);
  await openExistingRule();
  expect(
    (
      document.querySelector(
        '[aria-label="规则来源文件夹"]',
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await select("规则适用账号", account.email);
  await select("规则来源文件夹", "收件箱");
  await act(async () =>
    document
      .querySelector('[aria-label="规则目标文件夹"]')!
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
  await render([legacyServerRule("serverCopy")]);
  await openExistingRule();
  await select("规则适用账号", account.email);
  await select("规则来源文件夹", "收件箱");
  await select("规则目标文件夹", "归档");
  await select("规则执行动作", "归入本地文件夹");
  expect(document.querySelector('[aria-label="规则来源文件夹"]')).toBeNull();
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
    updatedAt: "2026-11-14T10:00:00+08:00",
  }));
  await render();
  const historyTrigger = document.querySelector<HTMLButtonElement>(
    'button[aria-label="展开或收起服务器规则执行记录"]',
  );
  if (historyTrigger?.getAttribute("aria-expanded") === "false")
    await act(async () => historyTrigger.click());
  expect(document.body.textContent).toContain("结果未确认");
  expect(document.body.textContent).toContain("连接中断，结果未确认");
  const table = document.querySelector<HTMLTableElement>(
    'table[aria-label="服务器规则命中记录"]',
  )!;
  expect(
    [...table.querySelectorAll("th")].map((cell) => cell.textContent),
  ).toEqual([
    "规则名称",
    "主题",
    "邮箱地址",
    "操作类型",
    "文件夹名称",
    "目标文件夹",
    "状态",
    "时间",
    "详情",
    "操作",
  ]);
  const uncertain = [...table.querySelectorAll("tbody tr")].find((row) =>
    row.textContent?.includes("uncertain"),
  )!;
  expect(uncertain.querySelector('td[data-column="folder"]')?.textContent).toBe(
    "收件箱",
  );
  expect(uncertain.querySelector('td[data-column="target"]')?.textContent).toBe(
    "归档",
  );
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
  await render([legacyServerRule("serverCopy")]);
  await openExistingRule();
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

it("offers local actions in a fixed-width row with controls at the right", async () => {
  await render();
  await click("新建规则");
  expect(
    document.querySelector('[data-slot="dialog-content"]')?.className,
  ).toContain("w-[900px]");
  const row = document.querySelector(
    '[aria-label="规则执行动作"]',
  )?.parentElement;
  expect(
    row?.querySelector('input[placeholder="例如：项目 / 设计"]'),
  ).not.toBeNull();
  expect(row?.lastElementChild?.className).toContain("ml-auto");
  await act(async () =>
    document
      .querySelector('[aria-label="规则执行动作"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const options = [...document.querySelectorAll('[role="option"]')].map(
    (item) => item.textContent,
  );
  expect(options).not.toContain("复制到服务器文件夹");
  expect(options).not.toContain("移动到服务器文件夹");
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
it("saves move and mark-read as ordered steps in one rule", async () => {
  await render([legacyServerRule("serverMove")]);
  await openExistingRule();
  await select("规则适用账号", account.email);
  await select("规则来源文件夹", "收件箱");
  await select("规则目标文件夹", "归档");
  await click("添加动作");
  await select("规则执行动作 2", "标记为已读");
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(api.call).toHaveBeenCalledWith("save_rules", {
    rules: [
      expect.objectContaining({
        actions: [
          expect.objectContaining({
            action: "serverMove",
            sourceFolder: "INBOX",
            destination: "Archive",
          }),
          expect.objectContaining({ action: "read" }),
        ],
      }),
    ],
  });
});
it("offers size and boundary text comparisons in rule preview", async () => {
  await render();
  await click("新建规则");
  await select("条件比较", "以此结尾");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({ field: "subject", operator: "endsWith" }),
      ],
    }),
  });
  await select("条件字段", "邮件大小（KB）");
  expect(
    (document.querySelector('[aria-label="条件值"]') as HTMLInputElement).type,
  ).toBe("number");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({ field: "sizeKb", operator: "greaterThan" }),
      ],
    }),
  });
});
it("offers read and starred status values and a shadcn date picker", async () => {
  await render();
  await click("新建规则");
  await select("条件字段", "已读状态");
  expect(document.querySelector('input[aria-label="条件值"]')).toBeNull();
  await select("条件值", "未读");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({
          field: "read",
          operator: "equals",
          value: "false",
        }),
      ],
    }),
  });
  await select("条件字段", "星标状态");
  await select("条件值", "有星标");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({
          field: "starred",
          operator: "equals",
          value: "true",
        }),
      ],
    }),
  });
  await select("条件字段", "邮件日期");
  expect(document.querySelector('input[type="date"]')).toBeNull();
  expect(document.querySelector('[aria-label="条件日期"]')).not.toBeNull();
});

it("offers copied receivers, priority and received-day conditions", async () => {
  await render();
  await click("新建规则");
  await select("条件字段", "抄送");
  expect(
    (document.querySelector('[aria-label="条件值"]') as HTMLInputElement).type,
  ).toBe("text");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({ field: "cc", operator: "contains" }),
      ],
    }),
  });
  await select("条件字段", "收件人或抄送");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({
          field: "recipientsOrCc",
          operator: "contains",
        }),
      ],
    }),
  });
  await select("条件字段", "优先级");
  await select("条件值", "高");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({
          field: "priority",
          operator: "equals",
          value: "high",
        }),
      ],
    }),
  });
  await select("条件字段", "已接收天数");
  const days = document.querySelector(
    '[aria-label="条件值"]',
  ) as HTMLInputElement;
  expect(days.type).toBe("number");
  expect(days.placeholder).toBe("天数");
  await click("预览匹配，不执行动作");
  expect(api.call).toHaveBeenLastCalledWith("preview_rule", {
    rule: expect.objectContaining({
      conditions: [
        expect.objectContaining({
          field: "ageDays",
          operator: "greaterThan",
        }),
      ],
    }),
  });
});

it("saves legacy rules with a server action in the second step and requires every server target", async () => {
  const first = { action: "read", sourceFolder: "", destination: "" };
  const second = {
    action: "serverCopy",
    sourceFolder: "INBOX",
    destination: "",
  };
  const third = {
    action: "serverMove",
    sourceFolder: "Archive",
    destination: "INBOX",
  };
  const rule = {
    ...legacyServerRule("serverCopy"),
    ...first,
    accountId: account.id,
    conditions: [{ field: "subject", operator: "contains", value: "invoice" }],
    actions: [first, second, third],
  };
  await render([rule]);
  await openExistingRule();
  const submit = document.querySelector<HTMLButtonElement>(
    ".rule-form button[type=submit]",
  )!;
  expect(submit.disabled).toBe(true);
  const target = document.querySelectorAll('[aria-label="规则目标文件夹"]')[0];
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const archive = [
    ...document.querySelectorAll<HTMLElement>('[role="option"]'),
  ].find((option) => option.textContent === "归档")!;
  await act(async () => archive.click());
  expect(submit.disabled).toBe(false);
  await act(async () => submit.click());
  expect(api.call).toHaveBeenCalledWith("save_rules", {
    rules: [
      expect.objectContaining({
        action: "read",
        destination: "",
        actions: [first, { ...second, destination: "Archive" }, third],
      }),
    ],
  });
});

it("blocks both buttons and form submission for a date condition without a value", async () => {
  await render([
    {
      ...legacyServerRule("serverMove"),
      action: "read",
      actions: [{ action: "read", sourceFolder: "", destination: "" }],
      conditions: [{ field: "date", operator: "after", value: "" }],
    },
  ]);
  await openExistingRule();
  const submit = document.querySelector<HTMLButtonElement>(
    ".rule-form button[type=submit]",
  )!;
  expect(submit.disabled).toBe(true);
  await act(async () =>
    submit.form!.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  expect(api.call).not.toHaveBeenCalledWith("save_rules", expect.anything());
});

it("localizes rule values and singular preview counts in English", async () => {
  setInterfaceLanguage("en");
  try {
    vi.mocked(api.call).mockImplementation(
      async <T,>(command: string) =>
        (command === "preview_rule"
          ? ["Match", "Pending（等待完整邮件核对）"]
          : []) as T,
    );
    await render([
      {
        ...legacyServerRule("serverCopy"),
        action: "read",
        actions: [{ action: "read", sourceFolder: "", destination: "" }],
        conditions: [{ field: "read", operator: "equals", value: "false" }],
      },
    ]);
    expect(host.textContent).toContain("Read status Equals Unread");
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[title="Edit rule"]')!.click(),
    );
    await click("Preview matches without running actions");
    expect(document.querySelector(".rule-preview")?.textContent).toContain(
      "This preview: 1 match.",
    );
    expect(document.querySelector(".rule-preview")?.textContent).toContain(
      "1 more message awaits complete-message verification.",
    );
    expect(document.querySelector(".rule-preview")?.textContent).toContain(
      "Pending (awaiting complete-message verification)",
    );
  } finally {
    setInterfaceLanguage("zh-CN");
  }
});
