import { describe, expect, it } from "vitest";
import {
  applyAccountOrder,
  moveAccountId,
  reorderAccountIds,
} from "./account-order";

describe("account ordering helpers", () => {
  const accounts = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("reorders accounts before and after a target without mutating no-ops", () => {
    expect(reorderAccountIds(accounts, "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(reorderAccountIds(accounts, "a", "b", "after")).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(reorderAccountIds(accounts, "a", "b", "before")).toBeNull();
    expect(reorderAccountIds(accounts, "b", "b", "after")).toBeNull();
  });

  it("moves accounts up or down by one step and bounds at edges", () => {
    expect(moveAccountId(accounts, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveAccountId(accounts, "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveAccountId(accounts, "a", -1)).toBeNull();
    expect(moveAccountId(accounts, "c", 1)).toBeNull();
  });

  it("applies order while keeping newly added accounts at the end", () => {
    expect(
      applyAccountOrder(
        [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }],
        ["c", "a"],
      ).map((item) => item.id),
    ).toEqual(["c", "a", "b", "d"]);
  });
});
