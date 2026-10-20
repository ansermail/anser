import { t } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EyeOff, Languages, LoaderCircle, RotateCcw } from "lucide-react";
import { call } from "@/lib/api";
import {
  planMailTranslation,
  translationBatches,
  translationLanguages,
  validateTranslationReply,
  type TranslationConfig,
  type TranslationPart,
} from "@/lib/mail-translation";
import { MailContent } from "./mail-content";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

type Plan = ReturnType<typeof planMailTranslation>;
export function TranslatableMailBody({
  html,
  body,
  onOpenLink,
  title = t("Message body"),
  actionsContainer,
}: {
  actionsContainer: HTMLElement | null;
  html: string;
  body: string;
  title?: string;
  onOpenLink: (href: string) => void;
}) {
  const paragraphs = useMemo(() => body.split(/(\n\s*\n)/), [body]);
  const plain = useRef<HTMLDivElement>(null);
  const doc = useRef<Document | null>(null);
  const plan = useRef<Plan | null>(null);
  const generation = useRef(0);
  const request = useRef("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("zh-CN");
  const cancel = useCallback(() => {
    generation.current++;
    if (request.current) {
      void call("cancel_translation", { requestId: request.current }).catch(
        () => {},
      );
      request.current = "";
    }
  }, []);
  const reset = useCallback(() => {
    cancel();
    plan.current?.dispose();
    plan.current = null;
    setBusy(false);
    setShown(false);
    setError("");
    setProgress({ done: 0, total: 0 });
  }, [cancel]);
  const documentReady = useCallback(
    (next: Document | null) => {
      reset();
      doc.current = next;
      setReady(!!next);
    },
    [reset],
  );
  useEffect(() => {
    window.addEventListener("anser-translation-config-changed", reset);
    return () => {
      window.removeEventListener("anser-translation-config-changed", reset);
      cancel();
      plan.current?.dispose();
    };
  }, [reset, cancel]);
  useEffect(() => {
    if (html) return;
    documentReady(plain.current?.ownerDocument || null);
    return () => documentReady(null);
  }, [html, body, documentReady]);
  async function translate() {
    reset();
    const current = generation.current;
    const active = () => generation.current === current;
    const currentDoc = doc.current;
    if (!currentDoc) return;
    setBusy(true);
    try {
      const config = await call<TranslationConfig | null>(
        "get_translation_settings",
      );
      if (!active()) return;
      if (!config)
        throw new Error(
          t(
            "Save a model configuration in Settings & accounts → AI translation first.",
          ),
        );
      setLanguage(config.targetLanguage);
      const next = planMailTranslation(
        currentDoc,
        config.targetLanguage,
        html ? undefined : plain.current!,
      );
      plan.current = next;
      if (!next.parts.length)
        throw new Error(t("No visible body text needs translation."));
      const total = next.parts.length;
      setProgress({ done: 0, total });
      setShown(true);
      const values = new Map<string, string>();
      for (const parts of translationBatches(next.parts)) {
        if (!active()) return;
        const requestId = crypto.randomUUID();
        request.current = requestId;
        const translated = await call<TranslationPart[]>(
          "translate_mail_parts",
          { requestId, revision: config.revision, parts },
        );
        if (!active()) return;
        request.current = "";
        // IPC output is text-only. Reject missing/extra ids before touching DOM.
        validateTranslationReply(parts, translated);
        for (const part of translated) values.set(part.id, part.text);
        next.apply(values);
        setProgress({ done: values.size, total });
      }
    } catch (e) {
      if (active()) setError(String(e));
    } finally {
      if (active()) {
        request.current = "";
        setBusy(false);
      }
    }
  }
  const actionLabel = busy
    ? t("Cancel translation")
    : error
      ? t("Retry translation")
      : shown
        ? t("Hide translation")
        : t("Translate");
  const status = busy
    ? t("Translating {value0}/{value1}", {
        value0: progress.done,
        value1: progress.total,
      })
    : shown
      ? t("{value0} · {value1}/{value2} text segments", {
          value0: translationLanguages[language],
          value1: progress.done,
          value2: progress.total,
        })
      : "";
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {actionsContainer &&
        createPortal(
          <TooltipProvider>
            <div className="flex shrink-0 items-center gap-1">
              {shown && error && !busy && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("Hide translation")}
                      onClick={reset}
                    >
                      <EyeOff aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("Hide translation")}</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={shown && !busy && !error ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={actionLabel}
                    aria-pressed={shown}
                    disabled={!ready}
                    onClick={() => {
                      if (busy) {
                        cancel();
                        setBusy(false);
                        setError(
                          t(
                            "Translation canceled. Completed paragraphs remain; retry or hide them.",
                          ),
                        );
                      } else if (shown && !error) reset();
                      else void translate();
                    }}
                  >
                    {busy ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="animate-spin"
                      />
                    ) : error ? (
                      <RotateCcw aria-hidden="true" />
                    ) : (
                      <Languages aria-hidden="true" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {status ? `${status} · ${actionLabel}` : actionLabel}
                </TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>,
          actionsContainer,
        )}
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
      {busy && progress.total > 0 && (
        <Progress
          value={(progress.done / progress.total) * 100}
          aria-label={t("Translation progress")}
        />
      )}
      {error && (
        <Alert>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {html ? (
        <MailContent
          inspectable
          html={html}
          title={title}
          onOpenLink={onOpenLink}
          onDocumentReady={documentReady}
        />
      ) : (
        <div className="message-body" data-mail-debug-region="" ref={plain}>
          {paragraphs.map((text, index) =>
            index % 2 ? (
              text
            ) : (
              <p className="m-0" key={index}>
                {text}
              </p>
            ),
          )}
        </div>
      )}
    </div>
  );
}
