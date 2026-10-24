import { t } from "@/lib/i18n";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { native } from "../lib/api";
export function EmlViewer() {
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let draining = false;
    let again = false;
    let unlisten: (() => void) | undefined;
    async function drain() {
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        do {
          again = false;
          const paths = await invoke<string[]>("take_eml_paths");
          if (disposed) return;
          let last: string | null = null;
          for (const path of paths) last = path;
          if (last) await invoke("open_external_mail_window", { path: last });
        } while (again);
      } catch (cause) {
        if (!disposed)
          toast.error(
            t("Could not open email file: {value0}", { value0: String(cause) }),
          );
      } finally {
        draining = false;
      }
    }
    void listen("eml-files-available", () => void drain())
      .then((stop) => {
        if (disposed) stop();
        else {
          unlisten = stop;
          void drain();
        }
      })
      .catch((cause) => {
        if (!disposed) toast.error(String(cause));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  return null;
}
