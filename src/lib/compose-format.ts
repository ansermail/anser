import { marked } from "marked";
import DOMPurify from "dompurify";
import { dateLocale, t } from "./i18n";
import type { Compose } from "./types";
import {
  applyComposePresentation,
  composeTaskStyle,
  composeTaskSymbol,
  styleComposeCanvas,
} from "./compose-presentation";
import {
  ComposeMarkdownRenderer,
  composeLinkAllowed,
  serializeMarkdown,
} from "./markdown-serialization";

export type ComposeFormat = NonNullable<Compose["format"]>;
export function composeFormat(draft: Compose): ComposeFormat {
  return draft.format || (draft.html ? "rich" : "plain");
}

export function hasDraftContent(draft: Compose): boolean {
  if (
    [
      draft.to,
      draft.cc,
      draft.bcc,
      draft.subject,
      draft.body,
      draft.source,
    ].some((text) => !!text?.trim()) ||
    draft.attachments.length ||
    draft.forwardSource ||
    draft.externalForwardToken ||
    draft.forwardFiles?.length ||
    draft.quote ||
    draft.replyAnchorId ||
    draft.inReplyTo
  )
    return true;
  if (!draft.html) return false;
  if (htmlToText(draft.html).trim()) return true;
  const doc = new DOMParser().parseFromString(draft.html, "text/html");
  return !!doc.body.querySelector(
    "img,video,audio,svg,canvas,object,embed,iframe,hr,table",
  );
}

