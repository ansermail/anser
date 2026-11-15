// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { addDays, endOfMonth } from "date-fns";
import { afterEach, expect, it, vi } from "vitest";
import {
  newWorkItem,
  workDate,
  type WorkItem,
  type WorkProject,
} from "@/lib/workbench";
import { Workbench } from "./workbench";

const backend = vi.hoisted(() => ({
  items: [] as WorkItem[],
  projects: [] as WorkProject[],
  reportCalls: 0,
  reportInstructions: "",
  reportText:
    "本月共记录 12 项工作，其中 2 项已完成。客户协作项目正在确认合同与交付范围。产品设计评审和供应商资料补充仍在进行，下一步应提交初版方案并跟进待回复事项。",
}));
vi.mock("@/lib/api", () => ({
  call: async (
    command: string,
    args: {
      item: WorkItem;
      project: WorkProject;
      id: string;
      revision: number;
      input?: {
        kind: string;
        body: string;
        language: string;
        instructions?: string;
      };
    },
  ) => {
    if (command === "list_work_items") return [...backend.items];
    if (command === "list_work_projects") return [...backend.projects];
    if (command === "get_translation_settings")
      return {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        targetLanguage: "zh-CN",
        revision: "report-test",
        hasApiKey: true,
      };
    if (command === "run_mail_ai") {
      backend.reportCalls += 1;
      backend.reportInstructions = args.input?.instructions ?? "";
      return { text: backend.reportText };
    }
    if (command === "save_work_project" || command === "delete_work_project") {
      const previous = backend.projects.find(
        (project) => project.id === (args.project?.id ?? args.id),
      );
      const name = args.project?.name.trim() ?? "";
      backend.items = backend.items.map((item) =>
        previous && item.project === previous.name && previous.name !== name
          ? { ...item, project: name, revision: item.revision + 1 }
          : item,
      );
      backend.projects = backend.projects.filter(
        (project) => project.id !== (args.project?.id ?? args.id),
      );
      if (args.project)
        backend.projects.push({
          ...args.project,
          name,
          revision: args.project.revision + 1,
        });
      return { items: [...backend.items], projects: [...backend.projects] };
    }
    if (command === "save_work_item") {
      const item = { ...args.item, revision: args.item.revision + 1 };
      backend.items = [
        ...backend.items.filter((entry) => entry.id !== item.id),
        item,
      ];
      return item;
    }
  },
}));
afterEach(() => {
  backend.projects = [];
  backend.reportCalls = 0;
  backend.reportInstructions = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openReportDraft(host: HTMLElement) {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>('[aria-label="更多报告操作"]')!
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      ),
  );
  const draft = [...document.querySelectorAll('[role="menuitem"]')].find(
    (node) => node.textContent === "作为邮件草稿打开",
  )!;
  expect(draft).toBeTruthy();
  await act(async () =>
    draft.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
}
function reportDate(date: string) {
  const day = new Date(date + "T12:00:00");
  return (
    day.toLocaleDateString("zh-CN", { month: "long", day: "numeric" }) +
    " · " +
    day.toLocaleDateString("zh-CN", { weekday: "long" })
  );
}

it("shares a calendar quick entry across table and board and reloads it from storage", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  backend.items = [];
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  const page = (
    <Workbench
      onSeedConsumed={() => {}}
      openMail={() => {}}
      writeMail={() => {}}
    />
  );
  try {
    await act(async () => root.render(page));
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Review delivery");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(backend.items).toHaveLength(1);
    expect(
      host.querySelector(".workbench-day-items")?.parentElement,
    ).toBeTruthy();
    expect(host.textContent).toContain("Review delivery");
    const tab = async (label: string) => {
      const node = [...host.querySelectorAll('[role="tab"]')].find(
        (el) => el.textContent === label,
      )!;
      await act(async () =>
        node.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, button: 0 }),
        ),
      );
    };
    await tab("事项");
    expect(host.querySelector("tbody")?.textContent).toContain(
      "Review delivery",
    );
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="状态看板"]')!.click(),
    );
    expect(host.querySelector(".workbench-board")?.textContent).toContain(
      "Review delivery",
    );
    await act(async () =>
      host
        .querySelector('[aria-label="分组依据"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
        ),
    );
    const projectGrouping = [
      ...document.querySelectorAll('[role="option"]'),
    ].find((option) => option.textContent === "项目分类")!;
    await act(async () =>
      projectGrouping.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(
      host.querySelector(".wb-board-group-trigger")?.textContent,
    ).toContain("未分配项目");
    expect(
      host
        .querySelector(".wb-board-groups .workbench-board")
        ?.getAttribute("data-columns"),
    ).toBe("1");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(page));
    expect(host.textContent).toContain("Review delivery");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (originalScrollIntoView)
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoView,
      );
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

