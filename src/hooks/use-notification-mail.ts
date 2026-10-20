import { t } from "@/lib/i18n";
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { call } from "../lib/api";
import { toast } from "sonner";

// Subscribe before draining: notifications clicked while the WebView starts are
// queued natively, and clicks arriving during an IPC drain trigger another drain.
export function useNotificationMail(
  enabled: boolean,
  open: (token: string) => void,
) {
  const handler = useRef(open);
  handler.current = open;
  useEffect(() => {
    if (!enabled) return;
    let disposed = false,
      draining = false,
      again = false;
    let stop: (() => void) | undefined;
    async function drain() {
      if (draining) {
        again = true;
        return;
      }
      draining = true;
      try {
        do {
          again = false;
          const token = await call<string | null>("take_notification_mail");
          if (disposed) return;
          if (token) handler.current(token);
        } while (again);
      } catch (error) {
        if (!disposed)
          toast.error(
            t("Could not open notification message: {value0}", {
              value0: String(error),
            }),
          );
      } finally {
        draining = false;
      }
    }
    void listen("notification-mail-available", () => void drain())
      .then((unlisten) => {
        if (disposed) unlisten();
        else {
          stop = unlisten;
          void drain();
        }
      })
      .catch((error) => {
        if (!disposed) toast.error(String(error));
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [enabled]);
}
