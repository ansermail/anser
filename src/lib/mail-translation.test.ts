// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeMailHtml } from "./mail-html";
import {
  planMailTranslation,
  plainMailHtml,
  translationBatches,
  validateTranslationReply,
} from "./mail-translation";
function mail(html: string) {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(safeMailHtml(html));
  doc.close();
  return doc;
}
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
describe("bilingual mail display", () => {
  it("validates ids and whole paragraphs without requiring each inline piece to be nonempty", () => {
    const requested = [
      { id: "p0_t0", text: "Hello " },
      { id: "p0_t1", text: "world" },
    ];
    expect(() =>
      validateTranslationReply(requested, [
        { id: "p0_t1", text: "你好世界" },
        { id: "p0_t0", text: "" },
      ]),
    ).not.toThrow();
    for (const translated of [
      [
        { id: "p0_t0", text: "" },
        { id: "p0_t1", text: " " },
      ],
      [
        { id: "p0_t0", text: "你好" },
        { id: "p0_t0", text: "世界" },
      ],
      [
        { id: "unknown", text: "你好" },
        { id: "p0_t1", text: "世界" },
      ],
      [{ id: "p0_t0", text: "你好" }],
      [
        { id: "p0_t0", text: "x".repeat(24001) },
        { id: "p0_t1", text: "世界" },
      ],
      [
        { id: "p0_t0", text: "bad\0text" },
        { id: "p0_t1", text: "世界" },
      ],
    ])
      expect(() => validateTranslationReply(requested, translated)).toThrow();
    expect(() =>
      validateTranslationReply(
        [{ id: "p0", text: "Hi" }, requested[0]],
        [
          { id: "p0", text: "" },
          { id: "p0_t0", text: "你好" },
        ],
      ),
    ).toThrow();
  });
  it("keeps paragraph context together at the part and character batch boundaries", () => {
    const prefix = Array.from({ length: 63 }, (_, i) => ({
      id: `p${i}_t0`,
      text: "Hello",
    }));
    const paragraph = [
      { id: "p63_t0", text: "Hello " },
      { id: "p63_t1", text: "world" },
    ];
    expect(
      translationBatches([...prefix, ...paragraph]).map((b) => b.length),
    ).toEqual([63, 2]);
    const large = [
      { id: "p0_t0", text: "x".repeat(5900) },
      ...paragraph.map((p) => ({ ...p, text: "x".repeat(80) })),
    ];
    expect(translationBatches(large).map((b) => b.length)).toEqual([1, 2]);
  });
  it("按钮译文换行留在原按钮内，不复制链接、背景或边框，隐藏后精确恢复", () => {
    for (const label of [
      'style="display:inline-block;padding:12px 24px;border:1px solid #888;border-radius:30px"',
      'style="padding:12px 24px;background-color:#8ab4f8;border-radius:30px"',
      'role="button"',
    ]) {
      const doc = mail(
        `<p>Choose a plan</p><div><a id="cta" href="https://example.com/plan" ${label}><strong>Get Google AI Ultra</strong></a> <a href="https://example.com/demo" style="display:inline-block;background:#8ab4f8;padding:12px 24px">Try demo apps</a></div>`,
      );
      const original = doc.body.innerHTML;
      const links = [...doc.querySelectorAll("a")];
      const labelNode = links[0].querySelector("strong")!;
      const plan = planMailTranslation(doc, "zh-CN");
      const translations: Record<string, string> = {
        "Choose a plan": "选择方案",
        "Get Google AI Ultra": "获取 Google AI Ultra",
        "Try demo apps": "试用演示应用",
      };
      const values = new Map(
        plan.parts.map((p) => [p.id, translations[p.text] || ""]),
      );
      plan.apply(values);
      plan.apply(values);
      expect([...doc.querySelectorAll("a")]).toEqual(links);
      expect(links[0].getAttribute("data-mail-href")).toBe(
        "https://example.com/plan",
      );
      expect(links[0].querySelector("strong")).toBe(labelNode);
      expect(links[0].textContent).toBe(
        "Get Google AI Ultra获取 Google AI Ultra",
      );
      expect(links[1].textContent).toBe("Try demo apps试用演示应用");
      for (const link of links) {
        const view = link.querySelector<HTMLElement>(
          "[data-anser-translation]",
        )!;
        expect(view.style.display).toBe("block");
        expect(view.querySelector("a")).toBeNull();
        expect(
          view.querySelector("[style*='background'],[style*='border']"),
        ).toBeNull();
      }
      plan.dispose();
      expect(doc.body.innerHTML).toBe(original);
      expect([...doc.querySelectorAll("a")]).toEqual(links);
    }
  });
  it("groups ordinary horizontal links despite pasted matching backgrounds, atomic display or underline borders", () => {
    for (const color of ["#f4f4f4", "#234567"]) {
      for (const display of ["inline", "inline-block", "inline-flex"]) {
        const labels = ["Portal", "Handbook", "Support", "Community"];
        const links = labels
          .map(
            (label, i) =>
              `<a href="https://example.com/${i}" style="display:${display};background:${color};border-bottom:1px solid currentColor"><span style="background:${color}"><b>${label}</b></span></a>`,
          )
          .join(' <span style="background:' + color + '"> · </span> ');
        const doc = mail(
          `<section style="background:${color}"><p id="nav-row">${links}</p><p id="legal-row"><span style="background:${color}">© Example. All rights reserved. · </span><a href="https://example.com/preferences"><span style="background:${color}">Preferences</span></a></p></section>`,
        );
        const original = doc.body.innerHTML;
        const originals = [...doc.querySelectorAll("a")];
        const plan = planMailTranslation(doc, "zh-CN");
        plan.apply(new Map(plan.parts.map((p, i) => [p.id, `译文${i}`])));
        for (const id of ["nav-row", "legal-row"]) {
          const row = doc.getElementById(id)!;
          const views = row.querySelectorAll<HTMLElement>(
            "[data-anser-translation]",
          );
          expect(views).toHaveLength(1);
          expect(views[0].parentElement).toBe(row);
          expect(views[0].querySelectorAll("a")).toHaveLength(
            id === "nav-row" ? 4 : 1,
          );
        }
        for (const link of originals) {
          expect(link.isConnected).toBe(true);
          expect(link.querySelector("[data-anser-translation]")).toBeNull();
        }
        plan.dispose();
        expect(doc.body.innerHTML).toBe(original);
        expect([...doc.querySelectorAll("a")]).toEqual(originals);
      }
    }
  });
  it("内层装饰标签、flex/grid 和定高按钮只保留一个点击区域并恢复样式", () => {
    for (const style of [
      "display:inline-flex;align-items:center;height:44px;white-space:nowrap",
      "display:inline-grid;grid-template-columns:auto auto;height:44px",
      "",
    ]) {
      const doc = mail(
        `<a href="https://example.com/" style="${style}"><span style="display:inline-block;border:1px solid #888;background:#222;padding:10px;color:white">Read <b>more</b></span></a>`,
      );
      const original = doc.body.innerHTML;
      const link = doc.querySelector("a")!;
      const paintedLabel = link.querySelector("span")!;
      const plan = planMailTranslation(doc, "zh-CN");
      plan.apply(
        new Map(
          plan.parts.map((p) => [p.id, p.text === "more" ? "更多" : "阅读"]),
        ),
      );
      expect(doc.querySelectorAll("a")).toHaveLength(1);
      const view = link.querySelector<HTMLElement>("[data-anser-translation]")!;
      expect(view).not.toBeNull();
      expect(
        view.querySelector(
          "[style*='background'],[style*='border'],[style*='padding']",
        ),
      ).toBeNull();
      expect(view.parentElement).toBe(paintedLabel);
      if (style) expect(link.style.height).toBe("auto");
      plan.dispose();
      expect(doc.body.innerHTML).toBe(original);
    }
  });
  it("flex 和 grid 按钮的译文独占下一行，不改变原链接及图标", () => {
    for (const display of ["inline-flex", "inline-grid"]) {
      const doc = mail(
        `<a href="https://example.com/" style="display:${display};background:#8ab4f8;height:44px;white-space:nowrap"><img src="data:image/png;base64,AA=="><span>Try demo apps</span></a>`,
      );
      const original = doc.body.innerHTML;
      const link = doc.querySelector("a")!;
      const plan = planMailTranslation(doc, "zh-CN");
      plan.apply(new Map(plan.parts.map((p) => [p.id, "试用演示应用"])));
      const view = link.querySelector<HTMLElement>("[data-anser-translation]")!;
      expect(view.parentElement).toBe(link);
      expect(doc.querySelectorAll("a,img")).toHaveLength(2);
      if (display === "inline-flex") {
        expect(link.style.flexWrap).toBe("wrap");
        expect(view.style.flexBasis).toBe("100%");
      } else expect(view.style.gridColumn).toBe("1 / -1");
      expect(link.style.height).toBe("auto");
      plan.dispose();
      expect(doc.body.innerHTML).toBe(original);
    }
  });
  it("collapses HTML indentation in translated labels and keeps button line spacing compact", () => {
    const doc = mail(
      `<p id="body-row">\n  Ordinary text\n</p><a href="https://example.com/start"><span id="button-label" style="display:inline-block;background:#fa6432;padding:20px;width:220px;text-align:center;line-height:64px">\n                 Start <b>trial</b>\n            </span></a><pre id="preformatted">  Indented line\nNext line</pre>`,
    );
    const original = doc.body.innerHTML;
    const plan = planMailTranslation(doc, "zh-CN");
    plan.apply(
      new Map(plan.parts.map((p) => [p.id, "\n          译文\n     "])),
    );
    const bodyView = doc.querySelector<HTMLElement>(
      "#body-row [data-anser-translation]",
    )!;
    const label = doc.getElementById("button-label")!;
    const view = label.querySelector<HTMLElement>("[data-anser-translation]")!;
    expect(bodyView.style.whiteSpace).toBe("normal");
    expect(bodyView.style.borderInlineStart).toBe("");
    expect(bodyView.style.borderRadius).toBe("6px");
    expect(view.style.whiteSpace).toBe("normal");
    expect(view.style.lineHeight).toBe("1.35");
    expect(view.style.textIndent).toBe("0px");
    expect(view.style.padding).toBe("0px");
    expect(view.querySelector<HTMLElement>("span")?.style.lineHeight).toBe(
      "inherit",
    );
    expect(label.style.padding).toBe("20px");
    expect(
      doc.querySelector<HTMLElement>("#preformatted [data-anser-translation]")!
        .style.whiteSpace,
    ).toBe("pre-wrap");
    plan.dispose();
    expect(doc.body.innerHTML).toBe(original);
  });
  it("keeps original text, inline formatting, links, table and image positions and restores original DOM on hide", () => {
    const doc = mail(
      '<p id="intro" style="font-size:22px;color:rgb(20,30,40);height:24px">Hello <strong>world</strong>, <a href="https://example.com/">read more</a>.</p><table><tr><td>Price</td><td>Annual plan</td></tr></table><ul><li>First item</li></ul><img src="data:image/png;base64,AA==">',
    );
    const original = doc.body.innerHTML;
    const plan = planMailTranslation(doc, "zh-CN");
    expect(doc.body.innerHTML).toBe(original);
    plan.apply(new Map(plan.parts.map((p) => [p.id, `译文${p.text}`])));
    const intro = doc.getElementById("intro")!;
    const translated = intro.querySelector<HTMLElement>(
      "[data-anser-translation]",
    )!;
    expect(translated.style.fontSize).toBe("22px");
    expect(translated.querySelector("strong")?.textContent).toBe("译文world");
    expect(translated.querySelector("a")?.getAttribute("data-mail-href")).toBe(
      "https://example.com/",
    );
    expect(intro.firstChild?.textContent).toBe("Hello ");
    expect(doc.querySelectorAll("tr")).toHaveLength(1);
    expect(doc.querySelectorAll("li")).toHaveLength(1);
    expect(doc.querySelectorAll("td [data-anser-translation]")).toHaveLength(2);
    expect(doc.images).toHaveLength(1);
    plan.dispose();
    expect(doc.body.innerHTML).toBe(original);
  });
  it("does not send hidden content, source HTML, code, images, headers, URLs or already-Chinese paragraphs", () => {
    const doc = mail(
      '<div style="display:none">Hidden secret</div><div aria-hidden="true">Hidden preview</div><div style="opacity:0"><p>Hidden tracking</p></div><p>这里已经是中文。</p><pre><code>private code</code></pre><p><code>API_KEY=secret</code>Visible message</p><img src="https://example.invalid/pixel?private=1"><p>https://example.invalid/secret</p><p>user@example.invalid</p>',
    );
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts.map((p) => p.text)).toEqual([
      "[[CODE_0]]Visible message",
    ]);
    expect(plan.parts.map((p) => p.text).join("\n")).not.toContain(
      "API_KEY=secret",
    );
    plan.apply(new Map([[plan.parts[0].id, "[[CODE_0]]可见消息"]]));
    const view = doc.querySelector<HTMLElement>("[data-anser-translation]")!;
    expect(view.querySelector("code")?.textContent).toBe("API_KEY=secret");
    expect(view.textContent).toBe("API_KEY=secret可见消息");
  });
  it("preserves inline code, kbd, samp, var, wrapped links, URL links and translate=no without sending raw code or URLs", () => {
    const doc = mail(
      `<ul>
        <li id="pr-drawer"><strong>Windows workbench drawer close button.</strong> The drawer is at <code>z-index: 50</code> and starts below <code>--window-titlebar-height</code>.</li>
        <li id="pr-checks"><code>pnpm check:ui</code>, <code>pnpm check:i18n</code> (1,993 bilingual messages), <code>tsc -b</code> and <code>pnpm build</code> passed.</li>
        <li id="end-code">Press <kbd>Cmd+K</kbd> and run <code>pnpm test</code></li>
        <li id="reorder">Use <a href="https://example.com/fn"><code>account_action</code></a> with <var>limit</var> at <a href="https://example.com/docs">https://example.com/docs</a> for <span translate="no">Anser</span>.</li>
      </ul>
      <pre><code>fenced_secret()</code></pre>
      <code style="display:block">block_secret()</code>
      <p><code>only_code_a</code>, <code>only_code_b</code></p>`,
    );
    const original = doc.body.innerHTML;
    const plan = planMailTranslation(doc, "zh-CN");
    const sent = plan.parts.map((p) => p.text).join("\n");
    for (const secret of [
      "z-index: 50",
      "--window-titlebar-height",
      "pnpm check:ui",
      "pnpm check:i18n",
      "tsc -b",
      "pnpm build",
      "Cmd+K",
      "pnpm test",
      "account_action",
      "limit",
      "https://example.com/docs",
      "Anser",
      "fenced_secret",
      "block_secret",
      "only_code_a",
    ]) {
      expect(sent).not.toContain(secret);
    }
    expect(plan.parts.map((p) => p.text)).toEqual([
      "Windows workbench drawer close button.",
      " The drawer is at [[CODE_0]] and starts below [[CODE_1]].",
      "[[CODE_0]], [[CODE_1]] (1,993 bilingual messages), [[CODE_2]] and [[CODE_3]] passed.",
      "Press [[CODE_0]] and run [[CODE_1]]",
      "Use [[CODE_0]] with [[CODE_1]] at [[LINK_2]] for [[KEEP_3]].",
    ]);
    const translated: Record<string, string> = {
      "Windows workbench drawer close button.": "Windows 工作台抽屉关闭按钮。",
      " The drawer is at [[CODE_0]] and starts below [[CODE_1]].":
        " 抽屉位于 [[CODE_0]]，并从 【【CODE_1】】 下方开始。",
      "[[CODE_0]], [[CODE_1]] (1,993 bilingual messages), [[CODE_2]] and [[CODE_3]] passed.":
        "[[CODE_0]]、[[CODE_1]]（1,993 条双语消息）、[[CODE_2]] 和 [[CODE_3]] 均已通过。",
      "Press [[CODE_0]] and run [[CODE_1]]":
        "按下 [[CODE_0]] 并运行 [[CODE_1]]",
      "Use [[CODE_0]] with [[CODE_1]] at [[LINK_2]] for [[KEEP_3]].":
        "在 [[LINK_2]] 中为 [[KEEP_3]] 搭配 [[CODE_1]] 使用 [[CODE_0]]。",
    };
    const reply = plan.parts.map((p) => ({
      id: p.id,
      text: translated[p.text],
    }));
    expect(() => validateTranslationReply(plan.parts, reply)).not.toThrow();
    plan.apply(new Map(reply.map((p) => [p.id, p.text])));
    expect(
      doc.querySelector("#pr-drawer [data-anser-translation]")?.textContent,
    ).toBe(
      "Windows 工作台抽屉关闭按钮。 抽屉位于 z-index: 50，并从 --window-titlebar-height 下方开始。",
    );
    expect(
      doc.querySelector("#pr-checks [data-anser-translation]")?.textContent,
    ).toBe(
      "pnpm check:ui、pnpm check:i18n（1,993 条双语消息）、tsc -b 和 pnpm build 均已通过。",
    );
    const endCodeLi = doc.getElementById("end-code")!;
    expect(
      endCodeLi.lastElementChild?.hasAttribute("data-anser-translation"),
    ).toBe(true);
    expect(endCodeLi.lastElementChild?.textContent).toBe(
      "按下 Cmd+K 并运行 pnpm test",
    );
    const reorderView = doc.querySelector<HTMLElement>(
      "#reorder [data-anser-translation]",
    )!;
    expect(reorderView.textContent).toBe(
      "在 https://example.com/docs 中为 Anser 搭配 limit 使用 account_action。",
    );
    expect(
      [...reorderView.querySelectorAll("a")].map((a) =>
        a.getAttribute("data-mail-href"),
      ),
    ).toEqual(["https://example.com/docs", "https://example.com/fn"]);
    expect(doc.querySelectorAll("[data-anser-translation]")).toHaveLength(4);
    plan.dispose();
    expect(doc.body.innerHTML).toBe(original);
  });
  it("avoids placeholder collisions, never splits placeholders across chunks, and validates placeholder integrity", () => {
    const filler = "Long sentence with details. ".repeat(44);
    const doc = mail(
      `<p>Literal [[CODE_0]] before <code>real_token</code>.</p><p>${filler}use <code>split_safe_token</code> afterwards.</p>`,
    );
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts[0].text).toBe("Literal [[CODE_0]] before [[CODE2_0]].");
    const longParts = plan.parts.slice(1);
    expect(longParts.length).toBeGreaterThan(1);
    expect(longParts.some((p) => p.text.includes("[[CODE_0]]"))).toBe(true);
    expect(
      longParts.every(
        (p) => !/\[\[CODE(?:_)?$/.test(p.text) && !/^CODE_0\]\]/.test(p.text),
      ),
    ).toBe(true);
    const requested = [
      { id: "p0_t0", text: "Run [[CODE_0]] " },
      { id: "p0_t1", text: "with [[CODE_1]]." },
    ];
    // Moving a placeholder across pieces inside the same paragraph is valid.
    expect(() =>
      validateTranslationReply(requested, [
        { id: "p0_t0", text: "使用 [[CODE_1]] 运行 [[CODE_0]]。" },
        { id: "p0_t1", text: "" },
      ]),
    ).not.toThrow();
    // Missing or duplicated placeholder is rejected.
    expect(() =>
      validateTranslationReply(requested, [
        { id: "p0_t0", text: "运行" },
        { id: "p0_t1", text: "搭配 [[CODE_1]]。" },
      ]),
    ).toThrow();
    expect(() =>
      validateTranslationReply(requested, [
        { id: "p0_t0", text: "运行 [[CODE_0]] [[CODE_0]]" },
        { id: "p0_t1", text: "搭配 [[CODE_1]]。" },
      ]),
    ).toThrow();
  });
  it("skips already-target-language mixed paragraphs and bare technical identifiers while keeping English prose with Chinese quotes", () => {
    const doc = mail(
      `<p>请先在 macOS 上运行 <code>pnpm build</code> 验证 PR 与 API。</p>
       <p>Anser 0.1.48 已发布</p>
       <p>v0.1.48</p>
       <p>src/lib/mail-translation.ts</p>
       <p>pausing_an_account_does_not_wait</p>
       <p>Pausing during a background sweep failed with "正在收取该账号邮件，请稍后修改账号".</p>`,
    );
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts.map((p) => p.text)).toEqual([
      'Pausing during a background sweep failed with "正在收取该账号邮件，请稍后修改账号".',
    ]);
    const jaDoc = mail(
      `<p>設定で API キーを確認してください。</p><p>Please check your API key in settings.</p>`,
    );
    expect(planMailTranslation(jaDoc, "ja").parts.map((p) => p.text)).toEqual([
      "Please check your API key in settings.",
    ]);
  });
  it("排除零高度、零宽度、裁剪隐藏和折叠内容，翻译不解除原隐藏约束", () => {
    const doc =
      mail(`<div id="zero" style="max-height:0;overflow:hidden"><b>Hidden secret</b></div>
      <div style="height:0;overflow-y:clip">Hidden height</div>
      <div style="max-width:0;overflow:hidden">Hidden width</div>
      <div style="clip-path:inset(100%)">Hidden clip</div>
      <div style="position:absolute;clip:rect(0px,0px,0px,0px)">Hidden rect</div>
      <details><summary>Visible summary</summary>Hidden direct text<p>Hidden details</p><summary>Hidden second summary</summary></details>
      <details open><summary>Open summary</summary><p>Open details</p></details>
      <p>Visible mail</p>`);
    const original = doc.body.innerHTML;
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts.map((p) => p.text.trim())).toEqual([
      "Visible summary",
      "Open summary",
      "Open details",
      "Visible mail",
    ]);
    plan.apply(new Map(plan.parts.map((p) => [p.id, "译文"])));
    expect(Number.parseFloat(doc.getElementById("zero")!.style.maxHeight)).toBe(
      0,
    );
    expect(doc.getElementById("zero")!.style.overflow).toBe("hidden");
    expect(
      doc.querySelector("details:not([open]) p [data-anser-translation]"),
    ).toBeNull();
    plan.dispose();
    expect(doc.body.innerHTML).toBe(original);
  });
  it("只发送未被祖先裁剪的整段文字，不发送部分不可见的文字节点", () => {
    const doc = mail(
      '<div id="clip" style="height:20px;overflow:hidden"><span>Visible line</span><span>Clipped line</span></div><p>Outside</p>',
    );
    const clipping = doc.getElementById("clip")!;
    Object.defineProperty(clipping, "clientWidth", { value: 200 });
    Object.defineProperty(clipping, "clientHeight", { value: 20 });
    vi.spyOn(clipping, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 200, 20),
    );
    const create = doc.createRange.bind(doc);
    vi.spyOn(doc, "createRange").mockImplementation(() => {
      const range = create();
      Object.defineProperty(range, "getClientRects", {
        value: () => [
          new DOMRect(
            0,
            range.startContainer.textContent === "Clipped line" ? 15 : 0,
            100,
            18,
          ),
        ],
      });
      return range;
    });
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts.map((p) => p.text)).toEqual(["Visible line", "Outside"]);
    plan.apply(new Map(plan.parts.map((p) => [p.id, "译文"])));
    expect(clipping.style.height).toBe("20px");
    expect(clipping.style.overflow).toBe("hidden");
  });
  it("连续 BR 在直接正文及嵌套内联格式间分段，原文译文交替且还原原节点", () => {
    for (const html of [
      "<div>First paragraph<br><br>Second paragraph</div>",
      '<div><a id="link" href="https://example.com/"><strong>First paragraph<br> <br>Second paragraph</strong></a></div>',
      "<div><b>First paragraph</b><br><span> </span><br><i>Second paragraph</i></div>",
    ]) {
      const doc = mail(html);
      const original = doc.body.innerHTML;
      const originalNodes = [...doc.body.querySelectorAll("*")];
      const plan = planMailTranslation(doc, "zh-CN");
      expect(
        plan.parts.filter((p) => p.text.trim()).map((p) => p.text),
      ).toEqual(["First paragraph", "Second paragraph"]);
      expect(doc.body.innerHTML).toBe(original);
      const values = new Map(plan.parts.map((p, i) => [p.id, `译文${i + 1}`]));
      plan.apply(values);
      expect(doc.body.textContent?.replace(/\s/g, "")).toBe(
        "Firstparagraph译文1Secondparagraph译文2",
      );
      expect(doc.querySelectorAll("[data-anser-translation]")).toHaveLength(2);
      expect(doc.querySelector("a a")).toBeNull();
      expect(doc.querySelectorAll("br")).toHaveLength(2);
      plan.dispose();
      expect(doc.body.innerHTML).toBe(original);
      expect([...doc.body.querySelectorAll("*")]).toEqual(originalNodes);
      expect(planMailTranslation(doc, "zh-CN").parts).toEqual(plan.parts);
    }
  });
  it("保留单个换行，不把普通 HTML 源码空行误认为段落", () => {
    const doc = mail("<div>First line<br>Second line\n\nSame paragraph</div>");
    const plan = planMailTranslation(doc, "zh-CN");
    plan.apply(new Map(plan.parts.map((p) => [p.id, "译文"])));
    expect(doc.querySelectorAll("[data-anser-translation]")).toHaveLength(1);
    expect(doc.querySelectorAll("[data-anser-translation] br")).toHaveLength(1);
  });
  it("PRE 普通正文按空行分段，分批显示后隐藏保留原文本节点、空白及链接", () => {
    const doc = mail(
      '<pre><a href="https://example.com/"><b>  Hello world.\nLine two.\n\n  Please review.\n\nThird paragraph.</b></a></pre><pre><code>doNotSend()</code></pre>',
    );
    const original = doc.body.innerHTML;
    const text = doc.querySelector("b")!.firstChild!;
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts.map((p) => p.text)).toEqual([
      "  Hello world.\nLine two.",
      "  Please review.",
      "Third paragraph.",
    ]);
    expect(doc.body.innerHTML).toBe(original);
    const values = new Map<string, string>();
    for (const [i, part] of plan.parts.entries()) {
      values.set(part.id, `译文${i + 1}`);
      plan.apply(values);
    }
    expect(doc.body.textContent).toBe(
      "  Hello world.\nLine two.译文1\n\n  Please review.译文2\n\nThird paragraph.译文3doNotSend()",
    );
    expect(doc.querySelectorAll("pre > [data-anser-translation]")).toHaveLength(
      3,
    );
    expect(doc.querySelector("a a")).toBeNull();
    plan.dispose();
    expect(doc.body.innerHTML).toBe(original);
    expect(doc.querySelector("b")!.firstChild).toBe(text);
    expect(planMailTranslation(doc, "zh-CN").parts).toEqual(plan.parts);
  });
  it("预格式样式正文支持 CRLF 空行，失败计划不修改原件", () => {
    const doc = mail('<div style="white-space:pre-wrap"></div>');
    doc.querySelector("div")!.textContent = "First\r\n\r\nSecond";
    const original = doc.body.innerHTML;
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts.map((p) => p.text)).toEqual(["First", "Second"]);
    plan.dispose();
    expect(doc.body.innerHTML).toBe(original);
    const long = mail(`<pre>${"Long paragraph.\n\n".repeat(9000)}</pre>`);
    const longOriginal = long.body.innerHTML;
    expect(() => planMailTranslation(long, "zh-CN")).toThrow("过长");
    expect(long.body.innerHTML).toBe(longOriginal);
  });
  it("renders hostile model output as literal text and only removes its own generated nodes", () => {
    const doc = mail(
      '<p data-anser-translation="author">Original author marker</p><p>Hello</p>',
    );
    const plan = planMailTranslation(doc, "zh-CN");
    plan.apply(
      new Map(
        plan.parts.map((p) => [
          p.id,
          "<img src=x onerror=alert(1)><script>bad()</script>",
        ]),
      ),
    );
    expect(doc.querySelector("script,img")).toBeNull();
    expect(doc.body.textContent).toContain("<script>bad()</script>");
    plan.dispose();
    expect(
      doc.querySelector('[data-anser-translation="author"]')?.textContent,
    ).toBe("Original author marker");
  });
  it("waits for complete paragraph pieces before displaying it and bounds batches without truncating long text", () => {
    const doc = mail(`<p>${"Long sentence with emoji 🎉. ".repeat(400)}</p>`);
    const plan = planMailTranslation(doc, "zh-CN");
    expect(plan.parts.map((p) => p.text).join("")).toBe(
      "Long sentence with emoji 🎉. ".repeat(400),
    );
    expect(plan.parts.every((p) => p.text.length <= 1200)).toBe(true);
    const values = new Map([[plan.parts[0].id, "首段"]]);
    plan.apply(values);
    expect(doc.querySelector("[data-anser-translation]")).toBeNull();
    for (const p of plan.parts) values.set(p.id, "中文");
    plan.apply(values);
    expect(doc.querySelectorAll("[data-anser-translation]")).toHaveLength(1);
    for (const batch of translationBatches(plan.parts)) {
      expect(batch.length).toBeLessThanOrEqual(64);
      expect(batch.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(
        6000,
      );
    }
    expect(() =>
      planMailTranslation(mail(`<p>${"a".repeat(120001)}</p>`), "zh-CN"),
    ).toThrow("过长");
  });
  it("keeps plain-text paragraphs and escapes markup before using the reader", () => {
    const html = plainMailHtml("Hello\nworld\n\n<script>not code</script>");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll("p")).toHaveLength(2);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.body.textContent).toBe("Hello\nworld<script>not code</script>");
  });
});
