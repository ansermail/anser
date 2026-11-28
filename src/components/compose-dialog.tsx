import { formatSize } from "@/lib/providers";
import { Card } from "./ui/card";
import { Select, SelectContent, SelectGroup, SelectTrigger } from "./ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { t } from "@/lib/i18n";
import { Alert, AlertDescription } from "./ui/alert";
import { signatureContent } from "@/lib/signatures";
import type { MailSignature } from "@/lib/types";
import { useConfirmation } from "@/hooks/use-confirmation";
import { MiddleTruncateFilename } from "./middle-truncate-filename";
import { MailContent } from "./mail-content";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import {
  FieldSet,
  FieldLegend,
  FieldGroup,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "./ui/field";
import {
  mergeAttachmentPaths,
  insideComposeDrop,
} from "@/lib/compose-attachments";
import {
  composeHasIncludedAttachment,
  detectAttachmentReminder,
} from "@/lib/attachment-reminder";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Paperclip,
  Send,
  Check,
  X,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Clock3,
  Eye,
  FileCode2,
  Pilcrow,
  Text,
  Code2,
  FileUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button, ButtonLabel } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Toggle } from "./ui/toggle";
import { call, native, isDemo, publicPreview } from "@/lib/api";
import type { Account, Address, Compose, ForwardFile } from "@/lib/types";
import {
  textToHtml,
  composeFormat,
  hasDraftContent,
  compileSource,
  htmlToMarkdown,
  prepareCompose,
  prepareEditorCompose,
  type ComposeFormat,
} from "@/lib/compose-format";
import { localDateTime, scheduledIso } from "@/lib/schedule-time";
import { SchedulePicker } from "./schedule-picker";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
const RichEditor = lazy(() =>
  import("./rich-editor").then((m) => ({ default: m.RichEditor })),
);
import { RecipientInput } from "./recipient-input";
import { addressTokens, parseAddresses } from "@/lib/addresses";
import { toast } from "sonner";
import { isImagePath, type BodyImage } from "@/lib/rich-body";
import type { RichEditorHandle } from "./rich-editor";
import { RichEditorBoundary } from "./rich-editor-boundary";
import { composePaper } from "@/lib/compose-presentation";
type ComposeSession = {
  id: string;
  promise: Promise<string>;
  closing?: Promise<void>;
};

function closeComposeSession(session: ComposeSession) {
  session.closing ??= session.promise
    .then(
      (token) => call<void>("close_compose_session", { id: session.id, token }),
      () => {},
    )
    .catch((error) => {
      session.closing = undefined;
      throw error;
    });
  return session.closing;
}

