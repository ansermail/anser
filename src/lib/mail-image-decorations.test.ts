// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { safeMailHtml } from "./mail-html";
import { MAIL_SPACER_IMAGE } from "./mail-image-decorations";

describe("mail layout spacer resources", () => {
  it("uses a local transparent spacer before native routing and keeps the original layout", () => {
    const html =
      '<table><tr><td><img src="https://images.example/spacer-1476918453497.png" width="130" height="1" style="display:inline-block;border:none"></td></tr></table>';
    for (const native of [false, true]) {
      const doc = new DOMParser().parseFromString(
        safeMailHtml(html, "spacer", native),
        "text/html",
      );
      const image = doc.querySelector("img")!;
      expect(image.getAttribute("src")).toBe(MAIL_SPACER_IMAGE);
      expect(image.getAttribute("width")).toBe("130");
      expect(image.getAttribute("height")).toBe("1");
      expect(image.style.display).toBe("inline-block");
      expect(doc.querySelectorAll("td")).toHaveLength(1);
      expect(
        doc
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute("content"),
      ).toContain("default-src 'none'");
    }
    expect(html).toContain(
      'src="https://images.example/spacer-1476918453497.png"',
    );
  });
  it("handles horizontal/vertical and inline CSS spacers without a vendor domain allowlist", () => {
    for (const attrs of [
      'width="1" height="130"',
      'style="width:130px;height:1px"',
    ]) {
      for (const name of [
        "spacer.gif",
        "blank_123.png",
        "transparent-1x1.webp",
        "clear.gif",
      ]) {
        const doc = new DOMParser().parseFromString(
          safeMailHtml(
            `<img src="https://other.example/mail/${name}" ${attrs}>`,
          ),
          "text/html",
        );
        expect(doc.querySelector("img")!.src).toBe(MAIL_SPACER_IMAGE);
      }
    }
  });
  it("never replaces arbitrary photos, labelled strips, unknown sizes, CSS overrides or responsive images", () => {
    for (const [name, attrs] of [
      ["photo.png", 'width="130" height="1"'],
      ["clear-sky.png", 'width="130" height="1"'],
      ["spacer.png", 'width="130" height="1" alt="Timeline"'],
      ["spacer.png", 'width="130" height="1" aria-label="Chart"'],
      ["spacer.png", 'width="130" height="1" aria-labelledby="caption"'],
      ["spacer.png", 'width="130" height="1" role="img"'],
      ["spacer.png", 'width="130"'],
      ["spacer.png", 'width="130" height="1" style="height:80px"'],
      ["spacer.png", 'width="130" height="1" style="height:100%"'],
      [
        "spacer.png",
        'width="130" height="1" srcset="https://images.example/photo.png 2x"',
      ],
    ]) {
      const src = `https://images.example/${name}`;
      const doc = new DOMParser().parseFromString(
        safeMailHtml(`<img src="${src}" ${attrs}>`),
        "text/html",
      );
      expect(doc.querySelector("img")!.src).toBe(src);
    }
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<picture><source srcset="https://images.example/photo.png"><img src="https://images.example/spacer.png" width="130" height="1"></picture>',
      ),
      "text/html",
    );
    expect(doc.querySelector("img")!.src).not.toBe(MAIL_SPACER_IMAGE);
  });
});
