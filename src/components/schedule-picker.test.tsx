// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SchedulePicker } from "./schedule-picker";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderPicker(
  initialValue = "2099-01-01T09:05",
  onChange = vi.fn(),
) {
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return (
      <SchedulePicker
        value={value}
        busy={false}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  return onChange;
}

function timeInput(label: string) {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

it("uses compact editable fields instead of long hour and minute lists", async () => {
  await renderPicker();
  expect(timeInput("发送小时").value).toBe("09");
  expect(timeInput("发送分钟").value).toBe("05");
  expect(host.querySelector('[role="option"]')).toBeNull();
});

it("normalizes typed values and accepts keyboard and wheel changes", async () => {
  const onChange = await renderPicker();
  const hour = timeInput("发送小时");
  await type(hour, "7");
  expect(hour.value).toBe("07");

  await act(async () => {
    hour.focus();
    hour.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/T06:05$/));

  await act(async () => {
    hour.dispatchEvent(new WheelEvent("wheel", { deltaY: -1, bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(expect.stringMatching(/T07:05$/));
});

it("rejects out-of-range input and restores the current value", async () => {
  await renderPicker();
  const minute = timeInput("发送分钟");
  await type(minute, "99");
  expect(minute.value).toBe("05");
});

it("disables past dates and keeps same-day time at or after the next minute", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 22, 16, 30));
  await renderPicker("2026-11-22T15:05");

  const confirm = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "确认定时发送",
  ) as HTMLButtonElement;
  expect(timeInput("发送小时").value).toBe("16");
  expect(timeInput("发送分钟").value).toBe("31");
  expect(confirm.disabled).toBe(false);

  const dateButton = [...host.querySelectorAll("button")].find((button) =>
    button.getAttribute("aria-label")?.includes("选择发送日期"),
  )!;
  await act(async () => dateButton.click());
  const yesterday = [
    ...document.querySelectorAll<HTMLButtonElement>("button[data-day]"),
  ].find(
    (button) =>
      button.getAttribute("data-day") ===
      new Date(2026, 10, 21).toLocaleDateString(),
  )!;
  expect(yesterday.disabled).toBe(true);

  await type(timeInput("发送分钟"), "30");
  expect(timeInput("发送分钟").value).toBe("31");

  await type(timeInput("发送小时"), "15");
  expect(timeInput("发送小时").value).toBe("16");
  expect(timeInput("发送分钟").value).toBe("31");
});

it("advances to the next selectable minute when the selected minute passes", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 22, 16, 29));
  const onChange = await renderPicker("2026-11-22T16:30");
  const confirm = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "确认定时发送",
  ) as HTMLButtonElement;
  expect(confirm.disabled).toBe(false);

  await act(async () => vi.advanceTimersByTime(61_000));
  expect(onChange).toHaveBeenLastCalledWith("2026-11-22T16:31");
  expect(timeInput("发送分钟").value).toBe("31");
  expect(confirm.disabled).toBe(false);
});
