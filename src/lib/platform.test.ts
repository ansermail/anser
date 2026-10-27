// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { isWindows, shortcut } from "./platform";
import { safeMailHtml } from "./mail-html";
import { mailShortcut, mailShortcutKeys } from "./mail-shortcuts";

afterEach(() => vi.unstubAllGlobals());

it("uses Ctrl hints and routes every native mail resource through HTTPS on WebView2", () => {
  vi.stubGlobal("navigator", { platform: "Win32" });
  expect(isWindows()).toBe(true);
  expect(shortcut("⌘ N")).toBe("Ctrl+N");
  expect(mailShortcutKeys.replyAll).toBe("Ctrl+Shift+R");
  expect(
    mailShortcut(new KeyboardEvent("keydown", { key: "r", ctrlKey: true })),
  ).toBe("reply");
  const safe = safeMailHtml(
    `<head><link rel="stylesheet" href="https://example.com/mail.css"><style>@font-face{font-family:Mail;src:url(https://example.com/mail.woff2)}.hero{background:url(https://example.com/bg.png)}</style></head><body><img src="https://example.com/image.png" srcset="https://example.com/image@2x.png 2x"><script>window.bad=1</script></body>`,
    "windows-test",
    true,
    true,
  );
  for (const kind of ["image", "style", "font"])
    expect(safe).toContain(`https://anser-${kind}.localhost/`);
  expect(safe).not.toContain("anser-image://");
  expect(safe).not.toContain("<script");
  const doc = new DOMParser().parseFromString(safe, "text/html");
  expect(doc.querySelector("link")?.getAttribute("crossorigin")).toBe(
    "anonymous",
  );
  const csp = doc
    .querySelector('meta[http-equiv="Content-Security-Policy"]')!
    .getAttribute("content")!;
  expect(csp).toContain(
    "style-src 'unsafe-inline' https://anser-style.localhost",
  );
  expect(csp).toContain("font-src data: https://anser-font.localhost");
  expect(csp).toContain("default-src 'none'");
});

it("keeps the Mac protocol and keyboard presentation, with browser-only URLs in previews", () => {
  vi.stubGlobal("navigator", { platform: "MacIntel" });
  expect(shortcut("⌘⇧R")).toBe("⌘⇧R");
  expect(
    safeMailHtml('<img src="https://example.com/a.png">', "mac", true, true),
  ).toContain("anser-image://localhost/fetch");
  vi.stubGlobal("navigator", { platform: "Win32" });
  const browser = safeMailHtml(
    '<img src="https://example.com/a.png">',
    "preview",
    false,
    false,
  );
  expect(browser).toContain('src="https://example.com/a.png"');
  expect(browser).not.toContain("anser-image.localhost");
});
