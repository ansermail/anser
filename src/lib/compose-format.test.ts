// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  compileSource,
  composeFormat,
  hasDraftContent,
  hexColorStyles,
  htmlToMarkdown,
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
    expect(content.html).toContain("<table>");
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
    expect(composeFormat(newDraft("account"))).toBe("rich");
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
    expect(
      new DOMParser()
        .parseFromString(result.deliveryHtml!, "text/html")
        .querySelector("[data-anser-authored] strong")?.textContent,
    ).toBe("回复内容");
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
      signature: {
        accountId: "a",
        included: true,
        body: "<Name>\nRole\nEmail",
        html: "",
      },
    };
    expect(prepareCompose(draft).deliveryBody).toBe(
      "<Authored>\n\n<Name>\nRole\nEmail",
    );
    expect(prepareCompose(draft).deliveryHtml).toBe("");
    const delivered = new DOMParser().parseFromString(
      prepareCompose({ ...draft, html: "<p>Authored</p>" }).deliveryHtml!,
      "text/html",
    );
    const signature = delivered.querySelector<HTMLElement>(
      "[data-anser-signature]",
    )!;
    expect(signature.textContent).toBe("<Name>\nRole\nEmail");
    expect(signature.querySelector("p")).toBeNull();
    expect(signature.style.whiteSpace).toBe("pre-wrap");
    expect(signature.style.lineHeight).toBe("1.45");
    expect(signature.style.marginTop).toBe("18px");
  });
  it("uses compact rich rendering for a plain signature before the first edit", () => {
    const result = prepareCompose({
      ...newDraft("a"),
      signature: {
        accountId: "a",
        included: true,
        body: "Regards\nAlex\nEmail",
        html: "",
      },
    });
    const delivered = new DOMParser().parseFromString(
      result.deliveryHtml!,
      "text/html",
    );
    const signature = delivered.querySelector<HTMLElement>(
      "[data-anser-signature]",
    )!;
    expect(signature).not.toBeNull();
    expect(signature.textContent).toBe("Regards\nAlex\nEmail");
    expect(signature.style.whiteSpace).toBe("pre-wrap");
    expect(signature.style.lineHeight).toBe("1.45");
    expect(signature.style.marginTop).toBe("0px");
    expect(delivered.querySelector("body > p")).toBeNull();
  });
  it("drops an empty rich-editor paragraph before the signature", () => {
    const delivered = new DOMParser().parseFromString(
      prepareCompose({
        ...newDraft("a"),
        body: "",
        html: "<p><br></p>",
        signature: {
          accountId: "a",
          included: true,
          body: "Name\nCompany",
          html: "<p>Name</p><p>Company</p>",
        },
      }).deliveryHtml!,
      "text/html",
    );
    const signature = delivered.querySelector<HTMLElement>(
      "[data-anser-signature]",
    )!;
    expect(delivered.querySelector("body > p")).toBeNull();
    expect(signature.style.marginTop).toBe("0px");
    expect(signature.querySelector("p")?.style.marginTop).toBe("0px");
  });
  it("compacts paragraph margins inside imported HTML signatures", () => {
    const delivered = new DOMParser().parseFromString(
      prepareCompose({
        ...newDraft("a"),
        html: "<p>Authored</p>",
        signature: {
          accountId: "a",
          included: true,
          body: "Name\nCompany\nPhone",
          html: '<div style="border:1px solid #000;padding:8px"><p>Name</p><p>Company</p><p>Phone</p></div>',
        },
      }).deliveryHtml!,
      "text/html",
    );
    const signature = delivered.querySelector<HTMLElement>(
      "[data-anser-signature]",
    )!;
    expect(signature.style.lineHeight).toBe("1.45");
    for (const paragraph of signature.querySelectorAll<HTMLElement>("p")) {
      expect(paragraph.style.marginTop).toBe("0px");
      expect(paragraph.style.marginBottom).toBe("0px");
      expect(paragraph.style.lineHeight).toBe("1.45");
    }
    expect(signature.querySelector<HTMLElement>("div")?.style.padding).toBe(
      "8px",
    );
  });
});
describe("draft content detection", () => {
  it("ignores the selected sender, automatic signature and empty rich text markup", () => {
    const draft = newDraft("work");
    draft.signature = {
      accountId: "work",
      included: true,
      body: "Automatic signature",
      html: "<p>Automatic signature</p>",
    };
    expect(hasDraftContent(draft)).toBe(false);
    expect(
      hasDraftContent({ ...draft, body: " \n\t ", html: "<p>&nbsp;<br></p>" }),
    ).toBe(false);
  });
  it("preserves recipients, subject, attachments, visible HTML resources and reply context", () => {
    const draft = newDraft("work");
    for (const fields of [
      { to: "recipient@example.com" },
      { cc: "copy@example.com" },
      { bcc: "hidden@example.com" },
      { subject: "Subject" },
      { body: "Content" },
      { attachments: ["/test/attachment.txt"] },
      { html: '<img src="data:image/png;base64,aA==">' },
      { inReplyTo: "<reply@example.com>" },
      { format: "html" as const, source: "<p></p>" },
    ])
      expect(hasDraftContent({ ...draft, ...fields })).toBe(true);
  });
});
describe("rich text colors", () => {
  it("stores editor text colors as hex styles for mail clients", () => {
    expect(
      hexColorStyles(
        '<p><span style="color: rgb(197, 34, 31);">Red</span><span style="color: rgb(30, 123, 52);">Green</span></p>',
      ),
    ).toBe(
      '<p><span style="color: #c5221f;">Red</span><span style="color: #1e7b34;">Green</span></p>',
    );
  });
  it("converts highlighted backgrounds while leaving translucent and visible text alone", () => {
    const result = hexColorStyles(
      '<p style="background-color: rgb(187, 222, 251)">rgb(1, 2, 3)</p><mark style="background-color: rgba(255, 0, 0, 0.4)">x</mark><span style="color: rgba(197, 34, 31, 1)">y</span>',
    );
    expect(result).toContain("background-color: #bbdefb");
    expect(result).toContain("rgba(255, 0, 0, 0.4)");
    expect(result).toContain("rgb(1, 2, 3)");
    expect(result).toContain("color: #c5221f");
  });
});

