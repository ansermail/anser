import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EyeOff, Languages, LoaderCircle, RotateCcw } from "lucide-react";
import { call } from "@/lib/api";
import {
  planMailTranslation,
  translationBatches,
  translationLanguages,
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
  title = "邮件正文",
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
        throw new Error("请先在“设置与账号 → 大模型翻译”中保存模型配置。");
      setLanguage(config.targetLanguage);
      const next = planMailTranslation(
        currentDoc,
        config.targetLanguage,
        html ? undefined : plain.current!,
      );
      plan.current = next;
      if (!next.parts.length) throw new Error("未找到需要翻译的可见正文文字。");
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
        const ids = new Set(parts.map((p) => p.id));
        if (
          translated.length !== parts.length ||
          translated.some((p) => !ids.delete(p.id) || !p.text.trim()) ||
          ids.size
        )
          throw new Error("模型未返回完整段落，请重试。");
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
    ? "取消翻译"
    : error
      ? "重试翻译"
      : shown
        ? "隐藏译文"
        : "翻译";
  const status = busy
    ? `正在翻译 ${progress.done}/${progress.total}`
    : shown
      ? `${translationLanguages[language]} · ${progress.done}/${progress.total} 段文字`
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
                      aria-label="隐藏译文"
                      onClick={reset}
                    >
                      <EyeOff aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>隐藏译文</TooltipContent>
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
                          "翻译已取消，已完成的段落保留；可重试或隐藏。",
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
          aria-label="翻译进度"
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
