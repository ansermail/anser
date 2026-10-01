import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { mailLink, safeMailHtml } from "../lib/mail-html";
import { mailDocumentHeight } from "../lib/mail-layout";

export function MailContent({
  html,
  onOpenLink,
}: {
  html: string;
  onOpenLink: (href: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const cleanup = useRef<() => void>(() => {});
  const initialized = useRef<Document | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingImages, setPendingImages] = useState(0);
  const srcDoc = useMemo(() => safeMailHtml(html), [html]);
  const open = useRef(onOpenLink);
  open.current = onOpenLink;
  useEffect(() => {
    setReady(false);
    setPendingImages(0);
    initialized.current = null;
    cleanup.current();
    // DOM can be readable before onLoad, which waits for every remote image.
    let pending = 0;
    const waitForDocument = () => {
      const doc = frame.current?.contentDocument;
      if (doc?.URL === "about:srcdoc" && doc.readyState !== "loading") loaded();
      else pending = requestAnimationFrame(waitForDocument);
    };
    pending = requestAnimationFrame(waitForDocument);
    return () => {
      cancelAnimationFrame(pending);
      cleanup.current();
    };
  }, [srcDoc]);
  function loaded() {
    const iframe = frame.current;
    const doc = iframe?.contentDocument;
    if (
      !iframe ||
      !doc?.body ||
      doc.URL !== "about:srcdoc" ||
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
    const scheduleResize = () => {
      setPendingImages(
        [...doc.images].filter((image) => !image.complete).length,
      );
      cancelAnimationFrame(pendingResize);
      pendingResize = requestAnimationFrame(resize);
    };
    const clicked = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (href.startsWith("#")) return;
      event.preventDefault();
      const url = mailLink(href);
      if (url) open.current(url.href);
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
    doc.addEventListener("click", clicked);
    doc.addEventListener("load", scheduleResize, true);
    doc.addEventListener("error", scheduleResize, true);
    resize();
    setPendingImages([...doc.images].filter((image) => !image.complete).length);
    setReady(true);
    cleanup.current = () => {
      cancelAnimationFrame(pendingResize);
      observer.disconnect();
      mutations.disconnect();
      doc.removeEventListener("click", clicked);
      doc.removeEventListener("load", scheduleResize, true);
      doc.removeEventListener("error", scheduleResize, true);
    };
  }
  return (
    <div
      className="mail-html-container"
      aria-busy={!ready || pendingImages > 0}
    >
      {(!ready || pendingImages > 0) && (
        <div className="mail-html-loading" role="status">
          <LoaderCircle size={16} className="animate-spin" />
          {ready ? "正在加载图片…" : "正在加载正文…"}
        </div>
      )}
      <iframe
        ref={frame}
        className="mail-html"
        title="邮件正文"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        onLoad={loaded}
      />
    </div>
  );
}
