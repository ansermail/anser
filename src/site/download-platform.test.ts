import { describe, expect, it } from "vitest";
import { detectDownloadPlatform } from "./download-platform";

describe("website download OS selection", () => {
  it.each([
    [{ userAgentData: { platform: "Windows" }, platform: "Win32" }, "windows"],
    [{ platform: "Win32", userAgent: "Mozilla Windows NT 10.0" }, "windows"],
    [{ platform: "MacIntel", userAgent: "Mozilla Macintosh" }, "macos"],
    [{ userAgentData: { platform: "macOS" } }, "macos"],
    [{ userAgent: "Mozilla Macintosh Intel Mac OS X" }, "macos"],
    [{ platform: "Linux x86_64" }, null],
    [{ userAgent: "Mozilla Android", platform: "Linux" }, null],
    [{ userAgent: "Mozilla iPhone", platform: "iPhone" }, null],
    [
      {
        platform: "MacIntel",
        maxTouchPoints: 5,
        userAgent: "Mozilla Macintosh",
      },
      null,
    ],
    [{}, null],
  ])(
    "selects the desktop OS without treating mobile as a Mac: %j",
    (browser, expected) => {
      expect(detectDownloadPlatform(browser)).toBe(expected);
    },
  );
});
