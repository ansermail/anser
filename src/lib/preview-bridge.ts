import { t } from "./i18n";
// Build-time replacement for native APIs in the public static preview.
export function isTauri() {
  return false;
}
export async function invoke<T = never>(): Promise<T> {
  throw new Error(
    t("Desktop features are unavailable in the web preview. Download Anser."),
  );
}
export class Channel<T> {
  onmessage?: (message: T) => void;
}
export async function listen() {
  return () => {};
}
export function getCurrentWebview() {
  return { onDragDropEvent: async () => () => {} };
}
export async function getVersion() {
  return t("Page preview");
}
export async function check() {
  return null;
}
export async function open() {
  return null;
}
export async function save() {
  return null;
}
