import { expect, it, vi } from "vitest";
import { coalesceRefresh } from "./refresh-queue";

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
