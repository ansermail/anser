import { describe, it, expect } from "vitest";
import { mergeAttachmentPaths, insideComposeDrop } from "./compose-attachments";
describe("native attachment selection", () => {
  it("deduplicates paths but retains same-named files in separate directories", () => {
    expect(
      mergeAttachmentPaths(
        ["/one/report.txt"],
        ["/one/report.txt", "/two/report.txt"],
      ),
    ).toEqual(["/one/report.txt", "/two/report.txt"]);
    expect(() => mergeAttachmentPaths([], ["bad\0path"])).toThrow("路径无效");
  });
  it("maps physical drop positions to the current dialog bounds", () => {
    const rect = { left: 100, top: 50, right: 600, bottom: 400 };
    expect(insideComposeDrop({ x: 300, y: 150 }, rect, 2)).toBe(true);
    expect(insideComposeDrop({ x: 100, y: 100 }, rect, 2)).toBe(false);
    expect(insideComposeDrop({ x: 300, y: 150 }, rect, 0)).toBe(false);
  });
});
