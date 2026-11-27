import DOMPurify from "dompurify";
import { routeNativeMailResources } from "./mail-image-resources";
import { normalizeMailSpacers } from "./mail-image-decorations";
import { nativeResourceSource } from "./platform";

export type MailColorScheme = "light" | "dark";
export type MailLogoKind = "none" | "transparent-dark" | "white-matted-dark";

const darkMailColors = {
  background: "rgb(28, 28, 30)",
  foreground: "rgb(237, 237, 237)",
  muted: "rgb(174, 174, 178)",
  link: "rgb(137, 180, 250)",
  darkInkOnLight: "rgb(24, 24, 27)",
  invertedPeak: { red: 232, green: 232, blue: 234, alpha: 1 },
};

// Lucide Image, presented with the muted surface of shadcn EmptyMedia.
// CSS replaces only the rendering of the img. Its source and load state stay intact.
const unavailableImageIcon = (stroke: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>`)}")`;
const unavailableImageCss = `
  img[data-anser-image-unavailable] {
    content: ${unavailableImageIcon("#626269")} !important;
    object-fit: scale-down !important;
    object-position: center !important;
    min-width: 24px;
    min-height: 24px;
    background: linear-gradient(#f4f4f5, #f4f4f5) !important;
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px #d4d4d8;
  }
  :root[data-mail-color-scheme="dark"] img[data-anser-image-unavailable] {
    content: ${unavailableImageIcon("#b1b1ba")} !important;
    background: linear-gradient(#303034, #303034) !important;
    box-shadow: inset 0 0 0 1px #4c4c53;
  }
`;

const themeTransitionCss =
  "@media (prefers-reduced-motion:no-preference){html,body,body *,body img{transition:background-color 200ms cubic-bezier(0.22,1,0.36,1),color 200ms cubic-bezier(0.22,1,0.36,1),border-color 200ms cubic-bezier(0.22,1,0.36,1),filter 200ms cubic-bezier(0.22,1,0.36,1)!important}}";

function mailThemeCss(
  colorScheme: MailColorScheme,
  background?: string,
  animate = false,
) {
  const mailBackground = background?.trim() || darkMailColors.background;
  const transition = animate ? themeTransitionCss : "";
  return colorScheme === "dark"
    ? `${transition}:root{color-scheme:dark}html,body{background-color:${mailBackground}!important;color:${darkMailColors.foreground}!important}a:where(:not([data-anser-light-image-surface] *)){color:${darkMailColors.link}}:where([data-anser-light-image-surface]){color:#242424}a:where([data-anser-light-image-surface] *){color:#0645ad}img[data-anser-logo="transparent-dark"]:not([data-anser-image-unavailable]):where(:not([data-anser-light-image-surface] *)){filter:invert(1) brightness(0.92)!important}img[data-anser-logo="white-matted-dark"]:not([data-anser-image-unavailable]):where(:not([data-anser-light-image-surface] *)){filter:invert(1) brightness(0.92)!important;mix-blend-mode:screen!important}::selection{background:${darkMailColors.link};color:#111}`
    : `${transition}:root{color-scheme:light}html,body{background-color:#fff}`;
}

function fontDisplaySwap(value: string) {
  return value.replace(/@font-face\s*\{([^{}]*)\}/gi, (block, body: string) =>
    /\bfont-display\s*:/i.test(body)
      ? block
      : block.replace("{", "{font-display:swap;"),
  );
}

export function safeMailHtml(
  html: string,
  documentId = "anser-mail",
  nativeNavigation = false,
  nativeImages = nativeNavigation,
  colorScheme: MailColorScheme = "light",
  background?: string,
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
    FORBID_ATTR: [
      "action",
      "formaction",
      "data-mail-href",
      "data-anser-light-image-surface",
      "data-anser-logo",
      "data-anser-image-unavailable",
    ],
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
    style.textContent = secureResources(
      fontDisplaySwap(style.textContent || ""),
    );
  }
  normalizeMailSpacers(doc);
  // Image slices often inherit text baselines from pasted span/font wrappers.
  // Only mark tight, text-free media runs; prose, icons, BR spacing and the
  // author's margins/padding keep their original layout.
  const imageRuns = new Set<Element>();
  for (const img of doc.images) {
    const parent = img.closest("p,div,td,th");
    if (parent) imageRuns.add(parent);
  }
  for (const parent of imageRuns) {
    if (
      !parent.textContent?.trim() &&
      parent.querySelectorAll("img").length > 1 &&
      [...parent.querySelectorAll("*")].every((node) =>
        /^(A|SPAN|FONT|B|STRONG|I|EM|PICTURE|SOURCE|IMG)$/.test(node.tagName),
      )
    )
      parent.setAttribute("data-anser-image-run", "");
  }
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
  const colorSchemeMarker = doc.createElement("meta");
  colorSchemeMarker.name = "color-scheme";
  colorSchemeMarker.content = colorScheme;
  doc.head.prepend(colorSchemeMarker);
  // break-word wraps long prose/URLs without reducing table cells' min-content
  // width to one character (anywhere squeezes narrow status/header columns).
  // Keep original head styles and body classes; insert our policy before them.
  // A body-only sanitizer otherwise drops leading styles in HTML email fragments.
  doc.head.insertAdjacentHTML(
    "afterbegin",
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:${nativeImages ? ` ${nativeResourceSource("anser-image")}` : ""}; style-src 'unsafe-inline' ${nativeImages ? nativeResourceSource("anser-style") : "https:"}; font-src data: ${nativeImages ? nativeResourceSource("anser-font") : "https:"}; upgrade-insecure-requests; base-uri 'none'; form-action 'none'"><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;font-size:14px;line-height:1.6;color:#242424;margin:0;padding:0;overflow-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}[data-anser-image-run],[data-anser-image-run] :is(a,span,font,b,strong,i,em){line-height:0}[data-anser-image-run] img{vertical-align:bottom}${unavailableImageCss}</style><style id="anser-mail-theme">${mailThemeCss(colorScheme, background)}</style>`,
  );
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}

type RgbColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

function rgb(value: string): RgbColor | null {
  const trimmed = value.trim();
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i.exec(
      trimmed,
    );
  if (match) {
    return {
      red: Number(match[1]),
      green: Number(match[2]),
      blue: Number(match[3]),
      alpha: match[4] === undefined ? 1 : Number(match[4]),
    };
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed);
  if (hex) {
    const raw = hex[1];
    const full =
      raw.length === 3
        ? raw
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : raw;
    return {
      red: parseInt(full.slice(0, 2), 16),
      green: parseInt(full.slice(2, 4), 16),
      blue: parseInt(full.slice(4, 6), 16),
      alpha: 1,
    };
  }
  const oklch = /^oklch\(\s*([\d.]+)(%?)/i.exec(trimmed);
  if (oklch) {
    const l = oklch[2] === "%" ? Number(oklch[1]) / 100 : Number(oklch[1]);
    const channel = Math.round(
      Math.max(
        0,
        Math.min(255, Math.pow(Math.max(0, Math.min(1, l)), 1.6) * 255),
      ),
    );
    return { red: channel, green: channel, blue: channel, alpha: 1 };
  }
  return null;
}

function formatRgb(color: RgbColor) {
  return `rgb(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)})`;
}

function blendOver(fg: RgbColor, bg: RgbColor): RgbColor {
  const a = Math.max(0, Math.min(1, fg.alpha));
  if (a >= 0.999) return { ...fg, alpha: 1 };
  return {
    red: fg.red * a + bg.red * (1 - a),
    green: fg.green * a + bg.green * (1 - a),
    blue: fg.blue * a + bg.blue * (1 - a),
    alpha: 1,
  };
}

function neutral(color: RgbColor) {
  return (
    Math.max(color.red, color.green, color.blue) -
      Math.min(color.red, color.green, color.blue) <=
    20
  );
}

function luminance(color: RgbColor) {
  return (
    (color.red * 0.2126 + color.green * 0.7152 + color.blue * 0.0722) / 255
  );
}

function srgbLinear(channel: number) {
  const v = channel / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(color: RgbColor) {
  return (
    0.2126 * srgbLinear(color.red) +
    0.7152 * srgbLinear(color.green) +
    0.0722 * srgbLinear(color.blue)
  );
}

function contrastRatio(a: RgbColor, b: RgbColor) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Slightly tinted near-black ink is still neutral in a reading surface (for
// example #1f1b2e). Preserve saturated author colors and colored/image surfaces.
function darkInk(color: RgbColor) {
  const channels = [color.red, color.green, color.blue];
  return (
    neutral(color) ||
    (Math.max(...channels) <= 64 &&
      Math.max(...channels) - Math.min(...channels) <= 32)
  );
}

/**
 * Single continuous perceptual lightness-inversion curve for neutral colors.
 * Pure white (L = 1) maps to the dark theme canvas; light grays smoothly lift
 * into elevated dark surfaces; pure black (L = 0) inverts to crisp off-white.
 */
function invertNeutralTone(
  color: RgbColor,
  canvasRgb: RgbColor,
  peakRgb: RgbColor = darkMailColors.invertedPeak,
): RgbColor {
  const l = Math.max(0, Math.min(1, luminance(color)));
  const t = Math.pow(1 - l, 0.78);
  return {
    red: canvasRgb.red + (peakRgb.red - canvasRgb.red) * t,
    green: canvasRgb.green + (peakRgb.green - canvasRgb.green) * t,
    blue: canvasRgb.blue + (peakRgb.blue - canvasRgb.blue) * t,
    alpha: 1,
  };
}

function hasDarkAuthoredCanvas(doc: Document, view: Window) {
  // Prefer the document canvas over any individual card or header.
  for (const element of [
    doc.body,
    doc.documentElement,
    doc.body.firstElementChild,
  ]) {
    if (!element) continue;
    const background = rgb(view.getComputedStyle(element).backgroundColor);
    if (background && background.alpha > 0.5)
      return luminance(background) < 0.25;
  }
  return false;
}

function hasAuthoredColorSurface(element: Element, view: Window) {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const style = view.getComputedStyle(current);
    if (style.backgroundImage && style.backgroundImage !== "none") return true;
    const background = rgb(style.backgroundColor);
    if (background && background.alpha > 0.95)
      return (
        !neutral(background) ||
        current.hasAttribute("data-anser-light-image-surface")
      );
  }
  return false;
}

function preserveLightImageSurfaces(doc: Document, view: Window) {
  for (const image of doc.images) {
    const style = view.getComputedStyle(image);
    const tiny = (value: string | null) =>
      !!value &&
      /^\d+(?:\.\d+)?(?:px)?$/i.test(value) &&
      parseFloat(value) <= 1;
    if (
      style.visibility === "hidden" ||
      tiny(image.style.width || image.getAttribute("width")) ||
      tiny(image.style.height || image.getAttribute("height")) ||
      (image.naturalWidth > 0 &&
        (image.naturalWidth <= 1 || image.naturalHeight <= 1))
    )
      continue;
    const source = image.getAttribute("src") || "";
    const width = parseFloat(
      image.style.width || image.getAttribute("width") || "",
    );
    const compactImage = Number.isFinite(width) && width > 1 && width <= 240;
    const brandImage =
      /logo|wordmark/i.test(
        `${image.alt} ${image.title} ${source.length < 2048 ? source : ""}`,
      ) || compactImage;
    for (
      let parent: HTMLElement | null = image;
      parent && parent !== doc.body;
      parent = parent.parentElement
    ) {
      const computed = view.getComputedStyle(parent);
      if (
        computed.display === "none" ||
        (computed.backgroundImage && computed.backgroundImage !== "none")
      )
        break;
      const color = rgb(computed.backgroundColor);
      if (!color || color.alpha <= 0.95) continue;
      const brandRegion =
        brandImage ||
        parent.matches('footer,[role="contentinfo"]') ||
        /footer|branding/i.test(`${parent.id} ${parent.className}`);
      const nestedTable = [...parent.querySelectorAll("table")].some((table) =>
        table.querySelector("table"),
      );
      // A compact wordmark can anchor a longer legal footer. Keep the authored
      // light card with its brand colors instead of letting the dark-mode
      // neutralizer repaint the whole footer surface.
      const maxTextLength = brandRegion ? (compactImage ? 1200 : 320) : 0;

      // Keep the nearest authored backing only for a visibly shaded light card
      // (such as #f4f4f4 footers), not an invisible pure-white page header row
      // that would turn into a stark white strip on a dark canvas.
      const cardLuminance = luminance(color);
      if (
        neutral(color) &&
        cardLuminance > 0.78 &&
        cardLuminance < 0.978 &&
        !parent.matches("main,article") &&
        !nestedTable &&
        !parent.querySelector("h1, h2, h3, h4, h5, h6") &&
        parent.querySelectorAll("tr").length <= (brandRegion ? 4 : 1) &&
        (parent.textContent?.trim().length ?? 0) <= maxTextLength
      )
        parent.setAttribute("data-anser-light-image-surface", "");
      break;
    }
  }
}

function hasBackgroundImage(element: Element, view: Window) {
  let current: Element | null = element;
  while (current) {
    const image = view.getComputedStyle(current).backgroundImage;
    if (image && image !== "none") return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * Pure pixel classifier for monochrome dark logos/wordmarks (both transparent-
 * background and tight-cropped pure-white-matted line art). Leaves photos,
 * colorful logos, and shaded gray cards untouched.
 */
export function classifyDarkLogoPixels(
  pixels: Uint8ClampedArray | readonly number[],
  width: number,
  height: number,
): MailLogoKind {
  const totalPixels = Math.min(Math.floor(pixels.length / 4), width * height);
  if (totalPixels < 4 || width <= 1 || height <= 1) return "none";
  let transparent = 0;
  let visible = 0;
  let darkInk = 0;
  let pureWhite = 0;
  let colorfulTransparent = 0;
  let colorfulOpaque = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const a = pixels[i + 3];
    if (a < 24) {
      transparent++;
      continue;
    }
    visible++;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = (r * 2126 + g * 7152 + b * 722) / 10_000;
    if (lum <= 128 && chroma <= 36) darkInk++;
    if (lum >= 245 && chroma <= 14) pureWhite++;
    if (chroma > 40) colorfulTransparent++;
    if (chroma > 28) colorfulOpaque++;
  }
  if (visible < 4) return "none";
  if (
    transparent * 100 >= totalPixels * 10 &&
    darkInk * 100 >= visible * 75 &&
    colorfulTransparent * 100 <= visible * 5
  )
    return "transparent-dark";
  if (
    transparent * 100 < totalPixels * 10 &&
    colorfulOpaque * 100 <= visible * 2 &&
    pureWhite * 100 >= visible * 35 &&
    darkInk * 100 >= visible * 3
  ) {
    const isWhiteAt = (x: number, y: number) => {
      const idx = (y * width + x) * 4;
      if (idx + 3 >= pixels.length) return false;
      const a = pixels[idx + 3];
      if (a < 24) return true;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = (r * 2126 + g * 7152 + b * 722) / 10_000;
      return lum >= 245 && chroma <= 14;
    };
    const edgeWhite = (count: number, at: (i: number) => boolean) => {
      let hits = 0;
      for (let i = 0; i < count; i++) if (at(i)) hits++;
      return count > 0 && hits * 100 >= count * 25;
    };
    const whiteEdges = [
      edgeWhite(width, (x) => isWhiteAt(x, 0)),
      edgeWhite(width, (x) => isWhiteAt(x, height - 1)),
      edgeWhite(height, (y) => isWhiteAt(0, y)),
      edgeWhite(height, (y) => isWhiteAt(width - 1, y)),
    ].filter(Boolean).length;
    if (whiteEdges >= 2) return "white-matted-dark";
  }
  return "none";
}

function sampleInlineImageLogo(image: HTMLImageElement): MailLogoKind {
  if (
    !image.complete ||
    image.naturalWidth <= 1 ||
    image.naturalHeight <= 1 ||
    typeof document === "undefined"
  )
    return "none";
  try {
    const scale = Math.min(
      1,
      64 / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "none";
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    return classifyDarkLogoPixels(data, width, height);
  } catch {
    return "none";
  }
}

function unwrapNativeImageUrl(source: string): string | null {
  try {
    const url = new URL(source);
    if (
      (url.protocol === "anser-image:" ||
        url.hostname === "anser-image.localhost") &&
      url.pathname === "/fetch"
    ) {
      return url.searchParams.get("url");
    }
  } catch {
    // Ignore malformed or relative URLs.
  }
  return null;
}

/**
 * Classifies loaded mail images for dark-mode logo rendering via pure CSS
 * (data-anser-logo), using local canvas sampling for inline data: URIs and
 * the native Rust classification cache for proxied remote images.
 */
export async function classifyMailImages(
  doc: Document,
  nativeLookup?: (urls: string[]) => Promise<Record<string, string>>,
) {
  if (!doc.body) return;
  const nativeTargets = new Map<string, HTMLImageElement[]>();
  for (const image of doc.images) {
    if (image.hasAttribute("data-anser-logo")) continue;
    if (!image.complete || image.naturalWidth <= 1 || image.naturalHeight <= 1)
      continue;
    const src = image.currentSrc || image.getAttribute("src") || "";
    if (!src) continue;
    if (src.startsWith("data:")) {
      const kind = sampleInlineImageLogo(image);
      image.setAttribute("data-anser-logo", kind);
      continue;
    }
    const unwrapped = unwrapNativeImageUrl(src);
    if (unwrapped && nativeLookup) {
      const list = nativeTargets.get(unwrapped) ?? [];
      list.push(image);
      nativeTargets.set(unwrapped, list);
    }
  }
  if (!nativeTargets.size || !nativeLookup) return;
  try {
    const results = await nativeLookup([...nativeTargets.keys()]);
    for (const [url, images] of nativeTargets) {
      const kind = results[url];
      if (
        kind === "transparent-dark" ||
        kind === "white-matted-dark" ||
        kind === "none"
      ) {
        for (const image of images) {
          image.setAttribute("data-anser-logo", kind);
        }
      }
    }
  } catch {
    // Classification is purely visual enhancement; never disrupt reading.
  }
}

type SavedInlineProp = { value: string; priority: string };
type SavedInlineStyles = Record<string, SavedInlineProp>;

const originalInlineStyles = new WeakMap<HTMLElement, SavedInlineStyles>();
const adaptedElementsByDoc = new WeakMap<Document, Set<HTMLElement>>();

const managedStyleProps = [
  "background-color",
  "color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
] as const;

function snapshotInlineStyles(doc: Document, element: HTMLElement) {
  if (!originalInlineStyles.has(element)) {
    const saved: SavedInlineStyles = {};
    for (const prop of managedStyleProps) {
      saved[prop] = {
        value: element.style.getPropertyValue(prop),
        priority: element.style.getPropertyPriority(prop),
      };
    }
    originalInlineStyles.set(element, saved);
  }
  let tracked = adaptedElementsByDoc.get(doc);
  if (!tracked) {
    tracked = new Set();
    adaptedElementsByDoc.set(doc, tracked);
  }
  tracked.add(element);
}

function setManagedStyle(
  doc: Document,
  element: HTMLElement,
  prop: (typeof managedStyleProps)[number],
  value: string,
) {
  snapshotInlineStyles(doc, element);
  element.style.setProperty(prop, value, "important");
}

function restoreOriginalMailStyles(doc: Document) {
  const tracked = adaptedElementsByDoc.get(doc);
  if (!tracked) return;
  for (const element of tracked) {
    const saved = originalInlineStyles.get(element);
    if (!saved) continue;
    for (const prop of managedStyleProps) {
      const entry = saved[prop];
      if (entry.value) {
        element.style.setProperty(prop, entry.value, entry.priority);
      } else {
        element.style.removeProperty(prop);
      }
    }
  }
  tracked.clear();
  for (const marked of doc.querySelectorAll(
    "[data-anser-light-image-surface]",
  )) {
    marked.removeAttribute("data-anser-light-image-surface");
  }
}

const borderSides = [
  {
    style: "borderTopStyle",
    width: "borderTopWidth",
    color: "borderTopColor",
    css: "border-top-color",
  },
  {
    style: "borderRightStyle",
    width: "borderRightWidth",
    color: "borderRightColor",
    css: "border-right-color",
  },
  {
    style: "borderBottomStyle",
    width: "borderBottomWidth",
    color: "borderBottomColor",
    css: "border-bottom-color",
  },
  {
    style: "borderLeftStyle",
    width: "borderLeftWidth",
    color: "borderLeftColor",
    css: "border-left-color",
  },
] as const;

/** Adapt neutral author colors in the isolated reading document via unified lightness inversion. */
export function applyMailColorScheme(
  doc: Document,
  colorScheme: MailColorScheme,
  background?: string,
  animate = false,
) {
  if (!doc.body) return;
  const view = doc.defaultView;
  const mailBackground = background?.trim() || darkMailColors.background;
  let style = doc.querySelector<HTMLStyleElement>("#anser-mail-theme");
  if (!style) {
    style = doc.createElement("style");
    style.id = "anser-mail-theme";
    doc.head.prepend(style);
  }
  const colorSchemeMeta = doc.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]',
  );
  if (colorSchemeMeta) colorSchemeMeta.content = colorScheme;

  // Always restore original author inline styles first so repeated dark <-> light
  // or dark-palette A <-> B transitions compute cleanly from authentic source styles.
  restoreOriginalMailStyles(doc);
  const requestedScheme = `:root{color-scheme:${colorScheme}}`;
  style.textContent = `${animate ? themeTransitionCss : ""}${requestedScheme}`;

  // A declaration or media query is only a hint. Some senders emit empty or
  // narrowly scoped dark rules while the readable canvas stays light.
  const nativeDark =
    colorScheme === "dark" && view !== null && hasDarkAuthoredCanvas(doc, view);
  style.textContent = nativeDark
    ? `${animate ? themeTransitionCss : ""}:root{color-scheme:dark}`
    : mailThemeCss(colorScheme, background, animate);
  doc.documentElement.dataset.mailColorScheme = colorScheme;
  if (colorScheme === "light" || nativeDark || !view) return;

  preserveLightImageSurfaces(doc, view);
  const canvasRgb = rgb(mailBackground) ??
    rgb(darkMailColors.background) ?? {
      red: 28,
      green: 28,
      blue: 30,
      alpha: 1,
    };
  const effectiveSurface = new Map<Element, RgbColor>();
  effectiveSurface.set(doc.body, canvasRgb);

  setManagedStyle(doc, doc.body, "background-color", mailBackground);
  setManagedStyle(doc, doc.body, "color", darkMailColors.foreground);

  for (const element of doc.body.querySelectorAll<HTMLElement>("*")) {
    if (
      [
        "PICTURE",
        "SOURCE",
        "VIDEO",
        "AUDIO",
        "CANVAS",
        "OBJECT",
        "EMBED",
        "SCRIPT",
        "STYLE",
        "LINK",
      ].includes(element.tagName)
    )
      continue;
    const computed = view.getComputedStyle(element);
    if (computed.display === "none") continue;
    const parentSurface =
      (element.parentElement && effectiveSurface.get(element.parentElement)) ||
      canvasRgb;
    let currentSurface = parentSurface;

    const isPreservedLightCard = element.hasAttribute(
      "data-anser-light-image-surface",
    );
    const hasImageBg =
      !!computed.backgroundImage && computed.backgroundImage !== "none";
    const bg = rgb(computed.backgroundColor);

    if (bg && bg.alpha > 0.05) {
      if (isPreservedLightCard || hasImageBg || !neutral(bg)) {
        currentSurface = blendOver(bg, parentSurface);
      } else {
        const bgLum = luminance(bg);
        const preservesDarkImageBacking =
          bgLum < 0.25 &&
          element.querySelector("img") !== null &&
          (element.textContent?.trim().length ?? 0) <= 240;
        if (preservesDarkImageBacking) {
          currentSurface = blendOver(bg, parentSurface);
        } else if (bgLum >= 0.978) {
          setManagedStyle(doc, element, "background-color", mailBackground);
          currentSurface = canvasRgb;
        } else {
          const inverted = invertNeutralTone(bg, canvasRgb);
          setManagedStyle(
            doc,
            element,
            "background-color",
            formatRgb(inverted),
          );
          currentSurface = inverted;
        }
      }
    }
    effectiveSurface.set(element, currentSurface);
    if (element.tagName === "IMG") continue;

    if (!isPreservedLightCard && !hasImageBg) {
      for (const side of borderSides) {
        const borderStyle = computed[side.style];
        if (!borderStyle || borderStyle === "none" || borderStyle === "hidden")
          continue;
        const borderWidth = parseFloat(computed[side.width] || "0") || 0;
        if (borderWidth <= 0) continue;
        const borderColor = rgb(computed[side.color] || "");
        if (!borderColor || borderColor.alpha <= 0.1 || !neutral(borderColor))
          continue;
        const invertedBorder = invertNeutralTone(borderColor, canvasRgb);
        setManagedStyle(doc, element, side.css, formatRgb(invertedBorder));
      }
    }

    const foreground = rgb(computed.color);
    if (
      foreground &&
      !hasBackgroundImage(element, view) &&
      !element.closest("[data-anser-light-image-surface]")
    ) {
      const surfaceIsDark = relativeLuminance(currentSurface) < 0.3;
      const ratio = contrastRatio(foreground, currentSurface);
      if (surfaceIsDark) {
        if (
          darkInk(foreground) &&
          (luminance(foreground) < 0.42 || ratio < 4.5) &&
          !hasAuthoredColorSurface(element, view)
        ) {
          setManagedStyle(
            doc,
            element,
            "color",
            element.tagName === "A"
              ? darkMailColors.link
              : luminance(foreground) < 0.24
                ? darkMailColors.foreground
                : darkMailColors.muted,
          );
        }
      } else if (
        ratio < 4.5 &&
        (neutral(foreground) || element.tagName === "A")
      ) {
        setManagedStyle(doc, element, "color", darkMailColors.darkInkOnLight);
      }
    }
  }
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
