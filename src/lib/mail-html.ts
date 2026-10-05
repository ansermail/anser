import DOMPurify from "dompurify";
export function safeMailHtml(
  html: string,
  documentId = "yanxin-mail",
  nativeNavigation = false,
) {
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
    FORBID_ATTR: ["action", "formaction", "data-mail-href"],
  });
  const doc = new DOMParser().parseFromString(content, "text/html");
  // Legacy mail often embeds HTTP image/font URLs. Upgrade resource references
  // before WKWebView evaluates ATS; keep navigation links exactly as authored.
  for (const element of doc.querySelectorAll(
    "[src], [srcset], [background], [style]",
  )) {
    for (const attr of ["src", "srcset", "background", "style"]) {
      const value = element.getAttribute(attr);
      if (value) {
        let resource = secureResources(value);
        if (attr === "src" || attr === "background")
          resource = resource.replace(/^\/\//, "https://");
        if (attr === "srcset")
          resource = resource.replace(/(^|[\s,])\/\//g, "$1https://");
        element.setAttribute(attr, resource);
      }
    }
  }
  for (const style of doc.querySelectorAll("style")) {
    style.textContent = secureResources(style.textContent || "");
  }
  // WebKit suppresses frame event listeners in a scripts-disabled sandbox.
  // Native links use a route the navigation delegate cancels and emits to the
  // app; browser links are neutralized before their listeners attach.
  for (const anchor of doc.querySelectorAll("a")) {
    const href = anchor.getAttribute("href") || "";
    anchor.removeAttribute("target");
    anchor.removeAttribute("download");
    if (href.startsWith("#")) continue;
    const url = mailLink(href);
    if (url) {
      anchor.setAttribute("data-mail-href", href);
      anchor.setAttribute(
        "href",
        nativeNavigation
          ? `https://yanxin-mail-link.invalid/open?url=${encodeURIComponent(url.href)}`
          : "#",
      );
      anchor.setAttribute("rel", "noopener noreferrer");
    } else anchor.removeAttribute("href");
  }
  const marker = doc.createElement("meta");
  marker.name = "yanxin-mail-document";
  marker.content = documentId;
  doc.head.prepend(marker);
  // Keep original head styles and body classes; insert our policy before them.
  // A body-only sanitizer otherwise drops leading styles in HTML email fragments.
  doc.head.insertAdjacentHTML(
    "afterbegin",
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; font-src data: https:; upgrade-insecure-requests; base-uri 'none'; form-action 'none'"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;color:#242424;margin:0;padding:0;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`,
  );
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

function secureResources(value: string) {
  return value
    .replace(/\bhttp:\/\//gi, "https://")
    .replace(/(url\(\s*["']?)\/\//gi, "$1https://");
}

export function mailLink(href: string): URL | null {
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function isMailDocument(
  doc: Document | null | undefined,
  documentId: string,
) {
  return (
    doc
      ?.querySelector('meta[name="yanxin-mail-document"]')
      ?.getAttribute("content") === documentId
  );
}

export function interceptMailLinks(
  doc: Document,
  onOpen: (href: string) => void,
) {
  const clicked = (event: MouseEvent) => {
    const node = event.target as Node | null;
    const target =
      node?.nodeType === 1 ? (node as Element) : node?.parentElement;
    const anchor = target?.closest("a");
    if (!anchor) return;
    const href =
      anchor.getAttribute("data-mail-href") ||
      anchor.getAttribute("href") ||
      "";
    if (href.startsWith("#")) return;
    event.preventDefault();
    if (event.button > 1) return;
    const url = mailLink(href);
    if (url) onOpen(url.href);
  };
  doc.addEventListener("click", clicked, true);
  doc.addEventListener("auxclick", clicked, true);
  return () => {
    doc.removeEventListener("click", clicked, true);
    doc.removeEventListener("auxclick", clicked, true);
  };
}