it("copies the selected day's work records as numbered plain text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const date = workDate(new Date());
  backend.items = [
    {
      ...newWorkItem(date),
      id: "afternoon",
      revision: 1,
      title: "下午事项",
      time: "14:00",
    },
    {
      ...newWorkItem(date),
      id: "morning",
      revision: 1,
      title: "上午事项",
      time: "09:00",
      checklist: [
        { text: "核对供应商资料", done: false },
        { text: "发送确认邮件", done: true },
      ],
    },
    {
      ...newWorkItem(date),
      id: "completed",
      revision: 1,
      title: "已完成事项",
      time: "10:00",
      status: "done",
    },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    const copy = host.querySelector<HTMLButtonElement>(
      'button[aria-label="复制当日工作记录"]',
    )!;
    expect(copy.disabled).toBe(false);
    await act(async () => copy.click());
    expect(writeText).toHaveBeenCalledWith(
      `${date.replaceAll("-", "/")}\n1.上午事项\n  -- 核对供应商资料\n  -- 发送确认邮件\n2.已完成事项\n3.下午事项`,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  }
});

it("shows calendar project and time metadata and keeps table fields in separate columns", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const date = workDate(new Date());
  const nextMonthDate = workDate(addDays(endOfMonth(new Date()), 1));
  backend.projects = [{ id: "project-client", revision: 1, name: "客户协作" }];
  backend.items = [
    {
      ...newWorkItem(date),
      title: "Review delivery notes",
      project: "客户协作",
      time: "09:30",
      priority: "high",
      important: true,
      mailId: "linked-mail",
      mailSubject: "项目资料补充",
      revision: 1,
    },
    {
      ...newWorkItem(nextMonthDate),
      title: "Next month planning",
      project: "客户协作",
      time: "10:00",
      urgent: true,
      revision: 1,
    },
    {
      ...newWorkItem(nextMonthDate),
      title: "Next month early",
      project: "客户协作",
      time: "09:00",
      revision: 1,
    },
  ];
  const writeText = vi.fn().mockResolvedValue(undefined);
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const openMail = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={openMail}
          writeMail={() => {}}
        />,
      ),
    );
    const event = host.querySelector(".workbench-day-event");
    expect(event?.querySelector(".workbench-project-dot")).toBeTruthy();
    expect(event?.querySelector("small")?.textContent).toBe("09:30");
    expect(event?.textContent).toContain("Review delivery notes");
    const weeks = [...host.querySelectorAll(".workbench-calendar .rdp-week")];
    expect(weeks).toHaveLength(6);
    expect(
      weeks.every(
        (week) => week.querySelectorAll('[role="gridcell"]').length === 7,
      ),
    ).toBe(true);
    const outsideDays = [
      ...host.querySelectorAll(".workbench-calendar .workbench-day-outside"),
    ];
    const currentMonthDays = [
      ...host.querySelectorAll(
        ".workbench-calendar .workbench-day-current-month",
      ),
    ];
    expect(outsideDays.length).toBeGreaterThan(0);
    expect(outsideDays.length + currentMonthDays.length).toBe(42);
    expect(
      outsideDays.every(
        (day) => day.querySelector(".workbench-day-number")?.textContent,
      ),
    ).toBe(true);
    expect(
      outsideDays.some((day) =>
        day.textContent?.includes("Next month planning"),
      ),
    ).toBe(true);
    expect(host.querySelector(".wb-agenda-footer")).toBeNull();
    expect(host.textContent).not.toContain("邮件中的时间提醒可加入工作台");

    const itemsTab = [...host.querySelectorAll('[role="tab"]')].find(
      (node) => node.textContent === "事项",
    )!;
    await act(async () =>
      itemsTab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(
      [...host.querySelectorAll('[data-slot="table-head"]')].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      "",
      "工作事项",
      "状态",
      "项目分类",
      "所属日期",
      "优先级",
      "重要",
      "紧急",
      "关联邮件",
    ]);
    expect(
      host.querySelector('[data-slot="table-cell"][data-column="status"] svg'),
    ).toBeTruthy();
    expect(
      [...host.querySelectorAll("tbody .wb-table-title")].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      "Next month planning",
      "Next month early",
      "Review delivery notes",
    ]);
    const highPriority = host.querySelector(
      '.wb-table-priority-badge[data-priority="high"]',
    );
    const normalPriority = host.querySelector(
      '.wb-table-priority-badge[data-priority="normal"]',
    );
    expect(highPriority?.querySelector(".lucide-triangle-alert")).toBeTruthy();
    expect(normalPriority?.querySelector(".lucide-minus")).toBeTruthy();
    const linkedMailCells = host.querySelectorAll(
      '[data-slot="table-cell"][data-column="linkedMail"]',
    );
    expect(linkedMailCells).toHaveLength(3);
    const linkedMailButton = host.querySelector<HTMLButtonElement>(
      '[data-slot="table-cell"][data-column="linkedMail"] .wb-table-mail-link',
    )!;
    expect(linkedMailButton.textContent).toBe("项目资料补充");
    expect(linkedMailButton.getAttribute("aria-label")).toBe(
      "打开关联邮件：项目资料补充",
    );
    await act(async () => linkedMailButton.click());
    expect(openMail).toHaveBeenCalledWith("linked-mail");
    const linkedRow = linkedMailButton.closest("tr")!;
    const nextMonthRow = [
      ...host.querySelectorAll<HTMLButtonElement>(".wb-table-title"),
    ]
      .find((button) => button.textContent === "Next month planning")!
      .closest("tr")!;
    const importantCell = linkedRow.querySelector(
      '[data-slot="table-cell"][data-column="important"]',
    )!;
    const linkedUrgentCell = linkedRow.querySelector(
      '[data-slot="table-cell"][data-column="urgent"]',
    )!;
    const nextMonthImportantCell = nextMonthRow.querySelector(
      '[data-slot="table-cell"][data-column="important"]',
    )!;
    const nextMonthUrgentCell = nextMonthRow.querySelector(
      '[data-slot="table-cell"][data-column="urgent"]',
    )!;
    expect(importantCell.textContent).toBe("重要");
    expect(
      importantCell.querySelector(".wb-table-flag-badge .lucide-star"),
    ).toBeTruthy();
    expect(linkedUrgentCell.textContent).toBe("—");
    expect(nextMonthImportantCell.textContent).toBe("—");
    expect(nextMonthUrgentCell.textContent).toBe("紧急");
    expect(
      nextMonthUrgentCell.querySelector(".wb-table-flag-badge .lucide-zap"),
    ).toBeTruthy();
    expect(
      host.querySelector(".task-data-table-footer")?.textContent,
    ).toContain("共 3 条记录");
    expect(
      host.querySelector(".task-data-table-footer")?.textContent,
    ).toContain("每页 14 条");
    const firstRow = linkedRow as HTMLTableRowElement;
    const firstRowId = firstRow.dataset.rowId;
    await act(async () =>
      firstRow.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
        }),
      ),
    );
    const contextMenu = document.querySelector(
      '[data-slot="context-menu-content"]',
    )!;
    expect(contextMenu.textContent).toContain("编辑工作事项");
    expect(contextMenu.textContent).toContain("工作状态");
    expect(contextMenu.textContent).toContain("项目分类");
    expect(contextMenu.textContent).toContain("优先级");
    expect(contextMenu.textContent).toContain("打开关联邮件");
    expect(
      host.querySelector(
        `tbody tr[data-row-id="${firstRowId}"][data-state="selected"]`,
      ),
    ).toBeTruthy();
    expect(host.querySelector('[data-column="workActions"]')).toBeNull();
    const editItem = [
      ...contextMenu.querySelectorAll<HTMLElement>(
        '[data-slot="context-menu-item"]',
      ),
    ].find((item) => item.textContent === "编辑工作事项")!;
    await act(async () => editItem.click());
    expect(document.querySelector<HTMLInputElement>("#work-title")?.value).toBe(
      "Review delivery notes",
    );
    await act(async () =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );

    const reportTab = [...host.querySelectorAll('[role="tab"]')].find(
      (node) => node.textContent === "工作报告",
    )!;
    await act(async () =>
      reportTab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(host.querySelector(".wb-report-scroll")).toBeTruthy();
    expect(host.querySelector(".wb-report-content .wb-view-scroll")).toBeNull();
    const generate = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("生成 AI 报告"),
    )!;
    await act(async () => generate.click());
    expect(backend.reportCalls).toBe(1);
    expect(host.textContent).toContain(backend.reportText);
    expect(host.textContent).not.toContain("由 deepseek-chat 生成");
    const copySummary = host.querySelector<HTMLButtonElement>(
      'button[aria-label="复制摘要"]',
    )!;
    expect(copySummary).toBeTruthy();
    await act(async () => copySummary.click());
    expect(writeText).toHaveBeenCalledWith(backend.reportText);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (clipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
  }
});

