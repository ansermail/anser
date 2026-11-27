// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  applyMailColorScheme,
  classifyDarkLogoPixels,
  classifyMailImages,
  safeMailHtml,
  mailLink,
  isMailDocument,
  interceptMailLinks,
} from "./mail-html";
describe("untrusted email rendering", () => {
  it("keeps a light backing for the brand footer while adapting the main mail and tiny analytics images", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    try {
      doc.open();
      doc.write(
        safeMailHtml(
          '<div id="main" style="background-color:#fff"><h1>Readable message</h1><div id="footer" style="background-color:#f4f4f4"><img alt="Company logo" width="64" height="20"><span style="color:#222">Caption</span></div></div><p id="analytics" style="background-color:#fff"><img width="1" height="1"></p>',
        ),
      );
      doc.close();
      applyMailColorScheme(doc, "dark");
      const computed = (id: string) =>
        doc.defaultView!.getComputedStyle(doc.getElementById(id)!);
      expect(computed("main").backgroundColor).toBe("rgb(28, 28, 30)");
      expect(computed("footer").backgroundColor).toBe("rgb(244, 244, 244)");
      expect(computed("analytics").backgroundColor).toBe("rgb(28, 28, 30)");
      expect(
        doc.getElementById("footer")!.querySelector("span")!.style.color,
      ).toBe("rgb(34, 34, 34)");
    } finally {
      iframe.remove();
    }
  });
  it("keeps a multi-row authored footer around a compact wordmark image light", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    const footerCopy =
      "The voice platform for every language. Build accurate, low-latency speech recognition and translation experiences for products across web, mobile, and the contact center. " +
      "Soniox combines speech-to-text, text-to-speech, and real-time translation in one API so teams can ship voice features without assembling multiple vendors.";
    expect(footerCopy.length).toBeGreaterThan(320);
    try {
      doc.open();
      doc.write(
        safeMailHtml(
          `<table><tr><td id="main" style="background-color:#fff"><h1>Readable message</h1></td></tr><tr><td id="footer" style="padding:24px;background-color:#f4f4f4;border-radius:18px"><table><tr><td><img alt="Soniox" title="Soniox" width="100"><p style="color:rgba(13,13,13,0.7)">${footerCopy}</p></td></tr><tr><td>Website · Docs · Console</td></tr><tr><td>© 2026 Soniox, Inc. · Unsubscribe</td></tr></table></td></tr></table>`,
        ),
      );
      doc.close();
      applyMailColorScheme(doc, "dark");
      const computed = (id: string) =>
        doc.defaultView!.getComputedStyle(doc.getElementById(id)!);
      expect(computed("main").backgroundColor).toBe("rgb(28, 28, 30)");
      expect(computed("footer").backgroundColor).toBe("rgb(244, 244, 244)");
      expect(
        doc
          .getElementById("footer")!
          .hasAttribute("data-anser-light-image-surface"),
      ).toBe(true);
    } finally {
      iframe.remove();
    }
  });
  it("shows fallback text while remote email fonts are still loading", () => {
    const html = safeMailHtml(
      `<style>@font-face { font-family: Mail; src: url(https://cdn.example/mail.woff2); }</style><p>Readable now</p>`,
      "font-display",
      true,
      true,
    );
    expect(html).toContain("font-display:swap;");
    expect(html).toContain("Readable now");
  });
  it("makes near-black tinted headings readable without recoloring saturated text or authored color surfaces", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<h1 id="ink" style="color:#1f1b2e">Heading</h1><p id="brand" style="color:#215aff">Brand</p><div style="background:#edaa45"><p id="on-brand" style="color:#222">Ink on brand surface</p></div><div style="background-image:url(https://example.com/a.png)"><p id="on-image" style="color:#222">Image text</p></div>',
      ),
      "text/html",
    );
    Object.defineProperty(doc, "defaultView", {
      value: {
        getComputedStyle: (element: Element) => {
          const style = (element as HTMLElement).style;
          return {
            color: style.color || "rgb(0, 0, 0)",
            backgroundColor: style.backgroundColor || "rgba(0, 0, 0, 0)",
            backgroundImage: style.backgroundImage || "none",
            display: "block",
          };
        },
      },
    });
    applyMailColorScheme(doc, "dark");
    expect(doc.querySelector<HTMLElement>("#ink")!.style.color).toBe(
      "rgb(237, 237, 237)",
    );
    expect(doc.querySelector<HTMLElement>("#brand")!.style.color).toBe(
      "rgb(33, 90, 255)",
    );
    expect(doc.querySelector<HTMLElement>("#on-brand")!.style.color).toBe(
      "rgb(34, 34, 34)",
    );
    expect(doc.querySelector<HTMLElement>("#on-image")!.style.color).toBe(
      "rgb(34, 34, 34)",
    );
  });
  it("removes text-baseline seams only from tight image-only runs without changing authored spacing", () => {
    const html = `<p id="slices" style="margin:0;padding:7px"><span style="font-size:18px"><img width="200" height="90" src="https://example.com/a.png"><a href="https://example.com/"><img width="200" height="60" src="https://example.com/b.png"></a></span></p>
      <p id="prose">Read <img src="https://example.com/icon.png"> this <img src="https://example.com/icon2.png"> text.</p>
      <p id="breaks"><img src="https://example.com/a.png"><br><br><img src="https://example.com/b.png"></p>`;
    const doc = new DOMParser().parseFromString(
      safeMailHtml(html),
      "text/html",
    );
    expect(doc.querySelectorAll("[data-anser-image-run]")).toHaveLength(1);
    const slices = doc.getElementById("slices")!;
    expect(slices.hasAttribute("data-anser-image-run")).toBe(true);
    expect(slices.getAttribute("style")).toBe("margin:0;padding:7px");
    expect(doc.querySelectorAll("br")).toHaveLength(2);
    expect(slices.querySelector("img")?.getAttribute("height")).toBe("90");
    expect(slices.querySelector("a")?.getAttribute("data-mail-href")).toBe(
      "https://example.com/",
    );
  });
  it("marks the isolated document with the requested reader color scheme", () => {
    const light = new DOMParser().parseFromString(
      safeMailHtml("<p>light</p>"),
      "text/html",
    );
    expect(
      light.querySelector('meta[name="color-scheme"]')?.getAttribute("content"),
    ).toBe("light");
    expect(light.querySelector("#anser-mail-theme")?.textContent).not.toContain(
      "color-scheme:dark",
    );

    const dark = new DOMParser().parseFromString(
      safeMailHtml("<p>dark</p>", "dark-mail", false, false, "dark"),
      "text/html",
    );
    expect(
      dark.querySelector('meta[name="color-scheme"]')?.getAttribute("content"),
    ).toBe("dark");
    expect(dark.querySelector("#anser-mail-theme")?.textContent).toContain(
      "color-scheme:dark",
    );
    expect(dark.querySelector("#anser-mail-theme")?.textContent).toContain(
      "color:rgb(237, 237, 237)!important",
    );
  });
  it("adapts neutral colors in dark mode without changing brand colors or image-backed layouts", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<div id="neutral" style="background:#fff;color:#242424"><p id="text">Body</p><a id="link" href="https://example.com">Link</a></div><div id="brand" style="background:#b72025;color:#fff">Bank</div><div id="image" style="background:url(https://images.example/banner.png);color:#222">Banner</div>',
        "dark",
        false,
        false,
        "dark",
      ),
      "text/html",
    );
    Object.defineProperty(doc, "defaultView", {
      value: {
        getComputedStyle: (element: Element) => {
          const inline = (element as HTMLElement).style;
          return {
            backgroundColor: inline.backgroundColor || "rgba(0, 0, 0, 0)",
            backgroundImage: inline.backgroundImage || "none",
            color: inline.color || "rgb(0, 0, 0)",
            display: "block",
          };
        },
      },
    });
    applyMailColorScheme(doc, "dark");
    expect(doc.documentElement.dataset.mailColorScheme).toBe("dark");
    expect(doc.body.style.backgroundColor).toBe("rgb(28, 28, 30)");
    expect(doc.body.style.color).toBe("rgb(237, 237, 237)");
    expect(
      doc.querySelector<HTMLElement>("#neutral")!.style.backgroundColor,
    ).toBe("rgb(28, 28, 30)");
    expect(doc.querySelector<HTMLElement>("#text")!.style.color).toBe(
      "rgb(237, 237, 237)",
    );
    expect(doc.querySelector<HTMLElement>("#link")!.style.color).toBe(
      "rgb(137, 180, 250)",
    );
    expect(
      doc.querySelector<HTMLElement>("#brand")!.style.backgroundColor,
    ).toBe("rgb(183, 32, 37)");
    expect(doc.querySelector<HTMLElement>("#image")!.style.color).toBe(
      "rgb(34, 34, 34)",
    );
  });
  it("uses the application background for neutral dark-mode surfaces", () => {
    const background = "oklch(0.145 0 0)";
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<div id="neutral" style="background:#fff;color:#242424">Body</div><div id="brand" style="background:#b72025;color:#fff">Bank</div>',
        "dark",
        false,
        false,
        "dark",
        background,
      ),
      "text/html",
    );
    Object.defineProperty(doc, "defaultView", {
      value: {
        getComputedStyle: (element: Element) => {
          const inline = (element as HTMLElement).style;
          return {
            backgroundColor: inline.backgroundColor || "rgba(0, 0, 0, 0)",
            backgroundImage: inline.backgroundImage || "none",
            color: inline.color || "rgb(0, 0, 0)",
            display: "block",
          };
        },
      },
    });

    applyMailColorScheme(doc, "dark", background);

    expect(doc.querySelector("#anser-mail-theme")?.textContent).toContain(
      `background-color:${background}!important`,
    );
    expect(doc.body.style.backgroundColor).toBe(background);
    expect(
      doc.querySelector<HTMLElement>("#neutral")!.style.backgroundColor,
    ).toBe(background);
    expect(
      doc.querySelector<HTMLElement>("#brand")!.style.backgroundColor,
    ).toBe("rgb(183, 32, 37)");
  });
  it("inverts neutral light-gray surfaces, borders, and black buttons along one lightness curve in dark mode", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    try {
      doc.open();
      doc.write(
        safeMailHtml(
          '<div id="page" style="background-color:#ffffff"><a id="cta" href="https://example.com" style="display:inline-block;background-color:#000000;color:#ffffff;border-radius:999px;padding:10px 18px">Download Ollama</a><div id="code" style="background-color:#f5f5f5;border-radius:8px;padding:12px;color:#111111">ollama run inkling-2-mini</div><div id="divider" style="border-top:1px solid #e5e7eb">Section</div></div>',
          "dark-details",
          false,
          false,
          "dark",
        ),
      );
      doc.close();
      applyMailColorScheme(doc, "dark");
      const page = doc.getElementById("page")!;
      const code = doc.getElementById("code")!;
      const cta = doc.getElementById("cta")!;
      const divider = doc.getElementById("divider")!;
      expect(page.style.backgroundColor).toBe("rgb(28, 28, 30)");
      expect(code.style.backgroundColor).toBe("rgb(44, 44, 46)");
      expect(code.style.color).toBe("rgb(237, 237, 237)");
      expect(cta.style.backgroundColor).toBe("rgb(232, 232, 234)");
      expect(cta.style.color).toBe("rgb(24, 24, 27)");
      expect(divider.style.borderTopColor).toBe("rgb(60, 60, 62)");
    } finally {
      iframe.remove();
    }
  });
  it("inverts nested black pill buttons seamlessly into crisp light buttons and avoids white header bars", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    try {
      doc.open();
      doc.write(
        safeMailHtml(
          '<table><tr><td id="brand-header" style="background-color:#ffffff"><img alt="Grok Bot" width="24" height="24"><span id="brand-name" style="color:#111111">Grok Bot</span></td></tr><tr><td id="cta-wrap" style="background-color:#000000;border-radius:999px;padding:12px 24px"><a id="cta-link" href="https://example.com" style="display:block;background-color:#000000;border:2px solid #000000;color:#ffffff">Get 2 months for $30</a></td></tr></table>',
          "dark-grok",
          false,
          false,
          "dark",
        ),
      );
      doc.close();
      applyMailColorScheme(doc, "dark");
      const header = doc.getElementById("brand-header")!;
      const brandName = doc.getElementById("brand-name")!;
      const ctaWrap = doc.getElementById("cta-wrap")!;
      const ctaLink = doc.getElementById("cta-link")!;
      expect(header.hasAttribute("data-anser-light-image-surface")).toBe(false);
      expect(header.style.backgroundColor).toBe("rgb(28, 28, 30)");
      expect(brandName.style.color).toBe("rgb(237, 237, 237)");
      expect(ctaWrap.style.backgroundColor).toBe("rgb(232, 232, 234)");
      expect(ctaLink.style.backgroundColor).toBe("rgb(232, 232, 234)");
      expect(ctaLink.style.borderTopColor).toBe("rgb(232, 232, 234)");
      expect(ctaLink.style.color).toBe("rgb(24, 24, 27)");
    } finally {
      iframe.remove();
    }
  });
  it("respects an authored dark canvas", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    try {
      doc.open();
      doc.write(
        safeMailHtml(
          '<body style="background:#0d1117;color:#e6edf3"><div id="native-card" style="background-color:#ffffff;color:#111111">Native dark aware</div>',
          "dark-native",
          false,
          false,
          "dark",
        ),
      );
      doc.close();
      applyMailColorScheme(doc, "dark");
      expect(doc.getElementById("native-card")!.style.backgroundColor).toBe(
        "rgb(255, 255, 255)",
      );
      expect(doc.querySelector("#anser-mail-theme")?.textContent).toBe(
        ":root{color-scheme:dark}",
      );
    } finally {
      iframe.remove();
    }
  });
  it("adapts a light canvas with empty or localized author dark rules", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    try {
      doc.open();
      doc.write(
        safeMailHtml(
          `<style>@media (prefers-color-scheme: dark) {} @media (prefers-color-scheme: dark) { a { color: #98bcff; } }</style><body style="background:#e4e4e4"><div id="card" style="background:white;color:#111">Welcome</div></body>`,
        ),
      );
      doc.close();
      applyMailColorScheme(doc, "dark", "#202020");
      expect(doc.getElementById("card")!.style.backgroundColor).toBe(
        "rgb(32, 32, 32)",
      );
      applyMailColorScheme(doc, "light");
      expect(doc.getElementById("card")!.style.backgroundColor).toBe("white");
    } finally {
      iframe.remove();
    }
  });
  it("classifies transparent and tight white-matted monochrome logos without touching colorful logos, white logos, or gray cards", () => {
    const makePixels = (entries: [number, number, number, number][]) =>
      new Uint8ClampedArray(entries.flat());
    // Black transparent wordmark (e.g. Grok Bot)
    const darkWordmark = makePixels([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [10, 10, 10, 255],
      [15, 15, 15, 255],
      [20, 20, 20, 255],
      [12, 12, 12, 255],
      [8, 8, 8, 255],
      [18, 18, 18, 255],
      [14, 14, 14, 255],
      [255, 255, 255, 255],
    ]);
    expect(classifyDarkLogoPixels(darkWordmark, 4, 3)).toBe("transparent-dark");

    // Tight-cropped white-matted black line-art touching bottom & right edges (e.g. Ollama)
    const whiteMatted = new Uint8ClampedArray(8 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = (y * 8 + x) * 4;
        const isInk = y === 3 || x === 7;
        const c = isInk ? 10 : 255;
        whiteMatted[idx] = c;
        whiteMatted[idx + 1] = c;
        whiteMatted[idx + 2] = c;
        whiteMatted[idx + 3] = 255;
      }
    }
    expect(classifyDarkLogoPixels(whiteMatted, 8, 4)).toBe("white-matted-dark");

    // Shaded light-gray banner (#f2f3f5 like Black Friday): must not invert
    const grayBanner = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const idx = i * 4;
      grayBanner[idx] = i < 14 ? 242 : 10;
      grayBanner[idx + 1] = i < 14 ? 243 : 10;
      grayBanner[idx + 2] = i < 14 ? 245 : 10;
      grayBanner[idx + 3] = 255;
    }
    expect(classifyDarkLogoPixels(grayBanner, 4, 4)).toBe("none");

    // Colorful transparent logo: must not invert
    const colorfulLogo = makePixels([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [220, 40, 40, 255],
      [40, 120, 230, 255],
      [20, 20, 20, 255],
      [20, 20, 20, 255],
    ]);
    expect(classifyDarkLogoPixels(colorfulLogo, 3, 2)).toBe("none");

    // Already-white transparent logo: must not invert
    const whiteLogo = makePixels([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [245, 245, 245, 255],
      [250, 250, 250, 255],
      [255, 255, 255, 255],
      [240, 240, 240, 255],
    ]);
    expect(classifyDarkLogoPixels(whiteLogo, 3, 2)).toBe("none");
  });
  it("transitions dark -> light -> dark palettes in place and tags native logos via cache lookup", async () => {
    const html = safeMailHtml(
      '<div id="page" style="background-color:#ffffff;color:#111111"><img id="logo" src="https://images.example/ollama.png"><div id="code" style="background-color:#f5f5f5;color:#222222">ollama run</div></div>',
      "smooth-switch",
      true,
      true,
      "light",
    );
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    try {
      doc.open();
      doc.write(html);
      doc.close();
      const logo = doc.getElementById("logo") as HTMLImageElement;
      Object.defineProperties(logo, {
        complete: { value: true },
        naturalWidth: { value: 120 },
        naturalHeight: { value: 40 },
      });
      await classifyMailImages(doc, async (urls) => {
        expect(urls).toEqual(["https://images.example/ollama.png"]);
        return { "https://images.example/ollama.png": "white-matted-dark" };
      });
      expect(logo.getAttribute("data-anser-logo")).toBe("white-matted-dark");

      // Light -> Dark palette 1 (animated in-place)
      applyMailColorScheme(doc, "dark", "#121714", true);
      expect(doc.getElementById("page")!.style.backgroundColor).toBe(
        "rgb(18, 23, 20)",
      );
      expect(doc.getElementById("code")!.style.backgroundColor).not.toBe(
        "rgb(18, 23, 20)",
      );
      expect(doc.querySelector("#anser-mail-theme")?.textContent).toContain(
        "transition:",
      );

      // Dark palette 1 -> Dark palette 2 (in-place recalculation from original source colors)
      applyMailColorScheme(doc, "dark", "#282a36", true);
      expect(doc.getElementById("page")!.style.backgroundColor).toBe(
        "rgb(40, 42, 54)",
      );

      // Dark -> Light (restores authentic author styles cleanly)
      applyMailColorScheme(doc, "light", "#fff", true);
      expect(doc.getElementById("page")!.style.backgroundColor).toBe(
        "rgb(255, 255, 255)",
      );
      expect(doc.getElementById("code")!.style.backgroundColor).toBe(
        "rgb(245, 245, 245)",
      );
    } finally {
      iframe.remove();
    }
  });
  it("preserves authored table sizing without making every letter a min-content break", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<table style="width:100%"><tr><th style="width:24px;padding:16px 0 16px 16px">Status</th><th style="width:100%;padding:16px">Job</th><th style="white-space:nowrap">Annotations</th></tr><tr><td>×</td><td>Checks / test</td><td>2</td></tr></table><p>https://example.invalid/long-resource-name</p>',
      ),
      "text/html",
    );
    expect(doc.querySelector("th")?.style.width).toBe("24px");
    expect(doc.querySelector("th")?.textContent).toBe("Status");
    expect(doc.querySelectorAll("th")[1].style.width).toBe("100%");
    expect(doc.querySelectorAll("th")[2].style.whiteSpace).toBe("nowrap");
    expect(doc.head.textContent).toContain("overflow-wrap:break-word");
    expect(doc.head.textContent).not.toContain("overflow-wrap:anywhere");
  });
  it("keeps leading styles in email fragments and classes on full documents", () => {
    for (const html of [
      '<meta name="viewport"><style>.mail_cnt{max-width:700px}.title_bold{font-weight:bold}</style><div class="mail_cnt"><p class="title_bold">每周概况</p></div>',
      '<html><head><style>.mail_cnt{max-width:700px}</style></head><body class="mail_cnt" style="background:#eee" onload="alert(1)">每周概况</body></html>',
    ]) {
      const doc = new DOMParser().parseFromString(
        safeMailHtml(html),
        "text/html",
      );
      expect(
        [...doc.querySelectorAll("style")].some((s) =>
          s.textContent?.includes(".mail_cnt{max-width:700px}"),
        ),
      ).toBe(true);
      expect(doc.querySelector(".mail_cnt")).not.toBeNull();
      expect(doc.body.textContent).toContain("每周概况");
      expect(doc.body.hasAttribute("onload")).toBe(false);
      expect(doc.querySelector("meta[name=viewport]")).toBeNull();
    }
  });
  it("strips executable content while preserving normal links", () => {
    const html = safeMailHtml(
      '<script>alert(1)</script><img src="x" onerror="alert(2)"><iframe src="https://evil.example"></iframe><a href="https://evil.example">Link</a><form action="https://evil.example"><input></form>',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("script,iframe,form,input")).toBeNull();
    expect(doc.querySelector("[onerror]")).toBeNull();
    expect(doc.querySelector("a")?.getAttribute("data-mail-href")).toBe(
      "https://evil.example",
    );
  });
  it("permits remote and embedded images", () => {
    const html = safeMailHtml(
      '<img src="data:image/png;base64,aGVsbG8="><img src="https://tracker.example/pixel">',
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const policy = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute("content");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("img-src data: https:");
    expect(policy).toContain("font-src data: https:");
    expect(policy).toContain("form-action 'none'");
    expect(doc.querySelector("img")?.src).toMatch(/^data:/);
  });
  it("upgrades legacy resources including srcset and CSS without changing links", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        `<style>@font-face{font-family:Mail;src:url('http://fonts.example/mail.woff2')} .banner{background:url(//images.example/banner.png)}</style><table background="http://images.example/bg.png"><tr><td style="background-image:url(http://images.example/bg2.png)"><img src="http://images.example/a.jpg" srcset="http://images.example/a.jpg 1x, http://images.example/b.jpg 2x"><a href="http://example.com">Link</a></td></tr></table>`,
      ),
      "text/html",
    );
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "https://images.example/a.jpg",
    );
    expect(doc.querySelector("img")?.getAttribute("srcset")).not.toContain(
      "http:",
    );
    expect(doc.querySelector("table")?.getAttribute("background")).toBe(
      "https://images.example/bg.png",
    );
    expect(doc.querySelector("td")?.getAttribute("style")).toContain(
      "https://images.example/bg2.png",
    );
    expect(doc.head.textContent).toContain("https://fonts.example/mail.woff2");
    expect(doc.head.textContent).toContain("https://images.example/banner.png");
    expect(doc.querySelector("a")?.getAttribute("data-mail-href")).toBe(
      "http://example.com",
    );
    expect(
      doc
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
    ).toContain("upgrade-insecure-requests");
  });
  it("resolves protocol-relative image URLs without touching embedded images", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<img src="//images.example/logo.png" srcset="//images.example/a.png 1x, //images.example/b.png 2x"><img src="data:image/png;base64,aGVsbG8=">',
      ),
      "text/html",
    );
    expect(doc.querySelector("img")?.getAttribute("src")).toBe(
      "https://images.example/logo.png",
    );
    expect(doc.querySelector("img")?.getAttribute("srcset")).toBe(
      "https://images.example/a.png 1x, https://images.example/b.png 2x",
    );
    expect(doc.querySelectorAll("img")[1].getAttribute("src")).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
  });
  it("preserves readable Chinese and rich text", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        "<h2>项目更新</h2><p>正文 <b>重要</b></p><table><tr><td>数据</td></tr></table>",
      ),
      "text/html",
    );
    expect(doc.querySelector("h2")?.textContent).toBe("项目更新");
    expect(doc.querySelector("td")?.textContent).toBe("数据");
  });
  it("accepts web and compose links but rejects executable and local URLs", () => {
    for (const href of [
      "https://example.com/page",
      "http://example.com",
      "mailto:team@example.com?subject=Hello",
    ])
      expect(mailLink(href)).not.toBeNull();
    for (const href of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,test",
      "bad url",
    ])
      expect(mailLink(href)).toBeNull();
    const doc = new DOMParser().parseFromString(
      safeMailHtml('<a href="javascript:alert(1)">bad</a>'),
      "text/html",
    );
    expect(doc.querySelector("a")?.hasAttribute("href")).toBe(false);
  });
});

