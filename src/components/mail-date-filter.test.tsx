// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MailDateFilter, mailDateBounds } from "./mail-date-filter";
describe("mail calendar range", () => {
  it("uses local inclusive days with an exclusive next-day end", () => {
    const from = new Date(2026, 9, 10, 12),
      to = new Date(2026, 9, 12, 16);
    const value = mailDateBounds({ from, to });
    expect(new Date(value.dateFrom!).getHours()).toBe(0);
    expect(new Date(value.dateBefore!).getDate()).toBe(13);
    expect(mailDateBounds(undefined)).toEqual({
      dateFrom: undefined,
      dateBefore: undefined,
    });
  });
  it("adds a calendar day across a 23-hour DST day", () => {
    const before = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const range = mailDateBounds({ from: new Date(2026, 2, 8, 12) });
      expect(Date.parse(range.dateBefore!) - Date.parse(range.dateFrom!)).toBe(
        23 * 3600000,
      );
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
  it("clears a range through shadcn popover without native date inputs", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host),
      change = vi.fn();
    try {
      await act(async () =>
        root.render(
          <MailDateFilter
            {...mailDateBounds({ from: new Date(2026, 9, 10) })}
            onChange={change}
          />,
        ),
      );
      await act(async () => host.querySelector("button")!.click());
      expect(document.querySelector('input[type="date"]')).toBeNull();
      const clear = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "不限时间",
      )!;
      await act(async () => clear.click());
      expect(change).toHaveBeenCalledWith({
        dateFrom: undefined,
        dateBefore: undefined,
      });
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  it("applies selected calendar days as a local inclusive range", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host),
      change = vi.fn();
    try {
      await act(async () =>
        root.render(
          <MailDateFilter
            {...mailDateBounds({ from: new Date(2026, 9, 10) })}
            onChange={change}
          />,
        ),
      );
      await act(async () => host.querySelector("button")!.click());
      const restart = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "重新选择",
      )!;
      await act(async () => restart.click());
      expect(change).not.toHaveBeenCalled();
      for (const day of [12, 14]) {
        const target = [...document.querySelectorAll("button[data-day]")].find(
          (button) =>
            button.getAttribute("data-day") ===
            new Date(2026, 9, day).toLocaleDateString(),
        ) as HTMLButtonElement;
        expect(target).toBeDefined();
        await act(async () => target.click());
      }
      const apply = [...document.querySelectorAll("button")].find(
        (button) => button.textContent === "应用筛选",
      )!;
      await act(async () => apply.click());
      const [value] = change.mock.calls[0];
      expect(new Date(value.dateFrom).getDate()).toBe(12);
      expect(new Date(value.dateFrom).getHours()).toBe(0);
      expect(new Date(value.dateBefore).getDate()).toBe(15);
      expect(new Date(value.dateBefore).getHours()).toBe(0);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
