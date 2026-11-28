import { DesktopTitlebar } from "./desktop-titlebar";
import { formatMailTime, t, useLanguage } from "@/lib/i18n";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Printer,
  Reply,
  ReplyAll,
  Send,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { call, native, newDraft } from "../lib/api";
import {
  displayAddresses,
  formatAddress,
  replyRecipients,
} from "../lib/addresses";
import { saveContactAddress } from "../lib/contact-actions";
import { disableNativeContextMenu } from "../lib/context-menu";
import { replyHeaders } from "../lib/conversations";
import { mailFileError } from "../lib/mail-file-errors";
import { printMail } from "../lib/mail-print";
import { senderName } from "../lib/providers";
import { useTheme } from "../lib/theme";
import type { Account, Compose, Detail, Preferences } from "../lib/types";
import { Alert, AlertDescription } from "./ui/alert";
import { MailRecipients } from "./mail-recipients";
import { SenderIdentity } from "./contact-address";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";
import { ComposeDialog } from "./compose-dialog";
import { ConversationReader } from "./conversation-reader";
import { MailActionTooltip } from "./mail-action-tooltip";
import { MiddleTruncateFilename } from "./middle-truncate-filename";
import { mailShortcutKeys } from "../lib/mail-shortcuts";

interface EmlDocument {
  token: string;
  filename: string;
  detail: Detail;
}

