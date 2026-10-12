export const BODY_FONTS = [
  { group: "中文字体", label: "宋体", value: "SimSun, 'Songti SC', serif" },
  { group: "中文字体", label: "楷体", value: "KaiTi, 'Kaiti SC', serif" },
  { group: "中文字体", label: "黑体", value: "SimHei, 'Heiti SC', sans-serif" },
  { group: "中文字体", label: "仿宋", value: "FangSong, STFangsong, serif" },
  {
    group: "中文字体",
    label: "微软雅黑",
    value: "'Microsoft YaHei', 'PingFang SC', sans-serif",
  },
  { group: "英文字体", label: "Arial", value: "Arial, Helvetica, sans-serif" },
  {
    group: "英文字体",
    label: "Helvetica",
    value: "Helvetica, Arial, sans-serif",
  },
  {
    group: "英文字体",
    label: "Times New Roman",
    value: "'Times New Roman', Times, serif",
  },
  {
    group: "英文字体",
    label: "Georgia",
    value: "Georgia, 'Times New Roman', serif",
  },
  { group: "英文字体", label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { group: "英文字体", label: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  {
    group: "英文字体",
    label: "Trebuchet MS",
    value: "'Trebuchet MS', Arial, sans-serif",
  },
  {
    group: "英文字体",
    label: "Courier New",
    value: "'Courier New', Courier, monospace",
  },
];
export const BODY_SIZES = [
  8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48, 72,
];
export const MAX_INLINE_IMAGE = 10 * 1024 * 1024;
export type BodyImage = { src: string; name: string };
export const isImagePath = (path: string) =>
  /\.(png|jpe?g|gif|webp)$/i.test(path);

export function rasterMime(bytes: Uint8Array): string {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  const prefix = new TextDecoder().decode(bytes.slice(0, 12));
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a"))
    return "image/gif";
  if (prefix.startsWith("RIFF") && prefix.slice(8) === "WEBP")
    return "image/webp";
  throw new Error("请选择 PNG、JPEG、GIF 或 WebP 图片");
}
export function readBodyImage(file: File): Promise<BodyImage> {
  if (!file.size || file.size > MAX_INLINE_IMAGE)
    return Promise.reject(new Error("单张正文图片须为 1 字节至 10 MB"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取正文图片，请重新选择"));
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result as ArrayBuffer);
        const mime = rasterMime(bytes);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        resolve({
          src: `data:${mime};base64,${btoa(binary)}`,
          name: file.name || "正文图片",
        });
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
export function inlineImageBytes(
  html: string,
  images: BodyImage[] = [],
): number {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const sources = new Set(
    [...doc.querySelectorAll("img[src]")].map(
      (img) => img.getAttribute("src") || "",
    ),
  );
  images.forEach((image) => sources.add(image.src));
  let total = 0;
  for (const src of sources) {
    const encoded = src.match(/^data:image\/[\w.+-]+;base64,(.*)$/s)?.[1];
    if (encoded) total += atob(encoded).length;
  }
  if (total > 50 * 1024 * 1024)
    throw new Error("正文图片总大小超过 50 MB，请减少图片");
  return total;
}