it("jumps across years and returns to today's selected date", async () => {
  const originalScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  backend.items = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    const original = host
      .querySelector(".workbench-day[data-selected-single=true]")
      ?.getAttribute("aria-label");
    const pick = host.querySelector<HTMLButtonElement>(
      '[aria-label^="选择年月"]',
    )!;
    await act(async () => pick.click());
    const chooseYear = async (label: string) => {
      await act(async () =>
        document
          .querySelector("#workbench-year")!
          .dispatchEvent(
            new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
          ),
      );
      const options = [...document.querySelectorAll('[role="option"]')];
      const shownYear = Number(
        document.querySelector("#workbench-year")?.textContent,
      );
      expect(options.map((node) => node.textContent)).toEqual([
        ...Array.from({ length: 7 }, (_, index) =>
          String(shownYear - 3 + index),
        ),
        "输入年份",
      ]);
      const option = options.find((node) => node.textContent === label)!;
      expect(option).toBeTruthy();
      await act(async () =>
        option.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
    };
    const nextYear = String(new Date().getFullYear() + 1);
    await chooseYear(nextYear);
    const jump = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "跳转")!;
    await act(async () => jump.click());
    expect(pick.textContent).toContain(nextYear);
    await act(async () => pick.click());
    await chooseYear("输入年份");
    const year = document.querySelector<HTMLInputElement>(
      "#workbench-custom-year",
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(year, "2042");
      year.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      year.form!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(pick.textContent).toContain("2042");
    const today = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "今天",
    )!;
    await act(async () => today.click());
    const selected = host.querySelector(
      ".workbench-day[data-selected-single=true]",
    );
    expect(selected?.getAttribute("aria-label")).toBe(original);
    expect(
      selected?.querySelector('.workbench-day-number[data-today="true"]'),
    ).toBeTruthy();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    if (originalScroll)
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScroll,
      );
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  }
});

