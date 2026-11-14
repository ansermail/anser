import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import {
  ArrowUp,
  Check,
  LoaderCircle,
  Square,
  Sparkles,
  X,
} from "lucide-react";
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
import { Button } from "./ui/button";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  MessagePartPrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "./ui/input-group";

export function ComposeRepair({
  editor,
  disabled,
  onClose,
}: {
  editor: Editor;
  disabled: boolean;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<
    { id: string; instruction: string; message?: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [needsModel, setNeedsModel] = useState(false);
  const [suggestion, setSuggestion] = useState<{
    snapshot: Node;
    edits: DraftEdit[];
    blank: boolean;
  }>();
  const request = useRef("");
  const latest = useRef({ disabled, applying: false });
  latest.current.disabled = disabled;
  const stop = useCallback(() => {
    cancelMailAi(request.current);
    request.current = "";
    setBusy(false);
  }, []);
  const clear = useCallback(() => {
    setSuggestion(undefined);
    if (!editor.isDestroyed) showDraftEdits(editor, []);
  }, [editor]);
  useEffect(() => {
    const onUpdate = () => {
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
  }, [editor, stop, clear, suggestion, turns.length]);
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
    const composer = runtime.thread.composer;
    if (!composer.getState().text) composer.setText(instruction);
  }

  async function submit(instruction: string, fromInput = false): Promise<void> {
    instruction = instruction.trim();
    if (!instruction || disabled || request.current) return;
    const snapshot = editor.state.doc;
    const { paragraphs, blank } = editableParagraphs(snapshot);
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
    request.current = id;
    setBusy(true);
    setMessage("");
    setNeedsModel(false);
    setTurns((previous) => [...previous.slice(-7), { id, instruction }]);
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
        if (fromInput) restoreInstruction(instruction);
        return;
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
      setTurns((previous) =>
        previous.map((turn, i) =>
          i === previous.length - 1
            ? { ...turn, message: reply.message }
            : turn,
        ),
      );
      setSuggestion(edits.length ? { snapshot, edits, blank } : undefined);
      showDraftEdits(editor, edits);
      if (!edits.length) setMessage(t("There are no changes to apply."));
    } catch (error) {
      if (active()) {
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
      clear();
      setTurns([]);
      setMessage(
        applied
          ? t("Applied to draft")
          : t("The draft changed. Ask for a new suggestion."),
      );
    } finally {
      latest.current.applying = false;
    }
  }

  const messages = useMemo<ThreadMessageLike[]>(
    () =>
      turns.flatMap((turn) => {
        const user: ThreadMessageLike = {
          id: turn.id,
          role: "user",
          content: turn.instruction,
        };
        return turn.message
          ? [
              user,
              {
                id: `${turn.id}-response`,
                role: "assistant",
                content: turn.message,
              },
            ]
          : [user];
      }),
    [turns],
  );
  const runtime = useExternalStoreRuntime({
    messages,
    convertMessage: (message) => message,
    isRunning: busy,
    isDisabled: disabled,
    onNew: async ({ content }) => {
      const instruction = content
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      await submit(instruction, true);
    },
    onCancel: async () => {
      stop();
      setMessage(t("Generation stopped"));
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root asChild>
        <aside className="compose-repair-panel" aria-label={t("AI Assistant")}>
          <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
            <Sparkles
              className="size-4 text-[var(--item-selected-foreground)]"
              aria-hidden
            />
            <h3 className="flex-1 text-sm font-semibold">
              {t("AI Assistant")}
            </h3>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t("Close AI assistant")}
              onClick={onClose}
            >
              <X />
            </Button>
          </header>
          <ThreadPrimitive.Viewport className="compose-repair-conversation">
            <div
              className="flex flex-col gap-3 px-4 py-4"
              role="log"
              aria-label={t("Writing assistant conversation")}
            >
              {!turns.length && (
                <p className="leading-relaxed text-muted-foreground">
                  {t(
                    "Describe how to revise the editable body, or tell the assistant what to write.",
                  )}
                </p>
              )}
              <ThreadPrimitive.Messages
                components={{ UserMessage, AssistantMessage }}
              />
              {busy && (
                <p className="flex items-center gap-2" role="status">
                  <LoaderCircle className="size-4 animate-spin" />
                  {t("Preparing a revision…")}
                </p>
              )}
              {message && (
                <p role="status" className="text-muted-foreground">
                  {message}
                </p>
              )}
              {needsModel && (
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
              )}
            </div>
          </ThreadPrimitive.Viewport>
          <div className="compose-repair-input space-y-2 px-3 pt-2 pb-3">
            <div className="flex flex-wrap gap-1">
              {[
                t("Make it shorter"),
                t("Make it more polite"),
                t("Rewrite in English"),
              ].map((instruction) => (
                <Button
                  key={instruction}
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  variant="outline"
                  disabled={disabled || busy}
                  onClick={() => void submit(instruction)}
                >
                  {instruction}
                </Button>
              ))}
            </div>
            <ComposerPrimitive.Root>
              <InputGroup className="bg-background">
                <ComposerPrimitive.Input
                  asChild
                  autoFocus
                  cancelOnEscape={false}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Escape" &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      onClose();
                    }
                  }}
                  maxLength={1000}
                  placeholder={t("Describe a change…")}
                  aria-label={t("Describe a change…")}
                >
                  <InputGroupTextarea
                    className="max-h-24 min-h-12 overflow-y-auto"
                    rows={2}
                  />
                </ComposerPrimitive.Input>
                <InputGroupAddon align="inline-end" className="self-end">
                  {busy ? (
                    <ComposerPrimitive.Cancel asChild>
                      <InputGroupButton
                        size="icon-sm"
                        aria-label={t("Stop generating")}
                        title={t("Stop generating")}
                      >
                        <Square />
                      </InputGroupButton>
                    </ComposerPrimitive.Cancel>
                  ) : (
                    <ComposerPrimitive.Send asChild>
                      <InputGroupButton
                        size="icon-sm"
                        variant="default"
                        aria-label={t("Send revision request")}
                        title={t("Send revision request")}
                      >
                        <ArrowUp />
                      </InputGroupButton>
                    </ComposerPrimitive.Send>
                  )}
                </InputGroupAddon>
              </InputGroup>
            </ComposerPrimitive.Root>
          </div>
          {suggestion && (
            <div className="compose-repair-review space-y-2 border-t px-3 py-2.5">
              <p role="status" className="text-xs font-medium">
                {t("{value0} changes in the body", {
                  value0: suggestion.edits.length,
                })}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
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
              </div>
            </div>
          )}
        </aside>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="max-w-[92%] self-end rounded-lg rounded-br-sm bg-secondary px-3 py-2 break-words whitespace-pre-wrap">
      <MessagePrimitive.Parts components={{ Text: PlainTextPart }} />
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="max-w-full leading-relaxed break-words whitespace-pre-wrap">
      <MessagePrimitive.Parts components={{ Text: PlainTextPart }} />
    </MessagePrimitive.Root>
  );
}

function PlainTextPart() {
  return <MessagePartPrimitive.Text />;
}
