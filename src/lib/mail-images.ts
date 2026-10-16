import {
  isMailLayoutStrip,
  isMailZeroSizeImage,
  isMailImageClipped,
} from "./mail-image-decorations";

export const MAIL_IMAGE_TIMEOUT_MS = 15_000;
export interface MailImageStatus {
  waiting: number;
  timedOut: number;
  failed: number;
}

// Loading feedback describes the visible mail, not hidden analytics requests.
// A zero layout box alone is inconclusive: an unsized content image may not
// have received its intrinsic dimensions yet.
function contentImage(
  image: HTMLImageElement,
  styles: Map<Element, CSSStyleDeclaration>,
) {
  const view = image.ownerDocument.defaultView ?? window;
  const style = (element: Element) => {
    let value = styles.get(element);
    if (!value) {
      value = view.getComputedStyle(element);
      styles.set(element, value);
    }
    return value;
  };
  const own = style(image);
  if (own.visibility === "hidden" || own.visibility === "collapse")
    return false;
  let positionedDescendant = false;
  for (
    let element: Element | null = image;
    element;
    element = element.parentElement
  ) {
    const value = style(element);
    if (
      value.display === "none" ||
      value.opacity === "0" ||
      value.contentVisibility === "hidden" ||
      (!positionedDescendant && isMailImageClipped(element, value)) ||
      (element.tagName === "DETAILS" &&
        !element.hasAttribute("open") &&
        !element.querySelector(":scope > summary")?.contains(image))
    )
      return false;
    // Positioned descendants can escape overflow clips whose containing block
    // is outside that ancestor. Keep uncertain cases in content feedback.
    positionedDescendant ||=
      value.position === "absolute" || value.position === "fixed";
  }
  const rect = image.getBoundingClientRect();
  const dimension = (name: "width" | "height") => {
    if (rect[name] > 0) return rect[name];
    const css = own[name];
    if (/^\d+(?:\.\d+)?px$/.test(css)) return Number.parseFloat(css);
    const attr = image.getAttribute(name);
    return attr !== null && /^\d+(?:\.\d+)?$/.test(attr)
      ? Number(attr)
      : undefined;
  };
  const width = dimension("width"),
    height = dimension("height");
  return !(
    (width !== undefined &&
      height !== undefined &&
      width <= 1 &&
      height <= 1) ||
    isMailLayoutStrip(image, width, height) ||
    isMailZeroSizeImage(image, width, height)
  );
}

// Each image gets one deadline. Layout observers must not extend it. The
// browser may still finish a late request; that removes the timeout notice.
export function watchMailImages(
  doc: Document,
  changed: (status: MailImageStatus) => void,
  domEvents = true,
) {
  const images = new Map<
    HTMLImageElement,
    { source: string; expired: boolean; timer?: ReturnType<typeof setTimeout> }
  >();
  let disposed = false;
  let previous = "";
  let poll: ReturnType<typeof setInterval> | undefined;
  const source = (image: HTMLImageElement) =>
    JSON.stringify([image.getAttribute("src"), image.getAttribute("srcset")]);
  function refresh() {
    if (disposed) return;
    const styles = new Map<Element, CSSStyleDeclaration>();
    const current = new Set(
      [...doc.images].filter(
        (image) =>
          (image.getAttribute("src") || image.getAttribute("srcset")) &&
          contentImage(image, styles),
      ),
    );
    for (const [image, entry] of images) {
      if (!current.has(image) || entry.source !== source(image)) {
        clearTimeout(entry.timer);
        images.delete(image);
      }
    }
    const status = { waiting: 0, timedOut: 0, failed: 0 };
    for (const image of current) {
      let entry = images.get(image);
      if (!entry) {
        entry = { source: source(image), expired: false };
        images.set(image, entry);
      }
      if (image.complete) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
        if (image.naturalWidth === 0) status.failed++;
      } else if (entry.expired) status.timedOut++;
      else {
        status.waiting++;
        if (!entry.timer) {
          const waiting = entry;
          entry.timer = setTimeout(() => {
            waiting.expired = true;
            waiting.timer = undefined;
            refresh();
          }, MAIL_IMAGE_TIMEOUT_MS);
        }
      }
    }
    const signature = JSON.stringify(status);
    if (signature !== previous) {
      previous = signature;
      changed(status);
    }
    // WebKit's scripts-disabled frame can suppress DOM load/error listeners.
    // Poll only unresolved images so fixed-size late loads are still noticed.
    if (status.waiting + status.timedOut > 0) {
      poll ??= setInterval(refresh, 1000);
    } else {
      clearInterval(poll);
      poll = undefined;
    }
  }
  function retry() {
    if (disposed) return;
    // A layout/style change may have hidden a formerly visible failed image.
    refresh();
    for (const [image, entry] of images) {
      if (!entry.expired && !(image.complete && image.naturalWidth === 0))
        continue;
      clearTimeout(entry.timer);
      images.delete(image);
      const src = image.getAttribute("src"),
        srcset = image.getAttribute("srcset");
      // Reuse the exact sanitized sources, including data/CID replacements.
      // Never append cache-busting parameters or reload successful images.
      image.removeAttribute("srcset");
      image.removeAttribute("src");
      if (src !== null) image.setAttribute("src", src);
      if (srcset !== null) image.setAttribute("srcset", srcset);
    }
    refresh();
  }
  if (domEvents) {
    doc.addEventListener("load", refresh, true);
    doc.addEventListener("error", refresh, true);
  }
  refresh();
  return {
    refresh,
    retry,
    dispose() {
      disposed = true;
      clearInterval(poll);
      for (const entry of images.values()) clearTimeout(entry.timer);
      images.clear();
      if (domEvents) {
        doc.removeEventListener("load", refresh, true);
        doc.removeEventListener("error", refresh, true);
      }
    },
  };
}
