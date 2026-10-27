import { dateLocale, t } from "./i18n";
import { safeMailHtml } from "./mail-html";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Detail } from "./types";

let activePrint: HTMLElement | null = null;
let printSequence = 0;

function printBody(sheet: HTMLElement) {
  return sheet.querySelector(".mail-print-body")?.shadowRoot;
}

async function printResourcesReady(
  sheet: HTMLElement,
  refreshStyles: () => void,
) {
  const body = printBody(sheet);
  if (!body) return;
  // The temporary sheet is laid out off screen so styles, background images
  // and fonts can load before the system takes its print snapshot.
  void sheet.offsetHeight;
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    };
    const check = () => {
      if (activePrint !== sheet) return finish();
      refreshStyles();
      void sheet.offsetHeight;
      if (
        [...body.querySelectorAll("img")].every((image) => image.complete) &&
        [
          ...body.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
        ].every((link) => link.sheet !== null) &&
        sheet.ownerDocument.fonts?.status !== "loading"
      )
        finish();
    };
    const timer = setTimeout(finish, 15_000);
    const poll = setInterval(check, 50);
    check();
  });
}

function printStyles(sheet: HTMLElement, root: ShadowRoot) {
  const fontStyle = sheet.ownerDocument.createElement("style");
  const fontFamilies = new Map<string, string>();
  const copiedFonts = new WeakSet<CSSRule>();
  const prefix = `anser-print-${++printSequence}`;
  const unquote = (value: string) =>
    value.trim().replace(/^(["'])(.*)\1$/, "$2");
  const rewrite = (rules: CSSRuleList) => {
    for (const rule of rules) {
      // Browsers do not register @font-face inside shadow trees. Register only
      // font rules in the outer document, with private family names so mail
      // fonts cannot replace the app's fonts. Removal of the sheet removes them.
      if (rule.type === CSSRule.FONT_FACE_RULE && !copiedFonts.has(rule)) {
        copiedFonts.add(rule);
        const font = rule as CSSFontFaceRule;
        const original = unquote(font.style.getPropertyValue("font-family"));
        if (!original) continue;
        let family = fontFamilies.get(original.toLowerCase());
        if (!family) {
          family = `${prefix}-${fontFamilies.size}`;
          fontFamilies.set(original.toLowerCase(), family);
        }
        if (!fontStyle.isConnected) sheet.append(fontStyle);
        const target = fontStyle.sheet!;
        const index = target.insertRule(font.cssText, target.cssRules.length);
        const copy = target.cssRules[index] as CSSFontFaceRule;
        copy.style.setProperty("font-family", `"${family}"`);
        const base = font.parentStyleSheet?.href;
        if (base)
          copy.style.setProperty(
            "src",
            copy.style
              .getPropertyValue("src")
              .replace(
                /url\(\s*["']?([^"')]+)["']?\s*\)/g,
                (_, url: string) => `url("${new URL(url.trim(), base).href}")`,
              ),
          );
      }
      if ("selectorText" in rule) {
        const style = rule as CSSStyleRule;
        // The imported <html> is the email root inside this shadow tree.
        // Leave quoted attribute values intact when adapting :root selectors.
        style.selectorText = style.selectorText.replace(
          /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|:root\b/g,
          (token) => (token === ":root" ? "html" : token),
        );
      }
      if ("cssRules" in rule) rewrite((rule as CSSGroupingRule).cssRules);
      if (rule.type === CSSRule.IMPORT_RULE) {
        const imported = (rule as CSSImportRule).styleSheet;
        if (imported) rewrite(imported.cssRules);
      }
    }
  };
  return () => {
    for (const node of root.querySelectorAll<
      HTMLStyleElement | HTMLLinkElement
    >("style,link")) {
      try {
        if (node.sheet) rewrite(node.sheet.cssRules);
      } catch {
        // Cross-origin sheets still render; their CSSOM may be unreadable.
      }
    }
    if (!fontFamilies.size) return;
    const view = sheet.ownerDocument.defaultView!;
    for (const element of root.querySelectorAll<HTMLElement>(
      "html,body,body *",
    )) {
      const original = view.getComputedStyle(element).fontFamily;
      const family = original.replace(
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,]+/g,
        (name) => fontFamilies.get(unquote(name).toLowerCase()) || name,
      );
      if (family !== original)
        element.style.setProperty("font-family", family, "important");
    }
  };
}

export function printableMail(detail: Detail, doc: Document = document) {
  const sheet = doc.createElement("main");
  sheet.id = "mail-print-root";
  sheet.setAttribute("inert", "");
  sheet.setAttribute("aria-label", t("Message to print"));

  const header = doc.createElement("header");
  header.className = "mail-print-header";
  const subject = doc.createElement("h1");
  subject.textContent = detail.mail.subject || t("(No subject)");
  header.append(subject);
  const date = new Date(detail.mail.date);
  for (const [label, value] of [
    [t("From"), detail.mail.sender],
    [t("Sender"), detail.mail.senderOnBehalfOf || ""],
    [t("To"), detail.mail.recipients],
    [
      t("Date"),
      Number.isNaN(date.getTime())
        ? detail.mail.date
        : date.toLocaleString(dateLocale()),
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
    // Preserve the entire sanitized document, including head styles and the
    // html/body attributes that those styles target. Shadow DOM isolates both
    // the mail's CSS and the app's resets, without an iframe's print page box.
    const safe = new DOMParser().parseFromString(
      safeMailHtml(detail.html, "anser-print", false, isTauri()),
      "text/html",
    );
    for (const image of safe.body.querySelectorAll("img"))
      image.setAttribute("referrerpolicy", "no-referrer");
    const isolated = body.attachShadow({ mode: "open" });
    const printStyle = doc.createElement("style");
    printStyle.textContent =
      ":host{all:initial;display:block;color-scheme:light}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}";
    isolated.append(printStyle, doc.importNode(safe.documentElement, true));
  } else {
    body.textContent = detail.mail.body;
    body.classList.add("plain");
  }
  sheet.append(body);

  if (detail.attachments.length) {
    const attachments = doc.createElement("section");
    attachments.className = "mail-print-attachments";
    const heading = doc.createElement("h2");
    heading.textContent = t("Attachments");
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
  const isolated = printBody(sheet);
  const refreshStyles = isolated ? printStyles(sheet, isolated) : () => {};
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
    await printResourcesReady(sheet, refreshStyles);
    if (activePrint !== sheet) return;
    if (isTauri()) await invoke("print_mail");
    else window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
}
