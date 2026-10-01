import DOMPurify from "dompurify";
export function safeMailHtml(html: string) {
  const content = DOMPurify.sanitize(html, {
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
  const doc = new DOMParser().parseFromString(content, "text/html");
  // Keep original head styles and body classes; insert our policy before them.
  // A body-only sanitizer otherwise drops leading styles in HTML email fragments.
  doc.head.insertAdjacentHTML(
    "afterbegin",
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: http: https:; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;color:#242424;margin:0;padding:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`,
  );
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

export function mailLink(href: string): URL | null {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}
