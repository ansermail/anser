// @vitest-environment jsdom
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { composeCanvasCss } from "@/lib/compose-presentation";
import { RichEditor } from "./rich-editor";
import { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { richExtensions } from "@/lib/rich-extensions";
import { currentTableDimensions, resizeTable } from "@/lib/rich-table";
import {
  compileSource,
  htmlToMarkdown,
  sanitizeComposeHtml,
} from "@/lib/compose-format";
import { toast } from "sonner";
const mode = vi.hoisted(() => ({
  demo: false,
  call: vi.fn<
    (command: string, args?: Record<string, unknown>) => Promise<unknown>
  >(),
}));
vi.mock("@/lib/api", () => ({
  native: true,
  isDemo: () => mode.demo,
  call: mode.call,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
const picker = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => picker);
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
  Range.prototype.getBoundingClientRect = () => ({
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {},
  });
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(cb, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mode.demo = false;
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function paste(text = "") {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (format: string) => (format === "text/plain" ? text : ""),
      files: [
        new File(
          [Uint8Array.from(atob(png), (c) => c.charCodeAt(0))],
          "paste.png",
          { type: "image/png" },
        ),
      ],
    },
  });
  await act(async () =>
    document.querySelector(".rich-body")!.dispatchEvent(event),
  );
}
it("pastes raster bytes into editable body, reports preparation and preserves formatting", async () => {
  const change = vi.fn(),
    busy = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html={
          '<p><span style="font-family:SimSun;font-size:18pt">正文</span></p>'
        }
        disabled={false}
        onChange={change}
        onBusy={busy}
        readImages={vi.fn()}
      />,
    ),
  );
  await paste();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(vi.mocked(toast.error).mock.calls).toEqual([]);
  expect(busy.mock.calls.map((call) => call[0])).toEqual([true, false]);
  expect(change.mock.calls.at(-1)?.[1]).toContain(png);
  await vi.waitFor(() =>
    expect(
      document.querySelector(".rich-body img[src]")?.getAttribute("src"),
    ).toContain(png),
  );
  const html = change.mock.calls.at(-1)![1];
  expect(html).toContain(png);
  expect(html).toContain("18pt");
  expect(html).toContain("font-family");
  expect(
    document.querySelector(".rich-body img[src]")?.getAttribute("src"),
  ).toContain(png);
  expect(busy.mock.calls.map((call) => call[0])).toEqual([true, false]);
});
it("inserts from native picker once and drops late results after editor closes", async () => {
  picker.open.mockResolvedValue(["/tmp/fictional.png"]);
  let resolve!: (value: { src: string; name: string }[]) => void;
  const read = vi.fn(
      () =>
        new Promise<{ src: string; name: string }[]>((done) => {
          resolve = done;
        }),
    ),
    change = vi.fn(),
    busy = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html=""
        disabled={false}
        onChange={change}
        onBusy={busy}
        readImages={read}
      />,
    ),
  );
  await act(async () =>
    (
      document.querySelector('button[aria-label="插入正文图片"]') as HTMLElement
    ).click(),
  );
  await vi.waitFor(() =>
    expect(read).toHaveBeenCalledWith(["/tmp/fictional.png"]),
  );
  expect(busy).toHaveBeenCalledWith(true);
  await act(async () => root.render(null));
  await act(async () =>
    resolve([{ src: `data:image/png;base64,${png}`, name: "fictional.png" }]),
  );
  expect(change).not.toHaveBeenCalled();
  expect(busy).toHaveBeenLastCalledWith(false);
});
it("preview rejects real clipboard files and disables the native image picker", async () => {
  mode.demo = true;
  const change = vi.fn(),
    read = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html=""
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
        readImages={read}
      />,
    ),
  );
  await paste();
  expect(change).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(toast.info).toHaveBeenCalledWith("演示模式暂不支持插入正文图片。");
  expect(
    (
      document.querySelector(
        'button[aria-label="插入正文图片"]',
      ) as HTMLButtonElement
    ).disabled,
  ).toBe(true);

  vi.mocked(toast.info).mockClear();
  await paste("# Markdown\n\n正文内容");
  expect(document.querySelector(".rich-body h1")?.textContent).toBe("Markdown");
  expect(document.querySelector(".rich-body img")).toBeNull();
  expect(toast.info).not.toHaveBeenCalled();
});

