// Browser demos keep the existing Mac presentation unless Windows is detected.
// Native Windows uses WebView2's Win32 platform, including on 64-bit Windows.
export function isWindows() {
  return typeof navigator !== "undefined" && /Win/i.test(navigator.platform);
}

export function shortcut(key: string) {
  return isWindows()
    ? key
        .replace(/⌘\s*/g, "Ctrl+")
        .replace(/⇧/g, "Shift+")
        .replace(/⌥/g, "Alt+")
    : key;
}

export function nativeResourceOrigin(protocol: string) {
  // Main and external Windows WebViews both opt in to HTTPS custom schemes.
  return isWindows()
    ? `https://${protocol}.localhost`
    : `${protocol}://localhost`;
}

export function nativeResourceSource(protocol: string) {
  return isWindows() ? nativeResourceOrigin(protocol) : `${protocol}:`;
}
