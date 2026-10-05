// Bubble phase keeps future application ContextMenu triggers working.
export function suppressNativeContextMenu(event: Event) {
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
