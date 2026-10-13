import { safeMailHtml } from "./mail-html";
import type { Detail } from "./types";

let activePrint: HTMLElement | null = null;

export function printableMail(detail: Detail, doc: Document = document) {
  const sheet = doc.createElement("main");
  sheet.id = "mail-print-root";
  sheet.setAttribute("aria-label", "待打印邮件");

  const header = doc.createElement("header");
  header.className = "mail-print-header";
  const subject = doc.createElement("h1");
  subject.textContent = detail.mail.subject || "（无主题）";
  header.append(subject);
  const date = new Date(detail.mail.date);
  for (const [label, value] of [
    ["发件人", detail.mail.sender],
    ["收件人", detail.mail.recipients],
    [
      "日期",
      Number.isNaN(date.getTime())
        ? detail.mail.date
        : date.toLocaleString("zh-CN"),
    ],
  ]) {
    if (!value?.trim()) continue;
    const row = doc.createElement("p");
    const name = doc.createElement("strong");
    name.textContent = `${label}：`;
    row.append(name, doc.createTextNode(value));
    header.append(row);
  }
  sheet.append(header);

  const body = doc.createElement("section");
  body.className = "mail-print-body";
  if (detail.html) {
    // Reuse the same sanitizer as the reader, then import only the body.
    // Mail-owned styles stay out of the app document and print controls.
    const safe = new DOMParser().parseFromString(
      safeMailHtml(detail.html),
      "text/html",
    );
    for (const style of safe.body.querySelectorAll("style")) style.remove();
    for (const image of safe.body.querySelectorAll("img"))
      image.setAttribute("referrerpolicy", "no-referrer");
    for (const child of [...safe.body.childNodes])
      body.append(doc.importNode(child, true));
  } else {
    body.textContent = detail.mail.body;
    body.classList.add("plain");
  }
  sheet.append(body);

  if (detail.attachments.length) {
    const attachments = doc.createElement("section");
    attachments.className = "mail-print-attachments";
    const heading = doc.createElement("h2");
    heading.textContent = "附件";
    const list = doc.createElement("ul");
    for (const attachment of detail.attachments) {
      const item = doc.createElement("li");
      item.textContent = attachment.name;
      list.append(item);
    }
    attachments.append(heading, list);
    sheet.append(attachments);
  }
  return sheet;
}

export async function printMail(detail: Detail) {
  activePrint?.remove();
  const sheet = printableMail(detail);
  activePrint = sheet;
  document.body.append(sheet);
  const cleanup = () => {
    if (activePrint === sheet) activePrint = null;
    sheet.remove();
    window.removeEventListener("afterprint", cleanup);
    window.clearTimeout(timeout);
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  // Native macOS printing may not emit afterprint; the print sheet must not
  // become the target of a later unrelated print command.
  const timeout = window.setTimeout(cleanup, 120_000);
  try {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    // Tauri replaces window.print on macOS with its native webview print API.
    await (window.print() as unknown as Promise<void> | void);
  } catch (error) {
    cleanup();
    throw error;
  }
}
