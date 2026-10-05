import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Compose } from "./types";

export type ComposeFormat = NonNullable<Compose["format"]>;
export function composeFormat(draft: Compose): ComposeFormat {
  return draft.format || (draft.html ? "rich" : "plain");
}

export function sanitizeComposeHtml(source: string) {
  return DOMPurify.sanitize(source, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      "script",
      "iframe",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "video",
      "audio",
      "svg",
      "math",
      "base",
      "meta",
      "link",
    ],
    FORBID_ATTR: ["action", "formaction"],
  });
}
export function htmlToText(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style,script,template,head").forEach((e) => e.remove());
  doc.querySelectorAll("br").forEach((e) => e.replaceWith("\n"));
  doc.querySelectorAll("tr").forEach((row) => {
    const cells = [...row.querySelectorAll("td,th")].map((cell) =>
      (cell.textContent || "").replace(/\s+/g, " ").trim(),
    );
    if (cells.length) row.replaceChildren(doc.createTextNode(cells.join("\t")));
  });
  doc
    .querySelectorAll("img[alt]")
    .forEach((e) => e.replaceWith(e.getAttribute("alt") || ""));
  doc
    .querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote")
    .forEach((e) => e.append("\n"));
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}
export function compileSource(source: string, format: "markdown" | "html") {
  const markup =
    format === "markdown"
      ? marked.parse(source, { async: false, gfm: true, breaks: true })
      : source;
  let html = sanitizeComposeHtml(markup);
  if (format === "markdown") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.body.style.cssText =
      "font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;font-size:14px;line-height:1.7;color:#242424";
    doc
      .querySelectorAll("table")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "border-collapse:collapse;max-width:100%;margin:12px 0",
        ),
      );
    doc
      .querySelectorAll("th,td")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "border:1px solid #ddd;padding:8px 12px;text-align:left",
        ),
      );
    doc
      .querySelectorAll("pre")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "padding:12px;background:#f5f5f5;white-space:pre-wrap",
        ),
      );
    doc
      .querySelectorAll("blockquote")
      .forEach((e) =>
        e.setAttribute(
          "style",
          "border-left:3px solid #ddd;margin-left:0;padding-left:12px;color:#666",
        ),
      );
    html = doc.documentElement.outerHTML;
  }
  return { html, body: htmlToText(html) };
}
export function prepareEditorCompose(draft: Compose): Compose {
  const format = composeFormat(draft);
  if (format === "markdown" || format === "html")
    return { ...draft, ...compileSource(draft.source ?? "", format) };
  return draft;
}

export function textToHtml(text: string) {
  return text
    .split("\n")
    .map(
      (line) =>
        `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") || "<br>"}</p>`,
    )
    .join("");
}

function quoteHeader(draft: Compose) {
  const quote = draft.quote!;
  return [
    `--------- ${quote.kind === "forward" ? "转发邮件" : "原始邮件"} ---------`,
    `发件人：${quote.sender}`,
    ...(quote.recipients ? [`收件人：${quote.recipients}`] : []),
    `时间：${new Date(quote.date).toLocaleString("zh-CN", { hour12: false })}`,
    `主题：${quote.subject}`,
  ].join("\n");
}

// Preserve the editable text separately; scheduling/cancellation must not quote twice.
export function prepareCompose(draft: Compose): Compose {
  const editor = prepareEditorCompose(draft);
  const ownHtml = editor.html ? sanitizeComposeHtml(editor.html) : "";
  if (!draft.quote?.included)
    return { ...editor, deliveryBody: editor.body, deliveryHtml: ownHtml };
  const quote = draft.quote;
  const header = quoteHeader(draft);
  const deliveryBody = [
    editor.body,
    header,
    quote.body || htmlToText(quote.html),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!quote.html && !ownHtml)
    return { ...editor, deliveryBody, deliveryHtml: "" };
  const parser = new DOMParser();
  const original = parser.parseFromString(
    sanitizeComposeHtml(quote.html || textToHtml(quote.body)),
    "text/html",
  );
  const authored = parser.parseFromString(
    ownHtml || textToHtml(editor.body),
    "text/html",
  );
  const content = original.createElement("div");
  content.setAttribute("data-yanxin-authored", "true");
  for (const attribute of authored.body.attributes)
    content.setAttribute(attribute.name, attribute.value);
  content.style.fontFamily ||=
    "-apple-system,BlinkMacSystemFont,Arial,sans-serif";
  content.style.fontSize ||= "14px";
  content.style.lineHeight ||= "1.7";
  content.style.color ||= "#242424";
  content.style.marginBottom = "24px";
  content.append(
    ...[...authored.body.childNodes].map((node) =>
      original.importNode(node, true),
    ),
  );
  for (const style of authored.head.querySelectorAll("style"))
    original.head.append(original.importNode(style, true));
  const heading = original.createElement("div");
  heading.setAttribute("data-yanxin-quote-header", "true");
  heading.style.cssText =
    "white-space:pre-wrap;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#666;border-top:1px solid #ddd;padding-top:12px;margin-bottom:16px";
  heading.textContent = header;
  original.body.prepend(content, heading);
  return {
    ...editor,
    deliveryBody,
    deliveryHtml: sanitizeComposeHtml(original.documentElement.outerHTML),
  };
}
