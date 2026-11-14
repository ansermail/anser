// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { t } from "@/lib/i18n";
import { TaskDataTable } from "./task-data-table";

it("keeps the current task page on refresh and clamps it when records are cleared", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const rows = Array.from({ length: 11 }, (_, index) => ({
    id: String(index),
    task: `Task ${index + 1}`,
  }));
  const render = async (data: typeof rows) =>
    act(async () =>
      root.render(
        <TaskDataTable
          label="Tasks"
          rows={data}
          empty="Empty"
          fields={["task", "actions"]}
        />,
      ),
    );
  const next = () =>
    host.querySelector<HTMLButtonElement>(
      `button[aria-label="${t("Next page")}"]`,
    )!;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  try {
    await render(rows);
    expect(
      host.querySelector(
        '[data-slot="table-container"] [data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]',
      ),
    ).toBeTruthy();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    await act(async () => next().click());
    expect(host.querySelector("tbody")?.textContent).toBe("Task 11");
    await render(
      rows.map((row) => ({ ...row, task: row.task + " refreshed" })),
    );
    expect(host.querySelector("tbody")?.textContent).toBe("Task 11 refreshed");
    await render(rows.slice(0, 10));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(next()).toBeNull();
    await render([]);
    expect(host.querySelector("tbody")?.textContent).toBe("Empty");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
