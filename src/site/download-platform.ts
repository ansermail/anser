export type DownloadPlatform = "windows" | "macos";

type BrowserPlatform = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
};

// Choose an OS, never infer the Mac chip from a reduced browser user agent.
export function detectDownloadPlatform(
  browser: BrowserPlatform,
): DownloadPlatform | null {
  const agent = browser.userAgent ?? "";
  if (
    /Android|iPhone|iPad|iPod/i.test(agent) ||
    (/Mac/i.test(browser.platform ?? "") && (browser.maxTouchPoints ?? 0) > 1)
  )
    return null;
  const platform = browser.userAgentData?.platform || browser.platform || agent;
  if (/Windows|Win32|Win64/i.test(platform)) return "windows";
  if (/macOS|MacIntel|MacPPC|Macintosh/i.test(platform)) return "macos";
  return null;
}
