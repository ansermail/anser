// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  compileSource,
  composeFormat,
  prepareCompose,
  prepareEditorCompose,
} from "./compose-format";
import { newDraft } from "./api";
describe("mail source formats", () => {
  it("renders GFM headings, tables, lists and code with a readable plain alternative", () => {
    const content = compileSource(
      "# 周报\n\n**完成**\n\n- 邮件\n- 存档\n\n| 模块 | 状态 |\n|---|---|\n| 收信 | 完成 |\n\n```ts\nconst value = 1\n```",
      "markdown",
    );
    expect(content.html).toContain("<h1>周报</h1>");
    expect(content.html).toContain("<strong>完成</strong>");
    expect(content.html).toContain("<ul>");
    expect(content.html).toContain("<table style=");
    expect(content.body).toContain("收信\t完成");
    expect(content.body).toContain("const value = 1");
    expect(content.body).not.toContain("**");
  });
  it("keeps HTML document styles and table layout while excluding executable content", () => {
    const result = compileSource(
      '<html><head><style>.invoice{color:red}</style></head><body class="invoice"><table><tr><td>Invoice</td><td>42</td></tr></table><script>alert(1)</script><img src="https://example.com/logo.png" onerror="alert(1)"><a href="javascript:alert(1)">bad</a></body></html>',
      "html",
    );
    expect(result.html).toContain(".invoice{color:red}");
    expect(result.html).toContain('class="invoice"');
    expect(result.html).toContain("<table>");
    expect(result.html).not.toMatch(/<script|onerror|javascript:/i);
    expect(result.body).toContain("Invoice\t42");
    expect(result.body).not.toContain("color:red");
  });
  it("sanitizes embedded Markdown HTML and never interprets fenced source as markup", () => {
    const result = compileSource(
      "```html\n<script>alert(1)</script>\n```\n\n<img src=x onerror=alert(2)>",
      "markdown",
    );
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).not.toMatch(/<script|onerror=/);
  });
  it("recompiles source at send time and retains the editable source with legacy draft compatibility", () => {
    const d = {
      ...newDraft("account"),
      format: "markdown" as const,
      source: "**Newest**",
      html: "<p>stale</p>",
      body: "stale",
    };
    const result = prepareCompose(d);
    expect(result.html).toContain("<strong>Newest</strong>");
    expect(result.source).toBe("**Newest**");
    expect(result.body).toBe("Newest");
    expect(
      composeFormat({ ...newDraft("account"), html: "<p>old rich draft</p>" }),
    ).toBe("rich");
    expect(composeFormat(newDraft("account"))).toBe("plain");
  });
  it("preserves original HTML tables, CSS, body attributes and images outside the editor", () => {
    const draft = {
      ...newDraft("account"),
      body: "我写的回复 <OK>",
      quote: {
        kind: "forward" as const,
        included: true,
        sender: "Lin <lin@example.com>",
        recipients: "me@example.com",
        date: "2026-10-01T10:00:00+08:00",
        subject: "<周报>",
        body: "原文正文",
        html: '<html><head><style>.report td{color:red}</style></head><body class="report"><table><tr><td>原文正文</td></tr></table><img src="data:image/png;base64,aGVsbG8="></body></html>',
      },
    };
    const result = prepareCompose(draft);
    expect(result.body).toBe(draft.body);
    expect(result.html || "").toBe("");
    expect(result.deliveryHtml).toContain(".report td{color:red}");
    expect(result.deliveryHtml).toContain('class="report"');
    expect(result.deliveryHtml).toContain("<table>");
    expect(result.deliveryHtml).toContain("data:image/png;base64,aGVsbG8=");
    expect(result.deliveryHtml).toContain("&lt;OK&gt;");
    expect(result.deliveryHtml).toContain("&lt;周报&gt;");
    expect(result.deliveryBody).toContain("收件人：me@example.com");
    expect(prepareCompose(result)).toEqual(result);
    expect(prepareEditorCompose(result).body).toBe(draft.body);
    const excluded = prepareCompose({
      ...result,
      quote: { ...result.quote!, included: false },
    });
    expect(excluded.deliveryBody).toBe(draft.body);
    expect(excluded.deliveryHtml).toBe("");
  });
  it("combines authored Markdown with HTML original without contaminating editable source", () => {
    const result = prepareCompose({
      ...newDraft("account"),
      format: "markdown",
      source: "**回复内容**",
      quote: {
        kind: "reply",
        included: true,
        sender: "lin@example.com",
        recipients: "",
        date: "2026-10-01T10:00:00Z",
        subject: "周报",
        body: "原文",
        html: "<table><tr><td>原文</td></tr></table>",
      },
    });
    expect(result.deliveryHtml).toContain("<strong>回复内容</strong>");
    expect(result.deliveryHtml).toContain("<table>");
    expect(result.deliveryBody).toContain("原文");
    expect(result.deliveryBody).not.toContain("收件人：");
    expect(result.source).toBe("**回复内容**");
    expect(result.body).toBe("回复内容");
    expect(result.html).not.toContain("原文");
  });
});

describe("account signatures", () => {
  it("adds signature before the quote, preserves editable content and never doubles it", () => {
    const draft = {
      ...newDraft("a"),
      body: "Reply text",
      signature: {
        accountId: "a",
        included: true,
        body: "Regards\nAlex",
        html: '<p><b>Regards</b><br>Alex</p><img src="data:image/png;base64,aGVsbG8=">',
      },
      quote: {
        kind: "reply" as const,
        included: true,
        sender: "other@example.com",
        recipients: "",
        date: "2026-10-01T00:00:00Z",
        subject: "Example",
        body: "Original",
        html: "<p>Original</p>",
      },
    };
    const result = prepareCompose(draft);
    expect(result.body).toBe("Reply text");
    expect(result.deliveryBody!.indexOf("Alex")).toBeLessThan(
      result.deliveryBody!.indexOf("Original"),
    );
    expect(result.deliveryHtml).toContain("data-anser-signature");
    expect(result.deliveryHtml).toContain("data:image/png;base64,aGVsbG8=");
    expect(prepareCompose(result)).toEqual(result);
    const excluded = prepareCompose({
      ...result,
      signature: { ...result.signature!, included: false },
    });
    expect(excluded.deliveryBody).not.toContain("Alex");
    expect(excluded.deliveryHtml).not.toContain("data-anser-signature");
  });
  it("keeps a plain signature plain and escapes user markup in the HTML alternative", () => {
    const draft = {
      ...newDraft("a"),
      body: "<Authored>",
      signature: { accountId: "a", included: true, body: "<Name>", html: "" },
    };
    expect(prepareCompose(draft).deliveryBody).toBe("<Authored>\n\n<Name>");
    expect(prepareCompose(draft).deliveryHtml).toBe("");
    expect(
      prepareCompose({ ...draft, html: "<p>Authored</p>" }).deliveryHtml,
    ).toContain("&lt;Name&gt;");
  });
});
