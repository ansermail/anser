import { t } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { MailBodySkeleton } from "./mail-skeleton";
import { disableNativeContextMenu } from "../lib/context-menu";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { watchMailImages, type MailImageStatus } from "../lib/mail-images";
import {
  applyMailColorScheme,
  interceptMailLinks,
  isMailDocument,
  safeMailHtml,
  type MailColorScheme,
} from "../lib/mail-html";
import { mailDocumentHeight } from "../lib/mail-layout";
import { applyThemeClass, useTheme } from "../lib/theme";

export function MailContent({
  html,
  onOpenLink,
  title = t("Message body"),
  inspectable = false,
  onDocumentReady,
}: {
  html: string;
  title?: string;
  inspectable?: boolean;
  onDocumentReady?: (doc: Document | null) => void;
  onOpenLink: (href: string) => void;
}) {
  const { dark } = useTheme();
  const colorScheme: MailColorScheme = dark ? "dark" : "light";
  const [themeBackground, setThemeBackground] = useState<{
    colorScheme: MailColorScheme;
    value: string;
  }>();
  useLayoutEffect(() => {
    // Read the variable only after the resolved appearance is on the root:
    // the parent's effect runs later than this layout effect, so a theme
    // switch would otherwise pick up the previous scheme's background.
    applyThemeClass(dark);
    setThemeBackground({
      colorScheme,
      value: getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim(),
    });
  }, [colorScheme, dark]);
  const background =
    themeBackground?.colorScheme === colorScheme
      ? themeBackground.value
      : undefined;
  const notifyDocument = useRef(onDocumentReady);
  notifyDocument.current = onDocumentReady;
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<() => void>(() => {});
  const initialized = useRef<Document | null>(null);
  const [ready, setReady] = useState(false);
  const [images, setImages] = useState<MailImageStatus>({
    waiting: 0,
    timedOut: 0,
    failed: 0,
  });
  const retryImages = useRef(() => {});
  const content = useMemo(() => {
    const id = crypto.randomUUID();
    return {
      id,
      srcDoc: safeMailHtml(
        html,
        id,
        isTauri(),
        isTauri(),
        colorScheme,
        background,
      ),
    };
  }, [background, colorScheme, html]);
  const srcDoc = content.srcDoc;
  const open = useRef(onOpenLink);
  open.current = onOpenLink;
  useEffect(() => {
    setReady(false);
    setImages({ waiting: 0, timedOut: 0, failed: 0 });
    retryImages.current = () => {};
    initialized.current = null;
    cleanup.current();
    // DOM can be readable before onLoad, which waits for every remote image.
    let pending = 0;
    const waitForDocument = () => {
      const doc = frame.current?.contentDocument;
      if (
        doc &&
        isMailDocument(doc, content.id) &&
        doc.readyState !== "loading"
      )
        loaded();
      else pending = requestAnimationFrame(waitForDocument);
    };
    pending = requestAnimationFrame(waitForDocument);
    return () => {
      cancelAnimationFrame(pending);
      cleanup.current();
    };
  }, [srcDoc, inspectable]);
  function loaded() {
    const iframe = frame.current;
    const doc = iframe?.contentDocument;
    if (
      !iframe ||
      !doc?.body ||
      !isMailDocument(doc, content.id) ||
      initialized.current === doc
    )
      return;
    cleanup.current();
    initialized.current = doc;
    // Email templates often declare html/body height:100%. Force content
    // height so resizing the frame cannot grow its own measurement forever.
    for (const element of [doc.documentElement, doc.body]) {
      element.style.setProperty("height", "auto", "important");
      element.style.setProperty("min-height", "0", "important");
      element.style.setProperty("max-height", "none", "important");
      element.style.setProperty("overflow", "visible", "important");
    }
    // The frame grows to the measured content height, so it never needs its own
    // vertical scrollbar. Letting one appear while the frame is still short
    // narrows the body by the scrollbar width and re-wraps the text; when the
    // frame then grows the bar disappears and the text wraps back, which keeps
    // the lower half oscillating on widths near a wrap boundary. Horizontal
    // overflow still scrolls and is compensated in the measured height.
    doc.documentElement.style.setProperty("overflow-x", "auto", "important");
    doc.documentElement.style.setProperty("overflow-y", "hidden", "important");
    // Keep the usual block layout, while containing collapsed margins and
    // floats in the measured body. Preserve templates with custom flex/grid.
    if (doc.defaultView?.getComputedStyle(doc.body).display === "block")
      doc.body.style.setProperty("display", "flow-root", "important");
    applyMailColorScheme(doc, colorScheme, background);
    const resize = () => {
      const height = `${mailDocumentHeight(doc)}px`;
      if (iframe.style.height !== height) iframe.style.height = height;
    };
    let pendingResize = 0;
    const scheduleResize = () => {
      if (pendingResize) return;
      pendingResize = requestAnimationFrame(() => {
        pendingResize = 0;
        resize();
      });
    };
    const nativeFrame = isTauri();
    const imageTracker = watchMailImages(
      doc,
      (status) => {
        setImages(status);
        scheduleResize();
      },
      !nativeFrame,
    );
    retryImages.current = imageTracker.retry;
    const refresh = () => {
      imageTracker.refresh();
      scheduleResize();
    };
    // Height changes are the result of this observer's work, not a reason to
    // measure the frame again. Width changes still need text/table reflow.
    let frameWidth = iframe.getBoundingClientRect().width;
    const observer = new ResizeObserver((entries) => {
      if (
        entries.some((entry) => {
          if (entry.target !== iframe) return true;
          const changed = entry.contentRect.width !== frameWidth;
          frameWidth = entry.contentRect.width;
          return changed;
        })
      )
        refresh();
    });
    observer.observe(doc.body);
    observer.observe(iframe);
    const mutations = new MutationObserver(refresh);
    mutations.observe(doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    // Keep the WebView's native "Inspect Element" menu inside read-only mail.
    // The frame remains scripts-disabled; editor/signature menus are unchanged.
    const restoreContextMenu = inspectable
      ? () => {}
      : disableNativeContextMenu(doc);
    const restoreLinks = nativeFrame
      ? () => {}
      : interceptMailLinks(doc, (href) => open.current(href));
    if (!nativeFrame) {
      doc.addEventListener("load", refresh, true);
      doc.addEventListener("error", refresh, true);
    }
    resize();
    setReady(true);
    notifyDocument.current?.(doc);
    cleanup.current = () => {
      notifyDocument.current?.(null);
      cancelAnimationFrame(pendingResize);
      observer.disconnect();
      mutations.disconnect();
      imageTracker.dispose();
      restoreContextMenu();
      retryImages.current = () => {};
      restoreLinks();
      if (!nativeFrame) {
        doc.removeEventListener("load", refresh, true);
        doc.removeEventListener("error", refresh, true);
      }
    };
  }
  return (
    <div
      className="mail-html-container"
      data-mail-debug-region={inspectable ? "" : undefined}
      aria-busy={!ready || images.waiting > 0}
    >
      {(!ready || images.waiting > 0) && <MailBodySkeleton images={ready} />}
      {ready && images.timedOut + images.failed > 0 && (
        <Alert className="mb-2">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t("{value0} body images could not load ({value1})", {
                value0: images.failed + images.timedOut,
                value1: [
                  images.failed > 0 && `${images.failed} 张失败`,
                  images.timedOut > 0 && `${images.timedOut} 张超时`,
                ]
                  .filter(Boolean)
                  .join("，"),
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => retryImages.current()}
            >
              {t("Reload images")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <iframe
        ref={frame}
        className={`mail-html mail-html-${colorScheme}`}
        title={title}
        sandbox="allow-same-origin allow-top-navigation-by-user-activation"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={loaded}
      />
    </div>
  );
}
