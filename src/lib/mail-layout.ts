export function mailDocumentHeight(doc: Document) {
  const body = doc.body.getBoundingClientRect();
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  const contentBottom = range.getBoundingClientRect().bottom;
  const view = doc.defaultView;
  const bottomMargin =
    parseFloat(view?.getComputedStyle(doc.body).marginBottom ?? "0") || 0;
  const horizontalScrollbar =
    doc.documentElement.scrollWidth > doc.documentElement.clientWidth
      ? Math.max(0, (view?.innerHeight ?? 0) - doc.documentElement.clientHeight)
      : 0;
  // Body height alone excludes collapsed top margins and overflowing children.
  // Do not use documentElement.scrollHeight: it is at least the current iframe
  // height, which prevents shrinking when a wider reader wraps fewer lines.
  return Math.max(
    64,
    Math.ceil(
      Math.max(body.bottom, body.top + doc.body.scrollHeight, contentBottom) +
        (view?.scrollY ?? 0) +
        bottomMargin,
    ) +
      horizontalScrollbar +
      2,
  );
}
