import { expect, it, vi } from "vitest";
import { coalesceRefresh, throttledRefresh } from "./refresh-queue";

it("coalesces a download burst into one active and one latest refresh", async () => {
  let release!: () => void;
  let query = "inbox";
  const seen: string[] = [];
  const work = vi.fn(async () => {
    seen.push(query);
    if (seen.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  });
  const refresh = coalesceRefresh(work);
  const running = refresh();
  query = "archive";
  for (let i = 0; i < 1000; i++) expect(refresh()).toBe(running);
  query = "starred";
  release();
  await running;
  expect(seen).toEqual(["inbox", "starred"]);
  await refresh();
  expect(work).toHaveBeenCalledTimes(3);
});

it("allows retry after a failed refresh", async () => {
  const work = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const refresh = coalesceRefresh(work);
  await expect(refresh()).rejects.toThrow("offline");
  await refresh();
  expect(work).toHaveBeenCalledTimes(2);
});

it("throttles a refresh burst into one delayed run", async () => {
  vi.useFakeTimers();
  try {
    const work = vi.fn(async () => {});
    const refresh = throttledRefresh(work, 1000);
    for (let i = 0; i < 1000; i++) await refresh();
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(work).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(work).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it("runs a trailing refresh after work started during the interval settles", async () => {
  vi.useFakeTimers();
  try {
    let release!: () => void;
    const work = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const refresh = throttledRefresh(work, 1000);
    await refresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(work).toHaveBeenCalledTimes(1);
    await refresh();
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(work).toHaveBeenCalledTimes(2);
    release();
  } finally {
    vi.useRealTimers();
  }
});

it("allows another refresh after throttled work fails", async () => {
  vi.useFakeTimers();
  try {
    const work = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const refresh = throttledRefresh(work, 10);
    await refresh();
    await vi.advanceTimersByTimeAsync(10);
    await refresh();
    await vi.advanceTimersByTimeAsync(10);
    expect(work).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
