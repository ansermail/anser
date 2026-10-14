import { useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { MailBodySkeleton } from "./mail-skeleton";
import { disableNativeContextMenu } from "../lib/context-menu";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { watchMailImages, type MailImageStatus } from "../lib/mail-images";
import {
  interceptMailLinks,
  isMailDocument,
  safeMailHtml,
} from "../lib/mail-html";
import { mailDocumentHeight } from "../lib/mail-layout";

export function MailContent({
  html,
  onOpenLink,
  title = "邮件正文",
  inspectable = false,
}: {
  html: string;
  title?: string;
  inspectable?: boolean;
  onOpenLink: (href: string) => void;
}) {
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
    return { id, srcDoc: safeMailHtml(html, id, isTauri()) };
  }, [html]);
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
    // Keep the usual block layout, while containing collapsed margins and
    // floats in the measured body. Preserve templates with custom flex/grid.
    if (doc.defaultView?.getComputedStyle(doc.body).display === "block")
      doc.body.style.setProperty("display", "flow-root", "important");
    const resize = () => {
      const height = `${mailDocumentHeight(doc)}px`;
      if (iframe.style.height !== height) iframe.style.height = height;
    };
    let pendingResize = 0;
    const nativeFrame = isTauri();
    const imageTracker = watchMailImages(
      doc,
      (status) => {
        setImages(status);
        resize();
      },
      !nativeFrame,
    );
    retryImages.current = imageTracker.retry;
    const scheduleResize = () => {
      imageTracker.refresh();
      cancelAnimationFrame(pendingResize);
      pendingResize = requestAnimationFrame(resize);
    };
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(doc.body);
    observer.observe(iframe);
    const mutations = new MutationObserver(scheduleResize);
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
      doc.addEventListener("load", scheduleResize, true);
      doc.addEventListener("error", scheduleResize, true);
    }
    resize();
    setReady(true);
    cleanup.current = () => {
      cancelAnimationFrame(pendingResize);
      observer.disconnect();
      mutations.disconnect();
      imageTracker.dispose();
      restoreContextMenu();
      retryImages.current = () => {};
      restoreLinks();
      if (!nativeFrame) {
        doc.removeEventListener("load", scheduleResize, true);
        doc.removeEventListener("error", scheduleResize, true);
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
              {images.timedOut > 0 ? "部分图片加载超时" : "部分图片加载失败"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => retryImages.current()}
            >
              重新加载图片
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <iframe
        ref={frame}
        className="mail-html"
        title={title}
        sandbox="allow-same-origin allow-top-navigation-by-user-activation"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={loaded}
      />
    </div>
  );
}
