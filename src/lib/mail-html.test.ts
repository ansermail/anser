// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  safeMailHtml,
  mailLink,
  isMailDocument,
  interceptMailLinks,
} from "./mail-html";
describe("untrusted email rendering", () => {
  it("keeps leading styles in email fragments and classes on full documents", () => {
    for (const html of [
      '<meta name="viewport"><style>.mail_cnt{max-width:700px}.title_bold{font-weight:bold}</style><div class="mail_cnt"><p class="title_bold">每周概况</p></div>',
      '<html><head><style>.mail_cnt{max-width:700px}</style></head><body class="mail_cnt" style="background:#eee" onload="alert(1)">每周概况</body></html>',
    ]) {
      const doc = new DOMParser().parseFromString(
        safeMailHtml(html),
        "text/html",
      );
      expect(
        [...doc.querySelectorAll("style")].some((s) =>
          s.textContent?.includes(".mail_cnt{max-width:700px}"),
        ),
      ).toBe(true);
      expect(doc.querySelector(".mail_cnt")).not.toBeNull();
      expect(doc.body.textContent).toContain("每周概况");
      expect(doc.body.hasAttribute("onload")).toBe(false);
      expect(doc.querySelector("meta[name=viewport]")).toBeNull();
    }
  });
  it("strips executable content while preserving normal links", () => {
    const html = safeMailHtml(
      '<script>alert(1)</script><img src="x" onerror="alert(2)"><iframe src="https://evil.example"></iframe><a href="https://evil.example">Link</a><form action="https://evil.example"><input></form>',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("script,iframe,form,input")).toBeNull();
    expect(doc.querySelector("[onerror]")).toBeNull();
    expect(doc.querySelector("a")?.getAttribute("data-mail-href")).toBe(
      "https://evil.example",
    );
  });
  it("permits remote and embedded images", () => {
    const html = safeMailHtml(
      '<img src="data:image/png;base64,aGVsbG8="><img src="https://tracker.example/pixel">',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const policy = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("img-src data: https:");
    expect(policy).toContain("font-src data: https:");
    expect(policy).toContain("form-action 'none'");
    expect(doc.querySelector("img")?.src).toMatch(/^data:/);
  });
  it("upgrades legacy resources including srcset and CSS without changing links", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        `<style>@font-face{font-family:Mail;src:url('http://fonts.example/mail.woff2')} .banner{background:url(//images.example/banner.png)}</style><table background="http://images.example/bg.png"><tr><td style="background-image:url(http://images.example/bg2.png)"><img src="http://images.example/a.jpg" srcset="http://images.example/a.jpg 1x, http://images.example/b.jpg 2x"><a href="http://example.com">Link</a></td></tr></table>`,
      ),
      "text/html",
    );
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "https://images.example/a.jpg",
    );
    expect(doc.querySelector("img")?.getAttribute("srcset")).not.toContain(
      "http:",
    );
    expect(doc.querySelector("table")?.getAttribute("background")).toBe(
      "https://images.example/bg.png",
    );
    expect(doc.querySelector("td")?.getAttribute("style")).toContain(
      "https://images.example/bg2.png",
    );
    expect(doc.head.textContent).toContain("https://fonts.example/mail.woff2");
    expect(doc.head.textContent).toContain("https://images.example/banner.png");
    expect(doc.querySelector("a")?.getAttribute("data-mail-href")).toBe(
      "http://example.com",
    );
    expect(
      doc
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
    ).toContain("upgrade-insecure-requests");
  });
  it("resolves protocol-relative image URLs without touching embedded images", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<img src="//images.example/logo.png" srcset="//images.example/a.png 1x, //images.example/b.png 2x"><img src="data:image/png;base64,aGVsbG8=">',
      ),
      "text/html",
    );
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "https://images.example/logo.png",
    );
    expect(doc.querySelector("img")?.getAttribute("srcset")).toBe(
      "https://images.example/a.png 1x, https://images.example/b.png 2x",
    );
    expect(doc.querySelectorAll("img")[1].getAttribute("src")).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
  });
  it("preserves readable Chinese and rich text", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        "<h2>项目更新</h2><p>正文 <b>重要</b></p><table><tr><td>数据</td></tr></table>",
      ),
      "text/html",
    );
    expect(doc.querySelector("h2")?.textContent).toBe("项目更新");
    expect(doc.querySelector("td")?.textContent).toBe("数据");
  });
  it("accepts web and compose links but rejects executable and local URLs", () => {
    for (const href of [
      "https://example.com/page",
      "http://example.com",
      "mailto:team@example.com?subject=Hello",
    ])
      expect(mailLink(href)).not.toBeNull();
    for (const href of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,test",
      "bad url",
    ])
      expect(mailLink(href)).toBeNull();
    const doc = new DOMParser().parseFromString(
      safeMailHtml('<a href="javascript:alert(1)">bad</a>'),
      "text/html",
    );
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
  });
});

describe("mail link navigation", () => {
  it("routes native links without scripts or navigation inside the email frame", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<a href="https://example.com/path?x=1&amp;y=2" target="_blank">web</a><a href="mailto:team@example.com?subject=hello">mail</a><a href="#bottom">bottom</a><a href="file:///tmp/private">unsafe</a><script>alert(1)</script>',
        "native",
        true,
      ),
      "text/html",
    );
    const links = doc.querySelectorAll("a");
    for (const [index, original] of [
      [0, "https://example.com/path?x=1&y=2"],
      [1, "mailto:team@example.com?subject=hello"],
    ] as const) {
      const routed = new URL(links[index].getAttribute("href")!);
      expect(routed.protocol).toBe("https:");
      expect(routed.hostname).toBe("yanxin-mail-link.invalid");
      expect(routed.searchParams.get("url")).toBe(original);
      expect(links[index].hasAttribute("target")).toBe(false);
    }
    expect(links[2].getAttribute("href")).toBe("#bottom");
    expect(links[3].hasAttribute("href")).toBe(false);
    expect(doc.querySelector("script")).toBeNull();
  });
  it("recognizes WebKit srcdoc documents without depending on the reported URL", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml("<p>mail</p>", "current"),
      "text/html",
    );
    Object.defineProperty(doc, "URL", { value: "about:blank" });
    expect(isMailDocument(doc, "current")).toBe(true);
    expect(isMailDocument(doc, "previous")).toBe(false);
    expect(isMailDocument(document, "current")).toBe(false);
  });
  it("opens nested and middle-clicked links externally while keeping the mail document intact", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<a href="https://example.com/page" target="_self"><span>open</span></a><a href="mailto:team@example.com">mail</a><a href="#section">section</a>',
      ),
      "text/html",
    );
    const open = vi.fn();
    const cleanup = interceptMailLinks(doc, open);
    const anchor = doc.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("#");
    expect(anchor.hasAttribute("target")).toBe(false);
    for (const [type, button] of [
      ["click", 0],
      ["auxclick", 1],
    ] as const) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button,
      });
      anchor.querySelector("span")!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(open.mock.calls).toEqual([
      ["https://example.com/page"],
      ["https://example.com/page"],
    ]);
    doc
      .querySelectorAll("a")[1]
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    expect(open).toHaveBeenLastCalledWith("mailto:team@example.com");
    const fragment = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    doc.querySelectorAll("a")[2].dispatchEvent(fragment);
    expect(fragment.defaultPrevented).toBe(false);
    cleanup();
    anchor.click();
    expect(open).toHaveBeenCalledTimes(3);
  });
});