describe("mail link navigation", () => {
  it("routes every native image source through the proxy transport while routing fonts separately and preserving embedded bytes and links", () => {
    const html = `<style>@import url('https://fonts.example/css?family=Font'); @font-face{font-family:Mail;src:url('https://fonts.example/font.woff2')} @media screen{.hero{background-image:url('https://images.example/css.png?x=1&y=2')}}</style><table background="http://images.example/bg.png"><tr><td style="background:url(//images.example/inline.png)"><picture><source srcset="https://images.example/large.png 2x"><img src="https://images.example/hero.gif?x=1&amp;y=2" srcset="https://images.example/a,b.png 1x, https://images.example/retina.png 2x" onerror="alert(1)"></picture><img src="data:image/png;base64,aGVsbG8="><a href="https://example.com/path">open</a></td></tr></table>`;
    const doc = new DOMParser().parseFromString(
      safeMailHtml(html, "native-images", true),
      "text/html",
    );
    const original = (value: string) => new URL(value).searchParams.get("url");
    expect(original(doc.images[0].getAttribute("src")!)).toBe(
      "https://images.example/hero.gif?x=1&y=2",
    );
    expect(doc.images[0].hasAttribute("onerror")).toBe(false);
    const candidates = doc.images[0].getAttribute("srcset")!.split(", ");
    expect(original(candidates[0].split(" ")[0])).toBe(
      "https://images.example/a,b.png",
    );
    expect(candidates[1]).toContain(" 2x");
    expect(doc.querySelector("source")?.getAttribute("srcset")).toContain(
      "anser-image://localhost/fetch?",
    );
    expect(
      original(doc.querySelector("table")!.getAttribute("background")!),
    ).toBe("https://images.example/bg.png");
    expect(doc.querySelector("td")!.getAttribute("style")).toContain(
      "anser-image://localhost/fetch?",
    );
    expect(doc.head.textContent).toContain("anser-image://localhost/fetch?");
    expect(doc.head.textContent).toContain(
      "anser-font://localhost/fetch?url=https%3A%2F%2Ffonts.example%2Ffont.woff2",
    );
    expect(doc.head.textContent).toContain(
      '@import url("anser-style://localhost/fetch?url=https%3A%2F%2Ffonts.example%2Fcss%3Ffamily%3DFont")',
    );
    expect(doc.images[1].getAttribute("src")).toBe(
      "data:image/png;base64,aGVsbG8=",
    );
    expect(doc.querySelector("a")?.getAttribute("data-mail-href")).toBe(
      "https://example.com/path",
    );
    expect(
      doc
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute("content"),
    ).toContain("img-src data: https: anser-image:");
    const browser = safeMailHtml(html);
    expect(browser).not.toContain("anser-image:");
    expect(browser).toContain("https://images.example/hero.gif");
    // Printing may use native images without native reader link navigation.
    const print = safeMailHtml(html, "print", false, true);
    expect(print).toContain("anser-image:");
    expect(print).not.toContain("anser-mail-link.invalid");
  });
  it("routes native links without scripts or navigation inside the email frame", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<a href="https://example.com/path?x=1&amp;y=2" target="_blank">web</a><a href="mailto:team@example.com?subject=hello">mail</a><a href="#bottom">bottom</a><a href="file:///tmp/private">unsafe</a><script>alert(1)</script>',
        "native",
        true,
      ),
      "text/html",
    );
    const links = doc.querySelectorAll("a");
    for (const [index, original] of [
      [0, "https://example.com/path?x=1&y=2"],
      [1, "mailto:team@example.com?subject=hello"],
    ] as const) {
      const routed = new URL(links[index].getAttribute("href")!);
      expect(routed.protocol).toBe("https:");
      expect(routed.hostname).toBe("anser-mail-link.invalid");
      expect(routed.searchParams.get("url")).toBe(original);
      expect(links[index].getAttribute("target")).toBe("_top");
    }
    expect(links[2].getAttribute("href")).toBe("#bottom");
    expect(links[3].hasAttribute("href")).toBe(false);
    expect(doc.querySelector("script")).toBeNull();
  });
  it("recognizes WebKit srcdoc documents without depending on the reported URL", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml("<p>mail</p>", "current"),
      "text/html",
    );
    Object.defineProperty(doc, "URL", { value: "about:blank" });
    expect(isMailDocument(doc, "current")).toBe(true);
    expect(isMailDocument(doc, "previous")).toBe(false);
    expect(isMailDocument(document, "current")).toBe(false);
  });
  it("opens nested and middle-clicked links externally while keeping the mail document intact", () => {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(
        '<a href="https://example.com/page" target="_self"><span>open</span></a><a href="mailto:team@example.com">mail</a><a href="#section">section</a>',
      ),
      "text/html",
    );
    const open = vi.fn();
    const cleanup = interceptMailLinks(doc, open);
    const anchor = doc.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("#");
    expect(anchor.hasAttribute("target")).toBe(false);
    for (const [type, button] of [
      ["click", 0],
      ["auxclick", 1],
    ] as const) {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button,
      });
      anchor.querySelector("span")!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    expect(open.mock.calls).toEqual([
      ["https://example.com/page"],
      ["https://example.com/page"],
    ]);
    doc
      .querySelectorAll("a")[1]
      .dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    expect(open).toHaveBeenLastCalledWith("mailto:team@example.com");
    const fragment = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    doc.querySelectorAll("a")[2].dispatchEvent(fragment);
    expect(fragment.defaultPrevented).toBe(false);
    cleanup();
    anchor.click();
    expect(open).toHaveBeenCalledTimes(3);
  });
});