it("right-clicks only the target image, locks proportions, supports independent sizes and cancel", async () => {
  const change = vi.fn();
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html={`<p><img src="data:image/png;base64,${png}" width="800" height="400"><img src="data:image/png;base64,${png}" width="200" height="100"></p>`}
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
        readImages={vi.fn()}
      />,
    ),
  );
  const context = async () => {
    await act(async () =>
      document.querySelector(".rich-body img[src]")!.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 20,
          clientY: 20,
        }),
      ),
    );
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (e) => e.textContent?.trim() === "调整图片尺寸",
    ) as HTMLElement;
    expect(item).toBeTruthy();
    await act(async () => item.click());
  };
  const field = async (id: string, value: string) => {
    await act(async () => {
      const input = document.getElementById(id) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  await context();
  await field("rich-image-width", "300");
  expect(
    (document.getElementById("rich-image-height") as HTMLInputElement).value,
  ).toBe("150");
  await act(async () =>
    (document.getElementById("rich-image-proportion") as HTMLElement).click(),
  );
  await field("rich-image-height", "80");
  await act(async () =>
    document
      .getElementById("rich-image-width")!
      .closest("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  const images = document.querySelectorAll(".rich-body img[src]");
  expect(images[0].getAttribute("width")).toBe("300");
  expect(images[0].getAttribute("height")).toBe("80");
  expect(images[1].getAttribute("width")).toBe("200");
  expect(change.mock.calls.at(-1)?.[1]).toContain('height="80"');
  await context();
  await field("rich-image-width", "100");
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(
    document.querySelector(".rich-body img[src]")?.getAttribute("width"),
  ).toBe("300");
});

it("previews AI revisions without saving and applies them as one undoable transaction", async () => {
  const change = vi.fn();
  mode.call.mockImplementation(async (command, args) => {
    if (command === "get_translation_settings") return { revision: "r1" };
    if (command === "run_mail_ai") {
      const input = args?.input as { paragraphs: string[] };
      expect(input.paragraphs).toEqual(["原正文", "保留这一段"]);
      return { message: "已调整", edits: [{ index: 0, text: "修改后" }] };
    }
  });
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html="<p><strong>原正文</strong></p><p>保留这一段</p>"
        assistantHost={host}
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
        readImages={vi.fn()}
      />,
    ),
  );
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find(
      (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    )!;
  await act(async () => {
    button("AI 助手").click();
    await import("./compose-repair");
  });
  await act(async () => button("精简一点").click());
  expect(host.querySelector(".compose-repair-added")?.textContent).toContain(
    "修改后",
  );
  expect(change).not.toHaveBeenCalled();
  await act(async () => button("应用到正文").click());
  expect(change).toHaveBeenLastCalledWith(
    "修改后\n保留这一段",
    "<p><strong>修改后</strong></p><p>保留这一段</p>",
  );
  const undo = host.querySelector(
    'button[aria-label="撤销编辑"]',
  ) as HTMLButtonElement;
  expect(undo).toBeTruthy();
  await act(async () => undo.click());
  expect(change).toHaveBeenLastCalledWith(
    "原正文\n保留这一段",
    "<p><strong>原正文</strong></p><p>保留这一段</p>",
  );
});

it("ignores IME Enter, cancels an in-flight repair and discards suggestions after typing", async () => {
  const change = vi.fn();
  const replies: ((value: unknown) => void)[] = [];
  mode.call.mockImplementation(async (command) => {
    if (command === "get_translation_settings") return { revision: "r1" };
    if (command === "run_mail_ai")
      return new Promise((resolve) => replies.push(resolve));
  });
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html="<p>原正文</p>"
        assistantHost={host}
        disabled={false}
        onChange={change}
        onBusy={vi.fn()}
        readImages={vi.fn()}
      />,
    ),
  );
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find(
      (element) =>
        element.textContent === label ||
        element.getAttribute("aria-label") === label,
    )!;
  await act(async () => {
    button("AI 助手").click();
    await import("./compose-repair");
  });
  const prompt = host.querySelector<HTMLTextAreaElement>(
    ".compose-repair-panel textarea",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(prompt, "请精简");
    prompt.dispatchEvent(new Event("input", { bubbles: true }));
    prompt.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing: true,
      }),
    );
  });
  expect(replies).toHaveLength(0);
  await act(async () => button("发送修改要求").click());
  const request = mode.call.mock.calls.find(
    ([name]) => name === "run_mail_ai",
  )?.[1];
  expect(replies).toHaveLength(1);
  await act(async () => button("停止生成").click());
  expect(mode.call).toHaveBeenCalledWith("cancel_translation", {
    requestId: request?.requestId,
  });
  await act(async () =>
    replies[0]({ message: "迟到建议", edits: [{ index: 0, text: "迟到" }] }),
  );
  expect(host.textContent).not.toContain("迟到建议");
  await act(async () => button("精简一点").click());
  await act(async () =>
    replies[1]({ message: "建议", edits: [{ index: 0, text: "修改后" }] }),
  );
  expect(button("应用到正文")).toBeDefined();
  const body = host.querySelector<HTMLElement>(".rich-body")!;
  await act(async () => {
    body.textContent = "手动更新";
    body.dispatchEvent(new InputEvent("input", { bubbles: true }));
  });
  expect(host.textContent).toContain("草稿已变更，请重新生成建议。");
  expect(button("应用到正文")).toBeUndefined();
  expect(body.querySelector(".compose-repair-added")).toBeNull();
});

