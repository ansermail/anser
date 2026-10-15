import DOMPurify from "dompurify";
import { routeNativeMailResources } from "./mail-image-resources";
import { normalizeMailSpacers } from "./mail-image-decorations";
export function safeMailHtml(
  html: string,
  documentId = "anser-mail",
  nativeNavigation = false,
  nativeImages = nativeNavigation,
) {
  const content = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["link"],
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
    ],
    FORBID_ATTR: ["action", "formaction", "data-mail-href"],
  });
  const doc = new DOMParser().parseFromString(content, "text/html");
  // Keep stylesheet links only; preload/prefetch/icons and other relationships
  // have no role in the isolated email and must not initiate requests.
  for (const link of doc.querySelectorAll("link")) {
    const href = secureResources(link.getAttribute("href") || "").replace(
      /^\/\//,
      "https://",
    );
    const url = mailLink(href);
    if (
      link.getAttribute("rel")?.toLowerCase() !== "stylesheet" ||
      url?.protocol !== "https:"
    ) {
      link.remove();
      continue;
    }
    link.setAttribute("rel", "stylesheet");
    link.setAttribute("href", url.href);
    link.setAttribute("referrerpolicy", "no-referrer");
  }
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
  normalizeMailSpacers(doc);
  if (nativeImages) routeNativeMailResources(doc);
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
          ? `https://anser-mail-link.invalid/open?url=${encodeURIComponent(url.href)}`
          : "#",
      );
      if (nativeNavigation) anchor.setAttribute("target", "_top");
      anchor.setAttribute("rel", "noopener noreferrer");
    } else anchor.removeAttribute("href");
  }
  const marker = doc.createElement("meta");
  marker.name = "anser-mail-document";
  marker.content = documentId;
  doc.head.prepend(marker);
  // break-word wraps long prose/URLs without reducing table cells' min-content
  // width to one character (anywhere squeezes narrow status/header columns).
  // Keep original head styles and body classes; insert our policy before them.
  // A body-only sanitizer otherwise drops leading styles in HTML email fragments.
  doc.head.insertAdjacentHTML(
    "afterbegin",
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:${nativeImages ? " anser-image:" : ""}; style-src 'unsafe-inline' ${nativeImages ? "anser-style:" : "https:"}; font-src data: ${nativeImages ? "anser-font:" : "https:"}; upgrade-insecure-requests; base-uri 'none'; form-action 'none'"><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;line-height:1.6;color:#242424;margin:0;padding:0;overflow-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}</style>`,
  );
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

function secureResources(value: string) {
  return value
    .replace(/\bhttp:\/\//gi, "https://")
    .replace(/(url\(\s*["']?)\/\//gi, "$1https://")
    .replace(/(@import\s+["'])\/\//gi, "$1https://");
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
      ?.querySelector('meta[name="anser-mail-document"]')
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
