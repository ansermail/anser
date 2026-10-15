// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDemo } from "./demo";
import { printableMail, printMail } from "./mail-print";
import type { Detail } from "./types";

const mail = makeDemo().messages[0];
const detail: Detail = {
  mail,
  html: '<link rel="stylesheet" href="https://fonts.example/mail.css"><style>body{display:none}</style><p>打印正文</p><script>window.bad=1</script><img src="https://images.example/photo.png" onerror="window.bad=2">',
  attachments: [
    { index: 0, name: "收据.pdf", size: 42, mime: "application/pdf" },
  ],
};

afterEach(() => {
  document.getElementById("mail-print-root")?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mail printing", () => {
  it("prepares only the selected message with safe body and attachment names", () => {
    const sheet = printableMail(detail);
    expect(sheet.querySelector("h1")?.textContent).toBe(mail.subject);
    expect(sheet.textContent).toContain("打印正文");
    expect(sheet.textContent).toContain("收据.pdf");
    expect(sheet.querySelector("script,style,link,[onerror]")).toBeNull();
    expect(sheet.querySelector("img")?.getAttribute("referrerpolicy")).toBe(
      "no-referrer",
    );
  });

  it("opens the system print action and clears the temporary sheet afterward", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await printMail({ ...detail, html: "", attachments: [] });
    expect(print).toHaveBeenCalledOnce();
    expect(document.getElementById("mail-print-root")?.textContent).toContain(
      mail.body,
    );
    window.dispatchEvent(new Event("afterprint"));
    expect(document.getElementById("mail-print-root")).toBeNull();
  });

  it("waits for proxied print images to settle before opening the native print panel", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const printing = printMail(detail);
    await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    const image = document.querySelector<HTMLImageElement>(
      "#mail-print-root img",
    )!;
    image.dispatchEvent(new Event("load"));
    await printing;
    expect(print).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("afterprint"));
  });
});
