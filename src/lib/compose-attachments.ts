import { t } from "./i18n";
export function mergeAttachmentPaths(existing: string[], incoming: string[]) {
  if (incoming.some((path) => !path || path.includes("\0")))
    throw new Error(t("附件路径无效，未添加文件"));
  return [
    ...new Set([
      ...existing,
      ...incoming.filter((path) => !!path && !path.includes("\0")),
    ]),
  ];
}
export function insideComposeDrop(
  position: { x: number; y: number },
  bounds: { left: number; right: number; top: number; bottom: number },
  scale: number,
) {
  if (!Number.isFinite(scale) || scale <= 0) return false;
  const x = position.x / scale,
    y = position.y / scale;
  return (
    x >= bounds.left &&
    x <= bounds.right &&
    y >= bounds.top &&
    y <= bounds.bottom
  );
}
