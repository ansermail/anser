import { t } from "@/lib/i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowDown,
  ArrowDownToLine,
  MoreHorizontal,
  Reply,
  ReplyAll,
  Send,
  ShieldCheck,
  SquarePen,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Badge } from "./ui/badge";
import { Textarea } from "./ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { MailBodySkeleton } from "./mail-skeleton";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { TranslatableMailBody } from "./translatable-mail-body";
import { MailAttachments } from "./mail-attachments";
import { call, newDraft } from "../lib/api";
import { parseAddresses, replyRecipients } from "../lib/addresses";
import { mailTime, replyHeaders } from "../lib/conversations";
import { senderName, senderAddress } from "../lib/providers";
import type { Account, Compose, Detail, Mail } from "../lib/types";

function ParseWarnings({ mail }: { mail: Mail }) {
  if (!mail.parseWarnings?.length) return null;
  return (
    <Alert className="mb-4">
      <AlertTitle>
        {t("Some content in this message has encoding errors")}
      </AlertTitle>
      <AlertDescription>
        {mail.savedLocally !== false
          ? t(
              "The complete original is saved. Other content displays normally.",
            )
          : t(
              "The server original is unchanged. Other content displays normally.",
            )}
        {mail.parseWarnings.map((warning, index) => (
          <p key={index}>{warning}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

function Turn({
  mail,
  selected,
  own,
  demo,
  onReply,
  onReedit,
  onExport,
  onAttachment,
  onAction,
  onLink,
  onLoaded,
  translationActions,
}: {
  mail: Mail;
  selected: Detail | null;
  own: boolean;
  demo: boolean;
  onReply: (detail: Detail, forward?: boolean, all?: boolean) => void;
  onReedit: (detail: Detail) => void;
  onExport: (mail: Mail) => void;
  onAttachment: (mail: Mail, index: number, name: string) => Promise<void>;
  onAction: (mail: Mail, action: string, value: string) => void;
  onLink: (href: string) => void;
  onLoaded: (detail: Detail) => void;
  translationActions: HTMLElement | null;
}) {
  const [localActions, setLocalActions] = useState<HTMLDivElement | null>(null);
  const [detail, setDetail] = useState<Detail | null>(selected);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError("");
    if (selected) {
      setDetail(selected);
      onLoaded(selected);
    } else
      void call<Detail>("mail_detail", { id: mail.id })
        .then((d) => {
          if (live) {
            setDetail(d);
            onLoaded(d);
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    return () => {
      live = false;
    };
  }, [
    mail.id,
    mail.hash,
    selected?.mail.id,
    selected?.mail.hash,
    retry,
    onLoaded,
  ]);
  return (
    <article
      className={`conversation-turn ${own ? "outgoing" : "incoming"}`}
      data-mail-id={mail.id}
      aria-label={`${own ? t("Messages I sent") : t("Messages received")}：${mail.subject}`}
    >
      <div className="turn-byline">
        <span className="sender-avatar" aria-hidden="true">
          {own ? t("Me") : senderName(mail.sender).slice(0, 1)}
        </span>
        <div className="turn-sender">
          <strong>{own ? t("Me") : senderName(mail.sender)}</strong>
          <span title={mail.sender}>{senderAddress(mail.sender)}</span>
        </div>
        <time dateTime={mail.date}>{mailTime(mail.date)}</time>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("Message actions: {value0}", {
                value0: mail.subject,
              })}
            >
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                disabled={!detail}
                onClick={() => detail && onReply(detail)}
              >
                <Reply size={14} />
                {t("Reply to this message")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!detail}
                onClick={() => detail && onReply(detail, false, true)}
              >
                <ReplyAll size={14} />
                {t("Reply all")}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!detail}
                onClick={() => detail && onReply(detail, true)}
              >
                <Send size={14} />
                {t("Forward")}
              </DropdownMenuItem>
              {own && (
                <DropdownMenuItem
                  disabled={!detail}
                  onClick={() => detail && onReedit(detail)}
                >
                  <SquarePen size={14} />
                  {t("Edit as a new message")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {mail.savedLocally === false && (
                <DropdownMenuItem onClick={() => onAction(mail, "save", "")}>
                  <ArrowDownToLine />
                  {t("Save complete message locally")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onExport(mail)}>
                <ArrowDownToLine size={14} />
                {t("Export original message")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onAction(mail, "star", String(!mail.starred))}
              >
                <Star size={14} />
                {mail.starred ? t("Unstar") : t("Star")}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onAction(mail, "trash", String(!mail.trashed))}
              >
                <Trash2 size={14} />
                {mail.trashed ? t("Restore message") : t("Move to local trash")}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {!selected && <div className="shrink-0" ref={setLocalActions} />}
      </div>
      <Card className={`conversation-bubble ${detail?.html ? "has-html" : ""}`}>
        {mail.recipients.trim() && (
          <div className="turn-recipients" title={mail.recipients}>
            {t("To: ")}
            {mail.recipients}
          </div>
        )}
        {mail.cc?.trim() && (
          <div className="turn-recipients" title={mail.cc}>
            {t("Cc: ")}
            {mail.cc}
          </div>
        )}
        {detail && <ParseWarnings mail={detail.mail} />}
        {!detail ? (
          error ? (
            <div role="alert" className="turn-error">
              {t("Could not load body")}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((n) => n + 1)}
              >
                {t("Reload")}
              </Button>
            </div>
          ) : (
            <MailBodySkeleton />
          )
        ) : (
          <TranslatableMailBody
            key={`${mail.id}:${mail.hash}`}
            html={detail.html}
            body={detail.mail.body}
            title={t("Message body: {value0}", { value0: mail.id })}
            actionsContainer={selected ? translationActions : localActions}
            onOpenLink={onLink}
          />
        )}
        <MailAttachments
          mailId={mail.id}
          demo={demo}
          attachments={detail?.attachments || []}
          onDownload={(index, name) => onAttachment(mail, index, name)}
        />
        <div className="turn-footer">
          <ShieldCheck size={12} />
          <span>
            {demo
              ? t("Demo archive")
              : mail.savedLocally === false
                ? t("Server message")
                : t("Saved")}
          </span>
          {mail.starred && <Star size={12} className="star-on" />}
        </div>
      </Card>
    </article>
  );
}

function QuickReply({
  target,
  accounts,
  onEdit,
  onSent,
  onEditing,
}: {
  target: Detail;
  accounts: Account[];
  onEdit: (draft: Compose) => void;
  onSent: () => void;
  onEditing: (value: boolean) => void;
}) {
  const account = accounts.find(
    (a) => a.id === target.mail.accountId && a.enabled,
  );
  const [draft, setDraft] = useState<Compose | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const persisted = useRef(false);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    let live = true;
    setReady(false);
    setDraft(null);
    if (!account) return;
    const recipients = replyRecipients(
      target,
      [target.mail.accountEmail, ...accounts.map((a) => a.email)],
      false,
      account.email,
    );
    void call<Compose[]>("list_drafts")
      .then((list) => {
        if (!live) return;
        const existing = list.find(
          (d) =>
            d.replyAnchorId === target.mail.id && d.accountId === account.id,
        );
        persisted.current = !!existing;
        setDraft(
          existing || {
            ...newDraft(account.id),
            format: "plain",
            replyAnchorId: target.mail.id,
            ...replyHeaders(target.mail),
            ...recipients,
            subject: `Re: ${target.mail.subject.replace(/^(Re|Fwd):\s*/i, "")}`,
          },
        );
        setReady(true);
      })
      .catch((e) => {
        if (live)
          toast.error(t("Could not load reply draft: {value0}", { value0: e }));
      });
    return () => {
      live = false;
    };
  }, [target.mail.id, account?.id]);
  useEffect(() => {
    if (
      !ready ||
      !draft ||
      sending ||
      (!draft.body.trim() && !persisted.current)
    )
      return;
    setSaving(true);
    setSaveError(false);
    const timer = setTimeout(() => {
      void call("save_draft", { draft })
        .then(() => setSaving(false))
        .catch((e) => {
          setSaving(false);
          setSaveError(true);
          toast.error(t("Could not save draft: {value0}", { value0: e }));
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, ready, sending]);
  // Flush the latest body on navigation; draft identity is per reply target.
  useEffect(
    () => () => {
      const current = latest.current;
      if (current && (current.body.trim() || persisted.current))
        void call("save_draft", { draft: current }).catch((e) =>
          toast.error(t("Could not save draft: {value0}", { value0: e })),
        );
    },
    [],
  );
  useEffect(() => {
    onEditing(
      !!draft &&
        (!!draft.body.trim() || !!draft.html || !!draft.attachments.length),
    );
    return () => onEditing(false);
  }, [draft?.body, draft?.html, draft?.attachments.length, onEditing]);
  async function send() {
    if (!draft || !draft.body.trim() || sending) return;
    setSending(true);
    try {
      await call("save_draft", { draft });
      await call("queue_send", { draft });
      // A new draft ID prevents a subsequent reply reusing a completed send.
      latest.current = null;
      persisted.current = false;
      setDraft({
        ...newDraft(draft.accountId),
        format: "plain",
        replyAnchorId: target.mail.id,
        ...replyHeaders(target.mail),
        to: draft.to,
        cc: draft.cc,
        subject: draft.subject,
      });
      toast.success(
        t("Queued to send. Cancel within 8 seconds in Send history."),
      );
      onSent();
    } catch (e) {
      toast.error(String(e), { duration: 10000 });
    } finally {
      setSending(false);
    }
  }
  const complex =
    !!draft &&
    (!!draft.html ||
      !!draft.deliveryHtml ||
      !!draft.attachments.length ||
      !!draft.forwardFiles?.length ||
      !!draft.forwardSource ||
      !!draft.quote?.included ||
      (draft.format && draft.format !== "plain"));
  if (complex)
    return (
      <div className="conversation-reply quick-rich-draft">
        <span>
          {t("Existing reply draft · Original format and attachments retained")}
        </span>
        <Button
          size="sm"
          disabled={sending}
          onClick={() => {
            latest.current = null;
            onEdit(draft);
          }}
        >
          <SquarePen size={14} />
          {t("Continue editing reply")}
        </Button>
      </div>
    );
  return (
    <div className="conversation-reply">
      {account ? (
        <>
          <div className="quick-reply-heading">
            <span>
              {t("Reply to")}{" "}
              <strong>{draft?.to || senderName(target.mail.sender)}</strong>
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={!ready || sending}
              onClick={() => {
                if (draft) {
                  latest.current = null;
                  onEdit(draft);
                }
              }}
            >
              <SquarePen size={14} />
              {t("Full editor")}
            </Button>
          </div>
          <Textarea
            aria-label={t("Conversation reply body")}
            placeholder={t("Write a reply…")}
            value={draft?.body || ""}
            disabled={!ready || sending}
            onChange={(e) => {
              persisted.current = true;
              setDraft((d) =>
                d
                  ? {
                      ...d,
                      body: e.target.value,
                      deliveryBody: undefined,
                      deliveryHtml: undefined,
                    }
                  : d,
              );
            }}
          />
          <div className="quick-reply-actions">
            <span>
              {sending
                ? t("Sending…")
                : saving
                  ? t("Saving draft…")
                  : saveError
                    ? t("Could not save draft")
                    : draft?.body.trim()
                      ? t("Draft saved")
                      : t("Send by email")}
            </span>
            <Button
              size="sm"
              disabled={
                !ready || !draft?.body.trim() || !draft.to.trim() || sending
              }
              onClick={() => void send()}
            >
              <Send size={14} />
              {t("Send reply")}
            </Button>
          </div>
        </>
      ) : (
        <span>
          {t("The original account is paused or removed. Enable it to reply.")}
        </span>
      )}
    </div>
  );
}

export function ConversationReader({
  selected,
  singleMessage = false,
  revision,
  accounts,
  demo,
  scrollRef,
  translationActions,
  editorOpen,
  onReply,
  onReedit,
  onEdit,
  onSent,
  onExport,
  onAttachment,
  onAction,
  onLink,
}: {
  selected: Detail;
  singleMessage?: boolean;
  revision: Mail[];
  accounts: Account[];
  demo: boolean;
  editorOpen: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  translationActions: HTMLElement | null;
  onReply: (detail: Detail, forward?: boolean, all?: boolean) => void;
  onReedit: (detail: Detail) => void;
  onEdit: (draft: Compose) => void;
  onSent: () => void;
  onExport: (mail: Mail) => void;
  onAttachment: (mail: Mail, index: number, name: string) => Promise<void>;
  onAction: (mail: Mail, action: string, value: string) => void;
  onLink: (href: string) => void;
}) {
  const [messages, setMessages] = useState<Mail[]>([selected.mail]);
  const [details, setDetails] = useState<Record<string, Detail>>({
    [selected.mail.id]: selected,
  });
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [newBelow, setNewBelow] = useState(false);
  const [replying, setReplying] = useState(false);
  const replyTarget = useRef("");
  const stream = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const newest = useRef("");
  const loaded = useCallback(
    (detail: Detail) =>
      setDetails((d) =>
        d[detail.mail.id] === detail ? d : { ...d, [detail.mail.id]: detail },
      ),
    [],
  );
  const bottom = useCallback(() => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTo(0, scroll.scrollHeight);
    pinned.current = true;
    setNewBelow(false);
  }, [scrollRef]);
  useEffect(() => {
    let live = true;
    if (singleMessage) {
      setMessages([selected.mail]);
      setError("");
      return;
    }
    void call<Mail[]>("mail_conversation", { id: selected.mail.id })
      .then((list) => {
        if (!live) return;
        setMessages(list);
        setError("");
        if (
          newest.current &&
          newest.current !== list.at(-1)?.id &&
          !pinned.current
        )
          setNewBelow(true);
        newest.current = list.at(-1)?.id || "";
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [selected.mail.id, revision, retry, singleMessage]);
  useEffect(() => {
    const scroll = scrollRef.current,
      content = stream.current;
    if (!scroll || !content) return;
    const changed = () => {
      if (pinned.current) scroll.scrollTo(0, scroll.scrollHeight);
    };
    const scrolled = () => {
      pinned.current =
        scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 96;
      if (pinned.current) setNewBelow(false);
    };
    const observer = new ResizeObserver(changed);
    observer.observe(content);
    scroll.addEventListener("scroll", scrolled);
    const frame = requestAnimationFrame(changed);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroll.removeEventListener("scroll", scrolled);
    };
  }, [scrollRef, messages]);
  const own = (mail: Mail) =>
    parseAddresses(mail.sender).some(
      (a) =>
        a.email.toLowerCase() === mail.accountEmail.toLowerCase() ||
        accounts.some(
          (account) => account.email.toLowerCase() === a.email.toLowerCase(),
        ),
    );
  const target =
    [...messages].reverse().find((m) => !own(m)) || messages.at(-1);
  if (!replying || !messages.some((mail) => mail.id === replyTarget.current))
    replyTarget.current = target?.id || "";
  const targetDetail = details[replyTarget.current];
  if (
    singleMessage ||
    (messages.length === 1 &&
      (selected.mail.conversationCount || 1) === 1 &&
      !selected.mail.inReplyTo?.length &&
      !selected.mail.references?.length)
  ) {
    return (
      <div
        className="reader-scroll"
        data-mail-debug-region=""
        id="mail-reader-content"
        ref={scrollRef}
      >
        <ParseWarnings mail={selected.mail} />
        <TranslatableMailBody
          key={`${selected.mail.id}:${selected.mail.hash}`}
          html={selected.html}
          body={selected.mail.body}
          actionsContainer={translationActions}
          onOpenLink={onLink}
        />
        <MailAttachments
          mailId={selected.mail.id}
          demo={demo}
          attachments={selected.attachments}
          onDownload={(index, name) => onAttachment(selected.mail, index, name)}
        />
      </div>
    );
  }
  return (
    <>
      <div
        className="reader-scroll conversation-scroll"
        data-mail-debug-region=""
        id="mail-reader-content"
        ref={scrollRef}
      >
        <div className="conversation-stream" ref={stream}>
          <div className="conversation-start">
            <Badge variant="secondary">
              {messages.length}
              {t("messages (conversation)")}
            </Badge>
            <span>{t("Chronological order")}</span>
          </div>
          {error && (
            <div role="alert" className="turn-error">
              {t("Could not load conversation")}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetry((n) => n + 1)}
              >
                {t("Reload conversation")}
              </Button>
            </div>
          )}
          {messages.map((mail) => (
            <Turn
              key={mail.id}
              mail={mail}
              selected={mail.id === selected.mail.id ? selected : null}
              own={own(mail)}
              demo={demo}
              onReply={onReply}
              onReedit={onReedit}
              onExport={onExport}
              onAttachment={onAttachment}
              onAction={onAction}
              onLink={onLink}
              onLoaded={loaded}
              translationActions={translationActions}
            />
          ))}
        </div>
      </div>
      {newBelow && (
        <Button
          variant="secondary"
          size="sm"
          className="new-conversation-mail"
          onClick={bottom}
        >
          <ArrowDown size={14} />
          {t("New messages · View")}
        </Button>
      )}
      {targetDetail && !editorOpen && !selected.mail.trashed && (
        <QuickReply
          key={targetDetail.mail.id}
          target={targetDetail}
          accounts={accounts}
          onEdit={onEdit}
          onSent={onSent}
          onEditing={setReplying}
        />
      )}
    </>
  );
}