export function sanitizeComposeHtml(source: string) {
  // Resize handles are decorations, but also discard stray copies from pasted markup.
  const document = DOMPurify.sanitize(source, {
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
    FORBID_ATTR: ["action", "formaction", "data-placeholder"],
    RETURN_DOM: true,
  }) as HTMLElement;
  document
    .querySelectorAll(".column-resize-handle,.row-resize-handle")
    .forEach((handle) => handle.remove());
  return document.outerHTML;
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
export function markdownMarkup(source: string) {
  const markup = marked.parse(source, {
    async: false,
    gfm: true,
    breaks: true,
    renderer: new ComposeMarkdownRenderer(),
  });
  const doc = new DOMParser().parseFromString(
    sanitizeComposeHtml(markup),
    "text/html",
  );
  for (const link of doc.querySelectorAll("a[href]")) {
    if (!composeLinkAllowed(link.getAttribute("href") || ""))
      link.removeAttribute("href");
  }
  return doc;
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(
    sanitizeComposeHtml(html),
    "text/html",
  );
  return serializeMarkdown(doc.body);
}

export function compileSource(source: string, format: "markdown" | "html") {
  if (format === "html") {
    const html = sanitizeComposeHtml(source);
    return { html, body: htmlToText(html) };
  }
  const doc = markdownMarkup(source);
  normalizeColors(doc);
  const html = doc.documentElement.outerHTML;
  return { html, body: htmlToText(html) };
}

export function prepareEditorCompose(draft: Compose): Compose {
  const format = composeFormat(draft);
  if (format === "markdown" || format === "html")
    return { ...draft, ...compileSource(draft.source ?? "", format) };
  return draft;
}

export function textToHtml(text: string) {
  if (!text.trim()) return "";
  return text
    .split("\n")
    .map(
      (line) =>
        `<p>${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") || "<br>"}</p>`,
    )
    .join("");
}

const hexColor = (value: string) => {
  const match =
    /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(
      value.trim(),
    );
  if (!match || (match[4] !== undefined && Number(match[4]) < 1)) return value;
  return `#${match
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
};

// ProseMirror renders inline styles through CSSOM, so editor colors come back
// as rgb(). Store hex instead; desktop mail clients prefer it.
function normalizeColors(container: Document | HTMLElement) {
  const elements = [...container.querySelectorAll("[style]")];
  if (container instanceof HTMLElement && container.hasAttribute("style"))
    elements.unshift(container);
  for (const element of elements) {
    const style = element.getAttribute("style") || "";
    element.setAttribute(
      "style",
      style.replace(/rgba?\([^)]+\)/g, (value) => hexColor(value)),
    );
  }
}

export function hexColorStyles(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  normalizeColors(doc);
  return doc.body.innerHTML;
}

function quoteHeader(draft: Compose) {
  const quote = draft.quote!;
  return [
    `--------- ${quote.kind === "forward" ? t("Forward message") : t("Original message")} ---------`,
    t("From: {value0}", { value0: quote.sender }),
    ...(quote.recipients
      ? [t("To: {value0}", { value0: quote.recipients })]
      : []),
    t("Date: {value0}", {
      value0: new Date(quote.date).toLocaleString(dateLocale(), {
        hour12: false,
      }),
    }),
    t("Subject: {value0}", { value0: quote.subject }),
  ].join("\n");
}

function withSignature(editor: Compose) {
  if (!editor.signature?.included)
    return { body: editor.body, html: editor.html || "" };
  const signature = editor.signature;
  const body = [editor.body, signature.body].filter(Boolean).join("\n\n");
  // Legacy plain drafts can rely on deliveryBody alone. A new rich draft has
  // neither editor HTML nor body until the user types, but its signature still
  // needs the rich rendering path so preview lines use the same compact
  // spacing before and after the first edit.
  if (!editor.html && editor.body && !signature.html) return { body, html: "" };
  const authoredHtml = sanitizeComposeHtml(
    editor.html || textToHtml(editor.body),
  );
  const authored = new DOMParser().parseFromString(authoredHtml, "text/html");
  const hasAuthoredContent =
    !!htmlToText(authoredHtml).trim() ||
    !!authored.body.querySelector("img,video,audio,svg,canvas,hr,table");
  if (!hasAuthoredContent) authored.body.replaceChildren();
  const doc = new DOMParser().parseFromString(
    authored.documentElement.outerHTML,
    "text/html",
  );
  const part = doc.createElement("div");
  part.setAttribute("data-anser-signature", "true");
  part.style.marginTop = hasAuthoredContent ? "18px" : "0";
  part.style.lineHeight = "1.45";
  if (signature.html) {
    const content = new DOMParser().parseFromString(
      sanitizeComposeHtml(signature.html),
      "text/html",
    );
    for (const attribute of content.body.attributes)
      part.setAttribute(attribute.name, attribute.value);
    for (const style of content.head.querySelectorAll("style"))
      doc.head.append(doc.importNode(style, true));
    part.replaceChildren(
      ...[...content.body.childNodes].map((node) => doc.importNode(node, true)),
    );
    // Imported signatures often use a paragraph per line. Browser-default
    // paragraph margins make the signature look double-spaced in both the
    // preview and the delivered message, so compact text blocks inside the
    // signature without changing the authored border, padding or media.
    for (const element of part.querySelectorAll<HTMLElement>(
      "p, div, li, span",
    )) {
      if (!element.textContent?.trim()) continue;
      element.style.setProperty("line-height", "1.45", "important");
      if (element.matches("p, div, li")) {
        element.style.setProperty("margin-top", "0", "important");
        element.style.setProperty("margin-bottom", "0", "important");
      }
    }
  } else {
    // Plain signatures keep the line breaks shown in signature settings.
    // Paragraph elements add browser-default margins that made each line look
    // double-spaced after delivery.
    part.style.whiteSpace = "pre-wrap";
    part.textContent = signature.body;
  }
  doc.body.append(part);
  return { body, html: sanitizeComposeHtml(doc.documentElement.outerHTML) };
}

function firstContent(container: Element) {
  return [...container.childNodes].find(
    (node) => node.nodeType === Node.ELEMENT_NODE || node.textContent?.trim(),
  );
}

function deliveryMarkup(html: string, visual: boolean, dark: boolean): string {
  if (!html || (!visual && !html.includes("taskItem"))) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (visual) applyComposePresentation(doc, dark);
  for (const item of doc.querySelectorAll<HTMLLIElement>(
    'li[data-type="taskItem"]',
  )) {
    item.querySelector(":scope > label")?.remove();
    item.style.listStyleType = "none";
    const content = item.querySelector(":scope > div") || item;
    // In rich text there is a paragraph inside the wrapper. A tight Markdown
    // list can have inline content directly in it.
    const first = firstContent(content);
    const line = first instanceof HTMLParagraphElement ? first : content;
    if (line.querySelector(":scope > [data-anser-task-prefix]")) continue;
    const marker = doc.createElement("span");
    marker.setAttribute("data-anser-task-prefix", "true");
    if (visual) marker.style.cssText = composeTaskStyle(dark);
    const checked = item.getAttribute("data-checked") === "true";
    marker.textContent = `${checked ? composeTaskSymbol.checked : composeTaskSymbol.unchecked}\u00a0`;
    line.prepend(marker);
  }
  normalizeColors(doc);
  return doc.documentElement.outerHTML;
}

function authoredContent(
  target: Document,
  source: Document,
  visual: boolean,
  dark: boolean,
) {
  const content = target.createElement("div");
  content.setAttribute("data-anser-authored", "true");
  for (const attribute of source.body.attributes)
    content.setAttribute(attribute.name, attribute.value);
  if (visual) styleComposeCanvas(content, dark);
  else {
    content.style.fontFamily ||=
      "-apple-system,BlinkMacSystemFont,Arial,sans-serif";
    content.style.fontSize ||= "14px";
    content.style.lineHeight ||= "1.7";
    content.style.color ||= "#242424";
  }
  content.append(...source.body.childNodes);
  return content;
}

// Preserve the editable text separately; scheduling/cancellation must not quote twice.
export function prepareCompose(draft: Compose, dark = false): Compose {
  const editor = prepareEditorCompose(draft);
  const format = composeFormat(editor);
  const visual = format === "rich" || format === "markdown";
  // Task checkboxes are editor controls. Mail gets static checked/unchecked
  // markers before sanitization removes inputs; the draft stays editable.
  const html = deliveryMarkup(editor.html || "", visual, dark);
  const signed = withSignature({
    ...editor,
    html,
    body: editor.html?.includes("taskItem")
      ? htmlToText(html).replace(/([☑☐])\u00a0/g, "$1 ")
      : editor.body,
  });
  const ownHtml = signed.html ? sanitizeComposeHtml(signed.html) : "";
  const parser = new DOMParser();
  if (!draft.quote?.included) {
    let deliveryHtml = ownHtml;
    if (ownHtml && visual) {
      const doc = parser.parseFromString(ownHtml, "text/html");
      doc.body.append(authoredContent(doc, doc, visual, dark));
      normalizeColors(doc);
      deliveryHtml = doc.documentElement.outerHTML;
    }
    return { ...editor, deliveryBody: signed.body, deliveryHtml };
  }
  const quote = draft.quote;
  const header = quoteHeader(draft);
  const deliveryBody = [
    signed.body,
    header,
    quote.body || htmlToText(quote.html),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!quote.html && !ownHtml)
    return { ...editor, deliveryBody, deliveryHtml: "" };
  const original = parser.parseFromString(
    sanitizeComposeHtml(quote.html || textToHtml(quote.body)),
    "text/html",
  );
  const authored = parser.parseFromString(
    ownHtml || textToHtml(signed.body),
    "text/html",
  );
  const content = authoredContent(original, authored, visual, dark);
  content.style.marginBottom = "24px";
  for (const style of authored.head.querySelectorAll("style"))
    original.head.append(original.importNode(style, true));
  const heading = original.createElement("div");
  heading.setAttribute("data-anser-quote-header", "true");
  heading.style.cssText =
    "white-space:pre-wrap;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#666;border-top:1px solid #ddd;padding-top:12px;margin-bottom:16px";
  heading.textContent = header;
  original.body.prepend(content, heading);
  if (visual) normalizeColors(content);
  return {
    ...editor,
    deliveryBody,
    deliveryHtml: sanitizeComposeHtml(original.documentElement.outerHTML),
  };
}
