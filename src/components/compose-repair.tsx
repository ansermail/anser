import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Check, FileText, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { t } from "@/lib/i18n";
import {
  cancelMailAi,
  mailAiConfig,
  mailAiError,
  openMailAiSettings,
  type MailRepair,
} from "@/lib/mail-ai";
import {
  applyDraftEdits,
  draftEdits,
  editableParagraphs,
  showDraftEdits,
  type DraftEdit,
} from "@/lib/compose-repair";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "./ai-elements/chain-of-thought";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./ai-elements/conversation";
import { Message, MessageContent } from "./ai-elements/message";
import {
  Plan,
  PlanContent,
  PlanFooter,
  PlanHeader,
  PlanStep,
} from "./ai-elements/plan";
import { PromptInput } from "./ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "./ai-elements/reasoning";
import { Suggestion, Suggestions } from "./ai-elements/suggestion";

type RepairTurn = {
  id: string;
  instruction: string;
  message?: string;
  reasoning?: string;
  durationMs?: number;
  model?: string;
  paragraphCount: number;
  skippedCount: number;
  blank: boolean;
  editCount?: number;
  status: "running" | "done" | "stopped" | "error";
};

function formatDuration(ms?: number) {
  if (!ms || ms < 100) return "";
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ComposeRepair({
  editor,
  disabled,
  onClose,
}: {
  editor: Editor;
  disabled: boolean;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<RepairTurn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsModel, setNeedsModel] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    snapshot: Node;
    edits: DraftEdit[];
    paragraphIndices: Map<number, number>;
    blank: boolean;
  }>();

  const computeScope = useCallback((doc: Node) => {
    const { paragraphs, blank } = editableParagraphs(doc);
    let totalBlocks = 0;
    doc.forEach((node) => {
      if (node.childCount > 0 || node.textContent.trim()) totalBlocks += 1;
    });
    return {
      count: blank ? 0 : paragraphs.length,
      skipped: blank ? 0 : Math.max(0, totalBlocks - paragraphs.length),
      blank,
    };
  }, []);

  const [scope, setScope] = useState(() => computeScope(editor.state.doc));
  const request = useRef("");
  const latest = useRef({ disabled, applying: false });
  latest.current.disabled = disabled;

  const stop = useCallback(() => {
    const currentId = request.current;
    cancelMailAi(currentId);
    request.current = "";
    setBusy(false);
    if (currentId) {
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === currentId && turn.status === "running"
            ? { ...turn, status: "stopped" }
            : turn,
        ),
      );
    }
  }, []);

  const clear = useCallback(() => {
    setSuggestion(undefined);
    if (!editor.isDestroyed) showDraftEdits(editor, []);
  }, [editor]);

  useEffect(() => {
    const onUpdate = () => {
      setScope(computeScope(editor.state.doc));
      if (latest.current.applying) return;
      if (request.current || suggestion) {
        stop();
        setSuggestion(undefined);
        setMessage(t("The draft changed. Ask for a new suggestion."));
      }
      if (turns.length) setTurns([]);
    };
    const onConfig = () => {
      stop();
      clear();
      setNeedsModel(false);
      setTurns([]);
      setMessage(t("AI settings changed. Ask for a new suggestion."));
    };
    editor.on("update", onUpdate);
    window.addEventListener("anser-translation-config-changed", onConfig);
    return () => {
      editor.off("update", onUpdate);
      window.removeEventListener("anser-translation-config-changed", onConfig);
    };
  }, [editor, stop, clear, suggestion, turns.length, computeScope]);

  useEffect(
    () => () => {
      cancelMailAi(request.current);
      request.current = "";
      if (!editor.isDestroyed) showDraftEdits(editor, []);
    },
    [editor],
  );

  useEffect(() => {
    if (disabled && request.current) {
      stop();
      setMessage(t("Generation stopped"));
    }
  }, [disabled, stop]);

  function restoreInstruction(instruction: string) {
    setInput((current) => current || instruction);
  }

  async function submit(instruction: string, fromInput = false): Promise<void> {
    instruction = instruction.trim();
    if (!instruction || disabled || request.current) return;
    const snapshot = editor.state.doc;
    const { paragraphs, blank } = editableParagraphs(snapshot);
    const currentScope = computeScope(snapshot);
    if (!paragraphs.length) {
      setMessage(
        t(
          "Add a plain paragraph or simplify the formatting before using Repair.",
        ),
      );
      if (fromInput) restoreInstruction(instruction);
      return;
    }
    const replacements = new Map(
      suggestion?.edits.map((edit) => [edit.from, edit.replacement]),
    );
    const source = paragraphs.map((p) => replacements.get(p.from) ?? p.text);
    // A follow-up revises the current proposal and carries the prior successful instructions.
    const instructions = [
      ...turns
        .filter((turn) => turn.message)
        .slice(-7)
        .map((turn) => turn.instruction),
      instruction,
    ];
    const encoder = new TextEncoder();
    if (
      paragraphs.length > 48 ||
      encoder.encode(source.join("")).length > 40_000 ||
      source.some((p) => encoder.encode(p).length > 12_000) ||
      encoder.encode(instruction).length > 2_000
    ) {
      setMessage(t("The draft or instruction is too long for Repair."));
      if (fromInput) restoreInstruction(instruction);
      return;
    }
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    request.current = id;
    setBusy(true);
    setMessage("");
    setNeedsModel(false);
    setTurns((previous) => [
      ...previous.slice(-7),
      {
        id,
        instruction,
        paragraphCount: currentScope.count,
        skippedCount: currentScope.skipped,
        blank,
        status: "running",
      },
    ]);
    const active = () =>
      request.current === id &&
      !latest.current.disabled &&
      !editor.isDestroyed &&
      editor.state.doc.eq(snapshot);
    try {
      const config = await mailAiConfig();
      if (!active()) return;
      if (!config) {
        setNeedsModel(true);
        setMessage(t("Set up a model to use mail AI."));
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === id ? { ...turn, status: "error" } : turn,
          ),
        );
        if (fromInput) restoreInstruction(instruction);
        return;
      }
      if (config.model) {
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === id ? { ...turn, model: config.model } : turn,
          ),
        );
      }
      const reply = await call<MailRepair>("run_mail_ai", {
        requestId: id,
        revision: config.revision,
        input: { kind: "repair", paragraphs: source, instructions, blank },
      });
      if (!active()) return;
      const latestEdits = draftEdits(
        paragraphs.map((p, i) => ({ ...p, text: source[i] })),
        reply.edits,
        blank,
      );
      if (!latestEdits) throw new Error("Invalid repair");
      for (const edit of latestEdits)
        replacements.set(edit.from, edit.replacement);
      const edits = draftEdits(
        paragraphs,
        paragraphs.flatMap((p, index) => {
          const replacement = replacements.get(p.from);
          return replacement === undefined
            ? []
            : [{ index, text: replacement }];
        }),
        blank,
      )!;
      const paragraphIndices = new Map(
        paragraphs.map((p, index) => [p.from, index + 1]),
      );
      const durationMs = Date.now() - startedAt;
      setTurns((previous) =>
        previous.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                message: reply.message,
                reasoning: reply.reasoning?.trim() || undefined,
                durationMs,
                model: config.model || turn.model,
                editCount: edits.length,
                status: "done",
              }
            : turn,
        ),
      );
      setSuggestion(
        edits.length ? { snapshot, edits, paragraphIndices, blank } : undefined,
      );
      showDraftEdits(editor, edits);
      if (!edits.length) setMessage(t("There are no changes to apply."));
    } catch (error) {
      if (active()) {
        setTurns((previous) =>
          previous.map((turn) =>
            turn.id === id ? { ...turn, status: "error" } : turn,
          ),
        );
        setMessage(mailAiError(error));
        if (fromInput) restoreInstruction(instruction);
      }
    } finally {
      if (request.current === id) {
        request.current = "";
        setBusy(false);
      }
    }
  }

  function apply() {
    if (disabled || busy || !suggestion) return;
    latest.current.applying = true;
    try {
      const applied = applyDraftEdits(
        editor,
        suggestion.snapshot,
        suggestion.edits,
        suggestion.blank,
      );
      const afterDoc = applied && !editor.isDestroyed ? editor.state.doc : null;
      clear();
      setTurns([]);
      setMessage(
        applied
          ? t("Applied to draft")
          : t("The draft changed. Ask for a new suggestion."),
      );
      if (applied && afterDoc) {
        toast.success(t("Applied to draft"), {
          duration: 8000,
          action: {
            label: t("Undo"),
            onClick: () => {
              if (!editor.isDestroyed && editor.state.doc.eq(afterDoc)) {
                latest.current.applying = true;
                try {
                  if (editor.chain().focus().undo().run()) {
                    setMessage(t("Reverted AI changes"));
                  }
                } finally {
                  latest.current.applying = false;
                }
              }
            },
          },
        });
      }
    } finally {
      latest.current.applying = false;
    }
  }

  const orderedEdits = useMemo(
    () => (suggestion ? [...suggestion.edits].reverse() : []),
    [suggestion],
  );

  const autoScrollKey = `${turns.length}-${turns.at(-1)?.status ?? ""}-${message}-${busy}`;

  return (
    <aside className="compose-repair-panel" aria-label={t("AI Assistant")}>
      <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Sparkles
          className="size-4 text-[var(--item-selected-foreground)]"
          aria-hidden
        />
        <h3 className="flex-1 text-sm font-semibold">{t("AI Assistant")}</h3>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("Close AI assistant")}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>

      <Conversation autoScrollKey={autoScrollKey}>
        <ConversationContent aria-label={t("Writing assistant conversation")}>
          {!turns.length && (
            <ConversationEmptyState
              description={t(
                "Describe how to revise the editable body, or tell the assistant what to write.",
              )}
            />
          )}

          {turns.map((turn) => {
            const duration = formatDuration(turn.durationMs);
            const scopeDetail = turn.blank
              ? t("Drafting from an empty body")
              : turn.skippedCount > 0
                ? t(
                    "Read {value0} editable paragraphs · {value1} formatted blocks kept untouched",
                    {
                      value0: turn.paragraphCount,
                      value1: turn.skippedCount,
                    },
                  )
                : t("Read {value0} editable paragraphs", {
                    value0: turn.paragraphCount,
                  });
            return (
              <div key={turn.id} className="flex flex-col gap-2.5">
                <Message from="user">
                  <MessageContent from="user">
                    {turn.instruction}
                  </MessageContent>
                </Message>

                {(turn.status === "running" || turn.status === "done") && (
                  <Message from="assistant">
                    <ChainOfThought
                      key={`${turn.id}-${turn.status}`}
                      defaultOpen={turn.status === "running"}
                    >
                      <ChainOfThoughtHeader active={turn.status === "running"}>
                        {turn.status === "running"
                          ? t("Preparing a revision…")
                          : duration
                            ? t("Thought process · {value0}", {
                                value0: duration,
                              })
                            : t("Thought process")}
                      </ChainOfThoughtHeader>
                      <ChainOfThoughtContent>
                        <ChainOfThoughtStep
                          status="complete"
                          label={t("Analyze editable body")}
                          description={scopeDetail}
                        />
                        <ChainOfThoughtStep
                          status={
                            turn.status === "running" ? "active" : "complete"
                          }
                          label={
                            turn.status === "running"
                              ? t("Generating revision…")
                              : t("Generated revision")
                          }
                          description={
                            turn.model
                              ? duration
                                ? `${turn.model} · ${duration}`
                                : turn.model
                              : duration || undefined
                          }
                        />
                        <ChainOfThoughtStep
                          status={
                            turn.status === "running" ? "pending" : "complete"
                          }
                          label={t("Validate paragraph diff")}
                          description={
                            turn.status === "done"
                              ? turn.editCount
                                ? t("{value0} changes in the body", {
                                    value0: turn.editCount,
                                  })
                                : t("There are no changes to apply.")
                              : undefined
                          }
                        />
                      </ChainOfThoughtContent>
                    </ChainOfThought>

                    {turn.reasoning && (
                      <Reasoning defaultOpen={false}>
                        <ReasoningTrigger title={t("Model reasoning")} />
                        <ReasoningContent>{turn.reasoning}</ReasoningContent>
                      </Reasoning>
                    )}

                    {turn.message && (
                      <MessageContent from="assistant">
                        {turn.message}
                      </MessageContent>
                    )}
                  </Message>
                )}
              </div>
            );
          })}

          {message && (
            <p role="status" className="text-muted-foreground">
              {message}
            </p>
          )}
          {needsModel && (
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                void openMailAiSettings().catch(() =>
                  toast.error(t("Could not open AI settings.")),
                )
              }
            >
              {t("Open AI settings")}
            </Button>
          )}
        </ConversationContent>
        <ConversationScrollButton label={t("Scroll to latest")} />
      </Conversation>

      {suggestion && (
        <div className="compose-repair-review px-3 pt-1 pb-2">
          <Plan defaultOpen>
            <PlanHeader
              title={t("Revision plan")}
              badge={t("{value0} changes in the body", {
                value0: suggestion.edits.length,
              })}
              toggleLabel={t("Toggle revision plan")}
            />
            <PlanContent>
              {orderedEdits.map((edit) => {
                const index = suggestion.paragraphIndices.get(edit.from) ?? 1;
                const badge = suggestion.blank
                  ? t("Draft body")
                  : edit.replacement
                    ? t("Paragraph {value0}", { value0: index })
                    : t("Paragraph {value0} · Clear", { value0: index });
                return (
                  <PlanStep
                    key={`${edit.from}-${edit.to}`}
                    badge={badge}
                    preview={edit.replacement || edit.text}
                  />
                );
              })}
            </PlanContent>
            <PlanFooter>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || disabled}
                onClick={() => {
                  clear();
                  setTurns([]);
                  setMessage(t("Suggestion discarded"));
                }}
              >
                {t("Discard suggestion")}
              </Button>
              <Button size="sm" disabled={busy || disabled} onClick={apply}>
                <Check />
                {t("Apply to body")}
              </Button>
            </PlanFooter>
          </Plan>
        </div>
      )}

      <div className="compose-repair-input flex flex-col gap-2 border-t px-3 pt-2 pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="gap-1 px-2 py-0.5 text-[11px] font-normal text-muted-foreground tabular-nums"
              >
                <FileText className="size-3 shrink-0" aria-hidden />
                {scope.blank
                  ? t("Empty body")
                  : t("Body · {value0} paragraphs", {
                      value0: scope.count,
                    })}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {t(
                "Only editable plain paragraphs in the current body are sent; attachments and quoted replies are excluded.",
              )}
            </TooltipContent>
          </Tooltip>
          {scope.skipped > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="px-2 py-0.5 text-[11px] font-normal text-muted-foreground tabular-nums"
                >
                  {t("{value0} formatted blocks skipped", {
                    value0: scope.skipped,
                  })}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t(
                  "Paragraphs with links, lists, tables, or mixed formatting stay untouched.",
                )}
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {!turns.some((turn) => turn.message) && !busy && !suggestion && (
          <Suggestions>
            {(scope.blank
              ? [
                  t("Draft a polite follow-up"),
                  t("Write a concise meeting summary"),
                  t("Draft a reply in English"),
                ]
              : [
                  t("Make it shorter"),
                  t("Make it more polite"),
                  t("Rewrite in English"),
                ]
            ).map((instruction) => (
              <Suggestion
                key={instruction}
                suggestion={instruction}
                disabled={disabled || busy}
                onSelect={(text) => void submit(text)}
              />
            ))}
          </Suggestions>
        )}

        <PromptInput
          value={input}
          onChange={setInput}
          onSubmit={(text) => void submit(text, true)}
          onStop={() => {
            stop();
            setMessage(t("Generation stopped"));
          }}
          onEscape={onClose}
          busy={busy}
          disabled={disabled}
          hasActiveSuggestion={!!suggestion}
          placeholder={t("Describe a change…")}
          sendLabel={t("Send revision request")}
          stopLabel={t("Stop generating")}
        />
      </div>
    </aside>
  );
}
