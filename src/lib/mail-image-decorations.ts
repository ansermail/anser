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
    !image.alt.trim() &&
    !image.getAttribute("aria-label")?.trim() &&
    !image.getAttribute("aria-labelledby")?.trim() &&
    image.getAttribute("role") !== "img"
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
