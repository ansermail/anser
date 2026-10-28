import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { native } from "../lib/api";
import { t, useLanguage } from "../lib/i18n";
import { isWindows } from "../lib/platform";
import { Button } from "./ui/button";

export function DesktopTitlebar() {
  useLanguage();
  const windows = native && isWindows();
  const [maximized, setMaximized] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!windows) return;
    let live = true;
    let stop: (() => void) | undefined;
    const current = getCurrentWindow();
    const update = () => {
      void current
        .isMaximized()
        .then((value) => live && setMaximized(value))
        .catch((error) => console.warn("Window state unavailable", error));
    };
    update();
    void current.onResized(update).then(
      (unlisten) => {
        if (live) stop = unlisten;
        else unlisten();
      },
      (error) => console.warn("Window state listener unavailable", error),
    );
    return () => {
      live = false;
      stop?.();
    };
  }, [windows]);

  function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    void Promise.resolve()
      .then(action)
      .catch(() => toast.error(t("Unable to control this window")))
      .finally(() => setBusy(false));
  }

  if (!windows)
    return <div className="desktop-titlebar" data-tauri-drag-region />;
  const maximizeLabel = t(maximized ? "Restore window" : "Maximize window");
  return (
    <>
      <div className="desktop-titlebar" data-tauri-drag-region />
      <div
        className="window-controls"
        data-tauri-drag-region="false"
        onPointerDown={(event) => {
          // Caption actions must not dismiss an open draft/settings dialog or
          // move focus into the page before the native window operation.
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className="window-control"
          aria-label={t("Minimize window")}
          title={t("Minimize window")}
          disabled={busy}
          onClick={() => run(() => getCurrentWindow().minimize())}
        >
          <Minus />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="window-control"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          disabled={busy}
          onClick={() =>
            run(async () => {
              const current = getCurrentWindow();
              await current.toggleMaximize();
              setMaximized(await current.isMaximized());
            })
          }
        >
          {maximized ? <Copy /> : <Square />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="window-control window-control-close"
          aria-label={t("Close window")}
          title={t("Close window")}
          disabled={busy}
          onClick={() => run(() => getCurrentWindow().close())}
        >
          <X />
        </Button>
      </div>
    </>
  );
}
