import DOMPurify from "dompurify";
import { marked } from "marked";

const tags = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

export function renderReleaseNotes(markdown: string): string {
  const html = DOMPurify.sanitize(
    marked.parse(markdown, { async: false, gfm: true }),
    { ALLOWED_TAGS: tags, ALLOWED_ATTR: ["href", "src", "alt", "title"] },
  );
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const anchor of template.content.querySelectorAll("a")) {
    const href = anchor.getAttribute("href");
    if (!href || !externalUrl(href)) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
  for (const image of template.content.querySelectorAll("img")) {
    const src = image.getAttribute("src");
    if (!src || !externalUrl(src, false)) image.remove();
  }
  return template.innerHTML;
}

export function externalUrl(value: string, allowMailto = true): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      url.protocol === "http:" ||
      (allowMailto && url.protocol === "mailto:")
      ? url.href
      : null;
  } catch {
    return null;
  }
}
