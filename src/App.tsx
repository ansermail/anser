import { EmlViewer } from "./components/eml-viewer";
import { MailFilters } from "./components/mail-filters";
import { ArchiveLocation } from "./components/archive-location";
import { MailSignatures } from "./components/mail-signatures";
import { useConfirmation } from "./hooks/use-confirmation";
import { useNotificationMail } from "./hooks/use-notification-mail";
import {
  useAppUpdate,
  UpdateIndicator,
  UpdateSettings,
  UpdateDialog,
} from "./components/app-updates";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "./components/ui/tooltip";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "./components/ui/collapsible";
import { Skeleton } from "./components/ui/skeleton";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./components/ui/context-menu";
import { Separator } from "./components/ui/separator";
import { FolderHealthPanel } from "./components/folder-health";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { ServerOperations } from "./components/server-operations";
import { DirectoryOperationsPanel } from "./components/server-copy";
import { ServerDirectoryMenu } from "./components/server-directory-menu";
import { FolderMappingDialog } from "./components/folder-mapping-dialog";
import { RetentionDialog } from "./components/retention-dialog";
import { ArchiveJobsPanel } from "./components/archive-jobs";
import { RemoteFolderList } from "./components/remote-folder-list";
import { remoteFolderLabel, sidebarAccountError } from "./lib/remote-folders";
import { printMail } from "./lib/mail-print";
import { coalesceRefresh } from "./lib/refresh-queue";
import { ConversationReader } from "./components/conversation-reader";
import { replyHeaders } from "./lib/conversations";
import { FolderInput } from "./components/folder-input";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import { disableNativeContextMenu } from "./lib/context-menu";
import { NavigationLayout, MailLayout } from "./components/resizable-layout";
import {
  MailListSkeleton,
  MailReaderSkeleton,
} from "./components/mail-skeleton";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  HardDriveDownload,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  HardDrive,
  Inbox,
  Info,
  Mail as MailIcon,
  MailOpen,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  MessagesSquare,
  List,
  Paperclip,
  Plus,
  Printer,
  RefreshCw,
  Reply,
  ReplyAll,
  UsersRound,
  History,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  SquarePen,
  Star,
  Sun,
  Moon,
  Trash2,
  X,
  LogOut,
  ExternalLink,
  AlertCircle,
  Undo2,
} from "lucide-react";
import { Button } from "./components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "./components/ui/sidebar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Checkbox } from "./components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Input } from "./components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./components/ui/dialog";
import { Toaster, toast } from "sonner";
import { AccountDialog } from "./components/account-dialog";
import { RulesPanel } from "./components/rules-panel";
import { ComposeDialog } from "./components/compose-dialog";
import { mailShortcut } from "./lib/mail-shortcuts";
import { mailShortcutKeys } from "./lib/mail-shortcuts";
import { MailActionTooltip } from "./components/mail-action-tooltip";
import { ContactsPanel } from "./components/contacts-panel";
import { OutboxPanel } from "./components/outbox-panel";
import { ArchiveIntegrity } from "./components/archive-integrity";
import { StorageTools } from "./components/storage-tools";
import { MailTranslationSettings } from "./components/mail-translation-settings";
import { NetworkProxySettings } from "./components/network-proxy-settings";
import { DeleteArchiveDialog } from "./components/delete-archive-dialog";
import {
  replyRecipients,
  parseAddresses,
  formatAddress,
} from "./lib/addresses";
import { sanitizeComposeHtml } from "./lib/compose-format";
import {
  mailPage,
  mailNeighbor,
  call,
  initialSnapshot,
  native,
  publicPreview,
  enterDemo,
  leaveDemo,
  isDemo,
  restoreDemo,
  newDraft,
} from "./lib/api";
import {
  senderName,
  senderAddress,
  formatSize,
  providers,
} from "./lib/providers";
import type {
  MailPage,
  MailNeighbor,
  Query,
  Detail,
  Mail,
  Compose,
  Account,
  Address,
  RemoteFolder,
} from "./lib/types";
import { mailLink } from "./lib/mail-html";
import { invoke } from "@tauri-apps/api/core";
restoreDemo();
const viewNames: Record<string, string> = {
  all: "全部收件箱",
  unread: "未读邮件",
  starred: "星标邮件",
  sent: "已发送",
  trash: "本地废纸篓",
  local: "本地存档",
};
function time(s: string) {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "时间未知";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function savedListMode(): "conversations" | "messages" {
  try {
    return localStorage.getItem("mail-list-mode") === "messages"
      ? "messages"
      : "conversations";
  } catch {
    return "conversations";
  }
}
function queryScope(query: Query) {
  return JSON.stringify({ ...query, limit: 0 });
}
export default function App() {
  const updates = useAppUpdate();
  const { askConfirmation, confirmationDialog } = useConfirmation();
  useEffect(() => disableNativeContextMenu(document), []);
  const [data, setData] = useState<MailPage>(() => ({
      ...initialSnapshot(),
      nextCursor: null,
      revision: 0,
      reset: false,
      bodyCoverage: { known: 0, unknown: 0 },
    })),
    [query, setQuery] = useState<Query>({
      view: "all",
      accountId: "",
      search: "",
      folder: "",
      limit: 200,
      unreadOnly: false,
      listMode: savedListMode(),
    }),
    [expandedAccounts, setExpandedAccounts] = useState<string[]>([]),
    [folderLoading, setFolderLoading] = useState<string[]>([]),
    [folderErrors, setFolderErrors] = useState<Record<string, string>>({}),
    [loadedFolders, setLoadedFolders] = useState<
      Record<string, RemoteFolder[]>
    >({}),
    [serverFolders, setServerFolders] = useState<RemoteFolder[]>([]),
    [page, setPage] = useState("mail"),
    [sidebarOpen, setSidebarOpen] = useState(true),
    [selected, setSelected] = useState(""),
    [readerExpanded, setReaderExpanded] = useState(false),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailError, setDetailError] = useState<{
      id: string;
      message: string;
    } | null>(null),
    [detailRetry, setDetailRetry] = useState(0),
    [checked, setChecked] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [accountDialog, setAccountDialog] = useState(false),
    [editingAccount, setEditingAccount] = useState<Account | null>(null),
    [mappingAccount, setMappingAccount] = useState<Account | null>(null),
    [retentionAccount, setRetentionAccount] = useState<Account | null>(null),
    [retentionIntro, setRetentionIntro] = useState(false),
    [archiving, setArchiving] = useState(false),
    [contactSeed, setContactSeed] = useState<Address | null>(null),
    [draft, setDraft] = useState<Compose | null>(null),
    [drafts, setDrafts] = useState<Compose[]>([]),
    [clearingDrafts, setClearingDrafts] = useState(false),
    [syncing, setSyncing] = useState(false),
    [syncText, setSyncText] = useState(""),
    [loading, setLoading] = useState(true),
    [demo, setDemo] = useState(isDemo()),
    [moveIds, setMoveIds] = useState<string[]>([]),
    [moveFolder, setMoveFolder] = useState(""),
    [moveThreads, setMoveThreads] = useState(false),
    [dark, setDark] = useState(localStorage.getItem("mail-theme") === "dark");
  const searchRef = useRef<HTMLInputElement>(null),
    request = useRef(0),
    draftRequest = useRef(0),
    clearingDraftsNow = useRef(false),
    queryRef = useRef(query),
    readerRef = useRef<HTMLDivElement>(null);
  const [translationActions, setTranslationActions] =
    useState<HTMLDivElement | null>(null);
  const selectionRef = useRef(selected);
  const detailRef = useRef(detail);
  const markingFolders = useRef(new Set<string>());
  detailRef.current = detail;
  const readingNeighbors = useRef<{
    scope: string;
    previous: string[];
    next: string[];
    known: string[];
    date: string;
  } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const pagePending = useRef(false);
  const pageTicket = useRef(0);
  const [pageLoading, setPageLoading] = useState(false);
  const [neighborHints, setNeighborHints] = useState<{
    id: string;
    scope: string;
    previous: boolean | null;
    next: boolean | null;
  } | null>(null);
  const neighborRequests = useRef<{
    id: string;
    scope: string;
    revision: number;
    previous?: Promise<MailNeighbor>;
    next?: Promise<MailNeighbor>;
  } | null>(null);
  const navigationRequest = useRef(0);
  const navigationPending = useRef(false);
  const shortcutMutationPending = useRef(false);
  const dataScope = useRef("");
  const [navigationLoading, setNavigationLoading] = useState(false);
  selectionRef.current = selected;
  const localChanges = useRef(new Map<string, Partial<Mail>>());
  queryRef.current = query;
  const grouped = query.listMode !== "messages";
  const [notificationToken, setNotificationToken] = useState<{
    token: string;
    click: number;
  } | null>(null);
  const [notificationSelected, setNotificationSelected] = useState("");
  const notificationGeneration = useRef(0);
  const notificationReading = useRef("");
  const notificationContext = useRef({ page, search, draft, demo });
  notificationContext.current = { page, search, draft, demo };
  useNotificationMail(native && !demo, (token) => {
    const click = ++notificationGeneration.current;
    setNotificationToken({ token, click });
  });
  useEffect(() => {
    if (!notificationToken || draft || demo) return;
    let live = true;
    const ticket = ++notificationGeneration.current;
    const scope = queryRef.current;
    const reading = selectionRef.current;
    const context = notificationContext.current;
    void call<Mail>("notification_mail", { token: notificationToken.token })
      .then((mail) => {
        if (
          !live ||
          ticket !== notificationGeneration.current ||
          scope !== queryRef.current ||
          reading !== selectionRef.current ||
          context.page !== notificationContext.current.page ||
          context.search !== notificationContext.current.search ||
          context.draft !== notificationContext.current.draft ||
          context.demo !== notificationContext.current.demo
        )
          return;
        setSearch("");
        setChecked([]);
        setPage("mail");
        setQuery({
          view: mail.trashed
            ? "trash"
            : mail.savedLocally !== false
              ? "local"
              : "remote",
          accountId: mail.accountId,
          folder: "",
          remoteFolder: mail.savedLocally === false ? mail.sourceFolder : "",
          search: "",
          unreadOnly: false,
          limit: 200,
          listMode: queryRef.current.listMode,
        });
        notificationReading.current = mail.id;
        setNotificationSelected(mail.id);
        readingNeighbors.current = null;
        setSelected(mail.id);
        setDetailRetry((value) => value + 1);
      })
      .catch((error) => {
        if (live && ticket === notificationGeneration.current)
          toast.error(`无法打开通知邮件：${String(error)}`);
      })
      .finally(() => {
        if (live && ticket === notificationGeneration.current)
          setNotificationToken(null);
      });
    return () => {
      live = false;
    };
  }, [notificationToken, draft, demo]);
  useEffect(() => {
    try {
      localStorage.setItem("mail-list-mode", query.listMode || "conversations");
    } catch {
      // The current session remains usable when storage is unavailable.
    }
  }, [query.listMode]);
  useEffect(() => {
    if (data.remoteFolders) setServerFolders(data.remoteFolders);
  }, [data.remoteFolders]);
  useEffect(() => {
    if (!selected || page !== "mail") setReaderExpanded(false);
  }, [selected, page]);
  useEffect(() => {
    if (!readerExpanded) return;
    const restore = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault();
        setReaderExpanded(false);
      }
    };
    window.addEventListener("keydown", restore);
    return () => window.removeEventListener("keydown", restore);
  }, [readerExpanded]);
  async function openMailLink(href: string) {
    const url = mailLink(href);
    if (!url) return;
    if (url.protocol === "mailto:") {
      const next = newDraft(detail?.mail.accountId ?? "");
      next.to = decodeURIComponent(url.pathname);
      next.cc = url.searchParams.get("cc") ?? "";
      next.bcc = url.searchParams.get("bcc") ?? "";
      next.subject = url.searchParams.get("subject") ?? "";
      next.body = url.searchParams.get("body") ?? "";
      setDraft(next);
    } else if (native) {
      await invoke("open_mail_link", { url: url.href });
    } else {
      window.open(url.href, "_blank", "noopener,noreferrer");
    }
  }
  const openMailLinkRef = useRef(openMailLink);
  openMailLinkRef.current = openMailLink;
  const refreshAction = useRef<() => Promise<void>>(async () => {});
  refreshAction.current = async () => {
    const seq = ++request.current;
    const currentQuery = queryRef.current;
    try {
      const value = await mailPage({ ...currentQuery, limit: 200 });
      if (seq === request.current && currentQuery === queryRef.current) {
        const same =
          dataScope.current === queryScope(currentQuery) &&
          dataRef.current.revision === value.revision;
        const previous = dataRef.current;
        const merged =
          same && previous.messages.length > value.messages.length
            ? {
                ...value,
                messages: [
                  ...value.messages,
                  ...previous.messages.slice(value.messages.length),
                ],
                nextCursor: previous.nextCursor,
              }
            : value;
        dataScope.current = queryScope(currentQuery);
        dataRef.current = merged;
        setData(merged);
      }
      const reading = selectionRef.current;
      if (reading) {
        const metadata = await call<Mail>("mail_metadata", {
          id: reading,
        }).catch(() => null);
        if (
          metadata &&
          selectionRef.current === reading &&
          seq === request.current
        ) {
          if (
            detailRef.current?.mail.id === reading &&
            detailRef.current.mail.hash !== metadata.hash
          ) {
            // The body and attachments must come from the same new original
            // as the metadata, especially after online mail is archived.
            setDetail(null);
            setDetailRetry((n) => n + 1);
          } else
            setDetail((current) =>
              current?.mail.id === reading
                ? {
                    ...current,
                    mail: {
                      ...metadata,
                      body: current.mail.body,
                      ...localChanges.current.get(reading),
                    },
                  }
                : current,
            );
        }
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      if (seq === request.current && currentQuery === queryRef.current)
        setLoading(false);
    }
  };
  const [refresh] = useState(() =>
    coalesceRefresh(() => refreshAction.current()),
  );
  useEffect(() => {
    void refresh();
  }, [query, refresh]);
  useEffect(() => {
    const changed = () => void refresh();
    window.addEventListener("anser-activity-changed", changed);
    return () => window.removeEventListener("anser-activity-changed", changed);
  }, [refresh]);
  useEffect(() => {
    // An unchanged search must retain the query identity. The startup debounce
    // otherwise looks like navigation and cancels a pending notification open.
    if (search === queryRef.current.search) return;
    const timer = setTimeout(
      () =>
        setQuery((q) =>
          q.search === search ? q : { ...q, search, limit: 200 },
        ),
      200,
    );
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("mail-theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    let live = true;
    // A read message may leave an unread list while it remains open.
    // Keep its content during list refreshes, and clear only on selection changes.
    setDetail((current) => (current?.mail.id === selected ? current : null));
    setDetailError(null);
    if (selected)
      void call<Detail>("mail_detail", { id: selected })
        .then((d) => {
          if (live) {
            setDetail({
              ...d,
              mail: { ...d.mail, ...localChanges.current.get(d.mail.id) },
            });
            if (notificationReading.current === d.mail.id) {
              notificationReading.current = "";
              if (!d.mail.isRead)
                void updateMail(d.mail.id, "read", "true")
                  .then(() => refresh())
                  .catch((error) => toast.error(String(error)));
            }
          }
        })
        .catch((e) => {
          if (live) {
            setDetailError({ id: selected, message: String(e) });
            toast.error(String(e));
          }
        });
    return () => {
      live = false;
    };
  }, [selected, detailRetry]);
  useEffect(() => {
    setChecked((ids) =>
      ids.filter((id) => data.messages.some((m) => m.id === id)),
    );
  }, [data.messages]);
  useEffect(() => {
    if (!native) return;
    let cleanup = () => {};
    let active = true;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const a = await listen<string>("sync-progress", (e) =>
        setSyncText(e.payload),
      );
      const b = await listen("mail-updated", () => {
        setSyncText("");
        void refresh();
      });
      const c = await listen<{
        status: string;
        subject: string;
        message: string;
      }>("send-result", ({ payload }) => {
        const message = `${payload.subject || "（无主题）"}：${payload.message}`;
        if (payload.status === "sent") toast.success(message);
        else if (payload.status === "uncertain")
          toast.warning(message, { duration: 10000 });
        else toast.error(message, { duration: 10000 });
      });
      const d = await listen<string>("mail-link-open", ({ payload }) => {
        void openMailLinkRef
          .current(payload)
          .catch((error) => toast.error(`无法打开链接：${String(error)}`));
      });
      if (!active) {
        a();
        b();
        c();
        d();
      } else
        cleanup = () => {
          a();
          b();
          c();
          d();
        };
    });
    const timer = setInterval(() => void refresh(), 20000);
    return () => {
      active = false;
      cleanup();
      clearInterval(timer);
    };
  }, [refresh]);
  const compose = useCallback(
    (mail?: Mail, forward = false, all = false, origin?: Detail) => {
      if (clearingDraftsNow.current) return;
      if (!data.accounts.some((a) => a.enabled)) {
        setAccountDialog(true);
        return;
      }
      const accountId =
        mail && data.accounts.some((a) => a.id === mail.accountId && a.enabled)
          ? mail.accountId
          : data.accounts.find((a) => a.enabled)!.id;
      const d = newDraft(accountId);
      if (mail) {
        const source =
          origin ||
          (detail?.mail.id === mail.id
            ? detail
            : { mail, html: "", attachments: [] });
        const recipients = replyRecipients(
          source,
          data.accounts.map((a) => a.email),
          all,
          data.accounts.find((a) => a.id === accountId)!.email,
        );
        if (!forward) Object.assign(d, replyHeaders(source.mail));
        d.to = forward ? "" : recipients.to;
        d.cc = forward ? "" : recipients.cc;
        d.subject = `${forward ? "Fwd" : "Re"}: ${mail.subject.replace(/^(Re|Fwd):\s*/i, "")}`;
        d.quote = {
          kind: forward ? "forward" : "reply",
          included: forward,
          sender: mail.sender,
          recipients: (source.to || []).map(formatAddress).join(", "),
          date: mail.date,
          subject: mail.subject,
          body: mail.body,
          html: source.html,
        };
        if (forward && native && !isDemo() && source.attachments.length) {
          d.forwardSource = {
            id: source.mail.id,
            hash: source.originalHash || "",
          };
        }
      }
      setDraft(d);
    },
    [data.accounts, detail],
  );
  const reeditSent = useCallback(
    (source: Detail) => {
      const account = data.accounts.find(
        (a) => a.id === source.mail.accountId && a.enabled,
      );
      if (!account) {
        toast.error("原发件账号已停用或移除，请先启用账号");
        return;
      }
      const draft = newDraft(account.id);
      draft.to = (source.to || []).map(formatAddress).join(", ");
      draft.cc = (source.cc || []).map(formatAddress).join(", ");
      draft.subject = source.mail.subject;
      draft.body = source.mail.body;
      draft.signature = {
        accountId: account.id,
        included: false,
        body: "",
        html: "",
      };
      if (source.html && !/<img\b/i.test(source.html)) {
        draft.format = "rich";
        draft.html = sanitizeComposeHtml(source.html);
      } else {
        draft.format = "plain";
      }
      if (native && !isDemo() && source.attachments.length) {
        if (!source.originalHash) {
          toast.error("原邮件快照缺失，请重新打开邮件后再试");
          return;
        }
        draft.forwardSource = { id: source.mail.id, hash: source.originalHash };
      }
      setDraft(draft);
    },
    [data.accounts],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.repeat ||
        draft ||
        target?.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="combobox"]',
        ) ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        )
      )
        return;
      if (
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        ["ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        if (page !== "mail" || !selected) return;
        const direction = e.key === "ArrowUp" ? "previous" : "next";
        if (canNavigate(direction)) {
          e.preventDefault();
          void navigateReading(direction);
        }
        return;
      }
      const action = mailShortcut(e);
      if (action) {
        if (
          page !== "mail" ||
          loading ||
          checked.length ||
          !detail ||
          detail.mail.id !== selected ||
          navigationPending.current ||
          !canSeek()
        )
          return;
        e.preventDefault();
        const mail = detail.mail;
        if (
          action === "reply" ||
          action === "replyAll" ||
          action === "forward"
        ) {
          compose(mail, action === "forward", action === "replyAll", detail);
        } else if (!shortcutMutationPending.current) {
          shortcutMutationPending.current = true;
          void mutate(
            [mail.id],
            action,
            String(action === "read" ? !mail.isRead : !mail.starred),
            false,
            [mail],
          ).finally(() => {
            shortcutMutationPending.current = false;
          });
        }
        return;
      }
      if (e.altKey || e.shiftKey) return;
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "k" &&
        searchRef.current
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        compose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    compose,
    page,
    draft,
    selected,
    data,
    detail,
    query,
    search,
    loading,
    checked,
  ]);
  function navigate(
    view: string,
    accountId = "",
    folder = "",
    remoteFolder = "",
    remoteFolderTree = false,
    remoteFolderDelimiter = "",
  ) {
    ++notificationGeneration.current;
    setNotificationToken(null);
    setNotificationSelected("");
    notificationReading.current = "";
    setPage("mail");
    setSearch("");
    setSelected("");
    setChecked([]);
    setQuery({
      view,
      accountId,
      folder,
      remoteFolder,
      remoteFolderTree,
      remoteFolderDelimiter,
      search: "",
      limit: 200,
      unreadOnly: false,
      listMode: query.listMode,
    });
  }
  async function mutate(
    ids: string[],
    action: string,
    value: string,
    whole = false,
    originals: Mail[] = [],
  ) {
    let currentMessages = [
      ...new Map(
        [...data.messages, ...(detail ? [detail.mail] : []), ...originals].map(
          (m) => [m.id, m],
        ),
      ).values(),
    ];
    if (whole) {
      try {
        const threads = await Promise.all(
          ids.map((id) => call<Mail[]>("mail_conversation", { id })),
        );
        currentMessages = [
          ...new Map(threads.flat().map((m) => [m.id, m])).values(),
        ];
        ids = currentMessages.map((m) => m.id);
      } catch (e) {
        toast.error(String(e));
        return;
      }
    }
    const before = currentMessages
      .filter((m) => ids.includes(m.id))
      .map((m) => ({
        id: m.id,
        value:
          action === "read"
            ? String(m.isRead)
            : action === "star"
              ? String(m.starred)
              : action === "trash"
                ? String(m.trashed)
                : m.localFolder,
      }));
    try {
      for (const id of ids) await updateMail(id, action, value);
      await refresh();
      setChecked([]);
      toast.success("已更新邮件", {
        action: {
          label: "撤销",
          onClick: () => {
            void (async () => {
              try {
                for (const old of before)
                  await updateMail(old.id, action, old.value);
                await refresh();
              } catch (e) {
                toast.error(String(e));
              }
            })();
          },
        },
      });
    } catch (e) {
      toast.error(String(e));
      void refresh();
    }
  }
  async function updateMail(id: string, action: string, value: string) {
    await call("update_mail", { id, action, value });
    const change: Partial<Mail> =
      action === "read"
        ? { isRead: value === "true" }
        : action === "star"
          ? { starred: value === "true" }
          : action === "trash"
            ? { trashed: value === "true" }
            : { localFolder: value };
    localChanges.current.set(id, {
      ...localChanges.current.get(id),
      ...change,
    });
    setDetail((current) =>
      current?.mail.id === id
        ? { ...current, mail: { ...current.mail, ...change } }
        : current,
    );
  }
  function readingScope() {
    return queryScope(query);
  }
  useEffect(() => {
    navigationRequest.current++;
    navigationPending.current = false;
    setNavigationLoading(false);
    return () => {
      navigationRequest.current++;
      navigationPending.current = false;
    };
  }, [query, selected, page, demo, search]);
  function neighboringMail(
    direction: "previous" | "next",
    messages = data.messages,
  ) {
    if (dataScope.current !== readingScope()) return undefined;
    const conversationId =
      detail?.mail.id === selected ? detail.mail.conversationId : undefined;
    const index = messages.findIndex(
      (m) =>
        m.id === selected ||
        (grouped && !!m.conversationId && m.conversationId === conversationId),
    );
    if (index >= 0)
      return messages[index + (direction === "previous" ? -1 : 1)];
    const anchor = readingNeighbors.current;
    if (anchor?.scope !== readingScope()) return undefined;
    const byId = new Map(messages.map((m) => [m.id, m]));
    const id = anchor[direction].find((id) => byId.has(id));
    if (id) return byId.get(id);
    // An opened unread mail can leave the list before the next page arrives.
    // Only newly loaded older results may extend its recorded next boundary.
    const known = new Set(anchor.known);
    return direction === "next"
      ? messages.find(
          (mail) =>
            !known.has(mail.id) &&
            new Date(mail.date).getTime() <= new Date(anchor.date).getTime(),
        )
      : undefined;
  }
  function canSeek() {
    if (
      !selected ||
      dataScope.current !== readingScope() ||
      search !== query.search
    )
      return false;
    const conversationId =
      detail?.mail.id === selected ? detail.mail.conversationId : undefined;
    return (
      readingNeighbors.current?.scope === readingScope() ||
      data.messages.some(
        (mail) =>
          mail.id === selected ||
          (grouped &&
            !!conversationId &&
            mail.conversationId === conversationId),
      )
    );
  }
  function canNavigate(direction: "previous" | "next") {
    if (neighboringMail(direction)) return true;
    return (
      canSeek() &&
      !(
        neighborHints?.id === selected &&
        neighborHints.scope === readingScope() &&
        neighborHints[direction] === false
      )
    );
  }
  useEffect(() => {
    pageTicket.current++;
    pagePending.current = false;
    setPageLoading(false);
  }, [query, demo, page, search]);
  useEffect(() => {
    let live = true;
    neighborRequests.current = null;
    if (!canSeek()) {
      setNeighborHints(null);
      return;
    }
    const currentQuery = queryRef.current,
      id = selected!,
      scope = readingScope();
    const cache: {
      id: string;
      scope: string;
      revision: number;
      previous?: Promise<MailNeighbor>;
      next?: Promise<MailNeighbor>;
    } = { id, scope, revision: data.revision };
    neighborRequests.current = cache;
    setNeighborHints({
      id,
      scope,
      previous: neighboringMail("previous") ? true : null,
      next: neighboringMail("next") ? true : null,
    });
    for (const direction of ["previous", "next"] as const) {
      if (neighboringMail(direction)) continue;
      const promise = mailNeighbor(currentQuery, id, direction);
      cache[direction] = promise;
      void promise
        .then((result) => {
          if (
            live &&
            currentQuery === queryRef.current &&
            selectionRef.current === id &&
            result.revision >= dataRef.current.revision
          ) {
            setNeighborHints((current) =>
              current?.id === id && current.scope === scope
                ? { ...current, [direction]: !!result.mail }
                : current,
            );
          }
        })
        .catch(() => {
          if (neighborRequests.current === cache) cache[direction] = undefined;
        });
    }
    return () => {
      live = false;
    };
  }, [query, selected, data.revision, demo, page, search]);
  async function loadNextPage() {
    const base = dataRef.current,
      currentQuery = queryRef.current;
    if (
      pagePending.current ||
      !base.nextCursor ||
      dataScope.current !== queryScope(currentQuery)
    )
      return;
    const cursor = base.nextCursor,
      ticket = ++pageTicket.current,
      seq = ++request.current;
    pagePending.current = true;
    setPageLoading(true);
    try {
      const value = await mailPage({ ...currentQuery, limit: 200 }, cursor);
      if (
        ticket !== pageTicket.current ||
        seq !== request.current ||
        currentQuery !== queryRef.current ||
        cursor !== dataRef.current.nextCursor
      )
        return;
      const reset = value.reset || value.revision !== dataRef.current.revision;
      const merged = reset
        ? value
        : {
            ...value,
            messages: [
              ...dataRef.current.messages,
              ...value.messages.filter(
                (mail) =>
                  !dataRef.current.messages.some(
                    (existing) => existing.id === mail.id,
                  ),
              ),
            ],
          };
      dataRef.current = merged;
      dataScope.current = queryScope(currentQuery);
      setData(merged);
      if (reset) toast.info("邮件列表已更新，已重新加载最新结果");
    } catch (e) {
      if (ticket === pageTicket.current && currentQuery === queryRef.current)
        toast.error(`加载更多邮件失败：${String(e)}`);
    } finally {
      if (ticket === pageTicket.current) {
        pagePending.current = false;
        setPageLoading(false);
      }
    }
  }
  async function navigateReading(direction: "previous" | "next") {
    if (navigationPending.current) return;
    const neighbor = neighboringMail(direction);
    if (neighbor) {
      await openMail(neighbor);
      return;
    }
    if (!canSeek()) return;
    const currentQuery = queryRef.current,
      reading = selectionRef.current!,
      ticket = ++navigationRequest.current;
    navigationPending.current = true;
    setNavigationLoading(true);
    try {
      const cache = neighborRequests.current;
      const pending =
        cache?.id === reading &&
        cache.scope === readingScope() &&
        cache.revision === dataRef.current.revision
          ? cache[direction]
          : undefined;
      let value = await (pending ||
        mailNeighbor(currentQuery, reading, direction));
      if (
        ticket !== navigationRequest.current ||
        currentQuery !== queryRef.current ||
        reading !== selectionRef.current
      )
        return;
      if (value.revision < dataRef.current.revision)
        value = await mailNeighbor(currentQuery, reading, direction);
      if (
        ticket !== navigationRequest.current ||
        currentQuery !== queryRef.current ||
        reading !== selectionRef.current ||
        value.revision < dataRef.current.revision
      )
        return;
      if (value.mail)
        await openMail(
          value.mail,
          dataRef.current.messages.some((mail) => mail.id === value.mail!.id)
            ? dataRef.current.messages
            : [value.mail],
        );
      else
        setNeighborHints((current) =>
          current?.id === reading
            ? { ...current, [direction]: false }
            : current,
        );
    } catch (e) {
      if (
        ticket === navigationRequest.current &&
        currentQuery === queryRef.current
      ) {
        if (neighborRequests.current?.id === reading)
          neighborRequests.current[direction] = undefined;
        toast.error(`加载相邻邮件失败：${String(e)}`);
      }
    } finally {
      if (ticket === navigationRequest.current) {
        navigationPending.current = false;
        setNavigationLoading(false);
      }
    }
  }
  async function openMail(m: Mail, messages = data.messages) {
    ++notificationGeneration.current;
    setNotificationToken(null);
    setNotificationSelected("");
    notificationReading.current = "";
    const index = messages.findIndex(
      (item) =>
        item.id === m.id ||
        (grouped &&
          !!m.conversationId &&
          item.conversationId === m.conversationId),
    );
    if (index >= 0)
      readingNeighbors.current = {
        scope: readingScope(),
        previous: messages
          .slice(0, index)
          .reverse()
          .map((item) => item.id),
        next: messages.slice(index + 1).map((item) => item.id),
        known: messages.map((item) => item.id),
        date: m.date,
      };
    setSelected(m.id);
    try {
      const mode = query.listMode;
      const conversation = grouped
        ? await call<Mail[]>("mail_conversation", { id: m.id })
        : [m];
      if (queryRef.current.listMode !== mode) return;
      for (const mail of conversation.filter((mail) => !mail.isRead))
        await updateMail(mail.id, "read", "true");
      void refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function sync() {
    if (syncing) return;
    if (demo) {
      toast.info("演示模式不连接真实邮箱");
      return;
    }
    setSyncing(true);
    try {
      let n: number;
      if (query.remoteFolderTree && query.accountId && query.remoteFolder) {
        const prefix = query.remoteFolder + query.remoteFolderDelimiter;
        const children = (
          loadedFolders[query.accountId] || serverFolders
        ).filter(
          (folder) =>
            folder.accountId === query.accountId &&
            folder.selectable &&
            !folder.syncError &&
            (folder.name === query.remoteFolder ||
              (!!query.remoteFolderDelimiter &&
                folder.name.startsWith(prefix))),
        );
        n = 0;
        for (const folder of children)
          n += await call<number>("sync_remote_folder", {
            id: query.accountId,
            folder: folder.name,
          });
      } else if (query.remoteFolder && query.accountId) {
        n = await call<number>("sync_remote_folder", {
          id: query.accountId,
          folder: query.remoteFolder,
        });
      } else {
        n = await call<number>("sync_mail");
      }
      toast.success(`收取完成，新增 ${n} 封邮件`);
    } catch (e) {
      toast.error(String(e), { duration: 8000 });
    } finally {
      setSyncing(false);
      setSyncText("");
      void refresh();
    }
  }
  function demoMode() {
    if (demo) {
      leaveDemo();
      setDemo(false);
    } else {
      enterDemo();
      setDemo(true);
    }
    setSelected("");
    setPage("mail");
    setQuery({
      view: "all",
      accountId: "",
      folder: "",
      search: "",
      limit: 200,
      unreadOnly: false,
      listMode: query.listMode,
    });
    setSearch("");
    void refresh();
  }
  async function reloadDrafts() {
    const ticket = ++draftRequest.current;
    try {
      const list = await call<Compose[]>("list_drafts");
      if (ticket === draftRequest.current) setDrafts(list);
    } catch (e) {
      if (ticket === draftRequest.current) toast.error(String(e));
    }
  }
  async function showDrafts() {
    setPage("drafts");
    await reloadDrafts();
  }
  async function clearDrafts() {
    if (!drafts.length || draft || clearingDraftsNow.current) return;
    const expected = drafts;
    clearingDraftsNow.current = true;
    setClearingDrafts(true);
    try {
      if (
        !(await askConfirmation({
          title: "清空草稿箱？",
          description: `将删除这 ${expected.length} 份本地草稿，删除后无法恢复。正在编辑的草稿请先关闭。`,
          action: "清空草稿",
          destructive: true,
        }))
      )
        return;
      ++draftRequest.current;
      const result = await call<{ deleted: number; cleanupPending: number }>(
        "clear_drafts",
        { drafts: expected },
      );
      ++draftRequest.current;
      const ids = new Set(expected.map((draft) => draft.id));
      setDrafts((current) => current.filter((draft) => !ids.has(draft.id)));
      await reloadDrafts();
      toast.success(`已清空 ${result.deleted} 份草稿`);
      if (result.cleanupPending)
        toast.warning("草稿已清空，部分临时附件待后续清理");
    } catch (e) {
      toast.error(String(e));
      await reloadDrafts();
    } finally {
      clearingDraftsNow.current = false;
      setClearingDrafts(false);
    }
  }
  async function queueArchives(ids: string[], conversations = false) {
    if (archiving) return;
    setArchiving(true);
    try {
      const result = await call<{
        queued: number;
        alreadySaved: number;
        blocked: number;
      }>("queue_archives", { ids, conversations });
      toast.success(
        `已安排 ${result.queued} 封补存，${result.alreadySaved} 封已有完整存档，${result.blocked} 封需处理`,
        { action: { label: "查看任务", onClick: () => setPage("storage") } },
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setArchiving(false);
    }
  }
  async function exportMail(m: Mail) {
    if (!native || demo) {
      toast.info("真实邮件可在桌面客户端中导出为 EML");
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: `${m.subject.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.eml`,
      filters: [{ name: "原始邮件", extensions: ["eml"] }],
    });
    if (path)
      try {
        await call("export_mail", { id: m.id, path });
        toast.success("完整邮件已导出");
      } catch (e) {
        toast.error(String(e));
      }
  }
  async function attachment(index: number, name: string, mail = detail?.mail) {
    if (!mail || !native || demo) {
      toast.info("请在桌面客户端中下载真实附件");
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name.replace(/[\\/]/g, "-") });
    if (path)
      try {
        await call("save_attachment", { id: mail.id, index, path });
        toast.success("附件已保存");
      } catch (e) {
        toast.error(String(e));
      }
  }
  async function backup(restore = false) {
    if (!native || demo) {
      toast.info("请在桌面客户端中备份真实存档");
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      directory: true,
      multiple: false,
      title: restore ? "选择雁信备份文件夹" : "选择备份保存位置",
    });
    if (path)
      try {
        const result = await call<string | number>(
          restore ? "restore_archive" : "backup_archive",
          { path },
        );
        toast.success(
          restore ? `已恢复 ${result} 封邮件` : `备份已保存至 ${result}`,
          { duration: 7000 },
        );
        void refresh();
      } catch (e) {
        toast.error(String(e));
      }
  }
  async function loadFolders(id: string) {
    if (folderLoading.includes(id)) return;
    setFolderLoading((ids) => [...ids, id]);
    setFolderErrors((errors) => ({ ...errors, [id]: "" }));
    try {
      const folders = await call<RemoteFolder[]>("account_folders", { id });
      setLoadedFolders((all) => ({ ...all, [id]: folders }));
      setServerFolders((all) => [
        ...all.filter((f) => f.accountId !== id),
        ...folders,
      ]);
      await refresh();
    } catch (e) {
      setFolderErrors((errors) => ({ ...errors, [id]: String(e) }));
      await refresh();
    } finally {
      setFolderLoading((ids) => ids.filter((value) => value !== id));
    }
  }
  function remoteFolder(accountId: string, name: string) {
    return (loadedFolders[accountId] || serverFolders).find(
      (folder) => folder.accountId === accountId && folder.name === name,
    );
  }
  async function openRemoteFolder(
    accountId: string,
    folder: string,
    tree = false,
    delimiter = "",
  ) {
    navigate("remote", accountId, "", folder, tree, delimiter);
    if (demo || tree || remoteFolder(accountId, folder)?.syncError) return;
    try {
      await call("sync_remote_folder", { id: accountId, folder });
      await refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function markRemoteFolderRead(
    accountId: string,
    folder: string,
    tree: boolean,
    delimiter: string,
    starred: boolean,
  ) {
    const key = `${accountId}\u0000${starred ? "starred" : folder}`;
    if (markingFolders.current.has(key)) return;
    markingFolders.current.add(key);
    try {
      const changed = await call<number>("mark_folder_read", {
        accountId,
        folder,
        tree,
        delimiter,
        starred,
      });
      await refresh();
      toast.success(
        changed ? `已将 ${changed} 封邮件标记为已读` : "没有未读邮件",
      );
    } catch (error) {
      toast.error(String(error));
      await refresh();
    } finally {
      markingFolders.current.delete(key);
    }
  }
  const activeAccount = data.accounts.find((a) => a.id === query.accountId),
    title = query.remoteFolder
      ? (() => {
          const folder = remoteFolder(query.accountId, query.remoteFolder);
          return folder ? remoteFolderLabel(folder) : query.remoteFolder;
        })()
      : query.folder ||
        (query.view === "starred" && query.accountId
          ? "星标邮件"
          : activeAccount?.name) ||
        viewNames[query.view];
  const nav = (view: string, Icon: typeof Inbox, count?: number) => (
    <Button
      variant="ghost"
      className={`nav-item ${page === "mail" && query.view === view && !query.accountId && !query.folder ? "active" : ""}`}
      onClick={() => navigate(view)}
      key={view}
    >
      <Icon size={17} />
      <span>{viewNames[view]}</span>
      {!!count && <em>{count}</em>}
    </Button>
  );
  return (
    <SidebarProvider
      className={`app-shell ${readerExpanded ? "reader-expanded" : ""}`}
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
    >
      <div className="desktop-titlebar" data-tauri-drag-region />
      <Toaster
        position="bottom-center"
        theme={dark ? "dark" : "light"}
        richColors
        closeButton
      />
      <div className="top-actions app-actions">
        <EmlViewer />
        <UpdateIndicator updates={updates} />
        {publicPreview && (
          <Badge variant="secondary">页面预览 · 虚构数据</Badge>
        )}
        {demo && !publicPreview && (
          <Button variant="ghost" className="demo-badge" onClick={demoMode}>
            演示模式 · 退出
          </Button>
        )}
        <span className="connection">
          <i className={syncing || syncText ? "pulse" : ""} />
          {syncText ||
            (demo
              ? "示例数据"
              : syncing
                ? "正在收取"
                : data.accounts.length
                  ? "本地优先"
                  : "尚未连接邮箱")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title={dark ? "浅色模式" : "深色模式"}
          onClick={() => setDark(!dark)}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
      </div>
      <NavigationLayout
        open={sidebarOpen}
        expanded={readerExpanded}
        sidebar={
          <Sidebar variant="inset" collapsible="none" className="mail-sidebar">
            <SidebarHeader className="mail-sidebar-header">
              <div className="brand">
                <img
                  src={`${import.meta.env.BASE_URL}app-icon.png`}
                  alt="雁信应用图标"
                />
                <div>
                  <strong>
                    雁信<span>邮件，自在有序</span>
                  </strong>
                </div>
                <Badge variant="outline" className="brand-version">
                  α
                </Badge>
              </div>
              <Button
                className="compose-button"
                disabled={clearingDrafts}
                onClick={() => compose()}
              >
                <SquarePen size={17} />
                写邮件<kbd>⌘ N</kbd>
              </Button>
            </SidebarHeader>
            <SidebarContent className="sidebar">
              <nav className="primary-nav">
                {nav("all", Inbox, data.stats.unread)}
                {nav("starred", Star)}
                {nav("sent", Send)}
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "drafts" ? "active" : ""}`}
                  onClick={() => void showDrafts()}
                >
                  <FileText size={17} />
                  <span>草稿箱</span>
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "outbox" ? "active" : ""}`}
                  onClick={() => setPage("outbox")}
                >
                  <History size={17} />
                  <span>发送记录</span>
                </Button>
              </nav>
              <div className="nav-section-heading">
                <span>我的账号</span>
                <Button
                  variant="ghost"
                  title="添加邮箱账号"
                  disabled={publicPreview}
                  onClick={() => setAccountDialog(true)}
                >
                  <Plus size={15} />
                </Button>
              </div>
              <div className="account-nav">
                {data.accounts.map((a, i) => (
                  <Collapsible
                    key={a.id}
                    open={expandedAccounts.includes(a.id)}
                    onOpenChange={(open) => {
                      setExpandedAccounts((ids) =>
                        open ? [...ids, a.id] : ids.filter((id) => id !== a.id),
                      );
                      if (open) void loadFolders(a.id);
                    }}
                  >
                    <div
                      className={`account-navigation ${page === "mail" && query.accountId === a.id ? "active" : ""}`}
                    >
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          className="nav-item account-item"
                          onClick={() => navigate("all", a.id)}
                        >
                          <span className={`account-dot color-${i % 4}`} />
                          <span>
                            {a.name}
                            <small>{a.email}</small>
                          </span>
                          {!a.enabled && <span className="paused-dot" />}
                        </Button>
                      </CollapsibleTrigger>
                      {sidebarAccountError(a, serverFolders) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`${a.name} 收取异常`}
                            >
                              <AlertCircle
                                size={14}
                                className="text-destructive"
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="right"
                            className="max-w-80 break-words"
                          >
                            <p>{a.email}</p>
                            <p>{sidebarAccountError(a, serverFolders)}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`展开 ${a.name} 的服务器文件夹`}
                          title="服务器文件夹"
                        >
                          <ChevronRight
                            size={13}
                            className={
                              expandedAccounts.includes(a.id) ? "rotate-90" : ""
                            }
                          />
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent className="remote-folder-list">
                      {folderLoading.includes(a.id) ? (
                        <div role="status" aria-label="正在加载服务器文件夹">
                          <Skeleton className="h-6 mb-2" />
                          <Skeleton className="h-6" />
                        </div>
                      ) : (
                        <>
                          {folderErrors[a.id] ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void loadFolders(a.id)}
                            >
                              加载失败，重试
                            </Button>
                          ) : (
                            <RemoteFolderList
                              folders={loadedFolders[a.id] || []}
                              selected={
                                query.accountId === a.id
                                  ? query.remoteFolder || ""
                                  : ""
                              }
                              selectedTree={!!query.remoteFolderTree}
                              starredSelected={
                                query.accountId === a.id &&
                                query.view === "starred"
                              }
                              unread={Object.fromEntries(
                                (data.remoteFolderUnread || [])
                                  .filter((count) => count.accountId === a.id)
                                  .map((count) => [
                                    count.name,
                                    { direct: count.direct, tree: count.tree },
                                  ]),
                              )}
                              starredUnread={
                                data.accountStarredUnread?.find(
                                  (count) => count.accountId === a.id,
                                )?.unread || 0
                              }
                              onSelect={(name, tree, delimiter) =>
                                void openRemoteFolder(
                                  a.id,
                                  name,
                                  tree,
                                  delimiter,
                                )
                              }
                              onSelectStarred={() => navigate("starred", a.id)}
                              onMarkRead={(name, tree, delimiter, starred) =>
                                void markRemoteFolderRead(
                                  a.id,
                                  name,
                                  tree,
                                  delimiter,
                                  starred,
                                )
                              }
                            />
                          )}
                        </>
                      )}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
                {!data.accounts.length && (
                  <Button
                    variant="ghost"
                    className="add-account-dashed"
                    onClick={() => setAccountDialog(true)}
                  >
                    <Plus size={14} />
                    连接你的第一个邮箱
                  </Button>
                )}
              </div>
              <div className="nav-section-heading">
                <span>保存在这台 Mac</span>
                <HardDrive size={13} />
              </div>
              {nav("local", Archive, data.stats.saved)}
              {data.folders.map((f) => (
                <Button
                  variant="ghost"
                  key={f}
                  className={`nav-item folder-item ${query.folder === f && page === "mail" ? "active" : ""}`}
                  onClick={() => navigate("local", "", f)}
                >
                  <Folder size={16} />
                  <span>{f}</span>
                </Button>
              ))}
              {nav("trash", Trash2)}
            </SidebarContent>
            <SidebarFooter className="mail-sidebar-footer">
              <div className="sidebar-bottom">
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "contacts" ? "active" : ""}`}
                  onClick={() => {
                    setContactSeed(null);
                    setPage("contacts");
                  }}
                >
                  <UsersRound size={17} />
                  <span>通讯录</span>
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "rules" ? "active" : ""}`}
                  onClick={() => setPage("rules")}
                >
                  <SlidersHorizontal size={17} />
                  <span>过滤规则</span>
                  {data.rules.length > 0 && <small>{data.rules.length}</small>}
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "settings" ? "active" : ""}`}
                  onClick={() => setPage("settings")}
                >
                  <Settings size={17} />
                  <span>设置与账号</span>
                </Button>
              </div>
            </SidebarFooter>
          </Sidebar>
        }
      >
        <SidebarInset
          className={`main-area ${page === "mail" ? "mail-layout" : ""}`}
        >
          {page === "contacts" ? (
            <ContactsPanel
              initial={contactSeed}
              onCompose={(address) => {
                const account = data.accounts.find((a) => a.enabled);
                if (!account) {
                  setAccountDialog(true);
                  return;
                }
                setDraft({
                  ...newDraft(account.id),
                  to: formatAddress(address),
                });
              }}
            />
          ) : page === "outbox" ? (
            <OutboxPanel onDraft={setDraft} />
          ) : page === "rules" ? (
            <RulesPanel
              data={data}
              onChange={() => void refresh()}
              onShowTasks={() => setPage("settings")}
            />
          ) : page === "settings" || page === "storage" ? (
            <section className="workspace-panel settings-workspace">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">
                    {page === "settings"
                      ? "MAKE YOURSELF AT HOME"
                      : "YOURS TO KEEP"}
                  </span>
                  <div className="page-title-row">
                    <SidebarTrigger
                      title="切换侧边栏"
                      aria-label="切换侧边栏"
                    />
                    <h1>
                      {page === "settings" ? "设置与账号" : "本地存档管理"}
                    </h1>
                  </div>
                  <p>
                    {page === "settings"
                      ? "连接你的邮箱，在一个地方照顾好工作与生活。"
                      : "服务器的保留期限，不再决定你的邮件能保存多久。"}
                  </p>
                </div>
                {page === "settings" && (
                  <Button
                    disabled={publicPreview}
                    onClick={() => setAccountDialog(true)}
                  >
                    <Plus size={16} />
                    添加账号
                  </Button>
                )}
              </div>
              {page === "settings" && (
                <>
                  <div className="settings-accounts">
                    {data.accounts.map((a, i) => (
                      <article className="account-card" key={a.id}>
                        <span className={`account-avatar color-${i % 4}`}>
                          {a.name[0]}
                        </span>
                        <div>
                          <h3>
                            {a.name}
                            <Badge variant="secondary">
                              {a.protocol.toUpperCase()}
                            </Badge>
                          </h3>
                          <p>
                            {a.email}{" "}
                            <Badge variant="outline">
                              默认：
                              {a.saveLocally === false
                                ? "在线阅读"
                                : "本地留存"}
                            </Badge>
                          </p>
                          <small>
                            {a.error ||
                              (!a.enabled
                                ? "账号已暂停"
                                : a.lastSync
                                  ? `最近收取：${new Date(a.lastSync).toLocaleString("zh-CN")}`
                                  : "已连接，等待首次收取")}
                          </small>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              title="账号操作"
                            >
                              <MoreHorizontal size={18} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onClick={() => {
                                  setEditingAccount(a);
                                  setAccountDialog(true);
                                }}
                              >
                                编辑账号配置
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setRetentionIntro(false);
                                  setRetentionAccount(a);
                                }}
                              >
                                {a.protocol === "imap"
                                  ? "文件夹保存范围"
                                  : "本地保存设置"}
                              </DropdownMenuItem>
                              {a.protocol === "imap" && (
                                <DropdownMenuItem
                                  onClick={() => setMappingAccount(a)}
                                >
                                  特殊文件夹
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() =>
                                  void call("account_action", {
                                    id: a.id,
                                    remove: false,
                                  })
                                    .then(refresh)
                                    .catch((e) => toast.error(String(e)))
                                }
                              >
                                {a.enabled ? "暂停收取" : "启用收取"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={async () => {
                                  if (
                                    await askConfirmation({
                                      title: "移除账号？",
                                      description: `移除 ${a.email} 后停止收取，本地完整存档会保留，未存档的列表记录将清理。`,
                                      action: "移除账号",
                                      destructive: true,
                                    })
                                  )
                                    void call("account_action", {
                                      id: a.id,
                                      remove: true,
                                    })
                                      .then(refresh)
                                      .catch((e) => toast.error(String(e)));
                                }}
                              >
                                移除账号，保留存档
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </article>
                    ))}
                  </div>
                  {!data.accounts.length && (
                    <div className="panel-empty">
                      <MailIcon size={36} />
                      <h3>从连接一个邮箱开始</h3>
                      <p>支持 Gmail、Outlook、QQ、网易与自定义服务器。</p>
                    </div>
                  )}
                  <Separator className="settings-section-divider" />
                </>
              )}
              <Card className="storage-card">
                <div className="storage-card-header">
                  <span>
                    <ShieldCheck size={25} />
                  </span>
                  <div>
                    <h3>完整保存，独立留存</h3>
                    <p>
                      开启本地保存的账号留存完整正文与附件，已有存档不会随账号移除。
                    </p>
                  </div>
                  <Badge variant="secondary">按账号设置</Badge>
                </div>
                <div className="storage-metrics">
                  <div>
                    <strong>
                      {data.stats.saved}
                      <small> 封</small>
                    </strong>
                    <span>完整本地存档</span>
                  </div>
                  <div>
                    <strong>{formatSize(data.stats.bytes)}</strong>
                    <span>原始邮件大小</span>
                  </div>
                  <ArchiveIntegrity />
                </div>
                <ArchiveLocation
                  initialPath={data.dataDir}
                  onChanged={() => void refresh()}
                >
                  <Button variant="outline" onClick={() => void backup()}>
                    <ArrowDownToLine size={15} />
                    备份存档
                  </Button>
                  <Button variant="outline" onClick={() => void backup(true)}>
                    <Archive size={15} />
                    恢复备份
                  </Button>
                  <DeleteArchiveDialog
                    onDeleted={() => {
                      setSelected("");
                      setDetail(null);
                      void refresh();
                    }}
                  />
                </ArchiveLocation>
              </Card>
              <Separator className="settings-section-divider" />
              <StorageTools testMailId={selected} />
              {page === "settings" && <NetworkProxySettings />}
              {page === "settings" && <MailTranslationSettings />}
              {page === "settings" && (
                <MailSignatures accounts={data.accounts} />
              )}
              <Separator className="settings-section-divider" />
              <ArchiveJobsPanel defaultCollapsed />
              <div className="flex flex-col gap-6">
                <ServerOperations defaultCollapsed />
                <FolderHealthPanel defaultCollapsed />
                <DirectoryOperationsPanel defaultCollapsed />
              </div>
              <Collapsible asChild>
                <Card>
                  <CardHeader>
                    <CardTitle>最近活动</CardTitle>
                    <CardDescription>
                      查看邮件收取、发送、规则执行及大模型翻译的最近记录。
                    </CardDescription>
                    <CardAction className="flex items-center gap-2">
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="展开或收起最近活动"
                          className="group"
                        >
                          <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
                        </Button>
                      </CollapsibleTrigger>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void refresh()}
                      >
                        <RefreshCw size={14} />
                        刷新
                      </Button>
                    </CardAction>
                  </CardHeader>
                  <CollapsibleContent asChild>
                    <CardContent className="activity-list">
                      {data.logs.length ? (
                        data.logs.map((l, i) => (
                          <p key={i}>
                            <Check size={13} />
                            {l}
                          </p>
                        ))
                      ) : (
                        <p>
                          这里会显示邮件收取、发送、规则执行及大模型翻译记录。
                        </p>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
              <Separator className="settings-section-divider" />
              {page === "settings" && <UpdateSettings updates={updates} />}
              <div className="info-strip">
                <Info size={17} />
                <span>
                  关闭窗口后继续收取；退出
                  App、睡眠或断网时暂停。邮件须在服务器删除前完整下载。
                </span>
              </div>
              {import.meta.env.DEV && (
                <Button
                  variant="ghost"
                  className="text-link self-start"
                  onClick={demoMode}
                >
                  {demo ? "退出演示" : "体验示例邮箱"}
                  <ArrowRight data-icon="inline-end" />
                </Button>
              )}
            </section>
          ) : page === "drafts" ? (
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">TAKE YOUR TIME</span>
                  <div className="page-title-row">
                    <SidebarTrigger
                      title="切换侧边栏"
                      aria-label="切换侧边栏"
                    />
                    <h1>草稿箱</h1>
                  </div>
                  <p>草稿自动保存到本机，随时继续。</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!drafts.length || clearingDrafts || !!draft}
                    onClick={() => void clearDrafts()}
                  >
                    <Trash2 data-icon="inline-start" />
                    {clearingDrafts ? "正在清空…" : "清空草稿"}
                  </Button>
                  <Button disabled={clearingDrafts} onClick={() => compose()}>
                    <SquarePen data-icon="inline-start" />
                    写邮件
                  </Button>
                </div>
              </div>
              {drafts.length ? (
                drafts.map((d) => (
                  <article className="draft-card" key={d.id}>
                    <Button
                      variant="ghost"
                      disabled={clearingDrafts}
                      onClick={() => {
                        if (!clearingDraftsNow.current) setDraft(d);
                      }}
                    >
                      <h3>{d.subject || "（无主题）"}</h3>
                      <p>收件人：{d.to || "尚未填写"}</p>
                      <small>{d.body.slice(0, 120) || "空白草稿"}</small>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="删除草稿"
                      disabled={clearingDrafts}
                      onClick={async () => {
                        if (clearingDraftsNow.current) return;
                        if (
                          await askConfirmation({
                            title: "删除草稿？",
                            description: "这份草稿删除后无法恢复。",
                            action: "删除草稿",
                            destructive: true,
                          })
                        )
                          void call("delete_draft", { id: d.id })
                            .then(showDrafts)
                            .catch((e) => toast.error(String(e)));
                      }}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </article>
                ))
              ) : (
                <div className="panel-empty">
                  <FileText size={36} />
                  <h3>暂时没有草稿</h3>
                  <p>每一封没写完的邮件，都会在这里等你。</p>
                </div>
              )}
            </section>
          ) : (
            <MailLayout
              expanded={readerExpanded}
              list={
                <section className="message-list">
                  <div className="list-heading">
                    <div>
                      <SidebarTrigger
                        title="切换侧边栏"
                        aria-label="切换侧边栏"
                      />
                      <h1>{title}</h1>
                      <span>
                        {data.matched} {grouped ? "个对话" : "封邮件"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={syncing || !data.accounts.length}
                      title="收取邮件"
                      onClick={() => void sync()}
                    >
                      <RefreshCw
                        size={16}
                        className={syncing ? "animate-spin" : ""}
                      />
                    </Button>
                  </div>
                  {!query.remoteFolderTree &&
                    remoteFolder(query.accountId, query.remoteFolder || "")
                      ?.syncError && (
                      <Alert className="mx-4 w-auto">
                        <AlertCircle />
                        <AlertTitle>目录来源已隔离</AlertTitle>
                        <AlertDescription>
                          此目录的服务器响应不可靠。旧来源已暂停使用，本地存档仍可在“本地存档”中查看。请到设置与账号重新核查。
                        </AlertDescription>
                      </Alert>
                    )}
                  <div className="mail-search-row">
                    <div className="search-box">
                      <Search size={16} />
                      <Input
                        ref={searchRef}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="搜索当前范围的邮件…"
                        aria-label="搜索邮件"
                      />
                      {search ? (
                        <Button
                          variant="ghost"
                          onClick={() => setSearch("")}
                          title="清除搜索"
                        >
                          <X size={14} />
                        </Button>
                      ) : (
                        <kbd>⌘ K</kbd>
                      )}
                    </div>
                    <MailFilters
                      query={query}
                      onChange={(filters) =>
                        setQuery((q) => ({ ...q, ...filters, limit: 200 }))
                      }
                    />
                  </div>
                  {query.search &&
                    (!query.searchField || query.searchField === "body") && (
                      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="正文搜索范围"
                            >
                              <Info data-icon="inline-start" />
                              正文范围
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72">
                            <p>
                              正文只检索本机已有内容，搜索不会自动下载。当前范围完整{" "}
                              {data.bodyCoverage.known} 封，未完整{" "}
                              {data.bodyCoverage.unknown}{" "}
                              封；需要纳入完整正文搜索时，可选择完整保存。
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    )}
                  <div className="list-filters">
                    <Tabs
                      value={query.unreadOnly ? "unread" : "all"}
                      onValueChange={(value) =>
                        setQuery((q) => ({
                          ...q,
                          unreadOnly: value === "unread",
                        }))
                      }
                    >
                      <TabsList>
                        <TabsTrigger value="all">全部</TabsTrigger>
                        <TabsTrigger value="unread">未读</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="邮件显示方式"
                        >
                          {grouped ? (
                            <MessagesSquare data-icon="inline-start" />
                          ) : (
                            <List data-icon="inline-start" />
                          )}
                          {grouped ? "按对话" : "逐封邮件"}
                          <ChevronDown data-icon="inline-end" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuRadioGroup
                          value={query.listMode || "conversations"}
                          onValueChange={(value) => {
                            if (
                              value !== "conversations" &&
                              value !== "messages"
                            )
                              return;
                            setChecked([]);
                            readingNeighbors.current = null;
                            setQuery((q) => ({
                              ...q,
                              listMode: value,
                              limit: 200,
                            }));
                          }}
                        >
                          <DropdownMenuRadioItem value="conversations">
                            按对话分组
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="messages">
                            逐封邮件
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {checked.length > 0 && (
                    <div className="batch-toolbar">
                      <span>
                        已选 {checked.length} {grouped ? "个对话" : "封邮件"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="完整保存到本地"
                        disabled={archiving}
                        onClick={() => void queueArchives(checked, grouped)}
                      >
                        <HardDriveDownload />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="标记为已读"
                        onClick={() =>
                          void mutate(checked, "read", "true", grouped)
                        }
                      >
                        <CheckCheck size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="归入本地文件夹"
                        onClick={() => {
                          setMoveIds(checked);
                          setMoveThreads(grouped);
                          setMoveFolder("");
                        }}
                      >
                        <Folder size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="移到本地废纸篓"
                        onClick={() =>
                          void mutate(
                            checked,
                            "trash",
                            query.view === "trash" ? "false" : "true",
                            grouped,
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  )}
                  <div className="mail-rows">
                    {loading ? (
                      <MailListSkeleton />
                    ) : data.messages.length ? (
                      data.messages.map((m) => (
                        <ContextMenu key={m.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              key={m.id}
                              className={`mail-row ${selected === m.id || (grouped && !!m.conversationId && m.conversationId === detail?.mail.conversationId) ? "selected" : ""} ${!m.isRead ? "unread" : ""}`}
                            >
                              <div className="row-check">
                                <Checkbox
                                  aria-label={`选择 ${m.subject}`}
                                  checked={checked.includes(m.id)}
                                  onCheckedChange={(v) =>
                                    setChecked((ids) =>
                                      v
                                        ? [...ids, m.id]
                                        : ids.filter((id) => id !== m.id),
                                    )
                                  }
                                />
                              </div>
                              <Button
                                variant="ghost"
                                className="mail-row-main"
                                onClick={() => void openMail(m)}
                              >
                                <div className="row-top">
                                  <span className="sender-name">
                                    {senderName(m.sender)}
                                  </span>
                                  <time dateTime={m.date}>{time(m.date)}</time>
                                </div>
                                <div className="row-subject">
                                  {!m.isRead && (
                                    <i aria-label="未读" title="未读" />
                                  )}
                                  <span className="row-subject-text">
                                    {m.subject}
                                  </span>
                                  {grouped &&
                                    (m.conversationCount || 0) > 1 && (
                                      <Badge
                                        variant="secondary"
                                        className="conversation-count"
                                      >
                                        {m.conversationCount}
                                      </Badge>
                                    )}
                                </div>
                                <p>{m.preview}</p>
                                <div className="row-meta">
                                  <span
                                    className={`mini-dot color-${data.accounts.findIndex((a) => a.id === m.accountId) % 4}`}
                                    aria-hidden="true"
                                    title="邮箱颜色标识"
                                  />
                                  <span>
                                    {data.accounts.find(
                                      (a) => a.id === m.accountId,
                                    )?.name || "已移除账号"}
                                  </span>
                                  {m.localFolder !== "全部存档" && (
                                    <small>{m.localFolder}</small>
                                  )}
                                  <span className="row-spacer" />
                                  {m.starred && (
                                    <Star size={13} className="star-on" />
                                  )}
                                  {m.hasAttachments && (
                                    <Paperclip
                                      className="size-3 shrink-0"
                                      aria-label="包含附件"
                                    />
                                  )}
                                </div>
                              </Button>
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              onSelect={() =>
                                void mutate([m.id], "read", String(!m.isRead))
                              }
                            >
                              <MailOpen />
                              {m.isRead ? "标记为未读" : "标记为已读"}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      ))
                    ) : (
                      <div className="list-empty">
                        <Inbox size={30} />
                        <h3>
                          {search
                            ? "没有找到邮件"
                            : data.accounts.length
                              ? "这里很安静"
                              : "收件箱准备好了"}
                        </h3>
                        <p>
                          {search
                            ? "试试其他关键词。"
                            : data.accounts.length
                              ? "点击上方刷新，收取新的邮件。"
                              : "连接邮箱后，邮件会出现在这里。"}
                        </p>
                      </div>
                    )}
                    {data.nextCursor && (
                      <Button
                        variant="ghost"
                        className="load-more"
                        onClick={() => void loadNextPage()}
                        disabled={pageLoading}
                        aria-busy={pageLoading}
                      >
                        {pageLoading
                          ? "正在加载…"
                          : `加载更多（${data.messages.length} / ${data.matched}）`}
                      </Button>
                    )}
                  </div>
                </section>
              }
            >
              <section className="reader">
                {detail ? (
                  <>
                    <div className="message-heading">
                      <div className="sender-line">
                        <div className="sender-block">
                          <span className="sender-avatar">
                            {senderName(detail.mail.sender).slice(0, 1)}
                          </span>
                          <div>
                            <strong>{senderName(detail.mail.sender)}</strong>
                            <span>{senderAddress(detail.mail.sender)}</span>
                          </div>
                        </div>
                        <div className="reader-toolbar">
                          <div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="上一封邮件"
                                  aria-busy={navigationLoading}
                                  disabled={
                                    navigationLoading ||
                                    !canNavigate("previous")
                                  }
                                  onClick={() =>
                                    void navigateReading("previous")
                                  }
                                >
                                  <ArrowLeft size={17} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {navigationLoading
                                  ? "正在查找相邻邮件…"
                                  : "上一封邮件（⌥↑）"}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="下一封邮件"
                                  aria-busy={navigationLoading}
                                  disabled={
                                    navigationLoading || !canNavigate("next")
                                  }
                                  onClick={() => void navigateReading("next")}
                                >
                                  <ArrowRight size={17} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {navigationLoading
                                  ? "正在查找相邻邮件…"
                                  : "下一封邮件（⌥↓）"}
                              </TooltipContent>
                              {navigationLoading && (
                                <span className="sr-only" role="status">
                                  正在查找相邻邮件…
                                </span>
                              )}
                            </Tooltip>
                            <span className="toolbar-divider" />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="归入本地文件夹"
                              onClick={() => {
                                setMoveIds([detail.mail.id]);
                                setMoveThreads(false);
                                setMoveFolder(detail.mail.localFolder);
                              }}
                            >
                              <Folder size={17} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="导出完整原始邮件"
                              onClick={() => void exportMail(detail.mail)}
                            >
                              <ArrowDownToLine size={17} />
                            </Button>
                            <span className="toolbar-divider" />
                            <MailActionTooltip
                              action="read"
                              label={
                                detail.mail.isRead ? "标记未读" : "标记已读"
                              }
                            >
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title={
                                  detail.mail.isRead ? "标记未读" : "标记已读"
                                }
                                aria-keyshortcuts="Meta+Shift+U Control+Shift+U"
                                onClick={() =>
                                  void mutate(
                                    [detail.mail.id],
                                    "read",
                                    String(!detail.mail.isRead),
                                  )
                                }
                              >
                                <MailOpen size={17} />
                              </Button>
                            </MailActionTooltip>
                            <MailActionTooltip action="star" label={"星标"}>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title="星标"
                                aria-keyshortcuts="Meta+Shift+L Control+Shift+L"
                                onClick={() =>
                                  void mutate(
                                    [detail.mail.id],
                                    "star",
                                    String(!detail.mail.starred),
                                  )
                                }
                              >
                                <Star
                                  size={17}
                                  className={
                                    detail.mail.starred ? "star-on" : ""
                                  }
                                />
                              </Button>
                            </MailActionTooltip>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="打印这封邮件"
                              aria-label="打印这封邮件"
                              onClick={() =>
                                void printMail(detail).catch((error) =>
                                  toast.error(`打印失败：${String(error)}`),
                                )
                              }
                            >
                              <Printer size={17} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={
                                detail.mail.trashed
                                  ? "恢复本地邮件"
                                  : "移到本地废纸篓"
                              }
                              onClick={() =>
                                void mutate(
                                  [detail.mail.id],
                                  "trash",
                                  String(!detail.mail.trashed),
                                )
                              }
                            >
                              {detail.mail.trashed ? (
                                <Undo2 size={17} />
                              ) : (
                                <Trash2 size={17} />
                              )}
                            </Button>
                          </div>
                          <div className="reader-actions">
                            <MailActionTooltip action="reply" label={"回复"}>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="回复"
                                title="回复"
                                aria-keyshortcuts="Meta+R Control+R"
                                onClick={() => compose(detail.mail)}
                              >
                                <Reply size={15} />
                                <span className="action-label">回复</span>
                              </Button>
                            </MailActionTooltip>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title="更多回复操作"
                                  aria-label="更多回复操作"
                                >
                                  <ChevronDown size={12} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    aria-keyshortcuts="Meta+Shift+R Control+Shift+R"
                                    onClick={() =>
                                      compose(detail.mail, false, true)
                                    }
                                  >
                                    <ReplyAll size={15} />
                                    全部回复
                                    <DropdownMenuShortcut>
                                      {mailShortcutKeys.replyAll}
                                    </DropdownMenuShortcut>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      const address = parseAddresses(
                                        detail.mail.sender,
                                      )[0];
                                      if (!address) {
                                        toast.error("无法识别发件人邮箱地址");
                                        return;
                                      }
                                      setContactSeed(address);
                                      setPage("contacts");
                                    }}
                                  >
                                    <UsersRound size={15} />
                                    添加发件人为联系人
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <MailActionTooltip action="forward" label={"转发"}>
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label="转发"
                                title="转发"
                                aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
                                onClick={() => compose(detail.mail, true)}
                              >
                                <ArrowRight size={15} />
                                <span className="action-label">转发</span>
                              </Button>
                            </MailActionTooltip>
                            {query.view === "sent" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => reeditSent(detail)}
                              >
                                <SquarePen size={15} />
                                重新编辑
                              </Button>
                            )}
                            {(["copy", "move"] as const).map((kind) => (
                              <ServerDirectoryMenu
                                key={kind}
                                mail={detail.mail}
                                kind={kind}
                                view={query.view}
                                remoteFolder={query.remoteFolder}
                                disabled={
                                  !data.accounts.some(
                                    (a) =>
                                      a.id === detail.mail.accountId &&
                                      a.enabled &&
                                      a.protocol === "imap",
                                  )
                                }
                              />
                            ))}
                          </div>
                          <span className="toolbar-divider" />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="reader-expand-button"
                            aria-label={
                              readerExpanded ? "还原阅读区域" : "最大化阅读区域"
                            }
                            title={
                              readerExpanded
                                ? "还原阅读区域（Esc）"
                                : "最大化阅读区域"
                            }
                            aria-pressed={readerExpanded}
                            aria-controls="mail-reader-content"
                            onClick={() => setReaderExpanded((value) => !value)}
                          >
                            {readerExpanded ? (
                              <Minimize2 size={16} />
                            ) : (
                              <Maximize2 size={16} />
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="recipient-line">
                        {detail.mail.recipients.trim() && (
                          <span
                            className="recipient-address"
                            title={detail.mail.recipients}
                          >
                            收件人：{detail.mail.recipients}
                          </span>
                        )}
                        <div className="message-metadata">
                          <time dateTime={detail.mail.date}>
                            {time(detail.mail.date)}
                          </time>
                          <span className="saved-chip">
                            <ShieldCheck size={13} />
                            {demo
                              ? "演示存档"
                              : detail.mail.savedLocally === false
                                ? "服务器邮件"
                                : "完整已保存"}
                          </span>
                          {detail.mail.savedLocally === false && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={archiving}
                              onClick={() =>
                                void queueArchives([detail.mail.id])
                              }
                            >
                              <HardDriveDownload />
                              完整保存到本地
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="message-title-row">
                        <h1>{detail.mail.subject}</h1>
                        <div className="shrink-0" ref={setTranslationActions} />
                      </div>
                    </div>
                    <ConversationReader
                      key={`${selected}:${query.listMode}`}
                      selected={detail}
                      singleMessage={
                        !grouped || notificationSelected === selected
                      }
                      revision={data.messages}
                      accounts={data.accounts}
                      demo={demo}
                      scrollRef={readerRef}
                      translationActions={translationActions}
                      editorOpen={!!draft}
                      onReply={(source, forward = false, all = false) =>
                        compose(source.mail, forward, all, source)
                      }
                      onEdit={setDraft}
                      onReedit={reeditSent}
                      onSent={() => void refresh()}
                      onExport={(mail) => void exportMail(mail)}
                      onAttachment={(mail, index, name) =>
                        attachment(index, name, mail)
                      }
                      onAction={(mail, action, value) =>
                        action === "save"
                          ? void queueArchives([mail.id])
                          : void mutate([mail.id], action, value, false, [mail])
                      }
                      onLink={(href) =>
                        void openMailLink(href).catch((e) =>
                          toast.error(String(e)),
                        )
                      }
                    />
                  </>
                ) : selected ? (
                  <div
                    className={`reader-loading ${detailError?.id === selected ? "" : "reader-loading-skeleton"}`}
                    role="status"
                    aria-live="polite"
                  >
                    {detailError?.id === selected ? (
                      <>
                        <AlertCircle size={24} />
                        <span>邮件加载失败</span>
                        <p>{detailError.message}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailRetry((value) => value + 1)}
                        >
                          重新加载
                        </Button>
                      </>
                    ) : (
                      <>
                        <MailReaderSkeleton />
                      </>
                    )}
                  </div>
                ) : (
                  <div className="reader-welcome">
                    <div className="welcome-art">
                      <img
                        src={`${import.meta.env.BASE_URL}app-icon.png`}
                        alt="雁信"
                      />
                      <span className="orbit one" />
                      <span className="orbit two" />
                      <span className="art-dot dot-one" />
                      <span className="art-dot dot-two" />
                    </div>
                    <span className="eyebrow">
                      A CALMER PLACE FOR YOUR MAIL
                    </span>
                    <h1>
                      {data.accounts.length
                        ? "留一点空间，给重要的事"
                        : "邮件，自在有序。"}
                    </h1>
                    <p>
                      {data.accounts.length
                        ? "选择一封邮件，开始阅读。\n你的往来，都在这里妥善留存。"
                        : "把不同的邮箱放在一起。\n让每一封重要的邮件，都有一个长久的归处。"}
                    </p>
                    {!data.accounts.length && (
                      <div className="welcome-actions">
                        <Button onClick={() => setAccountDialog(true)}>
                          <Plus size={16} />
                          连接我的邮箱
                        </Button>
                        <Button variant="ghost" onClick={demoMode}>
                          先体验一下
                          <ArrowRight size={15} />
                        </Button>
                      </div>
                    )}
                    <div className="welcome-features">
                      <span>
                        <Inbox size={17} />
                        多账号管理
                      </span>
                      <span>
                        <SlidersHorizontal size={17} />
                        自动归类
                      </span>
                      <span>
                        <ShieldCheck size={17} />
                        本地留存
                      </span>
                    </div>
                    {!native && (
                      <small className="browser-note">
                        浏览器预览 · 真实收发请使用 macOS 桌面客户端
                      </small>
                    )}
                  </div>
                )}
              </section>
            </MailLayout>
          )}
        </SidebarInset>
      </NavigationLayout>
      <FolderMappingDialog
        account={mappingAccount}
        onClose={() => setMappingAccount(null)}
        onSaved={() => void refresh()}
      />
      <RetentionDialog
        account={retentionAccount}
        onboarding={retentionIntro}
        onClose={() => setRetentionAccount(null)}
        onSaved={() => void refresh()}
      />
      <AccountDialog
        open={accountDialog}
        editing={editingAccount}
        onOpenChange={(open) => {
          setAccountDialog(open);
          if (!open) setEditingAccount(null);
        }}
        onDone={(connected) => {
          void refresh();
          void sync();
          if (connected) {
            setRetentionIntro(true);
            setRetentionAccount(connected);
          }
        }}
      />
      <ComposeDialog
        dark={dark}
        onToggleTheme={() => setDark((value) => !value)}
        draft={draft}
        onClose={() => {
          setDraft(null);
          void refresh();
          if (page === "drafts") void reloadDrafts();
        }}
        accounts={data.accounts}
        onSent={() => void refresh()}
        onQueued={() => setPage("outbox")}
      />
      <Dialog
        open={moveIds.length > 0}
        onOpenChange={(v) => {
          if (!v) setMoveIds([]);
        }}
      >
        <DialogContent className="sm:max-w-[430px]">
          <DialogHeader>
            <DialogTitle>归入本地文件夹</DialogTitle>
            <DialogDescription>
              整理 {moveIds.length} 封本地邮件，不改变服务器上的原件。
            </DialogDescription>
          </DialogHeader>
          <FolderInput
            value={moveFolder}
            onChange={setMoveFolder}
            folders={data.folders}
          />
          <Button
            disabled={!moveFolder.trim()}
            onClick={() => {
              void mutate(moveIds, "folder", moveFolder.trim(), moveThreads);
              setMoveIds([]);
            }}
          >
            确认归类
          </Button>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
      <UpdateDialog updates={updates} blocked={!!draft} />
    </SidebarProvider>
  );
}
