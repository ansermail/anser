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
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import { call, native, newDraft } from "../lib/api";
import {
  displayAddresses,
  formatAddress,
  parseAddresses,
  replyRecipients,
} from "../lib/addresses";
import { saveContactAddress } from "../lib/contact-actions";
import { disableNativeContextMenu } from "../lib/context-menu";
import { replyHeaders } from "../lib/conversations";
import { mailFileError } from "../lib/mail-file-errors";
import { printMail } from "../lib/mail-print";
import { senderAddress, senderName } from "../lib/providers";
import { useTheme } from "../lib/theme";
import type { Account, Compose, Detail } from "../lib/types";
import { Alert, AlertDescription } from "./ui/alert";
import { MailRecipients } from "./mail-recipients";
import { ContactAddress } from "./contact-address";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  const [draft, setDraft] = useState<Compose | null>(null);
  const theme = useTheme();
  const dark = theme.dark;
  const readerRef = useRef<HTMLDivElement>(null);
  const [translationActions, setTranslationActions] =
    useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = window.document.documentElement;
    element.classList.toggle("dark", theme.dark);
    element.classList.add("external-mail-document");
    return () => element.classList.remove("external-mail-document");
  }, [theme.dark]);
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
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !document ||
        draft ||
        (event.target instanceof Element &&
          event.target.closest(
            'input, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]',
          ))
      )
        return;
      if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "r") {
        event.preventDefault();
        compose(false, false);
      } else if (
        event.metaKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "r"
      ) {
        event.preventDefault();
        compose(false, true);
      } else if (
        event.metaKey &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        compose(true);
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  });
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
        <div className="desktop-titlebar" data-tauri-drag-region />
        <Toaster
          position="bottom-center"
          theme={theme.mode}
          richColors
          closeButton
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
                    <strong>{senderName(document.detail.mail.sender)}</strong>
                    {(() => {
                      const address = parseAddresses(
                        document.detail.mail.sender,
                      )[0];
                      return address ? (
                        <ContactAddress
                          address={address}
                          className="contact-address-start"
                          text={address.email}
                          onComposeAddress={composeTo}
                          onAddContact={saveContactAddress}
                        />
                      ) : (
                        <span>
                          {senderAddress(document.detail.mail.sender)}
                        </span>
                      );
                    })()}
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
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("Previous message")}
                          disabled
                        >
                          <ArrowLeft size={17} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("Previous message")}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("Next message")}
                          disabled
                        >
                          <ArrowRight size={17} />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("Next message")}</TooltipContent>
                    </Tooltip>
                    <span className="toolbar-divider" />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={t("Print this message")}
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
                  </div>
                  <div className="reader-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("Reply")}
                      title={t("Reply")}
                      aria-keyshortcuts="Meta+R Control+R"
                      onClick={() => compose()}
                    >
                      <Reply size={15} />
                      <span className="action-label">{t("Reply")}</span>
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t("More reply actions")}
                          aria-label={t("More reply actions")}
                        >
                          <ChevronDown size={12} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          aria-keyshortcuts="Meta+Shift+R Control+Shift+R"
                          onClick={() => compose(false, true)}
                        >
                          <ReplyAll size={15} />
                          {t("Reply all")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("Forward")}
                      title={t("Forward")}
                      aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
                      onClick={() => compose(true)}
                    >
                      <Send size={15} />
                      <span className="action-label">{t("Forward")}</span>
                    </Button>
                  </div>
                </div>
              </div>
              <div className="recipient-line">
                <MailRecipients
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
                  <span className="saved-chip">{document.filename}</span>
                </div>
              </div>
              <div className="message-title-row">
                <h1>{document.detail.mail.subject || t("(No subject)")}</h1>
                <div className="shrink-0" ref={setTranslationActions} />
              </div>
            </div>
            <ConversationReader
              selected={document.detail}
              singleMessage
              revision={[]}
              accounts={accounts}
              demo={false}
              scrollRef={readerRef}
              translationActions={translationActions}
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
          themeMode={theme.mode}
          onToggleTheme={theme.cycleMode}
          draft={draft}
          onClose={() => setDraft(null)}
          accounts={accounts}
          onSent={() => {}}
        />
      </div>
    </TooltipProvider>
  );
}
