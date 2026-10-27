import { nativeResourceOrigin } from "./platform";

// Only the native reader has resource transports. Browser/Pages rendering keeps
// normal resource URLs and can never call the native backend through this path.
function nativeResource(source: string, kind: "image" | "style" | "font") {
  try {
    const url = new URL(source);
    if (url.protocol !== "https:") return source;
    return `${nativeResourceOrigin(`anser-${kind}`)}/fetch?url=${encodeURIComponent(url.href)}`;
  } catch {
    return source;
  }
}

const nativeImage = (source: string) => nativeResource(source, "image");

function srcset(value: string) {
  // URLs are whitespace-delimited; preserve descriptors, embedded data URIs and
  // candidate separators. Commas inside an HTTPS URL are encoded in the route.
  return value.replace(
    /(^|[\s,])(https:\/\/[^\s]+)/g,
    (_, prefix, token: string) => {
      const source = token.replace(/,+$/, "");
      return prefix + nativeImage(source) + token.slice(source.length);
    },
  );
}

function cssUrls(value: string, kind: "image" | "font") {
  return value.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s][^)]*?))\s*\)/gi,
    (original, double: string, single: string, bare: string) => {
      const source = double ?? single ?? bare?.trim();
      const routed = nativeResource(source, kind);
      return routed === source ? original : `url("${routed}")`;
    },
  );
}

function cssResources(value: string) {
  return value.replace(
    /@font-face\s*\{[^}]*\}|@import\b[^;]*;|url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s][^)]*?))\s*\)/gi,
    (original) => {
      if (/^@font-face/i.test(original)) return cssUrls(original, "font");
      if (/^@import/i.test(original))
        return original.replace(
          /(@import\s+(?:\/\*[\s\S]*?\*\/\s*)*)(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^'"\s][^)]*?))\s*\)|"([^"]*)"|'([^']*)')/i,
          (
            match: string,
            prefix: string,
            double: string,
            single: string,
            bare: string,
            quotedDouble: string,
            quotedSingle: string,
          ) => {
            const source =
              double ?? single ?? bare?.trim() ?? quotedDouble ?? quotedSingle;
            const routed = nativeResource(source, "style");
            return routed === source ? match : `${prefix}url("${routed}")`;
          },
        );
      return cssUrls(original, "image");
    },
  );
}

export function routeNativeMailResources(doc: Document) {
  for (const link of doc.querySelectorAll<HTMLLinkElement>(
    'link[rel="stylesheet"]',
  )) {
    link.setAttribute(
      "href",
      nativeResource(link.getAttribute("href")!, "style"),
    );
    link.setAttribute("crossorigin", "anonymous");
  }
  for (const image of doc.querySelectorAll("img")) {
    const source = image.getAttribute("src");
    if (source) image.setAttribute("src", nativeImage(source));
  }
  for (const element of doc.querySelectorAll(
    "img[srcset], picture source[srcset]",
  ))
    element.setAttribute("srcset", srcset(element.getAttribute("srcset")!));
  for (const element of doc.querySelectorAll("[background]"))
    element.setAttribute(
      "background",
      nativeImage(element.getAttribute("background")!),
    );
  for (const element of doc.querySelectorAll("[style]"))
    element.setAttribute("style", cssResources(element.getAttribute("style")!));
  for (const style of doc.querySelectorAll("style"))
    style.textContent = cssResources(style.textContent ?? "");
}