it("shows a specific repair failure without assistant-ui's loading dot", async () => {
  mode.call.mockImplementation(async (command) => {
    if (command === "get_translation_settings") return { revision: "r1" };
    if (command === "run_mail_ai") throw "模型返回的内容不符合格式，请重试";
  });
  await act(async () =>
    root.render(
      <RichEditor
        body=""
        html="<p>原正文</p>"
        assistantHost={host}
        disabled={false}
        onChange={vi.fn()}
        onBusy={vi.fn()}
        readImages={vi.fn()}
      />,
    ),
  );
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find(
      (element) =>
        element.textContent === label ||
        element.getAttribute("aria-label") === label,
    )!;
  await act(async () => {
    button("AI 助手").click();
    await import("./compose-repair");
  });
  await act(async () => button("精简一点").click());
  expect(host.textContent).toContain(
    "模型返回内容格式不正确，请重试或换用支持 JSON 输出的模型。",
  );
  expect(host.textContent).not.toContain("●");
});

it("keeps resized columns after merge, draft serialization and undo", () => {
  const editor = new Editor({ element: host, extensions: richExtensions() });
  try {
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    expect(resizeTable(editor, { width: 640, column: 210, row: 96 })).toBe(
      true,
    );
    expect(currentTableDimensions(editor)).toEqual({
      width: 640,
      column: 210,
      row: 96,
    });
    editor.commands.goToNextCell();
    expect(resizeTable(editor, { column: 270, row: 96 })).toBe(true);
    editor.commands.setCellSelection({ anchorCell: 2, headCell: 6 });
    expect(editor.commands.mergeCells()).toBe(true);
    const html = sanitizeComposeHtml(editor.getHTML());
    expect(html).toContain('data-colwidth="210,270"');
    expect(html).toMatch(/width:\s*480px/);
    expect(html).not.toContain("resize-handle");
    editor.commands.setContent(
      compileSource(htmlToMarkdown(html), "markdown").html,
    );
    expect(editor.getHTML()).toContain('data-colwidth="210,270"');
    editor.commands.setTextSelection(4);
    editor.view.dispatch(closeHistory(editor.state.tr));
    expect(resizeTable(editor, { width: 800, column: 240, row: 120 })).toBe(
      true,
    );
    expect(editor.commands.undo()).toBe(true);
    expect(currentTableDimensions(editor)).toEqual({
      width: 640,
      column: 210,
      row: 96,
    });
  } finally {
    editor.destroy();
  }
});

