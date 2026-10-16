function hasImageDescription(image: HTMLImageElement) {
  return !!(
    image.alt.trim() ||
    image.getAttribute("aria-label")?.trim() ||
    image.getAttribute("aria-labelledby")?.trim() ||
    image.getAttribute("role") === "img"
  );
}

// Only exclude provably empty clipping regions. An auto-sized zero layout
// box before an image loads is not proof of clipping.
export function isMailImageClipped(
  element: Element,
  style: CSSStyleDeclaration,
) {
  for (const axis of ["x", "y"] as const) {
    const dimension = axis === "x" ? "width" : "height";
    const overflow =
      style.getPropertyValue(`overflow-${axis}`) || style.overflow;
    const inline = (element as HTMLElement).style?.getPropertyValue(dimension);
    const zero = (value: string) => /^0(?:px)?$/.test(value);
    const sides = axis === "x" ? ["left", "right"] : ["top", "bottom"];
    const noPadding = sides.every(
      (side) => !parseFloat(style.getPropertyValue(`padding-${side}`)),
    );
    if (
      /^(hidden|clip|auto|scroll)$/.test(overflow) &&
      noPadding &&
      ((zero(style.getPropertyValue(`max-${dimension}`)) &&
        !parseFloat(style.getPropertyValue(`min-${dimension}`))) ||
        (inline && zero(inline) && zero(style.getPropertyValue(dimension))))
    )
      return true;
  }
  // CSS clip only applies to positioned elements. A partial crop is content.
  if (style.position === "absolute" || style.position === "fixed") {
    const rect = style.clip.match(
      /^rect\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px\s*\)$/,
    );
    if (
      rect &&
      (Number(rect[3]) <= Number(rect[1]) || Number(rect[2]) <= Number(rect[4]))
    )
      return true;
  }
  return false;
}

// A broken 0×0 analytics image can acquire a nonzero fallback height in
// WebKit (the reader's height:auto overrides the HTML height). Require an
// authored zero pair AND a remaining zero axis; CSS-enlarged content, unknown
// sizes and responsive candidates must still participate in loading feedback.
export function isMailZeroSizeImage(
  image: HTMLImageElement,
  width: number | undefined,
  height: number | undefined,
) {
  if (
    hasImageDescription(image) ||
    image.hasAttribute("srcset") ||
    image.closest("picture")
  )
    return false;
  const declaredZero = (name: "width" | "height") => {
    const inline = image.style.getPropertyValue(name).trim();
    const value = inline || image.getAttribute(name)?.trim();
    return value !== undefined && /^0+(?:\.0+)?(?:px)?$/i.test(value);
  };
  return (
    declaredZero("width") &&
    declaredZero("height") &&
    (width === 0 || height === 0)
  );
}

// Layout strips carry spacing, not mail content. Require known dimensions so
// a pending, unsized image with a zero layout box is never mistaken for one.
export function isMailLayoutStrip(
  image: HTMLImageElement,
  width: number | undefined,
  height: number | undefined,
) {
  return (
    width !== undefined &&
    height !== undefined &&
    width > 0 &&
    height > 0 &&
    (width <= 1 || height <= 1) &&
    !hasImageDescription(image)
  );
}

export const MAIL_SPACER_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Replace only explicitly sized, unlabelled, conventional transparent spacer
 * assets in the derived reader DOM. Preserve dimensions/layout and MIME. Never
 * replace an arbitrary failed photo, labelled image or responsive candidate. */
export function normalizeMailSpacers(doc: Document) {
  for (const image of doc.querySelectorAll<HTMLImageElement>("img[src]")) {
    if (image.hasAttribute("srcset") || image.closest("picture")) continue;
    const dimension = (name: "width" | "height") => {
      const css = image.style.getPropertyValue(name).trim();
      if (css)
        return /^\d+(?:\.\d+)?px$/.test(css) ? parseFloat(css) : undefined;
      const attr = image.getAttribute(name);
      return attr !== null && /^\d+(?:\.\d+)?$/.test(attr)
        ? Number(attr)
        : undefined;
    };
    if (!isMailLayoutStrip(image, dimension("width"), dimension("height")))
      continue;
    try {
      const url = new URL(image.getAttribute("src")!);
      if (
        url.protocol === "https:" &&
        /^(?:spacer|blank|transparent|clear)(?:[-_](?:\d+|1x1))*\.(?:gif|png|webp)$/i.test(
          url.pathname.split("/").pop() || "",
        )
      )
        image.setAttribute("src", MAIL_SPACER_IMAGE);
    } catch {
      // Relative/CID/data resources keep their existing rendering path.
    }
  }
}