it("loads font stylesheet links and imports only inside the isolated reader", () => {
  const html = `<link rel="stylesheet" href="//fonts.googleapis.com/css?family=Roboto"><link rel="preload" as="script" href="https://evil.example/code.js"><link rel="stylesheet" href="file:///private"><style>@import "//fonts.example/font.css"; @FONT-FACE{font-family:Mail;src:URL('https://fonts.example/font.woff2')} .hero{background:url(https://images.example/a.png)}</style><script>alert(1)</script><form action="https://evil.example"></form>`;
  for (const native of [false, true]) {
    const doc = new DOMParser().parseFromString(
      safeMailHtml(html, "font", native),
      "text/html",
    );
    const links = doc.querySelectorAll("link");
    expect(links).toHaveLength(1);
    expect(links[0].href).toContain(
      native
        ? "anser-style://localhost/fetch?"
        : "https://fonts.googleapis.com/css?",
    );
    expect(links[0].getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(doc.head.textContent).toContain(
      native ? "anser-font://" : "https://fonts.example/font.woff2",
    );
    expect(doc.head.textContent).toContain(
      native
        ? "anser-style://localhost/fetch?url=https%3A%2F%2Ffonts.example%2Ffont.css"
        : "//fonts.example/font.css",
    );
    const csp = doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute("content")!;
    expect(csp).toContain(
      native
        ? "style-src 'unsafe-inline' anser-style:"
        : "style-src 'unsafe-inline' https:",
    );
    expect(csp).toContain(
      native ? "font-src data: anser-font:" : "font-src data: https:",
    );
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(doc.querySelector("script,form")).toBeNull();
  }
});
