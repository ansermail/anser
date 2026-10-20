import { t } from "@/lib/i18n";
import { Alert, AlertDescription } from "./ui/alert";
import { signatureContent } from "@/lib/signatures";
import type { MailSignature } from "@/lib/types";
import { useConfirmation } from "@/hooks/use-confirmation";
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
  FieldLabel,
} from "./ui/field";
import {
  mergeAttachmentPaths,
  insideComposeDrop,
} from "@/lib/compose-attachments";
import { disableFrameContextMenu } from "@/lib/context-menu";
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
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { call, native, isDemo } from "@/lib/api";
import type { Account, Address, Compose, ForwardFile } from "@/lib/types";
import {
  textToHtml,
  composeFormat,
  hasDraftContent,
  compileSource,
  prepareCompose,
  prepareEditorCompose,
  type ComposeFormat,
} from "@/lib/compose-format";
import { safeMailHtml } from "@/lib/mail-html";
import { localDateTime, scheduledIso } from "@/lib/schedule-time";
import { SchedulePicker } from "./schedule-picker";
const RichEditor = lazy(() =>
  import("./rich-editor").then((m) => ({ default: m.RichEditor })),
);
import { RecipientInput } from "./recipient-input";
import { addressTokens, parseAddresses } from "@/lib/addresses";
import { toast } from "sonner";
import { isImagePath, type BodyImage } from "@/lib/rich-body";
import type { RichEditorHandle } from "./rich-editor";
import { RichEditorBoundary } from "./rich-editor-boundary";
export function ComposeDialog({
  draft,
  onClose,
  accounts,
  onSent,
  onQueued,
  dark = false,
  onToggleTheme,
}: {
  draft: Compose | null;
  onClose: () => void;
  accounts: Account[];
  onSent: () => void;
  onQueued?: () => void;
  dark?: boolean;
  onToggleTheme?: () => void;
}) {
  const { askConfirmation, cancelConfirmation, confirmationDialog } =
    useConfirmation();
  const [value, setValue] = useState<Compose | null>(null),
    [saved, setSaved] = useState(false),
    [sending, setSending] = useState(false),
    [closing, setClosing] = useState(false),
    [extra, setExtra] = useState(false);
  const [signatureError, setSignatureError] = useState("");
  const [forwardError, setForwardError] = useState("");
  const [forwardLoading, setForwardLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const imageBusy = useRef(false);
  const richEditor = useRef<RichEditorHandle>(null);
  const [forwardReload, setForwardReload] = useState(0);
  const [sessionReload, setSessionReload] = useState(0);
  const sessionChain = useRef<Promise<void>>(Promise.resolve());
  const session = useRef<{ id: string; promise: Promise<string> } | null>(null);
  const dialogElement = useRef<HTMLDivElement>(null);
  const interactionLocked = useRef(false);
  interactionLocked.current = sending || closing;
  const [signatureReload, setSignatureReload] = useState(0);
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  const [deliveryPreview, setDeliveryPreview] = useState(false);
  const previewContent = useMemo(
    () => (deliveryPreview && value ? prepareCompose(value) : null),
    [deliveryPreview, value],
  );
  const [expanded, setExpanded] = useState(false),
    [preview, setPreview] = useState(true),
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
    session.current = { id, promise };
    sessionChain.current = promise.then(
      () => {},
      () => {},
    );
    return () => {
      const close = promise.then((token) =>
        call<void>("close_compose_session", { id, token }),
      );
      sessionChain.current = close.catch(() => {});
    };
  }, [draft?.id, sessionReload]);
  useEffect(() => {
    if (!value?.forwardSource || value.id !== draft?.id || !native || isDemo())
      return;
    const source = value.forwardSource,
      id = value.id,
      lease = session.current;
    if (!lease || lease.id !== id) return;
    let live = true;
    setForwardLoading(true);
    setForwardError("");
    void lease.promise
      .then((token) =>
        call<ForwardFile[]>("prepare_forward_files", { id, token, source }),
      )
      .then((files) => {
        if (!live || closingNow.current || latest.current?.id !== id) return;
        setForwardLoading(false);
        setValue((current) =>
          current?.id === id &&
          current.forwardSource?.hash === source.hash &&
          current.forwardSource.id === source.id
            ? {
                ...current,
                forwardSource: undefined,
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
  const previewFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (previewFrame.current)
      return disableFrameContextMenu(previewFrame.current);
  }, [preview, value?.html, value?.format]);
  useEffect(() => {
    cancelConfirmation();
    closingNow.current = false;
    setClosing(false);
    setValue(draft);
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
        const token = await lease.promise;
        await call("close_compose_session", { id: lease.id, token });
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
    if (forwardLoading || value?.forwardSource) {
      toast.error(
        t(
          "Original attachments are not ready. Retry or choose not to include them.",
        ),
      );
      return false;
    }
    if (!value?.accountId || !value.to.trim()) {
      toast.error(t("Select a sending account and enter recipients"));
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
    for (const [name, addresses] of [
      [t("To"), value.to],
      [t("Cc"), value.cc],
      [t("Bcc"), value.bcc],
    ]) {
      if (
        addressTokens(addresses).filter(Boolean).length !==
        parseAddresses(addresses).length
      ) {
        toast.error(
          t("{value0} contains an invalid email address", { value0: name }),
        );
        return false;
      }
    }
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
    return true;
  }
  async function queue() {
    const draftId = value?.id;
    if (!(await valid()) || !draftId || latest.current?.id !== draftId) return;
    setSending(true);
    try {
      await persistence.current;
      await call("queue_send", { draft: prepareCompose(latest.current) });
      toast.success(
        t("Added to send history. Cancel or send now within 8 seconds."),
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
        draft: prepareCompose(latest.current),
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
          : prepared.body;
      update({ format, source, ...compileSource(source, format) });
    }
  }
  async function importSource(file: File) {
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error(
          t("Body file exceeds 10 MB. Reduce its size before importing."),
        );
      const source = await file.text();
      const format = /\.html?$/i.test(file.name) ? "html" : "markdown";
      update({ format, source, ...compileSource(source, format) });
      toast.success(t("Imported {value0}", { value0: file.name }));
    } catch (e) {
      toast.error(String(e));
    }
  }
  const format = value ? composeFormat(value) : "plain";
  const hasContent = !!value && hasDraftContent(value);
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
        ref={dialogElement}
        className={`compose-dialog ${expanded ? "compose-expanded" : ""}`}
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (sending || closing) e.preventDefault();
          else if (expanded) {
            e.preventDefault();
            setExpanded(false);
          }
        }}
      >
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
            <fieldset className="compose-fields" disabled={sending || closing}>
              <div className="compose-row">
                <Label>{t("From")}</Label>
                <SelectField
                  value={value.accountId}
                  onValueChange={(value) => update({ accountId: value })}
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
              <div className="compose-row">
                <Label htmlFor="to">{t("To")}</Label>
                <RecipientInput
                  id="to"
                  autoFocus
                  value={value.to}
                  onChange={(to) => update({ to })}
                  suggestions={suggestions}
                />
                <Button
                  variant="ghost"
                  type="button"
                  className="text-link ml-auto"
                  onClick={() => setExtra(!extra)}
                >
                  {t("Cc / Bcc")}
                </Button>
              </div>
              {extra && (
                <>
                  <div className="compose-row">
                    <Label htmlFor="cc">{t("Cc")}</Label>
                    <RecipientInput
                      id="cc"
                      value={value.cc}
                      onChange={(cc) => update({ cc })}
                      suggestions={suggestions}
                    />
                  </div>
                  <div className="compose-row">
                    <Label htmlFor="bcc">{t("Bcc")}</Label>
                    <RecipientInput
                      id="bcc"
                      value={value.bcc}
                      onChange={(bcc) => update({ bcc })}
                      suggestions={suggestions}
                    />
                  </div>
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
              <div className="compose-format">
                <span>{t("Body")}</span>
                <SelectField
                  aria-label={t("Body format")}
                  value={format}
                  onValueChange={(value) =>
                    changeFormat(value as ComposeFormat)
                  }
                >
                  <SelectOption value="plain">{t("Plain text")}</SelectOption>
                  <SelectOption value="rich">{t("Rich text")}</SelectOption>
                  <SelectOption value="markdown">Markdown</SelectOption>
                  <SelectOption value="html">{t("HTML source")}</SelectOption>
                </SelectField>
                {value.quote && (
                  <Label
                    htmlFor={`include-original-${value.id}`}
                    className="compose-quote-toggle"
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeliveryPreview(true)}
                >
                  <Eye size={14} />
                  {t("Send preview")}
                </Button>
                {(format === "markdown" || format === "html") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreview(!preview)}
                  >
                    <Eye size={14} />
                    {preview ? t("Hide preview") : t("Preview body")}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => sourceFile.current?.click()}
                >
                  <FileUp size={14} />
                  {t("Import file")}
                </Button>
                <Input
                  ref={sourceFile}
                  type="file"
                  accept=".html,.htm,.md,.markdown"
                  className="sr-only"
                  aria-label={t("Import body file")}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importSource(file);
                  }}
                />
              </div>
              <div
                className={`compose-editor ${(format === "markdown" || format === "html") && preview ? "source-with-preview" : ""}`}
              >
                {format === "rich" ? (
                  <RichEditorBoundary key={value.id}>
                    <Suspense
                      fallback={
                        <div className="editor-loading">
                          <LoaderCircle className="animate-spin" size={18} />
                          {t("Loading editor…")}
                        </div>
                      }
                    >
                      <RichEditor
                        ref={richEditor}
                        dark={dark}
                        onToggleTheme={onToggleTheme}
                        key={`${value.id}-${format}`}
                        body={value.body}
                        html={
                          value.html ||
                          (value.body ? textToHtml(value.body) : "")
                        }
                        disabled={sending || closing}
                        onChange={(body, html) => update({ body, html })}
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
                              t("The compose window was closed or submitted"),
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
                ) : format === "markdown" || format === "html" ? (
                  <>
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
                          : t("Paste a complete HTML document or fragment…")
                      }
                      value={value.source ?? ""}
                      onChange={(e) =>
                        update({
                          source: e.target.value,
                          ...compileSource(e.target.value, format),
                        })
                      }
                    />
                    {preview && (
                      <div
                        className="compose-preview"
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        <div>
                          <Code2 size={13} />
                          {t("Body preview")}
                        </div>
                        <iframe
                          ref={previewFrame}
                          title={t("Compose body preview")}
                          sandbox="allow-same-origin"
                          referrerPolicy="no-referrer"
                          srcDoc={safeMailHtml(
                            value.html || textToHtml(value.body),
                          )}
                        />
                      </div>
                    )}
                  </>
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
              {value.signature &&
                value.signature.accountId === value.accountId &&
                (value.signature.body || value.signature.html) &&
                value.signature.included && (
                  <section className="px-6 py-4 flex flex-col gap-3">
                    {value.signature.included && (
                      <MailContent
                        html={
                          value.signature.html ||
                          textToHtml(value.signature.body)
                        }
                        title={t("Signature for this message")}
                        onOpenLink={() => {}}
                      />
                    )}
                  </section>
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
                    html={value.quote.html || textToHtml(value.quote.body)}
                    title={t("Quoted original")}
                    onOpenLink={() => {}}
                  />
                </section>
              )}
              {value.forwardSource && (
                <Alert className="mx-4 w-auto">
                  <FileUp />
                  <AlertDescription>
                    {forwardLoading
                      ? t(
                          "Preparing original attachments. Originals remain unchanged…",
                        )
                      : forwardError || t("Waiting for original attachments")}
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
                          update({ forwardSource: undefined });
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
                              forwardFiles: value.forwardFiles!.map((item) =>
                                item.id === file.id
                                  ? { ...item, included: included === true }
                                  : item,
                              ),
                            })
                          }
                        />
                        <FieldContent className="min-w-0">
                          <FieldLabel
                            className="max-w-full break-words"
                            htmlFor={`forward-file-${file.id}`}
                          >
                            {file.name} · {file.size}
                            {t(" bytes")}
                          </FieldLabel>
                        </FieldContent>
                      </Field>
                    ))}
                  </FieldGroup>
                </FieldSet>
              )}
              {value.attachments.length > 0 && (
                <div className="compose-attachments">
                  {value.attachments.map((p, i) => (
                    <span key={p + i}>
                      <Paperclip size={13} />
                      {p.split("/").pop()}
                      <Button
                        variant="ghost"
                        title={t("Remove attachment")}
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
                  ))}
                </div>
              )}
            </fieldset>
            {planning && (
              <SchedulePicker
                value={planTime}
                onChange={setPlanTime}
                onConfirm={(time) => void schedule(time)}
                onCancel={() => setPlanning(false)}
                busy={sending || closing}
              />
            )}
            <div className="compose-footer">
              <Button
                disabled={
                  sending ||
                  closing ||
                  forwardLoading ||
                  imageLoading ||
                  !!value.forwardSource ||
                  isDemo() ||
                  !native
                }
                onClick={queue}
              >
                {sending ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Send size={16} />
                )}{" "}
                {sending ? t("Preparing to send…") : t("Send message")}
              </Button>
              <Button
                variant="outline"
                disabled={
                  sending ||
                  closing ||
                  forwardLoading ||
                  imageLoading ||
                  !!value.forwardSource ||
                  (!native && !isDemo())
                }
                onClick={() => setPlanning(!planning)}
              >
                <Clock3 size={16} />
                {t("Schedule send")}
              </Button>
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
                variant="ghost"
                size="icon"
                onClick={() => void attach()}
                disabled={sending || closing}
                title={t("Add attachment")}
              >
                <Paperclip size={18} />
              </Button>
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
      </DialogContent>
      <Dialog
        open={deliveryPreview && !!value}
        onOpenChange={setDeliveryPreview}
      >
        <DialogContent className="delivery-preview-dialog">
          <DialogHeader>
            <DialogTitle>{t("Final message preview")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t(
                "Preview the outgoing body with the selected original content.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="delivery-preview-body">
            {previewContent && (
              <MailContent
                title={t("Outgoing message body preview")}
                html={
                  previewContent.deliveryHtml ||
                  textToHtml(previewContent.deliveryBody || "")
                }
                onOpenLink={() => {}}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </Dialog>
  );
}
