const editableSelector =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

// WebKit may keep keyboard focus on a button after a pointer click.
export function trackPointerFocus(target: Document = document) {
  const root = target.documentElement;
  const pointerDown = () => root.setAttribute("data-pointer-focus", "");
  const keyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    root.removeAttribute("data-pointer-focus");
  };
  target.addEventListener("pointerdown", pointerDown, true);
  target.addEventListener("keydown", keyDown, true);
  return () => {
    target.removeEventListener("pointerdown", pointerDown, true);
    target.removeEventListener("keydown", keyDown, true);
    root.removeAttribute("data-pointer-focus");
  };
}

/**
 * WebKit treats Backspace on a non-editable page as browser back. The desktop
 * shell has no document history to restore, so the shortcut can navigate the
 * whole webview to a blank document.
 */
export function installBackspaceGuard(target: Window = window) {
  const keydown = (event: KeyboardEvent) => {
    if (
      event.key !== "Backspace" ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.defaultPrevented
    )
      return;
    const node = event.target;
    if (node instanceof Element && node.closest(editableSelector)) return;
    event.preventDefault();
  };
  target.addEventListener("keydown", keydown, { capture: true });
  return () =>
    target.removeEventListener("keydown", keydown, { capture: true });
}
