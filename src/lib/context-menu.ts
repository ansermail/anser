// Bubble phase keeps future application ContextMenu triggers working.
export function suppressNativeContextMenu(event: Event) {
  const node = event.target as Node | null;
  const element =
    node?.nodeType === 1 ? (node as Element) : node?.parentElement;
  if (element?.closest("[data-mail-debug-region]")) return;
  const nonSelectableControl = element?.closest(
    '.mail-sidebar, .sidebar, .settings-navigation, [data-slot="tabs-list"], [data-slot="tabs-trigger"], button',
  );
  if (nonSelectableControl) {
    const selection = element?.ownerDocument.getSelection?.();
    if (
      selection?.anchorNode &&
      nonSelectableControl.contains(selection.anchorNode)
    ) {
      selection.removeAllRanges();
    }
  }
  event.preventDefault();
}
export function disableNativeContextMenu(doc: Document) {
  doc.addEventListener("contextmenu", suppressNativeContextMenu);
  return () =>
    doc.removeEventListener("contextmenu", suppressNativeContextMenu);
}

// Readable srcdoc is available before `load`, which may wait for remote images.
export function disableFrameContextMenu(frame: HTMLIFrameElement) {
  let stop = () => {};
  let current: Document | null = null;
  const attach = () => {
    const doc = frame.contentDocument;
    if (
      doc &&
      doc !== current &&
      doc.URL === "about:srcdoc" &&
      doc.readyState !== "loading"
    ) {
      stop();
      current = doc;
      stop = disableNativeContextMenu(doc);
    }
  };
  attach();
  // A source edit navigates the frame to a new Document. Track that replacement
  // even when its load event is still waiting for remote images.
  const pending = setInterval(attach, 50);
  frame.addEventListener("load", attach);
  return () => {
    clearInterval(pending);
    frame.removeEventListener("load", attach);
    stop();
  };
}