it("builds a table with an editable data row and accepts a typed alignment line", () => {
  const editor = new Editor({
    element: host,
    content: "<p>| Item | State |</p>",
    extensions: richExtensions(),
  });
  const enter = () =>
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
  try {
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    enter();
    expect(editor.view.dom.querySelectorAll("tr")).toHaveLength(2);
    expect(editor.state.selection.$from.node(-1).type.name).toBe("tableCell");
    editor.commands.insertContent("| :--- | ---: |");
    enter();
    expect(editor.view.dom.querySelector("th")?.style.textAlign).toBe("left");
    expect(
      editor.view.dom.querySelector<HTMLTableCellElement>("td:last-child")
        ?.style.textAlign,
    ).toBe("right");
    expect(editor.view.dom.textContent).not.toContain("---");
    editor.commands.setContent("<p>| Single |</p>");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    enter();
    expect(editor.view.dom.querySelector("th")?.textContent).toBe("Single");
    expect(editor.view.dom.querySelectorAll("td")).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

it("offers real task checkboxes after smart Markdown paste while preserving code and links", () => {
  const editor = new Editor({ element: host, extensions: richExtensions() });
  try {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        files: [],
        getData: (format: string) =>
          format === "text/plain"
            ? "## Update\n\n- [x] Done\n\n> Quoted\n\n`code` and [Docs](https://example.test)"
            : "",
      },
    });
    editor.view.dom.dispatchEvent(event);
    expect(editor.view.dom.querySelector("h2")?.textContent).toBe("Update");
    expect(
      editor.view.dom.querySelector<HTMLInputElement>(
        'li[data-type="taskItem"] input',
      )?.checked,
    ).toBe(true);
    expect(editor.view.dom.querySelector("blockquote")?.textContent).toBe(
      "Quoted",
    );
    expect(editor.view.dom.querySelector("code")?.textContent).toBe("code");
    expect(editor.view.dom.querySelector("a")?.href).toBe(
      "https://example.test/",
    );
  } finally {
    editor.destroy();
  }
});

it("turns typed Markdown into marks and keeps unsafe link syntax as text", () => {
  const editor = new Editor({ element: host, extensions: richExtensions() });
  function type(text: string) {
    for (const character of text) {
      const { state, view } = editor;
      const { from, to } = state.selection;
      const insert = () => state.tr.insertText(character, from, to);
      if (
        !view.someProp("handleTextInput", (handler) =>
          handler(view, from, to, character, insert),
        )
      )
        view.dispatch(insert());
    }
  }
  try {
    type(
      "**bold** *italic* ~~old~~ `code` ==highlight== [Docs](https://example.test) [unsafe](javascript:alert)",
    );
    expect(editor.getHTML()).toMatch(
      /<strong>bold<\/strong>.*<em>italic<\/em>.*<s>old<\/s>.*<code>code<\/code>.*<mark[^>]*>highlight<\/mark>/,
    );
    expect(editor.view.dom.querySelector("a")?.textContent).toBe("Docs");
    expect(editor.getHTML()).toContain("[unsafe](javascript:alert)");
  } finally {
    editor.destroy();
  }
});

