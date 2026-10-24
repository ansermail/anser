import {
  dateLocale,
  formatMailTime,
  interfaceLanguageRevision,
  setInterfaceLanguage,
  t,
  useLanguage,
  type InterfaceLanguage,
} from "@/lib/i18n";
import { LanguageSettings } from "./components/language-settings";
import { TaskPanelHeader } from "./components/task-panel-header";
import { SettingsLayout } from "./components/settings-layout";
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
import { FileAssociations } from "./components/file-associations";
import { EmlImports } from "./components/eml-imports";
import { RemoteFolderList } from "./components/remote-folder-list";
import { remoteFolderLabel, sidebarAccountError } from "./lib/remote-folders";
import { printMail } from "./lib/mail-print";
import { coalesceRefresh } from "./lib/refresh-queue";
import { ConversationReader } from "./components/conversation-reader";
import { replyHeaders } from "./lib/conversations";
import { FolderInput } from "./components/folder-input";
import { useTheme } from "./lib/theme";
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
  Monitor,
  Trash2,
  X,
  LogOut,
  ExternalLink,
  AlertCircle,
  Undo2,
  Check,
  PenLine,
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
import { Card, CardContent } from "./components/ui/card";
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
  displayAddresses,
} from "./lib/addresses";
import { MailRecipients } from "./components/mail-recipients";
import { ContactAddress } from "./components/contact-address";
import { sanitizeComposeHtml } from "./lib/compose-format";
import { saveContactAddress } from "./lib/contact-actions";
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
  get all() {
    return t("All mail");
  },
  get unread() {
    return t("Unread mail");
  },
  get starred() {
    return t("Starred mail");
  },
  get sent() {
    return t("Sent");
  },
  get trash() {
    return t("Local trash");
  },
  get local() {
    return t("Local archive");
  },
};
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
  useLanguage();
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
      excludeSent: true,
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
    [settingsSection, setSettingsSection] = useState("accounts"),
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
    [renameFolder, setRenameFolder] = useState(""),
    [renameValue, setRenameValue] = useState(""),
    [renamingFolder, setRenamingFolder] = useState(false);
  const theme = useTheme();
  const dark = theme.dark;
  useEffect(() => {
    let live = true;
    const revision = interfaceLanguageRevision();
    void call<InterfaceLanguage>("get_interface_language")
      .then((language) => {
        if (live && revision === interfaceLanguageRevision())
          setInterfaceLanguage(language);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [demo]);
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
  const [notificationSelected, setNotificationSelected] = useState<{
    id: string;
    click: number;
  } | null>(null);
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
          excludeSent: true,
          limit: 200,
          listMode: queryRef.current.listMode,
        });
        notificationReading.current = mail.id;
        setNotificationSelected({
          id: mail.id,
          click: notificationToken.click,
        });
        readingNeighbors.current = null;
        setSelected(mail.id);
        setDetailRetry((value) => value + 1);
      })
      .catch((error) => {
        if (live && ticket === notificationGeneration.current)
          toast.error(
            t("Could not open notification message: {value0}", {
              value0: String(error),
            }),
          );
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
    document.documentElement.classList.toggle("dark", theme.dark);
  }, [theme.dark]);
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
        const message = `${payload.subject || t("(No subject)")}：${payload.message}`;
        if (payload.status === "sent") toast.success(message);
        else if (payload.status === "uncertain")
          toast.warning(message, { duration: 10000 });
        else toast.error(message, { duration: 10000 });
      });
      const d = await listen<string>("mail-link-open", ({ payload }) => {
        void openMailLinkRef
          .current(payload)
          .catch((error) =>
            toast.error(
              t("Could not open link: {value0}", { value0: String(error) }),
            ),
          );
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
  const composeAddress = useCallback(
    (address: Address) => {
      if (clearingDraftsNow.current) return;
      const account = data.accounts.find((item) => item.enabled);
      if (!account) {
        setAccountDialog(true);
        return;
      }
      setDraft({ ...newDraft(account.id), to: formatAddress(address) });
    },
    [data.accounts],
  );
  const reeditSent = useCallback(
    (source: Detail) => {
      const account = data.accounts.find(
        (a) => a.id === source.mail.accountId && a.enabled,
      );
      if (!account) {
        toast.error(
          t(
            "The original sending account is disabled or removed. Enable it first.",
          ),
        );
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
          toast.error(
            t(
              "The original message snapshot is missing. Open the message again.",
            ),
          );
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
        if (action === "read" && isNonUnreadMail(mail)) return;
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
    setNotificationSelected(null);
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
      excludeSent: true,
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
      toast.success(t("Message updated"), {
        action: {
          label: t("Undo"),
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
      if (reset)
        toast.info(t("The message list changed. Latest results reloaded."));
    } catch (e) {
      if (ticket === pageTicket.current && currentQuery === queryRef.current)
        toast.error(
          t("Could not load more messages: {value0}", { value0: String(e) }),
        );
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
        toast.error(
          t("Could not load neighboring messages: {value0}", {
            value0: String(e),
          }),
        );
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
    setNotificationSelected(null);
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
      toast.info(t("Demo mode does not connect to real mailboxes"));
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
      toast.success(t("Mail checked. {value0} new messages.", { value0: n }));
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
      excludeSent: true,
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
  async function renameLocalFolder() {
    const current = renameFolder;
    const replacement = renameValue.trim();
    if (
      !current ||
      !replacement ||
      replacement.length > 120 ||
      replacement === current
    )
      return;
    setRenamingFolder(true);
    try {
      await call("rename_local_folder", { current, replacement });
      setRenameFolder("");
      if (query.folder === current)
        setQuery((value) => ({ ...value, folder: replacement }));
      await refresh();
      toast.success(t("Local folder renamed"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setRenamingFolder(false);
    }
  }
  async function deleteLocalFolder(folderName: string) {
    if (
      !(await askConfirmation({
        title: t("Delete local folder?"),
        description: t(
          "Permanently delete “{value0}” and every message in it from this app. Server mailbox copies are not deleted.",
          { value0: folderName },
        ),
        action: t("Delete folder"),
        destructive: true,
      }))
    )
      return;
    try {
      const deleted = await call<number>("delete_local_folder", {
        folder: folderName,
      });
      if (query.folder === folderName) navigate("local");
      await refresh();
      toast.success(
        t("Deleted folder and {value0} messages.", {
          value0: deleted,
        }),
      );
    } catch (error) {
      toast.error(String(error));
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
          title: t("Clear drafts?"),
          description: t(
            "Delete these {value0} local drafts permanently. Close any drafts being edited first.",
            { value0: expected.length },
          ),
          action: t("Clear drafts"),
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
      toast.success(t("Deleted {value0} drafts", { value0: result.deleted }));
      if (result.cleanupPending)
        toast.warning(
          t(
            "Drafts cleared; some temporary attachments will be cleaned up later",
          ),
        );
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
        t(
          "Queued {value0} messages for saving; {value1} already archived; {value2} need attention",
          {
            value0: result.queued,
            value1: result.alreadySaved,
            value2: result.blocked,
          },
        ),
        {
          action: {
            label: t("View tasks"),
            onClick: () => {
              setSettingsSection("tasks");
              setPage("settings");
            },
          },
        },
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setArchiving(false);
    }
  }
  async function exportMail(m: Mail) {
    if (!native || demo) {
      toast.info(t("Export original mail files in the desktop app"));
      return;
    }
    try {
      const extension = await call<string>("mail_original_format", {
        id: m.id,
      });
      if (!["eml", "emlx", "msg", "mbox"].includes(extension))
        throw new Error(t("Could not determine the original mail format."));
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `${m.subject.replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.${extension}`,
        filters: [{ name: t("Original message"), extensions: [extension] }],
      });
      if (path) {
        await call("export_mail", { id: m.id, path });
        toast.success(t("Full message exported"));
      }
    } catch (e) {
      toast.error(String(e));
    }
  }
  async function attachment(index: number, name: string, mail = detail?.mail) {
    if (!mail || !native || demo) {
      toast.info(t("Download real attachments in the desktop app"));
      return;
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name.replace(/[\\/]/g, "-") });
    if (path)
      try {
        await call("save_attachment", { id: mail.id, index, path });
        toast.success(t("Attachment saved"));
      } catch (e) {
        toast.error(String(e));
      }
  }
  async function backup(restore = false) {
    if (!native || demo) {
      toast.info(t("Back up real archives in the desktop app"));
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      directory: true,
      multiple: false,
      title: restore
        ? t("Select an Anser backup folder")
        : t("Choose a backup destination"),
    });
    if (path)
      try {
        const result = await call<string | number>(
          restore ? "restore_archive" : "backup_archive",
          { path },
        );
        toast.success(
          restore
            ? t("Restored {value0} messages", { value0: result })
            : t("Backup saved to {value0}", { value0: result }),
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
  function isNonUnreadMail(mail: Mail) {
    if (query.view === "sent") return true;
    const selectedFolder = query.remoteFolder
      ? remoteFolder(mail.accountId, query.remoteFolder)
      : undefined;
    const folder = remoteFolder(mail.accountId, mail.sourceFolder);
    return (
      !!selectedFolder?.roles?.some(
        (role) => role === "sent" || role === "drafts",
      ) ||
      !!folder?.roles?.some((role) => role === "sent" || role === "drafts") ||
      ((mail.sourceFolder === "Sent" || mail.sourceFolder === "Drafts") &&
        !folder)
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
        changed
          ? t("Marked {value0} messages as read", { value0: changed })
          : t("No unread messages"),
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
          ? t("Starred mail")
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
        theme={theme.mode}
        richColors
        closeButton
      />
      <div className="top-actions app-actions">
        <EmlViewer />
        <UpdateIndicator updates={updates} />
        {publicPreview && (
          <Badge variant="secondary">{t("Web preview · Fictional data")}</Badge>
        )}
        {demo && !publicPreview && (
          <Button variant="ghost" className="demo-badge" onClick={demoMode}>
            {t("Demo mode · Exit")}
          </Button>
        )}
        <span className="connection">
          <i className={syncing || syncText ? "pulse" : ""} />
          {syncText ||
            (demo
              ? t("Sample data")
              : syncing
                ? t("Checking mail")
                : data.accounts.length
                  ? t("Local first")
                  : t("No mailbox connected"))}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          title={
            theme.mode === "light"
              ? t("Light mode · Switch to dark mode")
              : theme.mode === "dark"
                ? t("Dark mode · Switch to follow system appearance")
                : t("Following system appearance · Switch to light mode")
          }
          aria-label={
            theme.mode === "light"
              ? t("Light mode · Switch to dark mode")
              : theme.mode === "dark"
                ? t("Dark mode · Switch to follow system appearance")
                : t("Following system appearance · Switch to light mode")
          }
          onClick={theme.cycleMode}
        >
          {theme.mode === "light" ? (
            <Sun size={16} />
          ) : theme.mode === "dark" ? (
            <Moon size={16} />
          ) : (
            <Monitor size={16} />
          )}
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
                  alt={t("Anser app icon")}
                />
                <div>
                  <strong>
                    {t("Anser")}
                    <span>{t("Mail, thoughtfully organized")}</span>
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
                {t("Compose")}
                <kbd>⌘ N</kbd>
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
                  <span>{t("Drafts")}</span>
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "outbox" ? "active" : ""}`}
                  onClick={() => setPage("outbox")}
                >
                  <History size={17} />
                  <span>{t("Send history")}</span>
                </Button>
              </nav>
              <div className="nav-section-heading">
                <span>{t("My accounts")}</span>
                <Button
                  variant="ghost"
                  title={t("Add email account")}
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
                              aria-label={t("Mail check failed for {value0}", {
                                value0: a.name,
                              })}
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
                          aria-label={t("Expand server folders for {value0}", {
                            value0: a.name,
                          })}
                          title={t("Server folders")}
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
                        <div
                          role="status"
                          aria-label={t("Loading server folders")}
                        >
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
                              {t("Could not load. Retry")}
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
                    {t("Connect your first mailbox")}
                  </Button>
                )}
              </div>
              <div className="nav-section-heading">
                <span>{t("Saved on this Mac")}</span>
                <HardDrive size={13} />
              </div>
              {nav("local", Archive, data.stats.saved)}
              {data.folders.map((f) => (
                <ContextMenu key={f}>
                  <ContextMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className={`nav-item folder-item ${query.folder === f && page === "mail" ? "active" : ""}`}
                      onClick={() => navigate("local", "", f)}
                    >
                      <Folder size={16} />
                      <span>{f}</span>
                    </Button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onSelect={() => {
                        setRenameFolder(f);
                        setRenameValue(f);
                      }}
                    >
                      <PenLine />
                      {t("Rename")}
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant="destructive"
                      onSelect={() => void deleteLocalFolder(f)}
                    >
                      <Trash2 />
                      {t("Delete folder")}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
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
                  <span>{t("Contacts")}</span>
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "rules" ? "active" : ""}`}
                  onClick={() => setPage("rules")}
                >
                  <SlidersHorizontal size={17} />
                  <span>{t("Mail rules")}</span>
                  {data.rules.length > 0 && <small>{data.rules.length}</small>}
                </Button>
                <Button
                  variant="ghost"
                  className={`nav-item ${page === "settings" ? "active" : ""}`}
                  onClick={() => setPage("settings")}
                >
                  <Settings size={17} />
                  <span>{t("Settings & accounts")}</span>
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
              onShowTasks={() => {
                setSettingsSection("tasks");
                setPage("settings");
              }}
            />
          ) : page === "settings" || page === "storage" ? (
            <section className="workspace-panel settings-workspace">
              <div className="panel-heading">
                <div>
                  <div className="page-title-row">
                    <SidebarTrigger
                      title={t("Toggle sidebar")}
                      aria-label={t("Toggle sidebar")}
                    />
                    <h1>{t("Settings & accounts")}</h1>
                  </div>
                  <p>{t("Manage accounts, local archives and preferences.")}</p>
                </div>
              </div>
              <Separator />
              <SettingsLayout
                value={settingsSection}
                onValueChange={setSettingsSection}
                accountCount={data.accounts.length}
                accounts={
                  <>
                    <div className="settings-section-heading">
                      <div>
                        <h2>{t("Email accounts")}</h2>
                        <p>
                          {t(
                            "Manage connected accounts and how their mail is fetched and saved.",
                          )}
                        </p>
                      </div>
                      <Button
                        disabled={publicPreview}
                        onClick={() => setAccountDialog(true)}
                      >
                        <Plus data-icon="inline-start" />
                        {t("Add account")}
                      </Button>
                    </div>
                    <div className="settings-accounts">
                      {data.accounts.map((a, i) => (
                        <Card className="settings-account-card" key={a.id}>
                          <span className={`account-avatar color-${i % 4}`}>
                            {a.name[0]}
                          </span>
                          <div className="settings-account-details">
                            <h3>
                              {a.name}
                              <Badge variant="secondary">
                                {a.protocol.toUpperCase()}
                              </Badge>
                            </h3>
                            <p>
                              {a.email}{" "}
                              <Badge variant="outline">
                                {t("Default: ")}
                                {a.saveLocally === false
                                  ? t("Read online")
                                  : t("Save locally")}
                              </Badge>
                            </p>
                            <small>
                              {a.error ||
                                (!a.enabled
                                  ? t("Account paused")
                                  : a.lastSync
                                    ? t("Last checked: {value0}", {
                                        value0: new Date(
                                          a.lastSync,
                                        ).toLocaleString(dateLocale()),
                                      })
                                    : t(
                                        "Connected. Waiting for the first mail check.",
                                      ))}
                            </small>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t("Account actions")}
                                aria-label={t("Actions for {value0}", {
                                  value0: a.name,
                                })}
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
                                  {t("Edit account settings")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setRetentionIntro(false);
                                    setRetentionAccount(a);
                                  }}
                                >
                                  {a.protocol === "imap"
                                    ? t("Folder retention scope")
                                    : t("Local storage settings")}
                                </DropdownMenuItem>
                                {a.protocol === "imap" && (
                                  <DropdownMenuItem
                                    onClick={() => setMappingAccount(a)}
                                  >
                                    {t("Special folders")}
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
                                  {a.enabled
                                    ? t("Pause mail checks")
                                    : t("Enable mail checks")}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={async () => {
                                    if (
                                      await askConfirmation({
                                        title: t("Remove account?"),
                                        description: t(
                                          "Removing {value0} stops mail checks. Full local archives remain; unarchived list entries are removed.",
                                          { value0: a.email },
                                        ),
                                        action: t("Remove account"),
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
                                  {t("Remove account, keep archives")}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </Card>
                      ))}
                    </div>
                    {!data.accounts.length && (
                      <div className="panel-empty">
                        <MailIcon size={36} />
                        <h3>{t("Start by connecting a mailbox")}</h3>
                        <p>
                          {t(
                            "Supports Gmail, Outlook, QQ, NetEase and custom servers.",
                          )}
                        </p>
                      </div>
                    )}
                  </>
                }
                archive={
                  <>
                    <div className="settings-section-heading">
                      <div>
                        <h2>{t("Local archive")}</h2>
                        <p>
                          {t(
                            "Review saved messages, manage locations and backups.",
                          )}
                        </p>
                      </div>
                    </div>
                    <Card className="storage-card">
                      <div className="storage-card-header">
                        <span>
                          <ShieldCheck size={25} />
                        </span>
                        <div>
                          <h3>
                            {t("Save complete copies, keep them independently")}
                          </h3>
                          <p>
                            {t(
                              "Accounts with local saving enabled retain full messages and attachments. Removing an account keeps existing archives.",
                            )}
                          </p>
                        </div>
                        <Badge variant="secondary">{t("Per account")}</Badge>
                      </div>
                      <div className="storage-metrics">
                        <div>
                          <strong>
                            {data.stats.saved}
                            <small>{t("messages (storage)")}</small>
                          </strong>
                          <span>{t("Full local archives")}</span>
                        </div>
                        <div>
                          <strong>{formatSize(data.stats.bytes)}</strong>
                          <span>{t("Original message size")}</span>
                        </div>
                        <ArchiveIntegrity />
                      </div>
                      <ArchiveLocation
                        initialPath={data.dataDir}
                        onChanged={() => void refresh()}
                      >
                        <Button variant="outline" onClick={() => void backup()}>
                          <ArrowDownToLine size={15} />
                          {t("Back up archives")}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void backup(true)}
                        >
                          <Archive size={15} />
                          {t("Restore backup")}
                        </Button>
                        <EmlImports
                          accounts={data.accounts}
                          folders={data.folders}
                          onChanged={refresh}
                          onView={(accountId, folder) =>
                            navigate("local", accountId, folder)
                          }
                        />
                        <DeleteArchiveDialog
                          onDeleted={() => {
                            setSelected("");
                            setDetail(null);
                            void refresh();
                          }}
                        />
                      </ArchiveLocation>
                    </Card>
                  </>
                }
                preferences={
                  <>
                    <div className="settings-section-heading">
                      <div>
                        <h2>{t("Preferences")}</h2>
                        <p>
                          {t(
                            "Configure display language, notifications, startup, background checks and network proxy.",
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="settings-preferences-grid">
                      <LanguageSettings />
                      <StorageTools testMailId={selected} />
                      <NetworkProxySettings />
                      <FileAssociations />
                    </div>
                  </>
                }
                composing={
                  <>
                    <div className="settings-section-heading">
                      <div>
                        <h2>{t("Reading & composing")}</h2>
                        <p>
                          {t(
                            "Configure email signatures and AI translation for reading and writing mail.",
                          )}
                        </p>
                      </div>
                    </div>
                    <MailSignatures accounts={data.accounts} />
                    <MailTranslationSettings />
                  </>
                }
                tasks={
                  <>
                    <div className="settings-section-heading">
                      <div>
                        <h2>{t("Background tasks")}</h2>
                        <p>
                          {t(
                            "Review saving and sync progress. Check recent activity for problems.",
                          )}
                        </p>
                      </div>
                    </div>
                    <ArchiveJobsPanel defaultCollapsed />
                    <EmlImports
                      taskPanel
                      accounts={data.accounts}
                      folders={data.folders}
                      onChanged={refresh}
                      onView={(accountId, folder) =>
                        navigate("local", accountId, folder)
                      }
                    />
                    <div className="flex flex-col gap-6">
                      <ServerOperations defaultCollapsed />
                      <FolderHealthPanel defaultCollapsed />
                      <DirectoryOperationsPanel defaultCollapsed />
                    </div>
                    <Collapsible asChild>
                      <Card>
                        <TaskPanelHeader
                          title={t("Recent activity")}
                          description={t(
                            "Recent mail checks, sends, rule actions and model translations.",
                          )}
                          onRefresh={refresh}
                        />
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
                                {t(
                                  "Mail checks, sends, rule actions and model translations appear here.",
                                )}
                              </p>
                            )}
                          </CardContent>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                  </>
                }
                about={
                  <>
                    <div className="settings-section-heading">
                      <div>
                        <h2>{t("About Anser")}</h2>
                        <p>{t("Version, updates and background operation.")}</p>
                      </div>
                    </div>
                    <UpdateSettings updates={updates} />
                    <div className="info-strip">
                      <Info size={17} />
                      <span>
                        {t(
                          "Mail checks continue after closing the window. Quitting, sleep or loss of connectivity pauses them. Download complete messages before the server deletes them.",
                        )}
                      </span>
                    </div>
                    {import.meta.env.DEV && (
                      <Button
                        variant="ghost"
                        className="text-link self-start"
                        onClick={demoMode}
                      >
                        {demo ? t("Exit demo") : t("Try sample mailbox")}
                        <ArrowRight data-icon="inline-end" />
                      </Button>
                    )}
                  </>
                }
              />
            </section>
          ) : page === "drafts" ? (
            <section className="workspace-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">TAKE YOUR TIME</span>
                  <div className="page-title-row">
                    <SidebarTrigger
                      title={t("Toggle sidebar")}
                      aria-label={t("Toggle sidebar")}
                    />
                    <h1>{t("Drafts")}</h1>
                  </div>
                  <p>{t("Drafts are saved locally. Continue anytime.")}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!drafts.length || clearingDrafts || !!draft}
                    onClick={() => void clearDrafts()}
                  >
                    <Trash2 data-icon="inline-start" />
                    {clearingDrafts ? t("Clearing…") : t("Clear drafts")}
                  </Button>
                  <Button disabled={clearingDrafts} onClick={() => compose()}>
                    <SquarePen data-icon="inline-start" />
                    {t("Compose")}
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
                      <h3>{d.subject || t("(No subject)")}</h3>
                      <p>
                        {t("To: ")}
                        {d.to || t("Not entered")}
                      </p>
                      <small>{d.body.slice(0, 120) || t("Empty draft")}</small>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title={t("Delete draft")}
                      disabled={clearingDrafts}
                      onClick={async () => {
                        if (clearingDraftsNow.current) return;
                        if (
                          await askConfirmation({
                            title: t("Delete draft?"),
                            description: t(
                              "This draft cannot be recovered after deletion.",
                            ),
                            action: t("Delete draft"),
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
                  <h3>{t("No drafts yet")}</h3>
                  <p>{t("Your unfinished messages will wait for you here.")}</p>
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
                        title={t("Toggle sidebar")}
                        aria-label={t("Toggle sidebar")}
                      />
                      <h1>{title}</h1>
                      <span>
                        {data.matched}{" "}
                        {grouped ? t("conversations") : t("messages")}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={syncing || !data.accounts.length}
                      title={t("Check mail")}
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
                        <AlertTitle>
                          {t("Folder source quarantined")}
                        </AlertTitle>
                        <AlertDescription>
                          {t(
                            "The server returned inconsistent responses for this folder. Old sources are suspended; local archives remain available in Local archive. Review the account in Settings & accounts.",
                          )}
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
                        placeholder={t("Search mail in this scope…")}
                        aria-label={t("Search mail")}
                      />
                      {search ? (
                        <Button
                          variant="ghost"
                          onClick={() => setSearch("")}
                          title={t("Clear search")}
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
                              aria-label={t("Body search coverage")}
                            >
                              <Info data-icon="inline-start" />
                              {t("Body coverage")}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-72">
                            <p>
                              {t(
                                "Only locally available bodies are searched; no messages are downloaded. Complete in this scope: ",
                              )}{" "}
                              {data.bodyCoverage.known}
                              {t(" messages; incomplete: ")}{" "}
                              {data.bodyCoverage.unknown}{" "}
                              {t(
                                " messages. Save complete messages to include their bodies in search.",
                              )}
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
                        <TabsTrigger value="all">{t("All")}</TabsTrigger>
                        <TabsTrigger value="unread">{t("Unread")}</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t("Message display mode")}
                        >
                          {grouped ? (
                            <MessagesSquare data-icon="inline-start" />
                          ) : (
                            <List data-icon="inline-start" />
                          )}
                          {grouped
                            ? t("Conversations")
                            : t("Individual messages")}
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
                            {t("Group by conversation")}
                          </DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="messages">
                            {t("Individual messages")}
                          </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {checked.length > 0 && (
                    <div className="batch-toolbar">
                      <span>
                        {t("Selected ")}
                        {checked.length}{" "}
                        {grouped ? t("conversations") : t("messages")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t("Save complete message locally")}
                        disabled={archiving}
                        onClick={() => void queueArchives(checked, grouped)}
                      >
                        <HardDriveDownload />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t("Mark as read")}
                        onClick={() =>
                          void mutate(checked, "read", "true", grouped)
                        }
                      >
                        <CheckCheck size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t("Move to local folder")}
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
                        title={t("Move to local trash")}
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
                              className={`mail-row ${selected === m.id || (grouped && !!m.conversationId && m.conversationId === detail?.mail.conversationId) ? "selected" : ""} ${!m.isRead && !isNonUnreadMail(m) ? "unread" : ""}`}
                            >
                              <div className="row-check">
                                <Checkbox
                                  aria-label={t("Select {value0}", {
                                    value0: m.subject,
                                  })}
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
                                  <time dateTime={m.date}>
                                    {formatMailTime(m.date)}
                                  </time>
                                </div>
                                <div className="row-subject">
                                  {!m.isRead && !isNonUnreadMail(m) && (
                                    <i
                                      aria-label={t("Unread")}
                                      title={t("Unread")}
                                    />
                                  )}
                                  <span className="row-subject-text">
                                    {m.subject}
                                  </span>
                                  {grouped &&
                                    (m.conversationCount || 0) > 1 && (
                                      <Badge
                                        variant="outline"
                                        className="conversation-count"
                                        aria-label={t(
                                          "{value0} messages in this conversation",
                                          { value0: m.conversationCount },
                                        )}
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
                                    title={t("Account color indicator")}
                                  />
                                  <span>
                                    {data.accounts.find(
                                      (a) => a.id === m.accountId,
                                    )?.name || t("Removed account")}
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
                                      aria-label={t("Has attachments")}
                                    />
                                  )}
                                </div>
                              </Button>
                            </div>
                          </ContextMenuTrigger>
                          {!isNonUnreadMail(m) && (
                            <ContextMenuContent>
                              <ContextMenuItem
                                onSelect={() =>
                                  void mutate([m.id], "read", String(!m.isRead))
                                }
                              >
                                <MailOpen />
                                {m.isRead
                                  ? t("Mark as unread")
                                  : t("Mark as read")}
                              </ContextMenuItem>
                            </ContextMenuContent>
                          )}
                        </ContextMenu>
                      ))
                    ) : (
                      <div className="list-empty">
                        <Inbox size={30} />
                        <h3>
                          {search
                            ? t("No messages found")
                            : data.accounts.length
                              ? t("All quiet here")
                              : t("Your inbox is ready")}
                        </h3>
                        <p>
                          {search
                            ? t("Try different keywords.")
                            : data.accounts.length
                              ? t("Click refresh above to check for new mail.")
                              : t(
                                  "Messages will appear here after you connect a mailbox.",
                                )}
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
                          ? t("Loading…")
                          : t("Load more ({value0} / {value1})", {
                              value0: data.messages.length,
                              value1: data.matched,
                            })}
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
                            {(() => {
                              const address = parseAddresses(
                                detail.mail.sender,
                              )[0];
                              return address ? (
                                <ContactAddress
                                  address={address}
                                  className="contact-address-start"
                                  text={address.email}
                                  onComposeAddress={composeAddress}
                                  onAddContact={saveContactAddress}
                                />
                              ) : (
                                <span>{senderAddress(detail.mail.sender)}</span>
                              );
                            })()}
                            {detail.mail.senderOnBehalfOf && (
                              <span
                                className="sender-on-behalf-of"
                                title={detail.mail.senderOnBehalfOf}
                              >
                                {t("Sent on behalf of {value0}", {
                                  value0: detail.mail.senderOnBehalfOf,
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
                                  ? t("Finding neighboring messages…")
                                  : t("Previous message (⌥↑)")}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={t("Next message")}
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
                                  ? t("Finding neighboring messages…")
                                  : t("Next message (⌥↓)")}
                              </TooltipContent>
                              {navigationLoading && (
                                <span className="sr-only" role="status">
                                  {t("Finding neighboring messages…")}
                                </span>
                              )}
                            </Tooltip>
                            <span className="toolbar-divider" />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t("Move to local folder")}
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
                              title={t("Export complete original message")}
                              onClick={() => void exportMail(detail.mail)}
                            >
                              <ArrowDownToLine size={17} />
                            </Button>
                            <span className="toolbar-divider" />
                            {!isNonUnreadMail(detail.mail) && (
                              <MailActionTooltip
                                action="read"
                                label={
                                  detail.mail.isRead
                                    ? t("Mark unread")
                                    : t("Mark read")
                                }
                              >
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  title={
                                    detail.mail.isRead
                                      ? t("Mark unread")
                                      : t("Mark read")
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
                            )}
                            <MailActionTooltip action="star" label={t("Star")}>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                title={t("Star")}
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
                              title={t("Print this message")}
                              aria-label={t("Print this message")}
                              onClick={() =>
                                void printMail(detail).catch((error) =>
                                  toast.error(
                                    t("Printing failed: {value0}", {
                                      value0: String(error),
                                    }),
                                  ),
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
                                  ? t("Restore local message")
                                  : t("Move to local trash")
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
                            <MailActionTooltip
                              action="reply"
                              label={t("Reply")}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t("Reply")}
                                title={t("Reply")}
                                aria-keyshortcuts="Meta+R Control+R"
                                onClick={() => compose(detail.mail)}
                              >
                                <Reply size={15} />
                                <span className="action-label">
                                  {t("Reply")}
                                </span>
                              </Button>
                            </MailActionTooltip>
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
                                <DropdownMenuGroup>
                                  <DropdownMenuItem
                                    aria-keyshortcuts="Meta+Shift+R Control+Shift+R"
                                    onClick={() =>
                                      compose(detail.mail, false, true)
                                    }
                                  >
                                    <ReplyAll size={15} />
                                    {t("Reply all")}
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
                                        toast.error(
                                          t(
                                            "Could not identify the sender's email address",
                                          ),
                                        );
                                        return;
                                      }
                                      setContactSeed(address);
                                      setPage("contacts");
                                    }}
                                  >
                                    <UsersRound size={15} />
                                    {t("Add sender to contacts")}
                                  </DropdownMenuItem>
                                </DropdownMenuGroup>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <MailActionTooltip
                              action="forward"
                              label={t("Forward")}
                            >
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={t("Forward")}
                                title={t("Forward")}
                                aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
                                onClick={() => compose(detail.mail, true)}
                              >
                                <ArrowRight size={15} />
                                <span className="action-label">
                                  {t("Forward")}
                                </span>
                              </Button>
                            </MailActionTooltip>
                            {query.view === "sent" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => reeditSent(detail)}
                              >
                                <SquarePen size={15} />
                                {t("Edit as new")}
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
                              readerExpanded
                                ? t("Restore reading pane")
                                : t("Expand reading pane")
                            }
                            title={
                              readerExpanded
                                ? t("Restore reading pane (Esc)")
                                : t("Expand reading pane")
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
                        <MailRecipients
                          to={displayAddresses(
                            detail.to,
                            detail.mail.recipients,
                          )}
                          cc={displayAddresses(detail.cc, detail.mail.cc)}
                          bcc={displayAddresses(detail.bcc)}
                          onComposeAddress={composeAddress}
                          onAddContact={saveContactAddress}
                        />
                        <div className="message-metadata">
                          <time dateTime={detail.mail.date}>
                            {formatMailTime(detail.mail.date)}
                          </time>
                          <span className="saved-chip">
                            <ShieldCheck size={13} />
                            {demo
                              ? t("Demo archive")
                              : detail.mail.savedLocally === false
                                ? t("Server message")
                                : t("Fully saved")}
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
                              {t("Save complete message locally")}
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
                      key={`${selected}:${query.listMode}:${notificationSelected?.click ?? "list"}`}
                      selected={detail}
                      singleMessage={
                        !grouped || notificationSelected?.id === selected
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
                      onComposeAddress={composeAddress}
                      onAddContact={saveContactAddress}
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
                        <span>{t("Could not load message")}</span>
                        <p>{detailError.message}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDetailRetry((value) => value + 1)}
                        >
                          {t("Reload")}
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
                        alt={t("Anser")}
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
                        ? t("Make room for what matters")
                        : t("Mail, thoughtfully organized.")}
                    </h1>
                    <p>
                      {data.accounts.length
                        ? t(
                            "Select a message to start reading.\nYour conversations, carefully kept.",
                          )
                        : t(
                            "Bring your mailboxes together.\nGive every important message a lasting home.",
                          )}
                    </p>
                    {!data.accounts.length && (
                      <div className="welcome-actions">
                        <Button onClick={() => setAccountDialog(true)}>
                          <Plus size={16} />
                          {t("Connect my mailbox")}
                        </Button>
                        <Button variant="ghost" onClick={demoMode}>
                          {t("Try it first")}
                          <ArrowRight size={15} />
                        </Button>
                      </div>
                    )}
                    <div className="welcome-features">
                      <span>
                        <Inbox size={17} />
                        {t("Multiple accounts")}
                      </span>
                      <span>
                        <SlidersHorizontal size={17} />
                        {t("Automatic filing")}
                      </span>
                      <span>
                        <ShieldCheck size={17} />
                        {t("Save locally")}
                      </span>
                    </div>
                    {!native && (
                      <small className="browser-note">
                        {t(
                          "Browser preview · Use the macOS desktop app for real mail",
                        )}
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
        themeMode={theme.mode}
        onToggleTheme={theme.cycleMode}
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
            <DialogTitle>{t("Move to local folder")}</DialogTitle>
            <DialogDescription>
              {t("Organize ")}
              {moveIds.length}
              {t(" local messages. Server originals remain unchanged.")}
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
            {t("Confirm filing")}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!renameFolder}
        onOpenChange={(open) => {
          if (!open) setRenameFolder("");
        }}
      >
        <DialogContent className="sm:max-w-[430px]">
          <DialogHeader>
            <DialogTitle>{t("Rename local folder")}</DialogTitle>
            <DialogDescription>
              {t("Message originals and flags remain unchanged.")}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            aria-label={t("Local folder name")}
            value={renameValue}
            maxLength={120}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void renameLocalFolder();
              }
            }}
          />
          {renameValue.trim() &&
            renameValue.trim() !== renameFolder &&
            data.folders.includes(renameValue.trim()) && (
              <p role="alert" className="folder-name-error">
                {t("A local folder with this name already exists")}
              </p>
            )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRenameFolder("")}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={
                renamingFolder ||
                !renameValue.trim() ||
                renameValue.trim().length > 120 ||
                renameValue.trim() === renameFolder ||
                data.folders.includes(renameValue.trim())
              }
              onClick={() => void renameLocalFolder()}
            >
              {renamingFolder ? t("Renaming…") : t("Rename")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
      <UpdateDialog updates={updates} blocked={!!draft} />
    </SidebarProvider>
  );
}
