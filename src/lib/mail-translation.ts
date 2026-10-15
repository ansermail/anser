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
  "script,style,link,meta,img,picture,svg,math,video,audio,iframe,object,code,kbd,samp,noscript,textarea,input,button,select";
const blockTags =
  /^(P|PRE|DIV|H[1-6]|LI|TD|TH|TABLE|TR|TBODY|THEAD|TFOOT|UL|OL|DL|DT|DD|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER|MAIN|ADDRESS|FIGURE|FIGCAPTION)$/;
function translatable(text: string, target: string) {
  if (!text.trim() || /^\s*(?:https?:\/\/\S+|[^\s@]+@[^\s@]+)\s*$/i.test(text))
    return false;
  return /\p{L}/u.test(
    target.startsWith("zh") ? text.replace(/\p{Script=Han}/gu, "") : text,
  );
}
function chunks(text: string): string[] {
  const values: string[] = [];
  let rest = text;
  while (rest.length > 1200) {
    let cut = rest.lastIndexOf(" ", 1200);
    if (cut < 600) cut = 1200;
    if (/[\uD800-\uDBFF]/.test(rest[cut - 1])) cut--;
    values.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) values.push(rest);
  return values;
}
export function translationBatches(parts: TranslationPart[]) {
  const batches: TranslationPart[][] = [];
  let batch: TranslationPart[] = [];
  let size = 0;
  for (const part of parts) {
    if (batch.length >= 64 || size + part.text.length > 6000) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(part);
    size += part.text.length;
  }
  if (batch.length) batches.push(batch);
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
  if (elements.length > 40_000) throw new Error("邮件结构过于复杂，未发送正文");
  const parts: TranslationPart[] = [];
  const groups: {
    parent: HTMLElement;
    end: { node: Text; offset: number };
    fragment: DocumentFragment;
    bindings: { part: TranslationPart; node: Text }[];
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
  // 邮件按钮通常是带底色/边框的链接。将整个链接作为分段边界，
  // 译文留在同一个点击区域，不能克隆出第二个按钮。
  const decorated = (element: Element) => {
    const style = styleOf(element);
    return !!(
      style &&
      (/^(inline-block|inline-flex|inline-grid|inline-table)$/.test(
        style.display,
      ) ||
        (style.backgroundColor &&
          !/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/.test(
            style.backgroundColor,
          )) ||
        ["Top", "Right", "Bottom", "Left"].some(
          (side) =>
            Number.parseFloat(
              style.getPropertyValue(`border-${side.toLowerCase()}-width`),
            ) > 0 &&
            !/^(none|hidden)$/.test(
              style.getPropertyValue(`border-${side.toLowerCase()}-style`),
            ),
        ))
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
    end: { node: Text; offset: number },
    view: HTMLElement,
  ) {
    const pieces = textPieces.get(end.node) || [end.node];
    textPieces.set(end.node, pieces);
    let offset = end.offset;
    let index = 0;
    while (index < pieces.length - 1 && offset > pieces[index].length)
      offset -= pieces[index++].length;
    const text = pieces[index];
    let before: Node | null;
    let container = text.parentElement!;
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
  function collect(parent: HTMLElement, nodes: Node[]) {
    if (!nodes.length) return;
    const link = parent.closest("a[data-mail-href],a[href]");
    const insideAction = !!link && actionLink(link);
    const leaves: { node: Text | HTMLElement; start: number; end: number }[] =
      [];
    let flat = "";
    function scan(node: Node, depth = 0) {
      if (depth > 120) throw new Error("邮件嵌套过深，未发送正文");
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
        leaves.push({ node: text, start, end: flat.length });
      } else if (
        node.nodeType === Node.ELEMENT_NODE &&
        visible(node as Element)
      ) {
        if ((node as Element).tagName === "BR") {
          leaves.push({
            node: node as HTMLElement,
            start: flat.length,
            end: flat.length + 1,
          });
          flat += "\n";
        } else for (const child of [...node.childNodes]) scan(child, depth + 1);
      }
    }
    for (const node of nodes) scan(node);
    if (flat.length > 120_000) throw new Error("邮件文字过长，未发送任何正文");
    const spans: [number, number][] = [];
    let start = 0;
    for (const match of flat.matchAll(/\r?\n[\t ]*\r?\n(?:[\t ]*\r?\n)*/g)) {
      spans.push([start, match.index]);
      start = match.index + match[0].length;
    }
    spans.push([start, flat.length]);
    for (const [start, end] of spans) {
      const selected = new Map<Node, string>();
      const ancestors = new Set<Node>();
      let anchor: { node: Text; offset: number } | undefined;
      for (const leaf of leaves) {
        const from = Math.max(start, leaf.start) - leaf.start;
        const to = Math.min(end, leaf.end) - leaf.start;
        if (to <= from) continue;
        selected.set(
          leaf.node,
          leaf.node.nodeType === Node.TEXT_NODE
            ? leaf.node.textContent!.slice(from, to)
            : "\n",
        );
        for (
          let p = leaf.node.parentNode;
          p && p !== parent && !ancestors.has(p);
          p = p.parentNode
        )
          ancestors.add(p);
        if (leaf.node.nodeType === Node.TEXT_NODE)
          anchor = { node: leaf.node as Text, offset: to };
      }
      if (!anchor) continue;
      const bindings: { part: TranslationPart; node: Text }[] = [];
      const paragraph = groups.length;
      const clone = (node: Node): Node | null => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = selected.get(node);
          if (text === undefined) return null;
          if (!translatable(text, target)) return doc.createTextNode(text);
          const fragment = doc.createDocumentFragment();
          for (const textPart of chunks(text)) {
            if (!textPart.trim()) {
              fragment.append(doc.createTextNode(textPart));
              continue;
            }
            const part = {
              id: `p${paragraph}_t${bindings.length}`,
              text: textPart,
            };
            const translated = doc.createTextNode("");
            bindings.push({ part, node: translated });
            fragment.append(translated);
          }
          return fragment;
        }
        if (!ancestors.has(node) && !selected.has(node)) return null;
        const source = node as HTMLElement;
        // 按钮标签仅复制文字排版；底色、边框、内边距继续由原按钮承载。
        const element =
          insideAction && source.tagName !== "BR"
            ? doc.createElement("span")
            : (source.cloneNode(false) as HTMLElement);
        element.removeAttribute("id");
        element.removeAttribute("name");
        copyTypography(source, element);
        for (const child of [...source.childNodes]) {
          const copied = clone(child);
          if (copied) element.append(copied);
        }
        return element;
      };
      const fragment = doc.createDocumentFragment();
      for (const node of nodes) {
        const copied = clone(node);
        if (copied) fragment.append(copied);
      }
      if (bindings.length) {
        parts.push(...bindings.map((b) => b.part));
        groups.push({ parent, end: anchor, fragment, bindings });
      }
    }
  }
  function visit(parent: HTMLElement, depth = 0) {
    if (depth > 120) throw new Error("邮件嵌套过深，未发送正文");
    if (!visible(parent)) return;
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
    throw new Error("邮件文字过长，请使用较短邮件进行翻译；未发送任何正文");
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
        for (const { part, node } of group.bindings)
          node.textContent = values.get(part.id)!;
        const view = doc.createElement("span");
        view.dataset.anserTranslation = "";
        view.lang = target;
        view.setAttribute(
          "aria-label",
          `${translationLanguages[target] || target}译文`,
        );
        copyTypography(group.parent, view);
        view.style.setProperty("display", "block", "important");
        view.style.setProperty("white-space", "pre-wrap");
        view.style.setProperty("margin-top", "0.35em");
        view.style.setProperty("margin-bottom", "0.5em");
        view.style.setProperty("overflow-wrap", "break-word");
        const action = group.parent.closest("a[data-mail-href],a[href]");
        if (action && actionLink(action)) {
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
  custom: { name: "OpenAI 兼容（自定义）", baseUrl: "", model: "" },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
  },
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "" },
  local: { name: "本机模型", baseUrl: "http://127.0.0.1:11434/v1", model: "" },
};
