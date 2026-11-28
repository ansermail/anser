import { useEffect, useState } from "react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { Compose } from "@/lib/types";

export function dismissSendUndoToast(draftId: string) {
  toast.dismiss(`send-undo:${draftId}`);
}

function SendUndoCountdown({
  draftId,
  deadline,
}: {
  draftId: string;
  deadline: number;
}) {
  const [seconds, setSeconds] = useState(() =>
    Math.ceil((deadline - Date.now()) / 1000),
  );

  useEffect(() => {
    let timer: number;
    function update() {
      window.clearTimeout(timer);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        // The dismissal animation can wait for a frame in a hidden WebView.
        setSeconds(0);
        dismissSendUndoToast(draftId);
        return;
      }
      const nextSeconds = Math.ceil(remaining / 1000);
      setSeconds(nextSeconds);
      timer = window.setTimeout(update, remaining - (nextSeconds - 1) * 1000);
    }
    // Recheck the actual clock on return from a suspended or hidden window.
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [deadline, draftId]);

  return (
    <span
      className="tabular-nums"
      data-send-undo-expired={seconds <= 0 || undefined}
    >
      {seconds > 0 &&
        t("Added to send history. {value0}s to undo.", { value0: seconds })}
    </span>
  );
}

export async function queueSendWithUndo(draft: Compose, onUndo: () => void) {
  const scheduledAt = await call<string>("queue_send", { draft });
  const deadline = Date.parse(scheduledAt);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) return;

  toast.success(<SendUndoCountdown draftId={draft.id} deadline={deadline} />, {
    id: `send-undo:${draft.id}`,
    className: "has-[[data-send-undo-expired]]:hidden!",
    // Sonner's own timer pauses on interaction. Sending follows the queue deadline.
    duration: Infinity,
    action: {
      label: t("Undo"),
      onClick: async () => {
        if (Date.now() >= deadline) return;
        try {
          await call("cancel_schedule", { id: draft.id });
          toast.success(
            t("Schedule canceled. Body and attachments restored as a draft."),
          );
          onUndo();
        } catch (error) {
          toast.error(String(error));
        }
      },
    },
  });
}