describe("Markdown visual editing round trips", () => {
  it("serializes nested formatting, aligned GFM tables and checked tasks", () => {
    const input = [
      "## Report",
      "",
      "**Strong** and *emphasis* with ~~old~~ `code` and [mail](mailto:qa@example.test)",
      "",
      "> A quote",
      "",
      "4. Start",
      "5. Continue",
      "",
      "- [x] Done",
      "  - [ ] Nested",
      "- [ ] Next",
      "",
      "| Project | State |",
      "| :--- | ---: |",
      "| Anser | **Ready** |",
      "",
      "```ts",
      "const ticks = '```';",
      "```",
    ].join("\n");
    const initial = compileSource(input, "markdown").html;
    const serialized = htmlToMarkdown(initial);
    expect(serialized).toContain("## Report");
    expect(serialized).toContain("4. Start");
    expect(serialized).toContain("- [x] Done\n  - [ ] Nested\n- [ ] Next");
    expect(serialized).toContain("| :--- | ---: |");
    expect(serialized).toContain("````ts\nconst ticks");
    const { html, body } = compileSource(serialized, "markdown");
    expect(html).toContain("<strong>Strong</strong>");
    expect(html).toContain("<em>emphasis</em>");
    expect(html).toContain("<del>old</del>");
    expect(html).toContain('href="mailto:qa@example.test"');
    expect(body).toContain("Anser\tReady");
    expect(body).toContain("const ticks");
  });

  it("uses sanitized HTML for merged, resized tables and snapshot images", () => {
    const html =
      '<table style="width:640px"><tr style="height:96px"><th colspan="2" data-colwidth="210,270" style="width:480px;height:96px"><p>Header</p><span class="column-resize-handle"></span></th></tr><tr><td><p>Body</p></td><td><p data-placeholder="editor-only">Result</p></td></tr></table><p><img src="data:image/png;base64,aGVsbG8=" alt="snapshot" style="width:128px"></p>';
    const source = htmlToMarkdown(html);
    expect(source).toContain('<th colspan="2" data-colwidth="210,270"');
    expect(source).not.toMatch(/resize-handle|data-placeholder/);
    const draft = prepareCompose({
      ...newDraft("demo"),
      format: "markdown",
      source,
    });
    const doc = new DOMParser().parseFromString(
      draft.deliveryHtml || "",
      "text/html",
    );
    const table = doc.querySelector("table")!;
    expect(table.style.width).toBe("640px");
    expect(table.style.borderRadius).toBe("8px");
    expect(table.style.getPropertyValue("clip-path")).toBe(
      "inset(0 round 8px)",
    );
    expect(table.style.borderCollapse).toBe("collapse");
    expect(table.rows[0].style.height).toBe("96px");
    expect(table.rows[0].cells[0].style.width).toBe("480px");
    expect(table.rows[0].cells[0].style.height).toBe("96px");
    expect(doc.querySelector("img")?.style.width).toBe("128px");
    expect(doc.querySelector("img")?.src).toContain("data:image/png;");
  });

  it("retains explicit Markdown blank content only when it contains a real block or media", () => {
    expect(htmlToMarkdown("<p><br></p>")).toBe("");
    expect(
      hasDraftContent({
        ...newDraft("demo"),
        html: "<table><tr><td></td></tr></table>",
      }),
    ).toBe(true);
    const { html } = compileSource(
      "[ok](https://example.test) [invalid](tel:123) <a href='ftp://example.test'>FTP</a>",
      "markdown",
    );
    expect(html).toContain('href="https://example.test"');
    expect(html).not.toMatch(/href="(?:tel|ftp):/);
  });
});

describe("rich delivery whitespace", () => {
  it("preserves authored leading and consecutive spaces in rich delivery HTML", () => {
    const result = prepareCompose({
      ...newDraft("account"),
      format: "rich",
      html: "<p>    希望您一切顺利。  请回复。</p><p>第一行<br>  第二行</p><pre>  keep pre</pre>",
      body: "    希望您一切顺利。  请回复。\n第一行\n  第二行\n  keep pre",
    });
    const doc = new DOMParser().parseFromString(
      result.deliveryHtml!,
      "text/html",
    );
    const paragraphs = [...doc.querySelectorAll("[data-anser-authored] p")];
    expect(paragraphs[0].textContent).toBe(
      "\u00a0\u00a0\u00a0\u00a0希望您一切顺利。\u00a0 请回复。",
    );
    expect(paragraphs[1].textContent).toBe("第一行\u00a0\u00a0第二行");
    expect(doc.querySelector("[data-anser-authored] pre")?.textContent).toBe(
      "  keep pre",
    );
  });

  it("formats reply and forward quote headers in English RFC style when enabled without affecting default locale behavior", () => {
    const baseQuote = {
      included: true,
      sender: "sender@example.com",
      recipients: "recipient@example.com",
      date: "2026-11-27T03:32:53+08:00",
      subject: "Order #42",
      body: "Original body",
      html: "<p>Original body</p>",
    };
    const defaultReply = prepareCompose({
      ...newDraft("account"),
      body: "Noted",
      quote: { ...baseQuote, kind: "reply" },
    });
    expect(defaultReply.deliveryBody).toContain("--------- 原始邮件 ---------");
    expect(defaultReply.deliveryBody).toContain("发件人：sender@example.com");

    const englishReply = prepareCompose(
      {
        ...newDraft("account"),
        body: "Noted",
        quote: { ...baseQuote, kind: "reply" },
      },
      false,
      { englishQuoteHeader: true },
    );
    expect(englishReply.deliveryBody).toContain(
      "--------- Original Message ---------",
    );
    expect(englishReply.deliveryBody).toContain("From: sender@example.com");
    expect(englishReply.deliveryBody).toContain("To: recipient@example.com");
    expect(englishReply.deliveryBody).toMatch(
      /Date: [A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} 2026 \d{2}:\d{2}:\d{2} [+-]\d{4}/,
    );
    expect(englishReply.deliveryBody).toContain("Subject: Order #42");
    expect(englishReply.deliveryBody).not.toMatch(/[\u4e00-\u9fff]/);
    const htmlHeader = new DOMParser()
      .parseFromString(englishReply.deliveryHtml!, "text/html")
      .querySelector("[data-anser-quote-header]")?.textContent;
    expect(htmlHeader).toContain("--------- Original Message ---------");
    expect(htmlHeader).not.toMatch(/[\u4e00-\u9fff]/);

    const englishForward = prepareCompose(
      {
        ...newDraft("account"),
        body: "FYI",
        quote: { ...baseQuote, kind: "forward", date: "not-a-date" },
      },
      false,
      { englishQuoteHeader: true },
    );
    expect(englishForward.deliveryBody).toContain(
      "--------- Forwarded Message ---------",
    );
    expect(englishForward.deliveryBody).toContain("Date: not-a-date");
    expect(englishForward.deliveryBody).not.toMatch(/[\u4e00-\u9fff]/);
  });
});
