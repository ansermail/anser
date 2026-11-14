// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { newWorkItem, workDate, type WorkItem } from "@/lib/workbench";
import { Workbench } from "./workbench";

const backend = vi.hoisted(() => ({ items: [] as WorkItem[] }));
vi.mock("@/lib/api", () => ({
  call: async (command: string, args: { item: WorkItem }) => {
    if (command === "list_work_items") return [...backend.items];
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    await tab("多维表格");
    expect(host.querySelector("tbody")?.textContent).toContain(
      "Review delivery",
    );
    await tab("状态看板");
    expect(host.querySelector(".workbench-board")?.textContent).toContain(
      "Review delivery",
    );
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(page));
    expect(host.textContent).toContain("Review delivery");
  } finally {
    await act(async () => root.unmount());
    host.remove();
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
    ).toEqual([date]);
    expect(
      [...host.querySelectorAll("ol > li")].map((node) => node.textContent),
    ).toEqual(["First task · 待办", "Second task · 待办"]);
    const draft = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "作为邮件草稿打开",
    )!;
    await act(async () => draft.click());
    expect(writeMail.mock.calls[0][1]).toContain(`## ${date}\n1. First task`);
    expect(writeMail.mock.calls[0][1]).toContain("\n2. Second task");
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
    const node = [...host.querySelectorAll('[role="tab"]')].find(
      (item) => item.textContent === label,
    )!;
    await act(async () =>
      node.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      ),
    );
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
    expect(host.querySelectorAll("thead th")).toHaveLength(8);
    const start = host.querySelector<HTMLButtonElement>(
      `[aria-label="在 ${date} 09:00 添加工作记录"]`,
    );
    expect(start?.parentElement?.textContent).toContain("09:30");
    const allDaySlot = host
      .querySelector(`[aria-label="在 ${date} 全天 添加工作记录"]`)
      ?.closest("td");
    const entries = allDaySlot?.querySelector(".flex-col");
    expect(
      [...entries!.querySelectorAll("button")].map((item) => item.textContent),
    ).toEqual(["Same day first", "Same day second"]);
    expect(
      allDaySlot?.parentElement?.querySelectorAll("td .flex-col button"),
    ).toHaveLength(
      entries!.querySelectorAll("button").length +
        (next.getDay() === 1 ? 0 : 1),
    );
    await tab("日");
    expect(host.querySelectorAll("thead th")).toHaveLength(2);
    const add = host.querySelector<HTMLButtonElement>(
      `[aria-label="在 ${date} 15:00 添加工作记录"]`,
    )!;
    await act(async () => add.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector("#work-hour")?.textContent).toBe("15");
    expect(dialog.textContent).toContain(date);
    expect(backend.items).toHaveLength(3);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("classifies older records and preselects importance and urgency when adding from a quadrant", async () => {
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
