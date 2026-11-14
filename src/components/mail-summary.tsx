import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CalendarPlus,
  Copy,
  LoaderCircle,
  Minus,
  Sparkles,
  X,
} from "lucide-react";
import DOMPurify from "dompurify";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { t } from "@/lib/i18n";
import {
  cancelMailAi,
  mailAiConfig,
  mailAiError,
  openMailAiSettings,
  type MailSummary,
} from "@/lib/mail-ai";
import { newWorkItem, workDate, type WorkItem } from "@/lib/workbench";
import { Button } from "./ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

const summaries = new Map<string, MailSummary>();

const SummaryLayer = createContext<{
  host: HTMLElement | null;
  claim: (reset: () => void) => void;
} | null>(null);

export function MailSummaryLayer({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const active = useRef<(() => void) | null>(null);
  const layer = useMemo(
    () => ({
      host,
      claim(reset: () => void) {
        if (active.current !== reset) active.current?.();
        active.current = reset;
      },
    }),
    [host],
  );

  return (
    <SummaryLayer.Provider value={layer}>
      <div className="reader-body-region">
        {children}
        <div className="mail-summary-layer" ref={setHost} />
      </div>
    </SummaryLayer.Provider>
  );
}

function summaryBody(body: string, html: string) {
  const safe = body.trim()
    ? null
    : DOMPurify.sanitize(html, {
        RETURN_DOM: true,
        ALLOWED_TAGS: [
          "p",
          "br",
          "div",
          "li",
          "td",
          "tr",
          "blockquote",
          "h1",
          "h2",
          "h3",
          "pre",
        ],
        ALLOWED_ATTR: [],
        FORBID_CONTENTS: ["script", "style", "head", "noscript", "template"],
      });
  if (safe instanceof Element)
    for (const block of safe.querySelectorAll("*")) block.append("\n");
  const text = body.trim() || safe?.textContent?.trim() || "";
  const bytes = new TextEncoder().encode(text);
  return new TextDecoder().decode(bytes.subarray(0, 48_000), { stream: true });
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; message: string }
  | { kind: "open"; summary: MailSummary }
  | { kind: "collapsed"; summary: MailSummary };

export function useMailSummary(
  id: string,
  body: string,
  html: string,
  sent?: string,
  onAddWorkItem?: (item: WorkItem) => void,
) {
  const layer = useContext(SummaryLayer);
  const reference =
    sent && Number.isFinite(Date.parse(sent)) ? sent : undefined;
  const offset = reference && /(?:Z|[+-]\d\d:\d\d)$/i.exec(reference)?.[0];
  const [state, setState] = useState<State>({ kind: "idle" });
  const request = useRef("");
  const triggerButton = useRef<HTMLButtonElement>(null);
  const overlayButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const cancel = useCallback(() => {
    cancelMailAi(request.current);
    request.current = "";
  }, []);
  const reset = useCallback(() => {
    cancel();
    setState({ kind: "idle" });
  }, [cancel]);
  useEffect(() => {
    reset();
    const clear = () => {
      summaries.clear();
      reset();
    };
    window.addEventListener("anser-translation-config-changed", clear);
    return () => {
      window.removeEventListener("anser-translation-config-changed", clear);
      cancel();
    };
  }, [id, body, html, reference, reset, cancel]);

  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    (overlayButton.current ?? triggerButton.current)?.focus({
      preventScroll: true,
    });
  }, [state.kind]);

  function close() {
    restoreFocus.current = true;
    reset();
  }

  async function start() {
    if (request.current) return;
    layer?.claim(reset);
    if (state.kind === "collapsed") {
      setState({ ...state, kind: "open" });
      return;
    }
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setState({ kind: "loading" });
    try {
      const config = await mailAiConfig();
      if (request.current !== requestId) return;
      if (!config) {
        setState({ kind: "missing" });
        return;
      }
      const text = summaryBody(body, html);
      if (!text) {
        setState({
          kind: "error",
          message: t("There is no text to summarize."),
        });
        return;
      }
      const input = {
        kind: "summary",
        body: text,
        language: config.targetLanguage,
        reference: offset ? reference : undefined,
      };
      const key = JSON.stringify([
        "summary-v3",
        id,
        config.revision,
        input.language,
        input.reference,
        text,
      ]);
      const summary =
        summaries.get(key) ??
        (await call<MailSummary>("run_mail_ai", {
          requestId,
          revision: config.revision,
          input,
        }));
      if (request.current !== requestId) return;
      if (!summaries.has(key) && summaries.size >= 48) {
        const first = summaries.keys().next().value;
        if (first !== undefined) summaries.delete(first);
      }
      summaries.set(key, summary);
      setState({ kind: "open", summary });
    } catch (error) {
      if (request.current === requestId)
        setState({ kind: "error", message: mailAiError(error) });
    } finally {
      if (request.current === requestId) request.current = "";
    }
  }

  const expanded = ["open", "error", "missing"].includes(state.kind);
  const action =
    state.kind === "loading"
      ? t("Cancel summary")
      : expanded
        ? t("Hide summary")
        : state.kind === "collapsed"
          ? t("Show summary")
          : t("Summarize email");
  const trigger = (ready: boolean) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={triggerButton}
          size="icon-sm"
          variant={
            expanded || state.kind === "collapsed" ? "secondary" : "ghost"
          }
          aria-label={action}
          aria-expanded={expanded}
          disabled={!ready}
          onClick={() => {
            if (expanded || state.kind === "loading") reset();
            else void start();
          }}
        >
          {state.kind === "loading" ? (
            <LoaderCircle className="animate-spin" />
          ) : (
            <Sparkles />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action}</TooltipContent>
    </Tooltip>
  );

  let overlay;
  if (state.kind === "loading" || state.kind === "collapsed") {
    overlay = (
      <Button
        ref={overlayButton}
        variant="outline"
        className="mail-status-pill"
        onClick={() => {
          if (state.kind === "loading") close();
          else {
            restoreFocus.current = true;
            void start();
          }
        }}
        aria-label={
          state.kind === "loading" ? t("Cancel summary") : t("Show summary")
        }
      >
        {state.kind === "loading" ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <Sparkles />
        )}
        {state.kind === "loading" ? (
          <>
            <span role="status">{t("Summarizing email…")}</span>
            <span className="mail-status-action">{t("Cancel")}</span>
          </>
        ) : (
          t("Email summary")
        )}
      </Button>
    );
  } else if (state.kind === "error" || state.kind === "missing") {
    overlay = (
      <Card className="mail-summary-result" aria-label={t("Email summary")}>
        <CardHeader className="mail-summary-header">
          <Sparkles className="size-4" aria-hidden />
          <CardTitle className="flex-1 text-xs">{t("Email summary")}</CardTitle>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("Close")}
            onClick={close}
          >
            <X />
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 px-3.5 pb-3">
          <p role="alert" className="break-words">
            {state.kind === "missing"
              ? t("Set up a model to use mail AI.")
              : state.message}
          </p>
          <div className="flex flex-wrap gap-2">
            {state.kind === "missing" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void openMailAiSettings().catch(() =>
                    toast.error(t("Could not open AI settings.")),
                  )
                }
              >
                {t("Open AI settings")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  restoreFocus.current = true;
                  void start();
                }}
              >
                {t("Retry")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  } else if (state.kind === "open") {
    const { conclusion, points, reminders = [] } = state.summary;
    overlay = (
      <Card className="mail-summary-result" aria-label={t("Email summary")}>
        <CardHeader className="mail-summary-header">
          <Sparkles className="size-4" aria-hidden />
          <CardTitle className="flex-1 text-xs">{t("Email summary")}</CardTitle>
          <Button
            ref={overlayButton}
            size="icon-sm"
            variant="ghost"
            title={t("Collapse summary")}
            aria-label={t("Collapse summary")}
            onClick={() => {
              restoreFocus.current = true;
              setState({ ...state, kind: "collapsed" });
            }}
          >
            <Minus />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("Close")}
            onClick={close}
          >
            <X />
          </Button>
        </CardHeader>
        <ScrollArea
          type="auto"
          className="mail-summary-scroll"
          viewportProps={{ tabIndex: 0, "aria-label": t("Email summary") }}
        >
          <CardContent className="space-y-2.5 px-3 py-2.5 break-words select-text">
            <p className="leading-relaxed font-medium">{conclusion}</p>
            {!!points.length && (
              <ul className="list-disc space-y-1 pl-4 leading-relaxed text-muted-foreground">
                {points.map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            )}
            {!!reminders.length && (
              <div className="mail-summary-dates pt-1">
                <p className="font-medium">{t("Email reminders")}</p>
                <ul className="mt-1 space-y-1.5 leading-relaxed">
                  {reminders.map((reminder, i) => {
                    const instant =
                      offset && reminder.time
                        ? new Date(
                            `${reminder.date}T${reminder.time}:00${offset}`,
                          )
                        : null;
                    const local =
                      instant && Number.isFinite(+instant) ? instant : null;
                    const date = local ? workDate(local) : reminder.date;
                    const time = local
                      ? [local.getHours(), local.getMinutes()]
                          .map((v) => String(v).padStart(2, "0"))
                          .join(":")
                      : "";
                    return (
                      <li
                        key={i}
                        className="flex items-start justify-between gap-1.5"
                      >
                        <div className="min-w-0">
                          <p>{reminder.title}</p>
                          <p className="text-muted-foreground">
                            {date} {time}
                          </p>
                          <p className="text-muted-foreground">
                            {reminder.evidence}
                          </p>
                        </div>
                        {onAddWorkItem && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="shrink-0"
                            title={t("Add to calendar")}
                            aria-label={t("Add to calendar")}
                            onClick={() =>
                              onAddWorkItem({
                                ...newWorkItem(date),
                                title: reminder.title.slice(0, 200),
                                time,
                                mailId: id,
                                notes: reminder.evidence,
                              })
                            }
                          >
                            <CalendarPlus />
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </CardContent>
        </ScrollArea>
        <CardFooter className="justify-end px-2 py-0.5">
          <Button
            className="h-6 text-[11px] [&_svg]:size-3"
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard
                .writeText(
                  [
                    conclusion,
                    ...points,
                    ...reminders.map((reminder) => reminder.evidence),
                  ].join("\n"),
                )
                .then(() => toast.success(t("Summary copied")))
                .catch(() => toast.error(t("Could not copy summary.")))
            }
          >
            <Copy />
            {t("Copy summary")}
          </Button>
        </CardFooter>
      </Card>
    );
  }
  return {
    trigger,
    overlay:
      overlay &&
      (layer ? layer.host && createPortal(overlay, layer.host) : overlay),
  };
}