it("renders one heading and a numbered list per report date and carries that layout to the mail draft", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const date = workDate(new Date());
  backend.items = ["First task", "Second task"].map((title) => ({
    ...newWorkItem(date),
    title,
    revision: 1,
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const writeMail = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={writeMail}
        />,
      ),
    );
    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (button) => button.textContent === "工作报告",
    )!;
    await act(async () =>
      tab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(
      [...host.querySelectorAll("h3")].map((node) => node.textContent),
    ).toEqual([reportDate(date)]);
    expect(
      [...host.querySelectorAll("ol > li strong")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["First task", "Second task"]);
    await openReportDraft(host);
    expect(writeMail.mock.calls[0][1]).toContain(`## ${date}\n1. First task`);
    expect(writeMail.mock.calls[0][1]).toContain("\n2. Second task");
    expect(writeMail.mock.calls[0][1]).not.toMatch(
      /工时|分钟|Estimated|Actual/,
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("places timed and multi-day items in the week, then opens a new record in a day slot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const date = workDate(new Date());
  const next = new Date();
  next.setDate(next.getDate() + 1);
  const nextDate = workDate(next);
  backend.items = [
    {
      ...newWorkItem(date),
      endDate: nextDate,
      title: "Schedule review",
      time: "09:30",
      revision: 1,
    },
    { ...newWorkItem(date), title: "Same day first", revision: 1 },
    { ...newWorkItem(date), title: "Same day second", revision: 1 },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  async function tab(label: string) {
    const node = [...host.querySelectorAll('[role="radio"]')].find(
      (item) => item.textContent === label,
    )!;
    await act(async () => (node as HTMLButtonElement).click());
  }
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    await tab("周");
    expect(host.querySelectorAll(".wb-week-day")).toHaveLength(7);
    const start = host.querySelector<HTMLButtonElement>(
      `[aria-label="在 ${date} 09:00 添加工作记录"]`,
    );
    expect(start?.parentElement?.textContent).toContain("09:30");
    const allDaySlot = host
      .querySelector(`[aria-label="在 ${date} 全天 添加工作记录"]`)
      ?.closest(".workbench-time-slot");
    const entries = allDaySlot?.querySelector(".wb-slot-entries");
    expect(
      [...entries!.querySelectorAll("button")].map(
        (item) => item.querySelector(".wb-event-title-text")?.textContent,
      ),
    ).toEqual(["Same day first", "Same day second"]);
    expect(
      entries?.querySelector<HTMLElement>(".wb-all-day-event")?.dataset
        .workStatus,
    ).toBe("todo");
    expect(
      host
        .querySelector(`[data-date="${nextDate}"][data-time=""]`)
        ?.textContent.includes("Schedule review") ?? next.getDay() === 1,
    ).toBeTruthy();
    expect(host.querySelectorAll(".wb-time-label")).toHaveLength(24);
    await tab("日");
    expect(host.querySelectorAll(".wb-week-day")).toHaveLength(1);
    const add = host.querySelector<HTMLButtonElement>(
      `[aria-label="在 ${date} 15:00 添加工作记录"]`,
    )!;
    await act(async () => add.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("#work-estimate")).toBeNull();
    expect(dialog.querySelector("#work-actual")).toBeNull();
    expect(dialog.querySelector("#work-hour")?.textContent).toBe("15");
    expect(dialog.textContent).toContain(date);
    expect(backend.items).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("classifies older records and moves them between quadrants with pointer dragging", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const {
    important: _important,
    urgent: _urgent,
    ...old
  } = newWorkItem(workDate(new Date()));
  backend.items = [
    { ...old, revision: 1, title: "Existing record" },
    {
      ...old,
      id: "urgent",
      revision: 1,
      title: "Urgent request",
      urgent: true,
    },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (node) => node.textContent === "四象限",
    )!;
    await act(async () =>
      tab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(host.querySelector('[data-quadrant="3"]')?.textContent).toContain(
      "Existing record",
    );
    expect(host.querySelector('[data-quadrant="2"]')?.textContent).toContain(
      "Urgent request",
    );
    const pointerEvent = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
      Object.defineProperties(event, {
        isPrimary: { value: true },
        pointerId: { value: 1 },
        pointerType: { value: "mouse" },
      });
      return event;
    };
    const source = host.querySelector<HTMLElement>(
      '[data-quadrant="2"] .wb-matrix-task',
    )!;
    const target = host.querySelector<HTMLElement>('[data-quadrant="0"]')!;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => target,
    });
    await act(async () => {
      source.dispatchEvent(pointerEvent("pointerdown", 100, 100));
      source.dispatchEvent(pointerEvent("pointermove", 140, 140));
    });
    expect(source.dataset.dragging).toBe("true");
    expect(target.dataset.dropTarget).toBe("true");
    expect(host.querySelector(".wb-matrix-drag-ghost")?.textContent).toContain(
      "Urgent request",
    );
    expect(host.querySelector(".wb-matrix-drag-ghost > span")).toBeTruthy();
    await act(async () =>
      source.dispatchEvent(pointerEvent("pointerup", 140, 140)),
    );
    if (originalElementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: originalElementFromPoint,
      });
    } else {
      Reflect.deleteProperty(document, "elementFromPoint");
    }
    expect(
      backend.items.find((item) => item.title === "Urgent request"),
    ).toMatchObject({ important: true, urgent: true });
    const add = host.querySelector<HTMLButtonElement>(
      '[data-quadrant="0"] button',
    )!;
    await act(async () => add.click());
    expect(
      document.querySelectorAll(
        '[role="dialog"] [role="checkbox"][aria-checked="true"]',
      ),
    ).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

// Verify project management through the same nested dialogs used from a record.
it("selects a newly created project and preserves unsaved content across renaming and deletion", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend.items = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  async function click(label: string, scope: ParentNode = document) {
    const button = [
      ...scope.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (node) =>
        node.textContent === label || node.getAttribute("aria-label") === label,
    )!;
    expect(button).toBeTruthy();
    await act(async () => button.click());
  }
  async function fill(selector: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    await click("添加工作记录", host.querySelector(".wb-navigation")!);
    await fill("#work-title", "Keep unsaved title");
    await click("新建或管理项目");
    await fill("#new-work-project", "New project");
    await act(async () =>
      document
        .querySelector<HTMLFormElement>(".wb-project-dialog form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(document.querySelector("#work-project")?.textContent).toBe(
      "New project",
    );
    await fill('[aria-label="项目名称 New project"]', "Renamed project");
    await click("保存", document.querySelector(".wb-project-row")!);
    expect(document.querySelector("#work-project")?.textContent).toBe(
      "Renamed project",
    );
    expect(document.querySelector<HTMLInputElement>("#work-title")?.value).toBe(
      "Keep unsaved title",
    );
    await click("删除项目 Renamed project");
    await click("删除", document.querySelector('[role="alertdialog"]')!);
    expect(document.querySelector("#work-project")?.textContent).toBe(
      "未分配项目",
    );
    expect(backend.projects).toHaveLength(0);
    await act(async () =>
      document
        .querySelector<HTMLElement>("#new-work-project")!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    );
    await click("保存记录", document.querySelector(".wb-editor")!);
    expect(backend.items).toHaveLength(1);
    expect(backend.items[0]).toMatchObject({
      title: "Keep unsaved title",
      project: "",
      time: "",
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("renders twelve months and exports report dates and times newest first", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const tuesday = new Date(monday);
  tuesday.setDate(tuesday.getDate() + 1);
  backend.items = [
    {
      ...newWorkItem(workDate(monday)),
      title: "Earlier",
      revision: 1,
      time: "09:00",
    },
    {
      ...newWorkItem(workDate(tuesday)),
      title: "Latest",
      revision: 1,
      time: "23:59",
    },
    {
      ...newWorkItem(workDate(tuesday)),
      title: "Midnight",
      revision: 1,
      time: "00:00",
    },
    { ...newWorkItem(workDate(tuesday)), title: "All day", revision: 1 },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const writeMail = vi.fn();
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={writeMail}
        />,
      ),
    );
    const year = [
      ...host.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ].find((node) => node.textContent === "年")!;
    await act(async () => year.click());
    expect(host.querySelectorAll(".wb-year-calendar")).toHaveLength(12);
    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (node) => node.textContent === "工作报告",
    )!;
    await act(async () =>
      tab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(
      [...host.querySelectorAll(".wb-report-date h3")].map(
        (node) => node.textContent,
      ),
    ).toEqual([reportDate(workDate(tuesday)), reportDate(workDate(monday))]);
    expect(
      [...host.querySelectorAll(".wb-report-date strong")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Latest", "Midnight", "All day", "Earlier"]);
    await openReportDraft(host);
    const markdown = writeMail.mock.calls[0][1];
    expect(markdown.indexOf("Latest")).toBeLessThan(
      markdown.indexOf("Midnight"),
    );
    expect(markdown.indexOf(workDate(tuesday))).toBeLessThan(
      markdown.lastIndexOf(workDate(monday)),
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("uses the approved record field order and adds subtasks with Enter without saving", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  backend.items = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    const add = host.querySelector<HTMLButtonElement>(
      '.wb-navigation button:not([role="tab"])',
    )!;
    await act(async () => add.click());
    const editor = document.querySelector(".wb-editor")!;
    expect(
      [...editor.querySelectorAll('label[data-slot="field-label"],legend')].map(
        (node) => node.textContent,
      ),
    ).toEqual([
      "记录标题",
      "状态",
      "优先级",
      "日期",
      "具体时间",
      "项目",
      "四象限",
      "重要",
      "紧急",
      "工作内容",
      "子任务",
    ]);
    expect(
      editor.querySelector('[data-slot="sheet-description"]')?.textContent,
    ).toContain("保存在这台设备");
    const input = editor.querySelector<HTMLInputElement>("#work-check")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Confirm delivery");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      ),
    );
    expect(editor.querySelectorAll(".wb-checklist")).toHaveLength(0);
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(editor.querySelector(".wb-checklist")?.textContent).toContain(
      "Confirm delivery",
    );
    expect(input.value).toBe("");
    expect(backend.items).toHaveLength(0);
    expect(
      editor.querySelector('[data-slot="sheet-footer"]')?.textContent,
    ).toContain("新增后可在日历和事项中查看");
    expect(editor.querySelector('[type="submit"]')?.textContent).toBe(
      "保存记录",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps quadrant rows compact, aligns their schedule and removes completed records from the active quadrants", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const date = workDate(new Date());
  backend.items = [
    {
      ...newWorkItem(date),
      revision: 1,
      title: "Review scope",
      important: true,
      urgent: true,
      project: "Private project subtitle",
      time: "09:30",
      priority: "high",
    },
    {
      ...newWorkItem(date),
      revision: 1,
      title: "Already completed",
      important: true,
      urgent: true,
      status: "done",
    },
    {
      ...newWorkItem(workDate(addDays(new Date(), 1))),
      revision: 1,
      title: "Tomorrow record",
      important: true,
      urgent: true,
    },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (node) => node.textContent === "四象限",
    )!;
    await act(async () =>
      tab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    const quadrant = host.querySelector('[data-quadrant="0"]')!;
    expect(host.querySelector(".workbench-matrix")).toBeTruthy();
    expect(host.querySelector(".wb-matrix-axis-line-y")).toBeTruthy();
    expect(host.querySelector(".wb-matrix-axis-line-x")).toBeTruthy();
    expect(quadrant.querySelector('[data-slot="card-description"]')).toBeNull();
    expect(quadrant.querySelector(".wb-count")?.textContent).toBe("1");
    expect(quadrant.textContent).not.toContain("Already completed");
    expect(quadrant.textContent).not.toContain("Tomorrow record");
    expect(quadrant.textContent).not.toContain("Private project subtitle");
    expect(host.querySelector(".wb-toolbar-caption")?.textContent).toContain(
      "1 条工作记录",
    );
    expect(quadrant.querySelector(".wb-row-date")?.textContent).toBe("09:30");
    expect(quadrant.querySelector(".wb-task-title small")).toBeNull();
    await act(async () =>
      quadrant.querySelector<HTMLButtonElement>('[role="checkbox"]')!.click(),
    );
    expect(quadrant.querySelectorAll(".wb-task-compact")).toHaveLength(0);
    expect(
      backend.items.find((item) => item.title === "Review scope")?.status,
    ).toBe("done");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("shows 14 work items on each table page", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  const date = workDate(new Date());
  backend.items = Array.from({ length: 16 }, (_, index) => ({
    ...newWorkItem(date),
    title: `Work item ${index + 1}`,
    revision: 1,
  }));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    const tab = [...host.querySelectorAll('[role="tab"]')].find(
      (node) => node.textContent === "事项",
    )!;
    await act(async () =>
      tab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    expect(host.querySelectorAll("tbody tr[data-row-id]")).toHaveLength(14);
    expect(
      host.querySelector(".task-data-table-footer")?.textContent,
    ).toContain("每页 14 条");
    const next = host.querySelector<HTMLButtonElement>(
      'button[aria-label="下一页"]',
    )!;
    await act(async () => next.click());
    expect(host.querySelectorAll("tbody tr[data-row-id]")).toHaveLength(2);
    expect(host.querySelector("tbody")?.textContent).toContain("Work item 15");
    expect(host.querySelector("tbody")?.textContent).toContain("Work item 16");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("sends and renders a customized AI report prompt", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const date = workDate(new Date());
  backend.items = [
    {
      ...newWorkItem(date),
      revision: 1,
      title: "Prepare release",
      status: "done",
    },
  ];
  backend.reportText = "## Custom summary\n\n- Release is ready";
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <Workbench
          onSeedConsumed={() => {}}
          openMail={() => {}}
          writeMail={() => {}}
        />,
      ),
    );
    const reportTab = [...host.querySelectorAll('[role="tab"]')].find(
      (node) => node.textContent === "工作报告",
    )!;
    await act(async () =>
      reportTab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
    const customPrompt = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "自定义提示词",
    )!;
    await act(async () => customPrompt.click());
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "#work-report-prompt",
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "按项目分组，并列出风险与下一步。");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "保存提示词",
    )!;
    await act(async () => save.click());
    expect(localStorage.getItem("anser-work-report-prompt")).toBe(
      "按项目分组，并列出风险与下一步。",
    );
    const generate = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("生成 AI 报告"),
    )!;
    await act(async () => generate.click());
    expect(backend.reportInstructions).toBe("按项目分组，并列出风险与下一步。");
    expect(host.querySelector(".wb-report-summary-text h2")?.textContent).toBe(
      "Custom summary",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