export function ComposeDialog({
  draft,
  onClose,
  accounts,
  onSent,
  onQueued,
  dark = false,
  englishQuoteHeader = false,
}: {
  draft: Compose | null;
  onClose: () => void;
  accounts: Account[];
  onSent: () => void;
  onQueued?: () => void;
  dark?: boolean;
  englishQuoteHeader?: boolean;
}) {
  const { askConfirmation, cancelConfirmation, confirmationDialog } =
    useConfirmation();
  const [value, setValue] = useState<Compose | null>(null),
    [saved, setSaved] = useState(false),
    [sending, setSending] = useState(false),
    [closing, setClosing] = useState(false),
    [extra, setExtra] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    account?: string;
    to?: string;
    cc?: string;
    bcc?: string;
  }>({});
  const [forwardError, setForwardError] = useState("");
  const [forwardLoading, setForwardLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const imageBusy = useRef(false);
  const richEditor = useRef<RichEditorHandle>(null);
  const [markdownSource, setMarkdownSource] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [forwardReload, setForwardReload] = useState(0);
  const [sessionReload, setSessionReload] = useState(0);
  const sessionChain = useRef<Promise<void>>(Promise.resolve());
  const session = useRef<ComposeSession | null>(null);
  const dialogElement = useRef<HTMLDivElement>(null);
  const [assistantHost, setAssistantHost] = useState<HTMLDivElement | null>(
    null,
  );
  const interactionLocked = useRef(false);
  interactionLocked.current = sending || closing;
  const [signatureReload, setSignatureReload] = useState(0);
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  const [dismissedAttachmentReminder, setDismissedAttachmentReminder] =
    useState("");
  const [deliveryPreview, setDeliveryPreview] = useState(false);
  const deliveryPreviewTrigger = useRef<HTMLButtonElement>(null);
  const previewContent = useMemo(
    () =>
      deliveryPreview && value
        ? prepareCompose(value, dark, { englishQuoteHeader })
        : null,
    [dark, deliveryPreview, englishQuoteHeader, value],
  );
  const [expanded, setExpanded] = useState(false),
    [planning, setPlanning] = useState(false),
    [planTime, setPlanTime] = useState(localDateTime);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const closingNow = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!draft?.id || !native || isDemo()) {
      session.current = null;
      return;
    }
    const id = draft.id;
    const promise = sessionChain.current.then(() =>
      call<string>("open_compose_session", { id }),
    );
    const lease = { id, promise };
    session.current = lease;
    sessionChain.current = promise.then(
      () => {},
      () => {},
    );
    return () => {
      sessionChain.current = closeComposeSession(lease).catch(() => {});
    };
  }, [draft?.id, sessionReload]);
  useEffect(() => {
    if (
      (!value?.forwardSource && !value?.externalForwardToken) ||
      value.id !== draft?.id ||
      !native ||
      isDemo()
    )
      return;
    const source = value.forwardSource,
      externalToken = value.externalForwardToken,
      id = value.id,
      lease = session.current;
    if (!lease || lease.id !== id) return;
    let live = true;
    setForwardLoading(true);
    setForwardError("");
    void lease.promise
      .then((token) => {
        if (externalToken)
          return call<ForwardFile[]>("prepare_external_forward_files", {
            id,
            token,
            documentToken: externalToken,
          });
        if (!source) throw new Error(t("Forward source is unavailable"));
        return call<ForwardFile[]>("prepare_forward_files", {
          id,
          token,
          source,
        });
      })
      .then((files) => {
        if (!live || closingNow.current || latest.current?.id !== id) return;
        setForwardLoading(false);
        setValue((current) =>
          current?.id === id &&
          (externalToken
            ? current.externalForwardToken === externalToken
            : current.forwardSource?.hash === source?.hash &&
              current.forwardSource?.id === source?.id)
            ? {
                ...current,
                forwardSource: undefined,
                externalForwardToken: undefined,
                forwardFiles: [...(current.forwardFiles || []), ...files],
              }
            : current,
        );
      })
      .catch((error) => {
        if (live && latest.current?.id === id) {
          setForwardLoading(false);
          setForwardError(String(error));
        }
      });
    return () => {
      live = false;
    };
  }, [
    value?.id,
    value?.forwardSource?.id,
    value?.forwardSource?.hash,
    value?.externalForwardToken,
    forwardReload,
    sessionReload,
    draft?.id,
  ]);
  useEffect(() => {
    if (!draft?.id || !native || isDemo()) return;
    const id = draft.id;
    let live = true,
      unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (
            !live ||
            event.payload.type !== "drop" ||
            latest.current?.id !== id ||
            closingNow.current ||
            interactionLocked.current ||
            isDemo()
          )
            return;
          const rect = dialogElement.current?.getBoundingClientRect();
          if (
            !rect ||
            !insideComposeDrop(
              event.payload.position,
              rect,
              window.devicePixelRatio,
            )
          )
            return;
          const paths = event.payload.paths;
          if (paths.some((path) => !path || path.includes("\0"))) {
            toast.error(t("Invalid attachment path. File not added."));
            return;
          }
          const images = paths.filter(isImagePath);
          const embedded =
            images.length &&
            richEditor.current?.insertPaths(images, {
              x: event.payload.position.x / window.devicePixelRatio,
              y: event.payload.position.y / window.devicePixelRatio,
            });
          const attached = embedded
            ? paths.filter((path) => !isImagePath(path))
            : paths;
          if (!attached.length) return;
          setValue((current) =>
            current?.id === id
              ? {
                  ...current,
                  attachments: mergeAttachmentPaths(
                    current.attachments,
                    attached,
                  ),
                }
              : current,
          );
        }),
      )
      .then((stop) => {
        if (!live) stop();
        else unlisten = stop;
      })
      .catch((error) => {
        if (live)
          toast.error(
            t(
              "Attachment drop is unavailable. Use the attachment button: {value0}",
              {
                value0: String(error),
              },
            ),
          );
      });
    return () => {
      live = false;
      unlisten?.();
    };
  }, [draft?.id]);
  const sourceFile = useRef<HTMLInputElement>(null);
  useEffect(() => {
    cancelConfirmation();
    closingNow.current = false;
    setClosing(false);
    setValue(
      draft && composeFormat(draft) === "markdown"
        ? prepareEditorCompose(draft)
        : draft,
    );
    setMarkdownSource(false);
    setSaved(false);
    setSignatureError("");
    setForwardError("");
    setForwardLoading(false);
    imageBusy.current = false;
    setImageLoading(false);
    setExtra(!!draft?.cc || !!draft?.bcc);
    setExpanded(false);
    setPlanning(false);
    setDeliveryPreview(false);
    setPlanTime(localDateTime());
    setDismissedAttachmentReminder("");
  }, [draft, cancelConfirmation]);
  useEffect(() => {
    if (!value?.accountId || value.signature?.accountId === value.accountId)
      return;
    setSignatureError("");
    const accountId = value.accountId,
      id = value.id;
    let live = true;
    void call<MailSignature>("mail_signature", { accountId })
      .then((config) => {
        if (live)
          setValue((current) =>
            current?.id === id && current.accountId === accountId
              ? { ...current, signature: signatureContent(accountId, config) }
              : current,
          );
      })
      .catch((e) => {
        if (live) setSignatureError(String(e));
      });
    return () => {
      live = false;
    };
  }, [
    value?.id,
    value?.accountId,
    value?.signature?.accountId,
    signatureReload,
  ]);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    void call<Address[]>("contact_suggestions")
      .then((list) => {
        if (live) setSuggestions(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [draft?.id]);
  function persist(action: () => Promise<void>) {
    const next = persistence.current.then(action);
    persistence.current = next.catch(() => {});
    return next;
  }
  useEffect(() => {
    if (!value || sending || closing) return;
    setSaved(false);
    if (!hasDraftContent(value)) return;
    const snapshot = value;
    const t = setTimeout(() => {
      void persist(async () => {
        if (closingNow.current || latest.current?.id !== snapshot.id) return;
        await call("save_draft", { draft: snapshot });
        if (latest.current === snapshot && !closingNow.current) setSaved(true);
      }).catch((e) => toast.error(String(e)));
    }, 600);
    autosaveTimer.current = t;
    return () => {
      clearTimeout(t);
      if (autosaveTimer.current === t) autosaveTimer.current = null;
    };
  }, [value, sending, closing]);
  function update(p: Partial<Compose>) {
    setValue((v) => (v ? { ...v, ...p } : null));
  }
  const attachmentReminder = useMemo(
    () => (value ? detectAttachmentReminder(value) : null),
    [value],
  );
  const attachmentReminderNeedsConfirmation =
    !!value && !!attachmentReminder && !composeHasIncludedAttachment(value);
  const attachmentReminderVisible =
    attachmentReminderNeedsConfirmation &&
    dismissedAttachmentReminder !== attachmentReminder.key;
  async function close() {
    if (sending || closingNow.current) return;
    if (imageBusy.current) {
      toast.info(t("Body images are loading. Wait before closing."));
      return;
    }
    const current = latest.current;
    closingNow.current = true;
    setClosing(true);
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    try {
      if (current)
        await persist(async () => {
          if (hasDraftContent(current))
            await call("save_draft", { draft: current });
          else await call("delete_draft", { id: current.id });
        });
      const lease = session.current;
      if (native && !isDemo() && lease && current && lease.id === current.id) {
        await closeComposeSession(lease);
      }
      onClose();
    } catch (e) {
      toast.error(
        t("{value0} failed: {value1}", {
          value0:
            current && !hasDraftContent(current)
              ? t("Discarding empty message")
              : t("Save draft"),
          value1: e,
        }),
      );
    } finally {
      closingNow.current = false;
      setClosing(false);
    }
  }
  async function valid() {
    if (imageBusy.current) {
      toast.error(t("Body images are loading. Wait before sending."));
      return false;
    }
    if (forwardLoading || value?.forwardSource || value?.externalForwardToken) {
      toast.error(
        t(
          "Original attachments are not ready. Retry or choose not to include them.",
        ),
      );
      return false;
    }
    if (!value?.accountId || !value.to.trim()) {
      const message = t("Select a sending account and enter recipients");
      setFieldErrors(
        !value?.accountId ? { account: message } : { to: message },
      );
      document
        .getElementById(!value?.accountId ? "compose-sender" : "to")
        ?.focus();
      toast.error(message);
      return false;
    }
    if (value.signature?.accountId !== value.accountId) {
      toast.error(
        signatureError
          ? t("Could not load signature. Retry or omit it for this message.")
          : t("Loading the sender's signature. Wait before sending."),
      );
      return false;
    }
    for (const [key, id, name, addresses] of [
      ["to", "to", t("To"), value.to],
      ["cc", "cc", t("Cc"), value.cc],
      ["bcc", "bcc", t("Bcc"), value.bcc],
    ] as const) {
      if (
        addressTokens(addresses).filter(Boolean).length !==
        parseAddresses(addresses).length
      ) {
        const message = t("{value0} contains an invalid email address", {
          value0: name,
        });
        setFieldErrors({ [key]: message });
        if (key !== "to") setExtra(true);
        requestAnimationFrame(() => document.getElementById(id)?.focus());
        toast.error(message);
        return false;
      }
    }
    setFieldErrors({});
    if (
      !value.subject.trim() &&
      !(await askConfirmation({
        title: t("Empty subject"),
        description: t(
          "This message has no subject. Send or schedule it anyway?",
        ),
        action: t("Continue"),
      }))
    )
      return false;
    if (
      attachmentReminderNeedsConfirmation &&
      !(await askConfirmation({
        title: t("Attachment reminder"),
        description: t(
          "The message mentions “{value0}”, but no attachment is included. Continue anyway?",
          { value0: attachmentReminder.keywords.join(" / ") },
        ),
        action: t("Continue"),
      }))
    )
      return false;
    return true;
  }
  async function queue() {
    const draftId = value?.id;
    if (!(await valid()) || !draftId || latest.current?.id !== draftId) return;
    setSending(true);
    try {
      await persistence.current;
      const queuedDraft = prepareCompose(latest.current, dark, {
        englishQuoteHeader,
      });
      await call("queue_send", { draft: queuedDraft });
      toast.success(
        t("Added to send history. Cancel or send now within 8 seconds."),
        {
          duration: 8000,
          action: {
            label: t("Undo"),
            onClick: () => {
              void call<
                {
                  id: string;
                  status: string;
                  sendKind?: string;
                  draft: Compose;
                }[]
              >("outbox")
                .then((records) => {
                  const match = records.find(
                    (r) =>
                      r.status === "scheduled" &&
                      r.sendKind === "undo" &&
                      r.draft.id === queuedDraft.id,
                  );
                  if (!match) {
                    toast.info(
                      t("This message has already left the delay window."),
                    );
                    return;
                  }
                  return call("cancel_schedule", { id: match.id }).then(() => {
                    toast.success(
                      t(
                        "Schedule canceled. Body and attachments restored as a draft.",
                      ),
                    );
                    onSent();
                  });
                })
                .catch((err) => toast.error(String(err)));
            },
          },
        },
      );
      onSent();
      onQueued?.();
      onClose();
    } catch (e) {
      toast.error(String(e), { duration: 10000 });
    } finally {
      setSending(false);
    }
  }
  async function schedule(selectedTime = planTime) {
    const draftId = value?.id;
    if (!(await valid()) || !draftId || latest.current?.id !== draftId) return;
    let scheduledAt: string;
    try {
      scheduledAt = scheduledIso(selectedTime);
    } catch (e) {
      toast.error(String(e));
      return;
    }
    setSending(true);
    try {
      await persistence.current;
      await call("schedule_mail", {
        draft: prepareCompose(latest.current, dark, { englishQuoteHeader }),
        scheduledAt,
      });
      toast.success(
        isDemo()
          ? t("Demo schedule saved. No messages will be sent.")
          : t("Schedule saved. Edit or cancel it in Send history."),
      );
      onSent();
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSending(false);
    }
  }
  function changeFormat(format: ComposeFormat) {
    if (!value || imageBusy.current) return;
    const prepared = prepareEditorCompose(value);
    setMarkdownSource(false);
    if (format === "plain")
      update({ format, body: prepared.body, html: "", source: "" });
    else if (format === "rich")
      update({
        format,
        body: prepared.body,
        html: prepared.html || textToHtml(prepared.body),
        source: "",
      });
    else {
      const source =
        format === "html"
          ? prepared.html || textToHtml(prepared.body)
          : prepared.html
            ? htmlToMarkdown(prepared.html)
            : prepared.body;
      update({ format, source, ...compileSource(source, format) });
    }
  }
  async function importSource(file: File) {
    const id = latest.current?.id;
    if (publicPreview || !id || imageBusy.current || interactionLocked.current)
      return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error(
          t("Body file exceeds 10 MB. Reduce its size before importing."),
        );
      const source = await file.text();
      if (
        id !== latest.current?.id ||
        interactionLocked.current ||
        imageBusy.current
      )
        return;
      const format = /\.html?$/i.test(file.name) ? "html" : "markdown";
      setMarkdownSource(false);
      setEditorRevision((revision) => revision + 1);
      update({ format, source, ...compileSource(source, format) });
      toast.success(t("Imported {value0}", { value0: file.name }));
    } catch (e) {
      toast.error(String(e));
    }
  }
  function closeDeliveryPreview() {
    setDeliveryPreview(false);
    deliveryPreviewTrigger.current?.focus({ preventScroll: true });
  }
  const format = value ? composeFormat(value) : "plain";
  const hasContent = !!value && hasDraftContent(value);
  const formatChoices = {
    plain: { icon: Text, label: t("Plain text") },
    rich: { icon: Pilcrow, label: t("Rich text") },
    markdown: { icon: Code2, label: t("Markdown") },
    html: { icon: FileCode2, label: t("HTML source") },
  };
  const FormatIcon = formatChoices[format].icon;
  const richMode =
    format === "rich" || (format === "markdown" && !markdownSource);
  const sourceMode =
    format === "html" || (format === "markdown" && markdownSource);
  const bodyActions = (
    <div
      className="compose-body-actions"
      role="group"
      aria-label={t("Body actions")}
    >
      <Select
        value={format}
        onValueChange={(next) => changeFormat(next as ComposeFormat)}
        disabled={sending || closing || imageLoading}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <SelectTrigger
              aria-label={t("Body format")}
              size="sm"
              className="compose-format-trigger size-8 justify-center border-0 p-0 shadow-none hover:bg-accent"
            >
              <FormatIcon aria-hidden />
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {t("Body format")} · {formatChoices[format].label}
          </TooltipContent>
        </Tooltip>
        <SelectContent position="popper" align="end">
          <SelectGroup>
            {Object.entries(formatChoices).map(([key, choice]) => (
              <SelectOption key={key} value={key}>
                <choice.icon />
                {choice.label}
              </SelectOption>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {format === "markdown" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Toggle
              id="compose-markdown-source"
              type="button"
              size="sm"
              aria-label={t("Markdown source")}
              pressed={markdownSource}
              disabled={sending || closing || imageLoading}
              onPressedChange={(pressed) => {
                richEditor.current?.closeAssistant();
                setMarkdownSource(pressed);
                requestAnimationFrame(() => {
                  dialogElement.current
                    ?.querySelector<HTMLElement>("#compose-markdown-source")
                    ?.focus({ preventScroll: true });
                });
              }}
            >
              <FileCode2 />
            </Toggle>
          </TooltipTrigger>
          <TooltipContent>
            {markdownSource ? t("Visual editor") : t("Markdown source")}
          </TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            ref={deliveryPreviewTrigger}
            aria-label={t("Send preview")}
            aria-expanded={deliveryPreview}
            aria-controls={
              deliveryPreview ? "compose-delivery-preview" : undefined
            }
            onClick={() => {
              if (deliveryPreview) closeDeliveryPreview();
              else {
                richEditor.current?.closeAssistant();
                setDeliveryPreview(true);
              }
            }}
          >
            <Eye />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("Send preview")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Import body…")}
            disabled={publicPreview}
            onClick={() => sourceFile.current?.click()}
          >
            <FileUp />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("Import body…")}</TooltipContent>
      </Tooltip>
    </div>
  );
  async function attach() {
    if (!native || isDemo()) {
      toast.info(t("Add real attachments in the desktop app"));
      return;
    }
    const id = latest.current?.id;
    if (!id || closingNow.current || interactionLocked.current) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const paths = await open({ multiple: true, directory: false });
      if (
        paths &&
        latest.current?.id === id &&
        !closingNow.current &&
        !interactionLocked.current
      ) {
        const incoming = Array.isArray(paths) ? paths : [paths];
        setValue((current) =>
          current?.id === id
            ? {
                ...current,
                attachments: mergeAttachmentPaths(
                  current.attachments,
                  incoming,
                ),
              }
            : current,
        );
      }
    } catch (error) {
      toast.error(
        t("Could not add attachment: {value0}", { value0: String(error) }),
      );
    }
  }
  return (
    <Dialog
      open={!!draft}
      onOpenChange={(v) => {
        if (!v) void close();
      }}
    >
      <DialogContent
        className={`compose-workspace ${expanded ? "compose-expanded" : ""}`}
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (
            e.isComposing ||
            sending ||
            closing ||
            (!deliveryPreview && richEditor.current?.closeAssistant())
          )
            e.preventDefault();
          else if (deliveryPreview) {
            e.preventDefault();
            closeDeliveryPreview();
          } else if (expanded) {
            e.preventDefault();
            setExpanded(false);
          }
        }}
      >
        <div className="compose-dialog" ref={dialogElement}>
          <DialogHeader>
            <div className="compose-heading">
              <DialogTitle>
                {draft?.subject.startsWith("Re:")
                  ? t("Reply to message")
                  : draft?.subject.startsWith("Fwd:")
                    ? t("Forward message")
                    : t("Compose")}
              </DialogTitle>
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    expanded
                      ? t("Restore compose window")
                      : t("Expand compose window")
                  }
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    hasContent
                      ? t("Save draft & close")
                      : t("Discard empty message")
                  }
                  disabled={sending || closing || imageLoading}
                  onClick={() => void close()}
                >
                  <X size={18} />
                </Button>
              </div>
            </div>
            <DialogDescription className="sr-only">
              {t(
                "Messages with content are saved as drafts automatically. Empty messages are discarded on close.",
              )}
            </DialogDescription>
          </DialogHeader>
          {value && (
            <>
              <fieldset
                className="compose-fields"
                disabled={sending || closing}
              >
                <div className="compose-fields-layout">
                  <div className="compose-row">
                    <Label htmlFor="compose-sender">{t("From")}</Label>
                    <SelectField
                      id="compose-sender"
                      className="compose-sender"
                      value={value.accountId}
                      aria-invalid={!!fieldErrors.account || undefined}
                      aria-describedby={
                        fieldErrors.account ? "compose-sender-error" : undefined
                      }
                      onValueChange={(accountId) => {
                        setFieldErrors((prev) => ({
                          ...prev,
                          account: undefined,
                        }));
                        update({ accountId });
                      }}
                    >
                      <SelectOption value="" disabled>
                        {t("Select sending account")}
                      </SelectOption>
                      {accounts
                        .filter((a) => a.enabled)
                        .map((a) => (
                          <SelectOption key={a.id} value={a.id}>
                            {a.name} &lt;{a.email}&gt;
                          </SelectOption>
                        ))}
                    </SelectField>
                  </div>
                  {fieldErrors.account && (
                    <FieldError
                      id="compose-sender-error"
                      className="px-6 text-xs"
                    >
                      {fieldErrors.account}
                    </FieldError>
                  )}
                  <div className="compose-row">
                    <Label htmlFor="to">{t("To")}</Label>
                    <RecipientInput
                      id="to"
                      autoFocus
                      value={value.to}
                      ariaInvalid={!!fieldErrors.to}
                      ariaDescribedBy={
                        fieldErrors.to ? "compose-to-error" : undefined
                      }
                      onChange={(to) => {
                        setFieldErrors((prev) => ({ ...prev, to: undefined }));
                        update({ to });
                      }}
                      suggestions={suggestions}
                    />
                    <Button
                      variant="ghost"
                      type="button"
                      className="text-link"
                      onClick={() => setExtra(!extra)}
                    >
                      {t("Cc / Bcc")}
                    </Button>
                  </div>
                  {fieldErrors.to && (
                    <FieldError id="compose-to-error" className="px-6 text-xs">
                      {fieldErrors.to}
                    </FieldError>
                  )}
                  {extra && (
                    <>
                      <div className="compose-row">
                        <Label htmlFor="cc">{t("Cc")}</Label>
                        <RecipientInput
                          id="cc"
                          value={value.cc}
                          ariaInvalid={!!fieldErrors.cc}
                          ariaDescribedBy={
                            fieldErrors.cc ? "compose-cc-error" : undefined
                          }
                          onChange={(cc) => {
                            setFieldErrors((prev) => ({
                              ...prev,
                              cc: undefined,
                            }));
                            update({ cc });
                          }}
                          suggestions={suggestions}
                        />
                      </div>
                      {fieldErrors.cc && (
                        <FieldError
                          id="compose-cc-error"
                          className="px-6 text-xs"
                        >
                          {fieldErrors.cc}
                        </FieldError>
                      )}
                      <div className="compose-row">
                        <Label htmlFor="bcc">{t("Bcc")}</Label>
                        <RecipientInput
                          id="bcc"
                          value={value.bcc}
                          ariaInvalid={!!fieldErrors.bcc}
                          ariaDescribedBy={
                            fieldErrors.bcc ? "compose-bcc-error" : undefined
                          }
                          onChange={(bcc) => {
                            setFieldErrors((prev) => ({
                              ...prev,
                              bcc: undefined,
                            }));
                            update({ bcc });
                          }}
                          suggestions={suggestions}
                        />
                      </div>
                      {fieldErrors.bcc && (
                        <FieldError
                          id="compose-bcc-error"
                          className="px-6 text-xs"
                        >
                          {fieldErrors.bcc}
                        </FieldError>
                      )}
                    </>
                  )}
                  <div className="compose-row">
                    <Label htmlFor="subject">{t("Subject")}</Label>
                    <Input
                      id="subject"
                      value={value.subject}
                      onChange={(e) => update({ subject: e.target.value })}
                      placeholder={t("Give this message a subject")}
                    />
                  </div>
                  <TooltipProvider delayDuration={300}>
                    <Card className="compose-body-card">
                      {!richMode && (
                        <div className="format-toolbar">{bodyActions}</div>
                      )}
                      <div className="compose-editor">
                        {richMode ? (
                          <RichEditorBoundary
                            key={`${value.id}-${editorRevision}`}
                          >
                            <Suspense
                              fallback={
                                <div className="rich-editor">
                                  <div className="format-toolbar">
                                    {bodyActions}
                                  </div>
                                  <div className="editor-loading">
                                    <LoaderCircle
                                      className="animate-spin"
                                      size={18}
                                    />
                                    {t("Loading editor…")}
                                  </div>
                                </div>
                              }
                            >
                              <RichEditor
                                ref={richEditor}
                                dark={dark}
                                key={`${value.id}-${format}`}
                                body={value.body}
                                html={
                                  value.html ||
                                  (value.body ? textToHtml(value.body) : "")
                                }
                                disabled={sending || closing}
                                repairDisabled={
                                  planning ||
                                  imageLoading ||
                                  forwardLoading ||
                                  !!value.forwardSource ||
                                  !!value.externalForwardToken
                                }
                                assistantHost={assistantHost}
                                onOpenAssistant={() =>
                                  setDeliveryPreview(false)
                                }
                                bodyActions={bodyActions}
                                onChange={(body, html) => {
                                  if (format === "markdown")
                                    update({
                                      body,
                                      html,
                                      source: htmlToMarkdown(html),
                                    });
                                  else update({ body, html });
                                }}
                                onBusy={(busy) => {
                                  imageBusy.current = busy;
                                  setImageLoading(busy);
                                }}
                                readImages={async (paths) => {
                                  const id = value.id;
                                  const lease = session.current;
                                  if (
                                    !native ||
                                    isDemo() ||
                                    !lease ||
                                    lease.id !== id ||
                                    interactionLocked.current
                                  )
                                    throw new Error(
                                      t(
                                        "Body images can only be read in the current desktop compose window",
                                      ),
                                    );
                                  const token = await lease.promise;
                                  if (
                                    latest.current?.id !== id ||
                                    closingNow.current ||
                                    interactionLocked.current
                                  )
                                    throw new Error(
                                      t(
                                        "The compose window was closed or submitted",
                                      ),
                                    );
                                  return call<BodyImage[]>("read_body_images", {
                                    id,
                                    token,
                                    paths,
                                  });
                                }}
                              />
                            </Suspense>
                          </RichEditorBoundary>
                        ) : sourceMode ? (
                          <Textarea
                            className="compose-body compose-source"
                            aria-label={
                              format === "markdown"
                                ? t("Markdown source")
                                : t("HTML source")
                            }
                            spellCheck={false}
                            placeholder={
                              format === "markdown"
                                ? t(
                                    "# Heading\n\nSupports **bold**, lists, links and tables…",
                                  )
                                : t(
                                    "Paste a complete HTML document or fragment…",
                                  )
                            }
                            value={value.source ?? ""}
                            onChange={(e) =>
                              update({
                                source: e.target.value,
                                ...compileSource(
                                  e.target.value,
                                  format === "markdown" ? "markdown" : "html",
                                ),
                              })
                            }
                          />
                        ) : (
                          <Textarea
                            className="compose-body"
                            aria-label={t("Message body")}
                            placeholder={t("Start with a greeting…")}
                            value={value.body}
                            onChange={(e) => update({ body: e.target.value })}
                          />
                        )}
                      </div>
                      <Input
                        ref={sourceFile}
                        type="file"
                        accept=".html,.htm,.md,.markdown"
                        className="sr-only"
                        aria-label={t("Import body file")}
                        disabled={publicPreview}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file) void importSource(file);
                        }}
                      />
                    </Card>
                  </TooltipProvider>
                  <div className="compose-body-details">
                    {signatureError && (
                      <Alert variant="destructive" className="mx-6 w-auto">
                        <AlertDescription className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-destructive">
                            {t("Could not load signature: ")}
                            {signatureError}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSignatureReload((v) => v + 1)}
                          >
                            {t("Reload signature")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSignatureError("");
                              update({
                                signature: {
                                  accountId: value.accountId,
                                  included: false,
                                  body: "",
                                  html: "",
                                },
                              });
                            }}
                          >
                            {t("Omit signature for this message")}
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    {value.quote && (
                      <Label
                        htmlFor={`include-original-${value.id}`}
                        className="compose-quote-toggle self-start px-6 py-2"
                      >
                        <Switch
                          id={`include-original-${value.id}`}
                          checked={value.quote.included}
                          disabled={sending || closing}
                          onCheckedChange={(included) =>
                            update({ quote: { ...value.quote!, included } })
                          }
                        />
                        {t("Include original")}
                      </Label>
                    )}
                    {value.quote?.included && (
                      <section
                        className="compose-quoted-original"
                        aria-label={t("Quoted original message")}
                      >
                        <div className="compose-quote-heading">
                          {t("Original · ")}
                          {value.quote.subject}
                        </div>
                        <MailContent
                          html={
                            value.quote.html || textToHtml(value.quote.body)
                          }
                          title={t("Quoted original")}
                          onOpenLink={() => {}}
                        />
                      </section>
                    )}
                    {(value.forwardSource || value.externalForwardToken) && (
                      <Alert className="mx-4 w-auto">
                        <FileUp />
                        <AlertDescription>
                          {forwardLoading
                            ? t(
                                "Preparing original attachments. Originals remain unchanged…",
                              )
                            : forwardError ||
                              t("Waiting for original attachments")}
                          <div className="flex flex-wrap gap-2">
                            {!forwardLoading && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSessionReload((n) => n + 1);
                                  setForwardReload((n) => n + 1);
                                }}
                              >
                                {t("Retry preparation")}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={sending || closing}
                              onClick={() => {
                                update({
                                  forwardSource: undefined,
                                  externalForwardToken: undefined,
                                });
                                setForwardError("");
                                setForwardLoading(false);
                              }}
                            >
                              {t("Do not include original attachments")}
                            </Button>
                          </div>
                        </AlertDescription>
                      </Alert>
                    )}
                    {!!value.forwardFiles?.length && (
                      <FieldSet className="min-w-0 shrink-0 px-7 py-3">
                        <FieldLegend>{t("Original attachments")}</FieldLegend>
                        <FieldGroup>
                          {value.forwardFiles.map((file) => (
                            <Field key={file.id} orientation="horizontal">
                              <Checkbox
                                id={`forward-file-${file.id}`}
                                checked={file.included}
                                disabled={sending || closing}
                                onCheckedChange={(included) =>
                                  update({
                                    forwardFiles: value.forwardFiles!.map(
                                      (item) =>
                                        item.id === file.id
                                          ? {
                                              ...item,
                                              included: included === true,
                                            }
                                          : item,
                                    ),
                                  })
                                }
                              />
                              <FieldContent className="min-w-0">
                                <FieldLabel
                                  className="min-w-0 max-w-full"
                                  htmlFor={`forward-file-${file.id}`}
                                >
                                  <MiddleTruncateFilename
                                    name={file.name}
                                    className="max-w-[260px]"
                                  />
                                  <span className="shrink-0 text-muted-foreground tabular-nums">
                                    {" "}
                                    · {formatSize(file.size)}
                                  </span>
                                </FieldLabel>
                              </FieldContent>
                            </Field>
                          ))}
                        </FieldGroup>
                      </FieldSet>
                    )}
                    {value.attachments.length > 0 && (
                      <div className="compose-attachments">
                        {value.attachments.map((p, i) => {
                          const name = p.split(/[\\/]/).pop() || p;
                          return (
                            <span key={p + i} className="max-w-[260px]">
                              <Paperclip size={13} className="shrink-0" />
                              <MiddleTruncateFilename name={name} />
                              <Button
                                variant="ghost"
                                title={t("Remove attachment")}
                                aria-label={t("Remove attachment")}
                                onClick={() =>
                                  update({
                                    attachments: value.attachments.filter(
                                      (_, j) => i !== j,
                                    ),
                                  })
                                }
                              >
                                <X size={13} />
                              </Button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </fieldset>
              <div className="compose-footer">
                <Button
                  aria-busy={sending}
                  disabled={
                    sending ||
                    closing ||
                    forwardLoading ||
                    imageLoading ||
                    !!value.forwardSource ||
                    !!value.externalForwardToken ||
                    isDemo() ||
                    !native
                  }
                  onClick={queue}
                >
                  {sending ? (
                    <LoaderCircle className="animate-spin" size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                  <ButtonLabel
                    reserve={[t("Send message"), t("Preparing to send…")]}
                  >
                    {sending ? t("Preparing to send…") : t("Send message")}
                  </ButtonLabel>
                </Button>
                <Popover
                  open={planning}
                  onOpenChange={setPlanning}
                  modal={false}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      disabled={
                        sending ||
                        closing ||
                        forwardLoading ||
                        imageLoading ||
                        !!value.forwardSource ||
                        !!value.externalForwardToken ||
                        (!native && !isDemo())
                      }
                    >
                      <Clock3 size={16} />
                      {t("Schedule send")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    side="top"
                    align="start"
                    sideOffset={10}
                    collisionPadding={16}
                    className="compose-schedule-popover w-auto p-0"
                  >
                    <SchedulePicker
                      value={planTime}
                      onChange={setPlanTime}
                      onConfirm={(time) => void schedule(time)}
                      onCancel={() => setPlanning(false)}
                      busy={sending || closing}
                    />
                  </PopoverContent>
                </Popover>
                {value.signature &&
                  value.signature.accountId === value.accountId &&
                  (value.signature.body || value.signature.html) && (
                    <Label
                      htmlFor={`include-signature-${value.id}`}
                      className="flex shrink-0 items-center gap-2 whitespace-nowrap"
                    >
                      <Switch
                        id={`include-signature-${value.id}`}
                        checked={value.signature.included}
                        disabled={sending || closing}
                        onCheckedChange={(included) =>
                          update({
                            signature: { ...value.signature!, included },
                          })
                        }
                      />
                      {t("Include email signature")}
                    </Label>
                  )}
                <Button
                  variant="outline"
                  onClick={() => void attach()}
                  disabled={sending || closing}
                >
                  <Paperclip data-icon="inline-start" />
                  {t("Add attachment")}
                </Button>
                {attachmentReminderVisible && attachmentReminder && (
                  <Alert role="status" className="compose-attachment-reminder">
                    <AlertDescription className="compose-attachment-reminder-content">
                      <Paperclip aria-hidden="true" />
                      <span
                        title={t(
                          "The message mentions “{value0}”, but no file is attached.",
                          {
                            value0: attachmentReminder.keywords.join(" / "),
                          },
                        )}
                      >
                        {t(
                          "The message mentions “{value0}”, but no file is attached.",
                          {
                            value0: attachmentReminder.keywords.join(" / "),
                          },
                        )}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void attach()}
                      >
                        {t("Add attachment")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("Dismiss reminder")}
                        title={t("Dismiss reminder")}
                        onClick={() =>
                          setDismissedAttachmentReminder(attachmentReminder.key)
                        }
                      >
                        <X />
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <span>
                  {hasContent && saved && <Check size={13} />}{" "}
                  {closing
                    ? t("Closing…")
                    : !hasContent
                      ? t("Empty messages are not saved")
                      : saved
                        ? t("Draft saved")
                        : t("Saving draft…")}
                </span>
                {isDemo() && <small>{t("Demo mode does not send mail")}</small>}
              </div>
            </>
          )}
        </div>
        <div className="compose-assistant-host" ref={setAssistantHost} />
        {previewContent && (
          <Card
            className="compose-preview-panel"
            id="compose-delivery-preview"
            role="region"
            aria-labelledby="compose-delivery-preview-title"
          >
            <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
              <h3
                id="compose-delivery-preview-title"
                className="text-sm font-semibold"
              >
                {t("Final message preview")}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("Close send preview")}
                onClick={closeDeliveryPreview}
              >
                <X />
              </Button>
            </header>
            <div
              className="delivery-preview-body"
              data-visual={
                format === "rich" || format === "markdown" || undefined
              }
              style={
                format === "rich" || format === "markdown"
                  ? { backgroundColor: composePaper(dark) }
                  : undefined
              }
            >
              <MailContent
                originalColors
                title={t("Outgoing message body preview")}
                html={
                  previewContent.deliveryHtml ||
                  textToHtml(previewContent.deliveryBody || "")
                }
                onOpenLink={() => {}}
              />
            </div>
          </Card>
        )}
      </DialogContent>
      {confirmationDialog}
    </Dialog>
  );
}
