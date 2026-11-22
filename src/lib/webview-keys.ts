const editableSelector =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

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
