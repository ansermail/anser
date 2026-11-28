// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Toaster, toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { call } from "./api";
import { dismissSendUndoToast, queueSendWithUndo } from "./send-undo-toast";
import type { Compose } from "./types";

vi.mock("./api", () => ({ call: vi.fn() }));
vi.mock("./i18n", () => ({
  t: (key: string, values?: { value0: number }) =>
    values ? key.replace("{value0}", String(values.value0)) : key,
}));

const draft = { id: "queued-draft" } as Compose;
const notice = () =>
  document.querySelector('[data-sonner-toast][data-type="success"]');
const undo = () => notice()?.querySelector<HTMLButtonElement>("[data-action]");
let root: Root;
let host: HTMLDivElement;

async function finishDismissal() {
  // Commit Sonner's frame-based dismissal before advancing the exit animation.
  await act(async () => vi.advanceTimersByTimeAsync(40));
  await act(async () => vi.advanceTimersByTimeAsync(250));
}

async function enqueue(onUndo = vi.fn()) {
  await act(async () => queueSendWithUndo(draft, onUndo));
  // Sonner publishes new toasts on its next timer tick.
  await act(async () => vi.advanceTimersByTimeAsync(0));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Toaster closeButton />));
});

afterEach(async () => {
  await act(async () => toast.dismiss());
  await finishDismissal();
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(call).mockReset();
  vi.restoreAllMocks();
});

it("counts down from the persisted deadline and dismisses while hidden and hovered", async () => {
  vi.mocked(call).mockResolvedValueOnce(
    new Date(Date.now() + 2500).toISOString(),
  );
  await enqueue();
  expect(notice()?.textContent).toContain("3s to undo");
  expect(undo()?.textContent).toBe("Undo");

  vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    notice()?.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);
  });
  expect(notice()?.textContent).toContain("1s to undo");
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(toast.getToasts()).toHaveLength(0);
  expect(notice()?.querySelector("[data-send-undo-expired]")).toBeTruthy();
  await finishDismissal();
  expect(undo()).toBeUndefined();
});

it("undoes the matching draft once during the delay and restores it", async () => {
  const onUndo = vi.fn();
  vi.mocked(call)
    .mockResolvedValueOnce(new Date(Date.now() + 8000).toISOString())
    .mockResolvedValueOnce({ id: "restored-draft" });
  await enqueue(onUndo);
  await act(async () => undo()?.click());
  expect(call).toHaveBeenNthCalledWith(2, "cancel_schedule", { id: draft.id });
  expect(onUndo).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.textContent).toContain("restored as a draft");
  expect(host.querySelector("[data-action]")).toBeNull();
});

it("skips an expired deadline and clears an active notice when sent early", async () => {
  vi.mocked(call)
    .mockResolvedValueOnce(new Date(Date.now()).toISOString())
    .mockResolvedValueOnce(new Date(Date.now() + 8000).toISOString());
  await enqueue();
  expect(notice()).toBeNull();
  await enqueue();
  expect(undo()).toBeDefined();
  await act(async () => dismissSendUndoToast(draft.id));
  await finishDismissal();
  expect(notice()).toBeNull();
});
