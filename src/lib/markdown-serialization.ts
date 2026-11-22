import { Renderer, type Tokens } from "marked";

export class ComposeMarkdownRenderer extends Renderer {
  override code(token: Tokens.Code) {
    return super.code(token).replace(/\n(?=<\/code><\/pre>\s*$)/, "");
  }

  override checkbox() {
    return "";
  }

  override list(list: Tokens.List): string {
    if (!list.items.some((item) => item.task)) return super.list(list);
    // A Markdown list can mix ordinary and task items. Tiptap represents
    // these as separate lists, so preserve their order in contiguous runs.
    const groups: string[] = [];
    for (let i = 0; i < list.items.length;) {
      const task = list.items[i].task;
      let end = i + 1;
      while (end < list.items.length && list.items[end].task === task) end++;
      const items = list.items.slice(i, end);
      groups.push(
        task
          ? `<ul data-type="taskList">${items
              .map(
                (item) =>
                  `<li data-type="taskItem" data-checked="${Boolean(item.checked)}"><div>${this.parser.parse(item.tokens)}</div></li>`,
              )
              .join("")}</ul>\n`
          : super.list({
              ...list,
              items,
              start: list.ordered ? Number(list.start) + i : "",
            }),
      );
      i = end;
    }
    return groups.join("");
  }
}

export function composeLinkAllowed(href: string) {
  return /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(href);
}

const escapeText = (text: string) =>
  text
    .replace(/[\\`*_{}\[\]<>~=#&]/g, (char) => `\\${char}`)
    .replace(/^(\s{0,3}\d{1,9})([.)])(?=\s)/gm, "$1\\$2")
    .replace(/^(\s{0,3})([-+])(?=\s|---)/gm, "$1\\$2");

function fenceFor(text: string, min = 1) {
  let length = min;
  for (const [run] of text.matchAll(/`+/g))
    length = Math.max(length, run.length + 1);
  return "`".repeat(length);
}

function tableMarkdown(table: HTMLElement): string | null {
  const rows = [...(table as HTMLTableElement).rows];
  const cols = rows[0]?.cells.length;
  // GFM cannot express merged cells, a header column, fixed dimensions, or
  // block content in cells. Such tables use an HTML block in the source.
  if (
    !cols ||
    rows[0].querySelector("td") ||
    (table.style.width && table.style.width !== "100%") ||
    rows.some(
      (row, index) =>
        row.style.height ||
        row.cells.length !== cols ||
        (index > 0 && row.querySelector("th")) ||
        [...row.cells].some(
          (cell) =>
            cell.colSpan !== 1 ||
            cell.rowSpan !== 1 ||
            cell.style.width ||
            cell.style.height ||
            cell.hasAttribute("colwidth") ||
            cell.hasAttribute("data-colwidth") ||
            cell.querySelector("br") ||
            cell.children.length > 1 ||
            (cell.firstElementChild &&
              !cell.firstElementChild.matches(
                "p,a,strong,b,em,i,s,del,code,mark,img,span,u,sub,sup",
              )),
        ),
    )
  )
    return null;
  const separator = [...rows[0].cells].map((cell) => {
    const align = cell.getAttribute("align") || cell.style.textAlign;
    return align === "center"
      ? ":---:"
      : align === "right"
        ? "---:"
        : align === "left"
          ? ":---"
          : "---";
  });
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const lines = rows.map((row) =>
    line(
      [...row.cells].map((cell) => children(cell).trim().replace(/\|/g, "\\|")),
    ),
  );
  lines.splice(1, 0, line(separator));
  return lines.join("\n");
}

function children(node: Node, separator = ""): string {
  return [...node.childNodes]
    .filter(
      (child) =>
        separator === "" ||
        child.nodeType !== Node.TEXT_NODE ||
        !!child.textContent?.trim(),
    )
    .map(serialize)
    .filter((value) => value !== "")
    .join(separator);
}

function listMarkdown(list: HTMLElement) {
  const task = list.dataset.type === "taskList";
  const start = Number(list.getAttribute("start")) || 1;
  return [...list.children]
    .map((item, index) => {
      const prefix = task
        ? `- [${item.getAttribute("data-checked") === "true" ? "x" : " "}] `
        : list.tagName === "OL"
          ? `${start + index}. `
          : "- ";
      const indent = " ".repeat(task ? 2 : prefix.length);
      const content = (task && item.querySelector(":scope > div")) || item;
      let text = "";
      let inline = "";
      const append = (value: string, nested = false) => {
        if (value.trim())
          text += (text ? (nested ? "\n" : "\n\n") : "") + value.trim();
      };
      for (const child of content.childNodes) {
        if (
          child instanceof HTMLElement &&
          child.matches("p,ul,ol,blockquote,pre,table,h1,h2,h3,h4,h5,h6,hr")
        ) {
          append(inline);
          inline = "";
          append(serialize(child), child.matches("ul,ol"));
        } else {
          inline += serialize(child);
        }
      }
      append(inline);
      return prefix + text.replaceAll("\n", `\n${indent}`).trimEnd();
    })
    .join("\n");
}

function serialize(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escapeText(node.textContent || "");
  if (!(node instanceof HTMLElement)) return "";
  const tag = node.tagName.toLowerCase();
  if (tag === "table") return tableMarkdown(node) ?? node.outerHTML;
  if (tag === "ol" || tag === "ul") return listMarkdown(node);
  if (tag === "pre") {
    const text = node.textContent || "";
    const fence = fenceFor(text, 3);
    const language =
      /^language-([\w+-]+)$/.exec(
        node.firstElementChild?.className || "",
      )?.[1] ?? "";
    return `${fence}${language}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
  }
  if (tag === "code") {
    const text = node.textContent || "";
    const fence = fenceFor(text);
    const padded =
      /^(?: |`)|(?: |`)$/.test(text) && text.trim() ? ` ${text} ` : text;
    return `${fence}${padded}${fence}`;
  }
  // Keep rich formatting and draft-owned images that have no GFM equivalent.
  if (
    (node.hasAttribute("style") && tag !== "mark") ||
    ["img", "u", "sub", "sup"].includes(tag)
  )
    return node.outerHTML;
  if (tag === "br") return "<br>";
  if (tag === "hr") return "---";
  const text = children(node);
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${text}`;
  if (tag === "blockquote")
    return children(node, "\n\n")
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  const mark = { strong: "**", b: "**", em: "*", i: "*", s: "~~", del: "~~" }[
    tag
  ];
  if (mark) {
    // GFM treats whitespace immediately inside emphasis as plain text.
    return text.replace(/^(\s*)(\S[\s\S]*?)(\s*)$/, `$1${mark}$2${mark}$3`);
  }
  if (tag === "mark") return node.outerHTML;
  if (tag === "a") {
    const href = node.getAttribute("href") || "";
    const title = node.getAttribute("title");
    if (!composeLinkAllowed(href)) return text;
    return `[${text}](<${href.replace(/[<>]/g, encodeURIComponent)}>${title ? ` "${title.replace(/[\\"]/g, "\\$&")}"` : ""})`;
  }
  if (tag === "p" && text === "<br>") return "<p><br></p>";
  return ["p", "span"].includes(tag) ? text : node.outerHTML;
}

export function serializeMarkdown(body: HTMLElement) {
  if (body.children.length === 1 && body.innerHTML === "<p><br></p>") return "";
  return children(body, "\n\n").trim();
}
