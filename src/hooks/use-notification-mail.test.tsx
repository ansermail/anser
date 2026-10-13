// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useNotificationMail } from "./use-notification-mail";
const bridge = vi.hoisted(() => ({
  call: vi.fn(),
  listen: vi.fn(),
  stop: vi.fn(),
  signal: () => {},
}));
vi.mock("../lib/api", () => ({ call: bridge.call }));
vi.mock("@tauri-apps/api/event", () => ({ listen: bridge.listen }));
let root: Root, host: HTMLDivElement;
function Fixture({
  enabled = true,
  open,
}: {
  enabled?: boolean;
  open: (token: string) => void;
}) {
  useNotificationMail(enabled, open);
  return null;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  bridge.call.mockReset();
  bridge.listen.mockReset();
  bridge.stop.mockReset();
  bridge.call.mockResolvedValue(null);
  bridge.listen.mockImplementation(async (_name, signal) => {
    bridge.signal = signal;
    return bridge.stop;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("subscribes then drains a click queued before frontend startup", async () => {
  const open = vi.fn();
  bridge.call.mockResolvedValueOnce("startup-token");
  await act(async () => root.render(<Fixture open={open} />));
  expect(bridge.listen).toHaveBeenCalledWith(
    "notification-mail-available",
    expect.any(Function),
  );
  expect(bridge.listen.mock.invocationCallOrder[0]).toBeLessThan(
    bridge.call.mock.invocationCallOrder[0],
  );
  expect(open).toHaveBeenCalledWith("startup-token");
  await act(async () => root.unmount());
  expect(bridge.stop).toHaveBeenCalledOnce();
});
it("drains again when another click arrives during IPC, without concurrent drains", async () => {
  let release!: (token: string) => void;
  bridge.call
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValueOnce("latest-token");
  const open = vi.fn();
  await act(async () => root.render(<Fixture open={open} />));
  await act(async () => {
    bridge.signal();
    bridge.signal();
  });
  expect(bridge.call).toHaveBeenCalledTimes(1);
  await act(async () => release("first-token"));
  expect(open.mock.calls).toEqual([["first-token"], ["latest-token"]]);
  expect(bridge.call).toHaveBeenCalledTimes(2);
});
it("uses the latest handler and ignores a disposed IPC result", async () => {
  let release!: (token: string) => void;
  bridge.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = vi.fn(),
    latest = vi.fn();
  await act(async () => root.render(<Fixture open={first} />));
  await act(async () => root.render(<Fixture open={latest} />));
  await act(async () => release("target"));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledWith("target");
  bridge.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await act(async () => bridge.signal());
  await act(async () => root.unmount());
  await act(async () => release("late"));
  expect(latest).toHaveBeenCalledTimes(1);
});
it("does not read native notification targets in the fictional preview", async () => {
  await act(async () =>
    root.render(<Fixture enabled={false} open={vi.fn()} />),
  );
  expect(bridge.listen).not.toHaveBeenCalled();
  expect(bridge.call).not.toHaveBeenCalled();
});