it("drags either side of a divider and resizes the whole table at the outer edge", () => {
  const editor = new Editor({
    element: host,
    extensions: richExtensions(),
    content:
      "<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>",
  });
  try {
    const dom = editor.view.dom;
    let leftWidth = 300,
      rightWidth = 300;
    dom.setPointerCapture = vi.fn();
    const rect = (element: Element, x: number, width: number) => {
      element.getBoundingClientRect = () => new DOMRect(x, 10, width, 80);
    };
    function layout() {
      const table = dom.querySelector("table")!;
      rect(table, 10, leftWidth + rightWidth);
      for (const row of table.rows) {
        rect(row.cells[0], 10, leftWidth);
        rect(row.cells[1], 10 + leftWidth, rightWidth);
      }
      return [...table.rows[0].cells];
    }

    function pointer(target: Element, type: string, x: number) {
      const event = new MouseEvent(type, {
        button: 0,
        clientX: x,
        clientY: 30,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperties(event, {
        pointerType: { value: "mouse" },
        pointerId: { value: 1 },
      });
      target.dispatchEvent(event);
      return event;
    }
    function drag(
      cell: Element,
      start: number,
      end: number,
      type = "pointerup",
    ) {
      expect(pointer(cell, "pointerdown", start).defaultPrevented).toBe(true);
      pointer(dom, "pointermove", end);
      pointer(dom, type, end);
    }

    drag(layout()[1], 310, 210);
    expect(editor.getHTML()).toContain('data-colwidth="200"');
    expect(editor.getHTML()).toContain('data-colwidth="400"');
    expect(editor.getHTML()).toMatch(/<table style="[^"]*width:\s*100%/);
    expect(editor.getHTML()).not.toContain("resize-handle");
    leftWidth = 200;
    rightWidth = 400;

    drag(layout()[0], 209, 259);
    expect(editor.getHTML()).toContain('data-colwidth="250"');
    expect(editor.getHTML()).toContain('data-colwidth="350"');
    leftWidth = 250;
    rightWidth = 350;

    drag(layout()[1], 609, 469);
    expect(editor.getHTML()).toMatch(/<table style="[^"]*width:\s*460px/);
    expect(editor.getHTML()).toContain('data-colwidth="192"');
    expect(editor.getHTML()).toContain('data-colwidth="268"');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getHTML()).toMatch(/<table style="[^"]*width:\s*100%/);
    expect(editor.getHTML()).toContain('data-colwidth="250"');

    drag(layout()[1], 609, 649, "pointercancel");
    expect(editor.getHTML()).toMatch(/<table style="[^"]*width:\s*100%/);
    drag(layout()[1], 609, 649);
    expect(editor.getHTML()).toMatch(/<table style="[^"]*width:\s*640px/);
    expect(editor.getHTML()).toContain('data-colwidth="267"');
    expect(editor.getHTML()).toContain('data-colwidth="373"');
    editor.commands.setTextSelection(4);
    expect(resizeTable(editor, { width: null, column: null, row: null })).toBe(
      true,
    );
    const reset = dom.querySelector("col")!;
    expect(reset.style.width).toBe("");
    expect(editor.getHTML()).toMatch(/<table style="[^"]*width:\s*100%/);
  } finally {
    editor.destroy();
  }
});

it("updates the existing editor canvas when the theme changes", async () => {
  const render = (dark: boolean) =>
    act(async () =>
      root.render(
        <RichEditor
          body="Keep this draft"
          html=""
          dark={dark}
          disabled={false}
          onChange={() => {}}
          onBusy={() => {}}
          readImages={vi.fn()}
        />,
      ),
    );
  await render(false);
  const canvas = host.querySelector(".rich-body");
  expect(canvas?.getAttribute("style")).toBe(composeCanvasCss(false));
  await render(true);
  expect(host.querySelector(".rich-body")).toBe(canvas);
  expect(canvas?.getAttribute("style")).toBe(composeCanvasCss(true));
  expect(canvas?.textContent).toBe("Keep this draft");
});
