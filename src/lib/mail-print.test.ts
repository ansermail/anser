// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeDemo } from "./demo";
import { printableMail, printMail } from "./mail-print";
import type { Detail } from "./types";

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => native.enabled,
  invoke: native.invoke,
}));

const mail = makeDemo().messages[0];
const detail: Detail = {
  mail,
  html: '<link rel="stylesheet" href="https://fonts.example/mail.css"><style>body{display:none}</style><p>打印正文</p><script>window.bad=1</script><img src="https://images.example/photo.png" onerror="window.bad=2">',
  attachments: [
    { index: 0, name: "收据.pdf", size: 42, mime: "application/pdf" },
  ],
};

afterEach(() => {
  native.enabled = false;
  native.invoke.mockReset();
  document.getElementById("mail-print-root")?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mail printing", () => {
  it("prepares only the selected message with safe body and attachment names", () => {
    const sheet = printableMail({
      ...detail,
      mail: { ...mail, senderOnBehalfOf: "bounce@mail.example.com" },
    });
    expect(sheet.querySelector("h1")?.textContent).toBe(mail.subject);
    const body = sheet.querySelector(".mail-print-body")!.shadowRoot!;
    expect(body.textContent).toContain("打印正文");
    expect(sheet.textContent).toContain("收据.pdf");
    expect(sheet.textContent).toContain("代发人：bounce@mail.example.com");
    expect(sheet.querySelector("style,link")).toBeNull();
    expect(body.querySelector("script,[onerror]")).toBeNull();
    expect(body.querySelector("style")).not.toBeNull();
    expect(body.querySelector("link")?.getAttribute("href")).toBe(
      "https://fonts.example/mail.css",
    );
    expect(body.querySelector("img")?.getAttribute("referrerpolicy")).toBe(
      "no-referrer",
    );
  });

  it("retains document styles, body attributes and template structure inside the isolated body", () => {
    const html = `<!doctype html><html lang="zh-CN" dir="ltr"><head>
      <style>:root{--brand:#327dff}body.template{padding:32px}.card h1{font-size:36px;color:var(--brand)}</style>
      </head><body class="template" style="background:#f6f8fc"><table class="card"><tr><td>
      <h1>Original title</h1><p style="margin:24px 0">Original paragraph</p>
      </td></tr></table></body></html>`;
    const original = { ...detail, html };
    const sheet = printableMail(original);
    const isolated = sheet.querySelector(".mail-print-body")!.shadowRoot!;
    expect(isolated.querySelector("html")?.lang).toBe("zh-CN");
    expect(isolated.querySelector("body")?.className).toBe("template");
    expect(isolated.querySelector("body")?.style.background).toBe(
      "rgb(246, 248, 252)",
    );
    expect(isolated.querySelector("head")?.textContent).toContain(
      ".card h1{font-size:36px;color:var(--brand)}",
    );
    expect(isolated.querySelector("table.card h1")?.textContent).toBe(
      "Original title",
    );
    expect(sheet.querySelector("table,style")).toBeNull();
    expect(original.html).toBe(html);
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
    vi.useFakeTimers();
    const printing = printMail({
      ...detail,
      html: '<p>Print image</p><img src="https://images.example/photo.png">',
    });
    await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    const image = document
      .querySelector(".mail-print-body")!
      .shadowRoot!.querySelector("img")!;
    Object.defineProperty(image, "complete", { value: true });
    await vi.advanceTimersByTimeAsync(50);
    await printing;
    expect(print).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("afterprint"));
  });

  it("uses the native A4 printing command in a desktop window", async () => {
    native.enabled = true;
    native.invoke.mockResolvedValue(undefined);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await printMail({ ...detail, html: "", attachments: [] });
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("print_mail");
    expect(print).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("afterprint"));
    expect(document.getElementById("mail-print-root")).toBeNull();
  });

  it("cleans the temporary sheet when the native A4 command fails", async () => {
    native.enabled = true;
    native.invoke.mockRejectedValue(new Error("native A4 failed"));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    await expect(
      printMail({ ...detail, html: "", attachments: [] }),
    ).rejects.toThrow("native A4 failed");
    expect(document.getElementById("mail-print-root")).toBeNull();
  });

  it("bounds waiting when a stylesheet or image never finishes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const printing = printMail(detail);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(print).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await printing;
    expect(print).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("afterprint"));
  });

  it("does not open a stale print after a newer message replaces its pending resources", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const oldPrint = printMail(detail);
    await Promise.resolve();
    await printMail({ ...detail, html: "", attachments: [] });
    await vi.advanceTimersByTimeAsync(50);
    await oldPrint;
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("#mail-print-root")).toHaveLength(1);
    window.dispatchEvent(new Event("afterprint"));
  });

  it("removes the temporary print content when the native action fails", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "print").mockImplementation(() => {
      throw new Error("native print failed");
    });
    await expect(printMail({ ...detail, html: "" })).rejects.toThrow(
      "native print failed",
    );
    expect(document.getElementById("mail-print-root")).toBeNull();
  });
});
