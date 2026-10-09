import type { ComposeSignature, MailSignature } from "./types";
import { htmlToText, sanitizeComposeHtml, textToHtml } from "./compose-format";
export const emptySignature = (): MailSignature => ({
  enabled: false,
  useHtml: false,
  text: "",
  fileName: "",
  fileText: "",
  fileHtml: "",
});
export function signatureContent(
  accountId: string,
  signature: MailSignature,
): ComposeSignature {
  const html = [
    signature.useHtml
      ? sanitizeComposeHtml(signature.text)
      : textToHtml(signature.text),
    signature.fileHtml || textToHtml(signature.fileText),
  ]
    .filter(Boolean)
    .join("\n");
  const body = [
    signature.useHtml ? htmlToText(signature.text) : signature.text,
    signature.fileText || htmlToText(signature.fileHtml),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    accountId,
    included:
      signature.enabled &&
      !!(body.trim() || htmlToText(html) || /<img\b/i.test(html)),
    body,
    html:
      signature.useHtml || signature.fileHtml ? sanitizeComposeHtml(html) : "",
  };
}
export async function importSignature(file: File) {
  if (file.size > 2 * 1024 * 1024) throw new Error("签名文件不能超过 2 MB");
  if (/\.(txt|html?|htm)$/i.test(file.name)) {
    const content = await file.text();
    const html = /\.html?$/i.test(file.name)
      ? sanitizeComposeHtml(content)
      : "";
    return {
      fileName: file.name,
      fileText: html ? htmlToText(html) : content,
      fileHtml: html,
    };
  }
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type))
    throw new Error("请选择文本、HTML、PNG、JPEG、GIF 或 WebP 文件");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取签名图片"));
    reader.readAsDataURL(file);
  });
  const image = document.createElement("img");
  image.src = data;
  image.alt = file.name;
  image.style.cssText = "max-width:480px;max-height:180px;height:auto";
  return {
    fileName: file.name,
    fileText: `[图片签名：${file.name}]`,
    fileHtml: image.outerHTML,
  };
}
