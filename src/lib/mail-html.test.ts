// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { safeMailHtml, mailLink } from "./mail-html";
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
    expect(doc.querySelector("a")?.getAttribute("href")).toBe(
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
    expect(policy).toContain("img-src data: http: https:");
    expect(policy).toContain("form-action 'none'");
    expect(doc.querySelector("img")?.src).toMatch(/^data:/);
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
