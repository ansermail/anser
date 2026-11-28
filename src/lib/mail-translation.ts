import { t } from "./i18n";
export interface TranslationConfig {
  baseUrl: string;
  model: string;
  targetLanguage: string;
  revision: string;
  hasApiKey: boolean;
}
export interface TranslationPart {
  id: string;
  text: string;
}
export const translationLanguages: Record<string, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
};
const typography = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "color",
  "text-align",
  "letter-spacing",
  "text-decoration",
  "direction",
] as const;
const ignored =
  "script,style,link,meta,img,picture,svg,math,video,audio,iframe,object,noscript,textarea,input,button,select,option,template";
const protectedCodeTags = /^(CODE|KBD|SAMP|VAR)$/;
const inlineWrapperTags =
  /^(A|SPAN|STRONG|B|EM|I|MARK|DEL|S|U|SMALL|SUB|SUP|FONT|ABBR|CITE|Q|TIME)$/;
const blockTags =
  /^(P|PRE|DIV|H[1-6]|LI|TD|TH|TABLE|TR|TBODY|THEAD|TFOOT|UL|OL|DL|DT|DD|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ADDRESS|FIGURE|FIGCAPTION)$/;
const placeholderTokenPattern = /\[\[((?:CODE|LINK|KEEP)\d*_\d+)\]\]/g;
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractPlaceholders(text: string): string[] {
  return [...text.matchAll(placeholderTokenPattern)].map((match) => match[0]);
}
function normalizePlaceholderVariants(
  text: string,
  expectedTokens: Iterable<string>,
) {
  let result = text;
  for (const token of expectedTokens) {
    const inner = token.slice(2, -2);
    const pattern = new RegExp(
      `(?:[\\[［【]\\s*[\\[［【])\\s*${escapeRegExp(inner)}\\s*(?:[\\]］】]\\s*[\\]］】])`,
      "gu",
    );
    result = result.replace(pattern, token);
  }
  return result;
}
function isUrlOrEmail(text: string) {
  const trimmed = text.trim();
  return (
    !!trimmed &&
    /^(?:(?:https?:\/\/|mailto:)\S+|www\.[^\s/]+\.\S+|[^\s@]+@[^\s@]+\.[^\s@]+)$/i.test(
      trimmed,
    )
  );
}
function isIdentifierLike(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (isUrlOrEmail(trimmed)) return true;
  if (/\s/.test(trimmed)) return false;
  if (
    /^(?:v?\d+(?:\.\d+)+(?:[-+._a-z0-9]*)?|0x[0-9a-f]+|[0-9a-f]{7,})$/i.test(
      trimmed,
    )
  )
    return true;
  if (
    /[/_=\\@]/.test(trimmed) ||
    trimmed.startsWith("--") ||
    trimmed.includes("::") ||
    (trimmed.match(/\./g)?.length ?? 0) >= 2
  )
    return true;
  return false;
}
function stripNonProseTokens(text: string) {
  return text
    .replace(placeholderTokenPattern, " ")
    .replace(/\b(?:https?:\/\/|mailto:|www\.)\S+/gi, " ")
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, " ");
}
function hasForeignPhraseRun(text: string) {
  return /\p{L}{2,}(?:[\s,/-]+\p{L}{2,}){2,}/u.test(text);
}
function translatable(text: string, target: string) {
  const withoutPlaceholders = text.replace(placeholderTokenPattern, " ");
  const trimmed = withoutPlaceholders.trim();
  if (!trimmed || isIdentifierLike(trimmed)) return false;
  const clean = stripNonProseTokens(text);
  if (!/\p{L}/u.test(clean)) return false;
  if (target.startsWith("zh")) {
    const han = clean.match(/\p{Script=Han}/gu)?.length ?? 0;
    const withoutHan = clean.replace(/\p{Script=Han}/gu, "|");
    const otherLetters = withoutHan.match(/\p{L}/gu)?.length ?? 0;
    if (otherLetters === 0) return false;
    if (han > 0 && otherLetters < han * 2 && !hasForeignPhraseRun(withoutHan))
      return false;
    return true;
  }
  if (target === "ja") {
    const kana =
      clean.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
    if (kana > 0) {
      const han = clean.match(/\p{Script=Han}/gu)?.length ?? 0;
      const withoutJa = clean.replace(
        /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu,
        "|",
      );
      const otherLetters = withoutJa.match(/\p{L}/gu)?.length ?? 0;
      if (otherLetters === 0) return false;
      if (otherLetters < (kana + han) * 2 && !hasForeignPhraseRun(withoutJa))
        return false;
    }
    return true;
  }
  return true;
}
function chunks(text: string): string[] {
  const values: string[] = [];
  let rest = text;
  while (rest.length > 1200) {
    let cut = rest.lastIndexOf(" ", 1200);
    if (cut < 600) cut = 1200;
    for (const match of rest.matchAll(placeholderTokenPattern)) {
      const tokenStart = match.index;
      const tokenEnd = tokenStart + match[0].length;
      if (tokenStart < cut && cut < tokenEnd) {
        cut = tokenStart > 0 ? tokenStart : tokenEnd;
        break;
      }
    }
    if (cut > 0 && /[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    values.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) values.push(rest);
  return values;
}

export function subjectTranslationParts(subject: string, target: string) {
  return translatable(subject, target)
    ? chunks(subject.trim()).map((text, index) => ({
        id: `subject${index}`,
        text,
      }))
    : [];
}
function paragraphKey(id: string) {
  const match = /^(p[0-9]+)_t[0-9]+$/.exec(id);
  return match ? `paragraph:${match[1]}` : `part:${id}`;
}
/** Empty inline pieces are valid after word reordering; empty paragraphs are not. */
export function validateTranslationReply(
  requested: TranslationPart[],
  translated: TranslationPart[],
) {
  if (!Array.isArray(translated) || translated.length !== requested.length)
    throw new Error(t("The model did not return all text segments. Retry."));
  const ids = new Set(requested.map((p) => p.id));
  const seen = new Set<string>();
  const nonempty = new Set<string>();
  const translatedById = new Map<string, string>();
  for (const part of translated) {
    if (typeof part?.id !== "string" || !ids.has(part.id))
      throw new Error(t("The model returned an unknown segment ID. Retry."));
    if (seen.has(part.id))
      throw new Error(t("The model returned duplicate segments. Retry."));
    if (
      typeof part.text !== "string" ||
      part.text.includes("\0") ||
      new TextEncoder().encode(part.text).length > 24_000
    )
      throw new Error(
        t("The translation is too long or contains invalid characters. Retry."),
      );
    seen.add(part.id);
    translatedById.set(part.id, part.text);
    if (part.text.trim()) nonempty.add(paragraphKey(part.id));
  }
  if (requested.some((part) => !nonempty.has(paragraphKey(part.id))))
    throw new Error(t("The model returned an empty paragraph. Retry."));
  const expectedByParagraph = new Map<string, Map<string, number>>();
  for (const part of requested) {
    const tokens = extractPlaceholders(part.text);
    if (!tokens.length) continue;
    const key = paragraphKey(part.id);
    let counts = expectedByParagraph.get(key);
    if (!counts) {
      counts = new Map<string, number>();
      expectedByParagraph.set(key, counts);
    }
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const [key, expected] of expectedByParagraph) {
    const actual = new Map<string, number>();
    for (const part of requested) {
      if (paragraphKey(part.id) !== key) continue;
      const normalized = normalizePlaceholderVariants(
        translatedById.get(part.id) ?? "",
        expected.keys(),
      );
      for (const token of extractPlaceholders(normalized)) {
        if (expected.has(token))
          actual.set(token, (actual.get(token) ?? 0) + 1);
      }
    }
    for (const [token, count] of expected) {
      if ((actual.get(token) ?? 0) !== count)
        throw new Error(
          t(
            "The model did not preserve inline code or link placeholders. Retry.",
          ),
        );
    }
  }
}
export function translationBatches(parts: TranslationPart[]) {
  const groups: TranslationPart[][] = [];
  for (const part of parts) {
    const last = groups.at(-1);
    if (last && paragraphKey(last[0].id) === paragraphKey(part.id))
      last.push(part);
    else groups.push([part]);
  }
  const batches: TranslationPart[][] = [];
  let batch: TranslationPart[] = [];
  let size = 0;
  const flush = () => {
    if (batch.length) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
  };
  for (const group of groups) {
    const groupSize = group.reduce((n, p) => n + p.text.length, 0);
    if (group.length <= 64 && groupSize <= 6000) {
      if (batch.length + group.length > 64 || size + groupSize > 6000) flush();
      batch.push(...group);
      size += groupSize;
    } else {
      // A single oversized paragraph still obeys both hard request limits.
      flush();
      for (const part of group) {
        if (batch.length >= 64 || size + part.text.length > 6000) flush();
        batch.push(part);
        size += part.text.length;
      }
      flush();
    }
  }
  flush();
  return batches;
}

/** Operates only on the sanitized, scripts-disabled reader DOM. All model text
 * is assigned to Text nodes; original HTML/MIME never passes to the model. */
export function planMailTranslation(
  doc: Document,
  target: string,
  root: HTMLElement = doc.body,
) {
  const elements = [...root.querySelectorAll("*")];
  if (elements.length > 40_000)
    throw new Error(
      t("Message structure is too complex. No body text was sent."),
    );
  type Anchor =
    | { kind: "text"; node: Text; offset: number }
    | { kind: "element"; node: Element };
  type TokenKind = "CODE" | "LINK" | "KEEP";
  const parts: TranslationPart[] = [];
  const groups: {
    parent: HTMLElement;
    end: Anchor;
    fragment: DocumentFragment;
    bindings: { part: TranslationPart; node: Text }[];
    placeholders: Map<string, HTMLElement>;
    view?: HTMLElement;
  }[] = [];
  const previousStyles = new Map<HTMLElement, string | null>();
  const undoSplits: (() => void)[] = [];
  const textPieces = new Map<Text, Text[]>();
  const styles = new Map<Element, CSSStyleDeclaration | undefined>();
  const styleOf = (node: Element) => {
    if (!styles.has(node))
      styles.set(node, doc.defaultView?.getComputedStyle(node));
    return styles.get(node);
  };
  // Pasted rich text often repeats the surrounding background on every link
  // and nested span. That is not a button surface. Plain inline/atomic links
  // and underline borders must remain part of their original horizontal run.
  const transparent = (color: string) =>
    !color || color === "transparent" || /^rgba\([^)]*,\s*0\s*\)$/.test(color);
  const distinctBackground = (element: Element, color: string) => {
    if (transparent(color)) return false;
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const background = styleOf(parent)?.backgroundColor || "";
      if (!transparent(background)) {
        // Repeated translucent paint still changes the surface by compositing.
        return (
          color !== background || /^rgba\([^)]*,\s*0?\.\d+\s*\)$/.test(color)
        );
      }
    }
    return true;
  };
  // Only actual button boxes create a separate group; translations stay
  // inside that one click target. Display:inline-block alone is not evidence.
  const decorated = (element: Element) => {
    const style = styleOf(element);
    return !!(
      style &&
      ((distinctBackground(element, style.backgroundColor) &&
        (/^(inline-block|inline-flex|inline-grid|inline-table|block|flex|grid)$/.test(
          style.display,
        ) ||
          ["top", "right", "bottom", "left"].some(
            (side) =>
              Number.parseFloat(style.getPropertyValue(`padding-${side}`)) > 0,
          ))) ||
        ["Top", "Right", "Bottom", "Left"].filter(
          (side) =>
            Number.parseFloat(
              style.getPropertyValue(`border-${side.toLowerCase()}-width`),
            ) > 0 &&
            !/^(none|hidden)$/.test(
              style.getPropertyValue(`border-${side.toLowerCase()}-style`),
            ),
        ).length >= 2)
    );
  };
  const actionLinks = new Map<Element, boolean>();
  const actionLink = (node: Element) => {
    if (!node.matches("a[data-mail-href],a[href]")) return false;
    if (actionLinks.has(node)) return actionLinks.get(node)!;
    const result =
      node.getAttribute("role") === "button" ||
      decorated(node) ||
      [...node.querySelectorAll("span,b,strong,em,i,font")].some(decorated);
    actionLinks.set(node, result);
    return result;
  };
  const clips = (value: string) => /^(hidden|clip)$/.test(value);
  const overflow = (style: CSSStyleDeclaration, axis: "x" | "y") => {
    const values = style.overflow.trim().split(/\s+/);
    return values[0]
      ? axis === "y"
        ? values[1] || values[0]
        : values[0]
      : axis === "x"
        ? style.overflowX
        : style.overflowY;
  };
  const visibility = new Map<Element, boolean>();
  const visible = (node: Element): boolean => {
    if (visibility.has(node)) return visibility.get(node)!;
    const parent = node.parentElement;
    const style = styleOf(node);
    const closed =
      parent?.tagName === "DETAILS" && !parent.hasAttribute("open");
    const firstSummary = closed
      ? [...parent.children].find((child) => child.tagName === "SUMMARY")
      : null;
    const zero = (value: string) =>
      value !== "" && Number.parseFloat(value) === 0;
    const shown = !(
      node.matches(ignored) ||
      node.hasAttribute("hidden") ||
      node.getAttribute("aria-hidden") === "true" ||
      (closed && node !== firstSummary) ||
      (parent && !visible(parent)) ||
      (style &&
        (style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.opacity === "0" ||
          style.contentVisibility === "hidden" ||
          (style.clipPath && style.clipPath !== "none") ||
          (style.clip && style.clip !== "auto") ||
          (/^(hidden|clip|auto|scroll)$/.test(overflow(style, "y")) &&
            (zero(style.height) || zero(style.maxHeight))) ||
          (/^(hidden|clip|auto|scroll)$/.test(overflow(style, "x")) &&
            (zero(style.width) || zero(style.maxWidth)))))
    );
    visibility.set(node, shown);
    return shown;
  };
  const visibleText = (node: Text) => {
    const parent = node.parentElement;
    if (
      !parent ||
      !visible(parent) ||
      (parent.tagName === "DETAILS" && !parent.hasAttribute("open"))
    )
      return false;
    const range = doc.createRange();
    range.selectNodeContents(node);
    // 无布局的单元测试使用上方样式判断；实际阅读器还核对每段文字是否被祖先裁剪。
    if (typeof range.getClientRects !== "function") return true;
    const rects = [...range.getClientRects()].filter(
      (r) => r.width > 0 && r.height > 0,
    );
    if (!rects.length) return false;
    for (
      let ancestor: Element | null = parent;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      const style = styleOf(ancestor);
      if (!style) continue;
      const x = clips(overflow(style, "x"));
      const y = clips(overflow(style, "y"));
      if (!x && !y) continue;
      const box = ancestor.getBoundingClientRect();
      const left = box.left + ancestor.clientLeft;
      const top = box.top + ancestor.clientTop;
      if (
        rects.some(
          (r) =>
            (x &&
              (r.left < left - 0.5 ||
                r.right > left + ancestor.clientWidth + 0.5)) ||
            (y &&
              (r.top < top - 0.5 ||
                r.bottom > top + ancestor.clientHeight + 0.5)),
        )
      )
        return false;
    }
    return true;
  };
  function insertTranslation(
    parent: HTMLElement,
    end: Anchor,
    view: HTMLElement,
  ) {
    let before: Node | null;
    let container: HTMLElement;
    if (end.kind === "text") {
      const pieces = textPieces.get(end.node) || [end.node];
      textPieces.set(end.node, pieces);
      let offset = end.offset;
      let index = 0;
      while (index < pieces.length - 1 && offset > pieces[index].length)
        offset -= pieces[index++].length;
      const text = pieces[index];
      container = text.parentElement!;
      if (offset === text.length) before = text.nextSibling;
      else {
        const tail = text.splitText(offset);
        pieces.splice(index + 1, 0, tail);
        undoSplits.push(() => {
          text.appendData(tail.data);
          tail.remove();
        });
        before = tail;
      }
    } else {
      container = end.node.parentElement!;
      before = end.node.nextSibling;
    }
    // 把插入点提升至原段落容器，避免译文链接嵌套在原链接内；隐藏时还原原节点。
    while (container !== parent) {
      const outer = container.parentElement!;
      if (before) {
        const original = container;
        const tail = container.cloneNode(false) as HTMLElement;
        tail.removeAttribute("id");
        tail.removeAttribute("name");
        copyTypography(container, tail);
        while (before) {
          const next: Node | null = before.nextSibling;
          tail.append(before);
          before = next;
        }
        outer.insertBefore(tail, container.nextSibling);
        undoSplits.push(() => {
          original.append(...tail.childNodes);
          tail.remove();
        });
        before = tail;
      } else before = container.nextSibling;
      container = outer;
    }
    parent.insertBefore(view, before);
  }
  const block = (node: Element) =>
    actionLink(node) ||
    (decorated(node) &&
      !!node.parentElement?.closest("a[data-mail-href],a[href]")) ||
    blockTags.test(node.tagName) ||
    /^(block|list-item|table|flex|grid)/.test(
      doc.defaultView?.getComputedStyle(node).display || "",
    );
  const containers = new Set<Element>();
  for (const node of elements)
    if (block(node)) {
      for (
        let parent = node.parentElement;
        parent && !containers.has(parent);
        parent = parent.parentElement
      )
        containers.add(parent);
    }
  const hasBlock = (node: Element) => containers.has(node);
  const copyTypography = (source: Element, clone: HTMLElement) => {
    const style = doc.defaultView?.getComputedStyle(source);
    if (style)
      for (const key of typography)
        clone.style.setProperty(key, style.getPropertyValue(key));
  };
  const visibleDescendantText = (element: Element): string => {
    let text = "";
    const walk = (node: Node, depth = 0) => {
      if (depth > 80) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (visibleText(node as Text)) text += node.textContent || "";
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        visible(node as Element)
      ) {
        for (const child of node.childNodes) walk(child, depth + 1);
      }
    };
    walk(element);
    return text;
  };
  const wrapsOnlyProtectedCode = (element: Element): boolean => {
    let hasCode = false;
    let hasProseOutsideCode = false;
    const walk = (node: Node, insideCode: boolean, depth = 0) => {
      if (depth > 80 || hasProseOutsideCode) return;
      if (node.nodeType === Node.TEXT_NODE) {
        if (!visibleText(node as Text)) return;
        if ((node.textContent || "").trim()) {
          if (insideCode) hasCode = true;
          else hasProseOutsideCode = true;
        }
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        visible(node as Element)
      ) {
        const el = node as Element;
        const nextInside = insideCode || protectedCodeTags.test(el.tagName);
        for (const child of el.childNodes) walk(child, nextInside, depth + 1);
      }
    };
    walk(element, false);
    return hasCode && !hasProseOutsideCode;
  };
  const protectedInlineKind = (node: Element): TokenKind | null => {
    if (node === root || block(node) || hasBlock(node)) return null;
    if (protectedCodeTags.test(node.tagName))
      return visibleDescendantText(node).trim() ? "CODE" : null;
    if (
      inlineWrapperTags.test(node.tagName) &&
      !actionLink(node) &&
      !node.querySelector("br")
    ) {
      if (wrapsOnlyProtectedCode(node)) return "CODE";
      if (node.matches("a[data-mail-href],a[href]")) {
        const text = visibleDescendantText(node);
        if (isUrlOrEmail(text)) return "LINK";
      }
    }
    if (
      node.getAttribute("translate")?.toLowerCase() === "no" &&
      !node.querySelector("br") &&
      visibleDescendantText(node).trim()
    )
      return "KEEP";
    return null;
  };
  const cloneProtected = (
    source: HTMLElement,
    stripAnchors: boolean,
    insideAction: boolean,
  ): HTMLElement => {
    const cloneTree = (node: Node, isRoot: boolean): Node | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        return visibleText(node as Text)
          ? doc.createTextNode(node.textContent || "")
          : null;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || !visible(node as Element))
        return null;
      const el = node as HTMLElement;
      const replaceWithSpan =
        (stripAnchors && el.tagName === "A") ||
        (insideAction && el.tagName === "A");
      const cloned = replaceWithSpan
        ? doc.createElement("span")
        : (el.cloneNode(false) as HTMLElement);
      cloned.removeAttribute("id");
      cloned.removeAttribute("name");
      if (isRoot || replaceWithSpan) copyTypography(el, cloned);
      if (insideAction) cloned.style.setProperty("line-height", "inherit");
      for (const child of el.childNodes) {
        const copied = cloneTree(child, false);
        if (copied) cloned.append(copied);
      }
      return cloned;
    };
    return cloneTree(source, true) as HTMLElement;
  };
  function collect(parent: HTMLElement, nodes: Node[]) {
    if (!nodes.length) return;
    const link = parent.closest("a[data-mail-href],a[href]");
    const insideAction = !!link && actionLink(link);
    type Leaf =
      | { kind: "text"; node: Text; start: number; end: number }
      | { kind: "br"; node: HTMLElement; start: number; end: number }
      | {
          kind: "protected";
          node: HTMLElement;
          tokenKind: TokenKind;
          start: number;
          end: number;
        };
    const leaves: Leaf[] = [];
    let flat = "";
    function scan(node: Node, depth = 0) {
      if (depth > 120)
        throw new Error(
          t("Message nesting is too deep. No body text was sent."),
        );
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        if (!visibleText(text)) return;
        const source = text.parentElement!;
        const whitespace =
          styleOf(source)?.whiteSpace ||
          (source.closest("pre") ? "pre-wrap" : "normal");
        const start = flat.length;
        // 普通 HTML 源码换行只是空白；只有保留换行的正文和 BR 才能形成段落边界。
        flat += /^(pre|pre-wrap|pre-line|break-spaces)$/.test(whitespace)
          ? text.data
          : text.data.replace(/[\r\n]/g, " ");
        leaves.push({ kind: "text", node: text, start, end: flat.length });
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        visible(node as Element)
      ) {
        const element = node as HTMLElement;
        if (element.tagName === "BR") {
          leaves.push({
            kind: "br",
            node: element,
            start: flat.length,
            end: flat.length + 1,
          });
          flat += "\n";
        } else {
          const tokenKind = protectedInlineKind(element);
          if (tokenKind) {
            leaves.push({
              kind: "protected",
              node: element,
              tokenKind,
              start: flat.length,
              end: flat.length + 1,
            });
            flat += "\uFFFC";
          } else {
            for (const child of [...element.childNodes]) scan(child, depth + 1);
          }
        }
      }
    }
    for (const node of nodes) scan(node);
    if (flat.length > 120_000)
      throw new Error(t("Message text is too long. No body text was sent."));
    const spans: [number, number][] = [];
    let start = 0;
    for (const match of flat.matchAll(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/g)) {
      spans.push([start, match.index]);
      start = match.index + match[0].length;
    }
    spans.push([start, flat.length]);
    for (const [start, end] of spans) {
      const selectedText = new Map<Text, string>();
      const selectedBr = new Set<Node>();
      const selectedProtected = new Map<HTMLElement, TokenKind>();
      const ancestors = new Set<Node>();
      let anchor: Anchor | undefined;
      let spanPlainText = "";
      for (const leaf of leaves) {
        const from = Math.max(start, leaf.start) - leaf.start;
        const to = Math.min(end, leaf.end) - leaf.start;
        if (to <= from) continue;
        if (leaf.kind === "text") {
          const slice = leaf.node.textContent!.slice(from, to);
          selectedText.set(leaf.node, slice);
          spanPlainText += slice;
          anchor = { kind: "text", node: leaf.node, offset: to };
        } else if (leaf.kind === "br") {
          selectedBr.add(leaf.node);
        } else {
          selectedProtected.set(leaf.node, leaf.tokenKind);
          anchor = { kind: "element", node: leaf.node };
        }
        for (
          let p = leaf.node.parentNode;
          p && p !== parent && !ancestors.has(p);
          p = p.parentNode
        )
          ancestors.add(p);
      }
      if (!anchor) continue;
      let tokenSalt = "";
      if (selectedProtected.size > 0) {
        let attempt = 1;
        while (
          spanPlainText.includes(`[[CODE${tokenSalt}_`) ||
          spanPlainText.includes(`[[LINK${tokenSalt}_`) ||
          spanPlainText.includes(`[[KEEP${tokenSalt}_`)
        ) {
          attempt += 1;
          tokenSalt = String(attempt);
        }
      }
      const bindings: { part: TranslationPart; node: Text }[] = [];
      const placeholders = new Map<string, HTMLElement>();
      let nextPlaceholder = 0;
      const paragraph = groups.length;
      type RunItem =
        | { kind: "text"; text: string }
        | { kind: "protected"; element: HTMLElement; tokenKind: TokenKind };
      const appendRun = (targetFragment: DocumentFragment, run: RunItem[]) => {
        if (!run.length) return;
        const runTokens: string[] = [];
        let combined = "";
        for (const item of run) {
          if (item.kind === "text") {
            combined += item.text;
          } else {
            const token = `[[${item.tokenKind}${tokenSalt}_${nextPlaceholder++}]]`;
            runTokens.push(token);
            placeholders.set(
              token,
              cloneProtected(item.element, false, insideAction),
            );
            combined += token;
          }
        }
        if (!translatable(combined, target)) {
          for (const token of runTokens) placeholders.delete(token);
          for (const item of run) {
            if (item.kind === "text")
              targetFragment.append(doc.createTextNode(item.text));
            else
              targetFragment.append(
                cloneProtected(item.element, false, insideAction),
              );
          }
          return;
        }
        for (const textPart of chunks(combined)) {
          if (!textPart.trim()) {
            targetFragment.append(doc.createTextNode(textPart));
            continue;
          }
          const part = {
            id: `p${paragraph}_t${bindings.length}`,
            text: textPart,
          };
          const translated = doc.createTextNode("");
          bindings.push({ part, node: translated });
          targetFragment.append(translated);
        }
      };
      const cloneChildren = (children: Node[]): DocumentFragment => {
        const out = doc.createDocumentFragment();
        let run: RunItem[] = [];
        const flushRun = () => {
          if (run.length) {
            appendRun(out, run);
            run = [];
          }
        };
        for (const child of children) {
          if (child.nodeType === Node.TEXT_NODE) {
            const text = selectedText.get(child as Text);
            if (text !== undefined) run.push({ kind: "text", text });
            continue;
          }
          if (child.nodeType === Node.ELEMENT_NODE) {
            const tokenKind = selectedProtected.get(child as HTMLElement);
            if (tokenKind) {
              run.push({
                kind: "protected",
                element: child as HTMLElement,
                tokenKind,
              });
              continue;
            }
          }
          if (!ancestors.has(child) && !selectedBr.has(child)) continue;
          flushRun();
          const source = child as HTMLElement;
          // 按钮标签仅复制文字排版；底色、边框、内边距继续由原按钮承载。
          const element =
            insideAction && source.tagName !== "BR"
              ? doc.createElement("span")
              : (source.cloneNode(false) as HTMLElement);
          element.removeAttribute("id");
          element.removeAttribute("name");
          copyTypography(source, element);
          // A button may use a large line-height to center its original label.
          // That value must not become the translated label's line spacing.
          if (insideAction) element.style.setProperty("line-height", "inherit");
          element.append(cloneChildren([...source.childNodes]));
          out.append(element);
        }
        flushRun();
        return out;
      };
      const fragment = cloneChildren(nodes);
      if (bindings.length) {
        parts.push(...bindings.map((b) => b.part));
        groups.push({ parent, end: anchor, fragment, bindings, placeholders });
      }
    }
  }
  function visit(parent: HTMLElement, depth = 0) {
    if (depth > 120)
      throw new Error(t("Message nesting is too deep. No body text was sent."));
    if (!visible(parent) || protectedCodeTags.test(parent.tagName)) return;
    let run: Node[] = [];
    for (const node of [...parent.childNodes]) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (block(node as Element) || hasBlock(node as Element))
      ) {
        collect(parent, run);
        run = [];
        visit(node as HTMLElement, depth + 1);
      } else run.push(node);
    }
    collect(parent, run);
  }
  visit(root);
  if (
    parts.length > 2000 ||
    parts.reduce((n, p) => n + p.text.length, 0) > 120_000
  )
    throw new Error(
      t(
        "Message text is too long. Try a shorter message. No body text was sent.",
      ),
    );
  const unwrapNestedAnchors = (rootEl: HTMLElement): HTMLElement => {
    const walk = (node: Node): Node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return node.cloneNode(true);
      const el = node as HTMLElement;
      const cloned =
        el.tagName === "A"
          ? doc.createElement("span")
          : (el.cloneNode(false) as HTMLElement);
      if (el.tagName === "A") copyTypography(el, cloned);
      for (const child of el.childNodes) cloned.append(walk(child));
      return cloned;
    };
    return walk(rootEl) as HTMLElement;
  };
  return {
    parts,
    apply(values: Map<string, string>) {
      for (const group of groups) {
        if (
          group.view ||
          !group.bindings.every((b) => values.has(b.part.id)) ||
          !group.end.node.isConnected
        )
          continue;
        if (group.placeholders.size === 0) {
          for (const { part, node } of group.bindings)
            node.textContent = values.get(part.id)!;
        } else {
          const expectedTokens = [...group.placeholders.keys()];
          const tokenRegex = new RegExp(
            expectedTokens.map(escapeRegExp).join("|"),
            "g",
          );
          const placed = new Set<string>();
          for (const { part, node } of group.bindings) {
            const raw = normalizePlaceholderVariants(
              values.get(part.id)!,
              expectedTokens,
            );
            const insideAnchor = !!node.parentElement?.closest(
              "a[data-mail-href],a[href]",
            );
            const out = doc.createDocumentFragment();
            let lastIndex = 0;
            for (const match of raw.matchAll(tokenRegex)) {
              const token = match[0];
              if (match.index > lastIndex)
                out.append(
                  doc.createTextNode(raw.slice(lastIndex, match.index)),
                );
              if (!placed.has(token)) {
                placed.add(token);
                const template = group.placeholders.get(token)!;
                out.append(
                  insideAnchor
                    ? unwrapNestedAnchors(template)
                    : (template.cloneNode(true) as HTMLElement),
                );
              }
              lastIndex = match.index + token.length;
            }
            if (lastIndex < raw.length)
              out.append(doc.createTextNode(raw.slice(lastIndex)));
            node.replaceWith(out);
          }
        }
        const view = doc.createElement("span");
        view.dataset.anserTranslation = "";
        view.lang = target;
        view.setAttribute(
          "aria-label",
          t("Translation in {value0}", {
            value0: translationLanguages[target] || target,
          }),
        );
        copyTypography(group.parent, view);
        view.style.setProperty("display", "block", "important");
        const whitespace =
          styleOf(group.parent)?.whiteSpace ||
          (group.parent.closest("pre") ? "pre-wrap" : "normal");
        // HTML source indentation is not visible whitespace. Preserve authored
        // PRE/BR formatting, without exposing pretty-printed source as gaps.
        view.style.setProperty("white-space", whitespace);
        view.style.setProperty("margin-top", "0.3em");
        view.style.setProperty("margin-bottom", "0.7em");
        view.style.setProperty("overflow-wrap", "break-word");
        const action = group.parent.closest("a[data-mail-href],a[href]");
        if (!action || !actionLink(action)) {
          const cellStyle = /^(TD|TH)$/.test(group.parent.tagName)
            ? styleOf(group.parent)
            : null;
          const tightCell =
            !!cellStyle &&
            parseFloat(cellStyle.paddingLeft || "0") === 0 &&
            parseFloat(cellStyle.paddingRight || "0") === 0;
          view.style.setProperty(
            "background-color",
            "color-mix(in srgb, currentColor 5.5%, transparent)",
          );
          view.style.setProperty("border-radius", "6px");
          view.style.setProperty("box-sizing", "border-box");
          // Keep the tinted block inside its host box without negative inline
          // margins so flush headings/paragraphs never get clipped at the
          // iframe edge (which stripped left padding and rounded corners).
          view.style.setProperty(
            "padding",
            tightCell ? "0.25em 0.55em" : "0.3em 0.65em",
          );
        }
        if (action && actionLink(action)) {
          view.style.setProperty("white-space", "normal");
          view.style.setProperty("line-height", "1.35");
          view.style.setProperty("text-indent", "0");
          view.style.setProperty("padding", "0");
          view.style.setProperty("margin-top", "0.2em");
          view.style.setProperty("margin-bottom", "0");
          view.style.setProperty("min-width", "0");
          view.style.setProperty("max-width", "100%");
          const actionStyle = styleOf(action);
          if (
            group.parent === action &&
            /^(inline-)?flex$/.test(actionStyle?.display || "")
          ) {
            if (!previousStyles.has(action as HTMLElement))
              previousStyles.set(
                action as HTMLElement,
                action.getAttribute("style"),
              );
            (action as HTMLElement).style.setProperty(
              "flex-wrap",
              "wrap",
              "important",
            );
            view.style.setProperty("flex-basis", "100%");
          } else if (/^(inline-)?grid$/.test(actionStyle?.display || "")) {
            view.style.setProperty("grid-column", "1 / -1");
          }
        }
        view.append(group.fragment);
        // 仅扩展没有裁剪约束的容器；绝不解除原邮件的 overflow/clip 隐藏边界。
        const hosts: HTMLElement[] = [group.parent];
        if (action && actionLink(action)) {
          for (
            let host = group.parent;
            host !== action && host.parentElement;
          ) {
            host = host.parentElement;
            hosts.push(host);
          }
        }
        for (const host of hosts) {
          const style = styleOf(host);
          if (
            !style ||
            [style.overflow, style.overflowX, style.overflowY].every(
              (v) => !v || v === "visible",
            )
          ) {
            if (!previousStyles.has(host))
              previousStyles.set(host, host.getAttribute("style"));
            host.style.setProperty("height", "auto", "important");
            host.style.setProperty("max-height", "none", "important");
          }
        }
        insertTranslation(group.parent, group.end, view);
        group.view = view;
      }
    },
    dispose() {
      for (const group of groups) {
        group.view?.remove();
        group.view = undefined;
      }
      for (const undo of undoSplits.reverse()) undo();
      undoSplits.length = 0;
      textPieces.clear();
      for (const [node, style] of previousStyles) {
        // WebKit 会延迟同步 CSSOM 的 style 属性；先清空声明再移除，
        // 避免原本没有 style 的节点在序列化时残留 style=""。
        node.style.cssText = "";
        node.getAttribute("style");
        if (style === null) node.removeAttribute("style");
        else node.setAttribute("style", style);
      }
      previousStyles.clear();
    },
  };
}
export function plainMailHtml(text: string) {
  const doc = document.implementation.createHTMLDocument("");
  for (const paragraph of text.split(/\n\s*\n/)) {
    const p = doc.createElement("p");
    p.style.whiteSpace = "pre-wrap";
    p.textContent = paragraph;
    doc.body.append(p);
  }
  return doc.body.innerHTML;
}

export interface TranslationModel {
  id: string;
  name: string;
}
export function translationProvider(address: string) {
  try {
    const url = new URL(address);
    if (url.hostname === "api.deepseek.com") return "deepseek";
    if (url.hostname === "api.openai.com") return "openai";
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      return "local";
  } catch {
    /* A draft URL may be incomplete. */
  }
  return "custom";
}
export const translationProviders: Record<
  string,
  { name: string; baseUrl: string; model: string }
> = {
  custom: { name: "OpenAI compatible (custom)", baseUrl: "", model: "" },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
  },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "" },
  local: {
    name: "Local model",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "",
  },
};
