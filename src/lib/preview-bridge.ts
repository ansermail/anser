// Build-time replacement for native APIs in the public static preview.
export function isTauri() {
  return false;
}
export async function invoke<T = never>(): Promise<T> {
  throw new Error("网页预览不提供桌面功能，请下载 Anser 客户端。");
}
export class Channel<T> {
  onmessage?: (message: T) => void;
}
export async function listen() {
  return () => {};
}
export async function getVersion() {
  return "页面预览";
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
