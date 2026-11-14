import { t } from "@/lib/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  EyeOff,
  Languages,
  LoaderCircle,
  RotateCcw,
  Sun,
  Moon,
} from "lucide-react";
import { useTheme } from "@/lib/theme";
import { call } from "@/lib/api";
import {
  planMailTranslation,
  translationBatches,
  translationLanguages,
  validateTranslationReply,
  type TranslationConfig,
  type TranslationPart,
} from "@/lib/mail-translation";
import type { WorkItem } from "@/lib/workbench";
import { useMailSummary } from "./mail-summary";
import { MailContent } from "./mail-content";
import { Button } from "./ui/button";
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
  mailId,
  mailDate,
  onAddWorkItem,
}: {
  mailId?: string;
  mailDate?: string;
  onAddWorkItem?: (item: WorkItem) => void;
  actionsContainer: HTMLElement | null;
  html: string;
  body: string;
  title?: string;
  onOpenLink: (href: string) => void;
}) {
  const summary = useMailSummary(
    mailId ?? title,
    body,
    html,
    mailDate,
    onAddWorkItem,
  );
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
  const { dark } = useTheme();
  const [originalColors, setOriginalColors] = useState(false);
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
            "Save a model configuration in Settings & accounts → AI assistant first.",
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
    : error
      ? error
      : shown
        ? t("{value0} · {value1}/{value2} text segments", {
            value0: translationLanguages[language],
            value1: progress.done,
            value2: progress.total,
          })
        : "";
  const translationOverlay = busy ? (
    <Button
      type="button"
      variant="secondary"
      className="mail-status-pill"
      data-mail-translation-state="busy"
      aria-label={`${status} · ${t("Cancel translation")}`}
      onClick={() => {
        cancel();
        setBusy(false);
        setError(
          t(
            "Translation canceled. Completed paragraphs remain; retry or hide them.",
          ),
        );
      }}
    >
      <LoaderCircle className="animate-spin" aria-hidden="true" />
      <span>{status}</span>
      <span className="mail-status-action">{t("Cancel translation")}</span>
    </Button>
  ) : error ? (
    <Button
      type="button"
      variant="secondary"
      className="mail-status-pill"
      data-mail-translation-state="error"
      aria-label={`${error} · ${t("Retry translation")}`}
      title={error}
      onClick={() => void translate()}
    >
      <RotateCcw aria-hidden="true" />
      <span className="mail-status-detail">{error}</span>
      <span className="mail-status-action">{t("Retry translation")}</span>
    </Button>
  ) : null;
  return (
    <div className="translatable-mail-body flex min-w-0 flex-col gap-3">
      {actionsContainer &&
        createPortal(
          <TooltipProvider>
            <div className="flex shrink-0 items-center gap-1">
              {html && dark && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        originalColors
                          ? t("Follow application colors")
                          : t("Use original light colors")
                      }
                      aria-pressed={originalColors}
                      onClick={() => setOriginalColors((value) => !value)}
                    >
                      {originalColors ? (
                        <Moon aria-hidden="true" />
                      ) : (
                        <Sun aria-hidden="true" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {originalColors
                      ? t("Follow application colors")
                      : t("Use original light colors")}
                  </TooltipContent>
                </Tooltip>
              )}
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
              {summary.trigger(ready && !!(body.trim() || html))}
            </div>
          </TooltipProvider>,
          actionsContainer,
        )}
      {summary.overlay}
      <span
        className="sr-only"
        role={error && !busy ? "alert" : "status"}
        aria-live="polite"
      >
        {error || status}
      </span>
      {html ? (
        <MailContent
          inspectable
          originalColors={originalColors}
          html={html}
          title={title}
          onOpenLink={onOpenLink}
          onDocumentReady={documentReady}
          statusOverlay={translationOverlay}
        />
      ) : (
        <div className="relative min-w-0">
          {translationOverlay && (
            <div className="mail-body-status-stack">{translationOverlay}</div>
          )}
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
        </div>
      )}
    </div>
  );
}
