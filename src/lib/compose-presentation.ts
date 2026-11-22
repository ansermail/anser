const composePalette = {
  light: {
    paper: "#ffffff",
    ink: "#242424",
    border: "#dcdcdc",
    code: "#f3f3f3",
    header: "#f4f6f5",
    quote: "#edf2f0",
    rail: "#345d51",
    link: "#366ba8",
  },
  dark: {
    paper: "#181818",
    ink: "#ededed",
    border: "#434343",
    code: "#262626",
    header: "#252525",
    quote: "#232e2a",
    rail: "#a8cbbd",
    link: "#8db9e8",
  },
};

const palette = (dark: boolean) => composePalette[dark ? "dark" : "light"];
const bodyFont =
  "-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif";
const codeFont = "SFMono-Regular,Menlo,Consolas,monospace";
const headings = ":is(h1,h2,h3,h4,h5,h6)";
const task = 'li[data-type="taskItem"]';
const taskList = 'ul[data-type="taskList"]';
const canvasPadding = "8px 18px 14px";
const tableMargin = "12px 0";

export const composeTaskSymbol = { checked: "☑", unchecked: "☐" };

export function composePaper(dark: boolean) {
  return palette(dark).paper;
}

export function composeTaskStyle(dark: boolean) {
  return `position:absolute;top:0;left:0;color:${palette(dark).rail}`;
}

function canvasStyles(dark: boolean) {
  const colors = palette(dark);
  return {
    "font-family": bodyFont,
    "font-size": "14px",
    "line-height": "1.75",
    "background-color": colors.paper,
    color: colors.ink,
    "overflow-wrap": "anywhere",
    padding: canvasPadding,
  };
}

// Defaults are ordered from specific to general so a property only needs to
// be written once when the same rules are inlined for email.
function composeRules(dark: boolean): [string, Record<string, string>][] {
  const colors = palette(dark);
  return [
    [`:is(th,td,li) > p, blockquote > p:last-child`, { "margin-bottom": "0" }],
    ["p", { "margin-top": "0", "margin-bottom": "10px" }],
    [`:scope > ${headings}:first-child`, { "margin-top": "0" }],
    [
      headings,
      {
        "margin-top": "14px",
        "margin-bottom": "7px",
        "font-weight": "700",
        "line-height": "1.35",
      },
    ],
    ["h1", { "font-size": "1.75em" }],
    ["h2", { "font-size": "1.45em" }],
    ["h3", { "font-size": "1.22em" }],
    [":is(h4,h5,h6)", { "font-size": "1.07em" }],
    ["a[href]", { color: colors.link, "text-decoration": "underline" }],
    ["strong,b", { "font-weight": "700" }],
    ["mark", { "background-color": "#ffe78e", color: "#242424" }],
    [
      "pre",
      {
        margin: "10px 0",
        padding: "8px 12px",
        border: `1px solid ${colors.border}`,
        "border-radius": "8px",
        "background-color": colors.code,
        "white-space": "pre-wrap",
      },
    ],
    [":is(pre,code)", { "font-family": codeFont, "font-size": "1em" }],
    [
      "code:not(pre code)",
      {
        padding: "2px 4px",
        "border-radius": "4px",
        "background-color": colors.code,
        "-webkit-box-decoration-break": "clone",
        "box-decoration-break": "clone",
      },
    ],
    [
      "blockquote",
      {
        position: "relative",
        margin: "10px 0",
        padding: "8px 14px 8px 17px",
        "border-radius": "6px",
        "background-color": colors.quote,
      },
    ],
    [
      "hr",
      {
        margin: "10px 0",
        border: "0",
        "border-top": `1px solid ${colors.border}`,
      },
    ],
    [`li ${taskList}`, { "padding-left": "16px", margin: "0" }],
    [taskList, { "padding-left": "0", "list-style-type": "none" }],
    ["ul", { "list-style-type": "disc" }],
    ["ol", { "list-style-type": "decimal" }],
    [":is(ul,ol)", { "padding-left": "24px", margin: "0 0 10px" }],
    [task, { position: "relative", "padding-left": "21px" }],
    [
      "table",
      {
        "border-collapse": "collapse",
        "border-spacing": "0",
        "table-layout": "fixed",
        width: "100%",
        "max-width": "100%",
        margin: tableMargin,
        "border-radius": "8px",
        outline: `1px solid ${colors.border}`,
        "outline-offset": "-1px",
      },
    ],
    [
      ":is(th,td)",
      {
        border: `1px solid ${colors.border}`,
        padding: "6px 10px",
        "vertical-align": "top",
        "box-sizing": "border-box",
      },
    ],
    [":is(th,td):not([align])", { "text-align": "left" }],
    [':is(th,td)[align="center" i]', { "text-align": "center" }],
    [':is(th,td)[align="right" i]', { "text-align": "right" }],
    [':is(th,td)[align="left" i]', { "text-align": "left" }],
    ["th", { "background-color": colors.header, "font-weight": "600" }],
    [
      "img",
      { "max-width": "100%", height: "auto", "vertical-align": "middle" },
    ],
  ];
}