export function ExternalMailWindow() {
  useLanguage();
  const [document, setDocument] = useState<EmlDocument | null>(null);
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [englishQuoteHeader, setEnglishQuoteHeader] = useState(false);
  const [draft, setDraft] = useState<Compose | null>(null);
  const { dark, mode } = useTheme();
  const readerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen("anser-translation-config-changed", () =>
          window.dispatchEvent(new Event("anser-translation-config-changed")),
        ),
      )
      .then((remove) => {
        if (disposed) remove();
        else unlisten = remove;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const [translatedSubject, setTranslatedSubject] =
    useState<HTMLDivElement | null>(null);
  const [translationActions, setTranslationActions] =
    useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = window.document.documentElement;
    element.classList.add("external-mail-document");
    return () => element.classList.remove("external-mail-document");
  }, []);
  useEffect(() => disableNativeContextMenu(window.document), []);
  useEffect(() => {
    let live = true;
    void call<{ accounts: Account[] }>("snapshot", {
      query: {
        view: "all",
        accountId: "",
        search: "",
        folder: "",
        limit: 1,
        unreadOnly: false,
        excludeSent: true,
      },
    })
      .then((snapshot) => {
        if (live) setAccounts(snapshot.accounts);
      })
      .catch(() => {});
    void call<Preferences>("get_preferences")
      .then((preferences) => {
        if (live)
          setEnglishQuoteHeader(preferences.englishQuoteHeader ?? false);
      })
      .catch(() => {});
    void invoke<EmlDocument>("current_external_mail")
      .then((value) => {
        if (live) setDocument(value);
      })
      .catch((cause) => {
        if (live) setError(mailFileError(cause, true));
      });
    return () => {
      live = false;
    };
  }, []);
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      !document ||
      draft ||
      window.document.querySelector(
        '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
      ) ||
      (event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [role="combobox"], [contenteditable]:not([contenteditable="false"])',
        ))
    )
      return;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "r"
    ) {
      event.preventDefault();
      compose(false, false);
    } else if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.shiftKey &&
      event.key.toLowerCase() === "r"
    ) {
      event.preventDefault();
      compose(false, true);
    } else if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      compose(true);
    }
  });
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, []);
  function compose(forward = false, all = false) {
    if (!document) return;
    const account = accounts.find((item) => item.enabled);
    if (!account) {
      toast.error(t("Enable a mailbox account to reply or forward"));
      return;
    }
    const value = newDraft(account.id);
    const recipients = replyRecipients(
      document.detail,
      accounts.map((item) => item.email),
      all,
      account.email,
    );
    if (!forward) Object.assign(value, replyHeaders(document.detail.mail));
    value.to = forward ? "" : recipients.to;
    value.cc = forward ? "" : recipients.cc;
    value.subject = `${forward ? "Fwd" : "Re"}: ${document.detail.mail.subject.replace(/^(Re|Fwd):\s*/i, "")}`;
    value.quote = {
      kind: forward ? "forward" : "reply",
      included: forward,
      sender: document.detail.mail.sender,
      recipients: (document.detail.to || []).map(formatAddress).join(", "),
      date: document.detail.mail.date,
      subject: document.detail.mail.subject,
      body: document.detail.mail.body,
      html: document.detail.html,
    };
    if (forward && document.detail.attachments.length)
      value.externalForwardToken = document.token;
    setDraft(value);
  }
  function composeTo(address: { name: string; email: string }) {
    const account = accounts.find((item) => item.enabled);
    if (!account) {
      toast.error(t("Enable a mailbox account to write mail"));
      return;
    }
    setDraft({ ...newDraft(account.id), to: formatAddress(address) });
  }
  async function downloadAttachment(index: number, name: string) {
    if (!document) return;
    const filename = name.split(/[\\/]/).pop() || t("Attachments");
    const path = await save({ defaultPath: filename });
    if (path)
      await invoke("save_eml_attachment", {
        token: document.token,
        index,
        path,
      });
  }
  async function previewAttachment(index: number) {
    if (!document) return;
    await invoke("preview_eml_attachment", {
      token: document.token,
      index,
    });
  }
  if (!native) return null;
  return (
    <TooltipProvider>
      <div className="external-mail">
        <DesktopTitlebar />
        <Toaster
          position="bottom-center"
          theme={mode}
          closeButton
          toastOptions={{
            classNames: {
              toast: "anser-toast",
              success: "anser-toast-success",
              warning: "anser-toast-warning",
              error: "anser-toast-error",
              info: "anser-toast-info",
              actionButton: "anser-toast-action",
            },
          }}
        />
        {error ? (
          <main className="external-mail-error">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </main>
        ) : document ? (
          <section className="reader external-mail-reader">
            <div className="message-heading">
              <div className="sender-line">
                <div className="sender-block">
                  <span className="sender-avatar">
                    {senderName(document.detail.mail.sender).slice(0, 1)}
                  </span>
                  <div>
                    <SenderIdentity
                      sender={document.detail.mail.sender}
                      onComposeAddress={composeTo}
                      onAddContact={saveContactAddress}
                    />
                    {document.detail.mail.senderOnBehalfOf && (
                      <span
                        className="sender-on-behalf-of"
                        title={document.detail.mail.senderOnBehalfOf}
                      >
                        {t("Sent on behalf of {value0}", {
                          value0: document.detail.mail.senderOnBehalfOf,
                        })}
                      </span>
                    )}
                  </div>
                </div>
                <div className="reader-toolbar">
                  <div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="inline-flex">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Previous message")}
                            disabled
                          >
                            <ArrowLeft size={17} />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t("Previous message")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="inline-flex">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Next message")}
                            disabled
                          >
                            <ArrowRight size={17} />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{t("Next message")}</TooltipContent>
                    </Tooltip>
                    <Separator
                      orientation="vertical"
                      className="toolbar-divider mx-1 !h-4 self-center"
                    />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("Print this message")}
                          onClick={() =>
                            void printMail(document.detail).catch((cause) =>
                              toast.error(
                                t("Printing failed: {value0}", {
                                  value0: String(cause),
                                }),
                              ),
                            )
                          }
                        >
                          <Printer size={17} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("Print this message")}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="reader-actions">
                    <div className="reader-reply-group">
                      <MailActionTooltip action="reply" label={t("Reply")}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="reader-primary-action"
                          aria-label={t("Reply")}
                          aria-keyshortcuts="Meta+R Control+R"
                          onClick={() => compose()}
                        >
                          <Reply size={15} />
                          <span className="action-label">{t("Reply")}</span>
                        </Button>
                      </MailActionTooltip>
                      <DropdownMenu>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="reader-reply-options"
                                aria-label={t("More reply actions")}
                              >
                                <ChevronDown size={12} />
                              </Button>
                            </DropdownMenuTrigger>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("More reply actions")}
                          </TooltipContent>
                        </Tooltip>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            aria-keyshortcuts="Meta+Shift+R Control+Shift+R"
                            onClick={() => compose(false, true)}
                          >
                            <ReplyAll size={15} />
                            {t("Reply all")}
                            <DropdownMenuShortcut>
                              {mailShortcutKeys.replyAll}
                            </DropdownMenuShortcut>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <MailActionTooltip action="forward" label={t("Forward")}>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("Forward")}
                        aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
                        onClick={() => compose(true)}
                      >
                        <Send size={15} />
                        <span className="action-label">{t("Forward")}</span>
                      </Button>
                    </MailActionTooltip>
                  </div>
                </div>
              </div>
              <div className="recipient-line">
                <MailRecipients
                  key={document.detail.mail.id}
                  to={displayAddresses(
                    document.detail.to,
                    document.detail.mail.recipients,
                  )}
                  cc={displayAddresses(
                    document.detail.cc,
                    document.detail.mail.cc,
                  )}
                  bcc={displayAddresses(document.detail.bcc)}
                  onComposeAddress={composeTo}
                  onAddContact={saveContactAddress}
                />
                <div className="message-metadata">
                  <time dateTime={document.detail.mail.date}>
                    {formatMailTime(document.detail.mail.date)}
                  </time>
                  <span className="saved-chip max-w-[200px]">
                    <MiddleTruncateFilename name={document.filename} />
                  </span>
                </div>
              </div>
              <div className="message-title-row">
                <h1>{document.detail.mail.subject || t("(No subject)")}</h1>
                <div className="shrink-0" ref={setTranslationActions} />
              </div>
              <div ref={setTranslatedSubject} />
            </div>
            <ConversationReader
              selected={document.detail}
              singleMessage
              accounts={accounts}
              demo={false}
              scrollRef={readerRef}
              translationActions={translationActions}
              subjectContainer={translatedSubject}
              onAddWorkItem={(item) =>
                void invoke("open_mail_reminder", {
                  item: { ...item, mailId: "" },
                }).catch(() => toast.error(t("Could not open calendar.")))
              }
              editorOpen={!!draft}
              onReply={(_, forward = false, all = false) =>
                compose(forward, all)
              }
              onEdit={setDraft}
              onReedit={() => {}}
              onSent={() => {}}
              onExport={() => {}}
              onAttachment={(_, index, name) => downloadAttachment(index, name)}
              onAttachmentPreview={(_, index) => previewAttachment(index)}
              onAction={() => {}}
              onLink={(href) =>
                void invoke("open_mail_link", { url: href }).catch((cause) =>
                  toast.error(String(cause)),
                )
              }
              onComposeAddress={composeTo}
              onAddContact={saveContactAddress}
            />
          </section>
        ) : (
          <main className="external-mail-loading" role="status">
            {t("Reading email file…")}
          </main>
        )}
        <ComposeDialog
          dark={dark}
          englishQuoteHeader={englishQuoteHeader}
          draft={draft}
          onClose={() => setDraft(null)}
          accounts={accounts}
          onSent={() => {}}
        />
      </div>
    </TooltipProvider>
  );
}