const quoteRail = (dark: boolean) => ({
  position: "absolute",
  display: "block",
  top: "0",
  bottom: "0",
  left: "0",
  width: "3px",
  "border-radius": "999px",
  "background-color": palette(dark).rail,
  "pointer-events": "none",
});

const declarations = (properties: Record<string, string>) =>
  Object.entries(properties)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");

export function composeCanvasCss(dark: boolean) {
  return declarations(canvasStyles(dark));
}

export function composeEditorCss(dark: boolean) {
  const scope = ".rich-body";
  const rules = composeRules(dark).map(([selector, styles]) => {
    const scoped = selector.startsWith(":scope")
      ? selector.replace(":scope", scope)
      : `${scope} :is(${selector})`;
    return `${scoped}{${declarations(styles)}}`;
  });
  rules.push(
    `${scope} table{clip-path:inset(0 round 8px)}`,
    `${scope} .tableWrapper{margin:${tableMargin}}`,
    `${scope} .tableWrapper table{margin:0}`,
    `${scope} blockquote::before{content:"";${declarations(quoteRail(dark))}}`,
    `${scope} ${task} > label::before{content:"${composeTaskSymbol.unchecked}";${composeTaskStyle(dark)}}`,
    `${scope} ${task}[data-checked="true"] > label::before{content:"${composeTaskSymbol.checked}"}`,
  );
  return rules.join("\n");
}

export function styleComposeCanvas(element: HTMLElement, dark: boolean) {
  setDefaults(element.style, canvasStyles(dark));
}

function setDefaults(
  style: CSSStyleDeclaration,
  styles: Record<string, string>,
) {
  for (const [name, value] of Object.entries(styles)) {
    if (!style.getPropertyValue(name)) style.setProperty(name, value);
  }
}

export function applyComposePresentation(doc: Document, dark: boolean) {
  // Drafts made by the previous editor can carry the old default cell paint
  // along with their saved widths. Leave custom colors and dimensions alone.
  for (const { style } of doc.body.querySelectorAll<HTMLElement>("th,td")) {
    if (
      style.borderColor !== "rgb(208, 208, 208)" ||
      style.padding !== "6px 10px" ||
      style.verticalAlign !== "top"
    )
      continue;
    style.removeProperty("border");
    if (style.backgroundColor === "rgb(244, 246, 245)")
      style.removeProperty("background-color");
  }
  for (const [selector, styles] of composeRules(dark)) {
    const elements = doc.body.querySelectorAll<HTMLElement>(selector);
    for (const { style } of elements) {
      setDefaults(style, styles);
    }
  }
  for (const quote of doc.body.querySelectorAll("blockquote")) {
    if (
      quote.style.borderLeft ||
      quote.style.getPropertyValue("border-inline-start")
    )
      continue;
    const rail = doc.createElement("span");
    rail.setAttribute("data-anser-quote-rail", "");
    rail.setAttribute("aria-hidden", "true");
    rail.setAttribute("style", declarations(quoteRail(dark)));
    quote.prepend(rail);
  }
  for (const table of doc.body.querySelectorAll("table")) {
    const { style } = table;
    if (!style.getPropertyValue("clip-path"))
      style.setProperty("clip-path", `inset(0 round ${style.borderRadius})`);
  }
}
