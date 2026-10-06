import { useConfirmation } from "./hooks/use-confirmation";
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
import { FolderHealthPanel } from "./components/folder-health";
import { Alert, AlertTitle, AlertDescription } from "./components/ui/alert";
import { ServerOperations } from "./components/server-operations";
import { DirectoryOperationsPanel } from "./components/server-copy";
import { ServerDirectoryMenu } from "./components/server-directory-menu";
import { FolderMappingDialog } from "./components/folder-mapping-dialog";
import { RemoteFolderList } from "./components/remote-folder-list";
import { remoteFolderLabel } from "./lib/remote-folders";
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
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Cloud,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Inbox,
  Info,
  Mail as MailIcon,
  MailOpen,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Paperclip,
  Plus,
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
import { Card } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Checkbox } from "./components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { ContactsPanel } from "./components/contacts-panel";
import { OutboxPanel } from "./components/outbox-panel";
import { StorageTools } from "./components/storage-tools";
import { DeleteArchiveDialog } from "./components/delete-archive-dialog";
import {
  replyRecipients,
  parseAddresses,
  formatAddress,
} from "./lib/addresses";
import {
  snapshot,
  call,
  initialSnapshot,
  native,
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
  Snapshot,
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
export default function App() {
  const updates = useAppUpdate();
  const { askConfirmation, confirmationDialog } = useConfirmation();
  useEffect(() => disableNativeContextMenu(document), []);
  const [data, setData] = useState<Snapshot>(initialSnapshot),
    [query, setQuery] = useState<Query>({
      view: "all",
      accountId: "",
      search: "",
      folder: "",
      limit: 200,
      unreadOnly: false,
    }),
    [expandedAccounts, setExpandedAccounts] = useState<string[]>([]),
    [folderLoading, setFolderLoading] = useState<string[]>([]),
    [folderErrors, setFolderErrors] = useState<Record<string, string>>({}),
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
    [contactSeed, setContactSeed] = useState<Address | null>(null),
    [draft, setDraft] = useState<Compose | null>(null),
    [drafts, setDrafts] = useState<Compose[]>([]),
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
    queryRef = useRef(query),
    readerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef(selected);
  const readingNeighbors = useRef<{
    scope: string;
    previous: string[];
    next: string[];
  } | null>(null);
  selectionRef.current = selected;
  const localChanges = useRef(new Map<string, Partial<Mail>>());
  queryRef.current = query;
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
  const [refresh] = useState(() =>
    coalesceRefresh(async () => {
      const seq = ++request.current;
      const currentQuery = queryRef.current;
      try {
        const value = await snapshot(currentQuery);
        if (seq === request.current && currentQuery === queryRef.current)
          setData(value);
        const reading = selectionRef.current;
        if (reading) {
          const metadata = await call<Mail>("mail_metadata", {
            id: reading,
          }).catch(() => null);
          if (
            metadata &&
            selectionRef.current === reading &&
            seq === request.current
          )
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
      } catch (e) {
        toast.error(String(e));
      } finally {
        if (seq === request.current && currentQuery === queryRef.current)
          setLoading(false);
      }
    }),
  );
  useEffect(() => {
    void refresh();
  }, [query, refresh]);
  useEffect(() => {
    const timer = setTimeout(
      () => setQuery((q) => ({ ...q, search, limit: 200 })),
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
          if (live)
            setDetail({
              ...d,
              mail: { ...d.mail, ...localChanges.current.get(d.mail.id) },
            });
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
      }
      setDraft(d);
    },
    [data.accounts, detail],
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        ["ArrowUp", "ArrowDown"].includes(e.key)
      ) {
        const target = e.target instanceof Element ? e.target : null;
        if (
          page !== "mail" ||
          draft ||
          !selected ||
          target?.closest(
            'input, textarea, [contenteditable="true"], [role="combobox"]',
          ) ||
          document.querySelector(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
          )
        )
          return;
        const mail = neighboringMail(e.key === "ArrowUp" ? "previous" : "next");
        if (mail) {
          e.preventDefault();
          void openMail(mail);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        compose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [compose, page, draft, selected, data.messages, detail, query]);
  function navigate(
    view: string,
    accountId = "",
    folder = "",
    remoteFolder = "",
  ) {
    setPage("mail");
    setSearch("");
    setSelected("");
    setChecked([]);
    setQuery({
      view,
      accountId,
      folder,
      remoteFolder,
      search: "",
      limit: 200,
      unreadOnly: false,
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
    return JSON.stringify({ ...query, limit: 0 });
  }
  function neighboringMail(direction: "previous" | "next") {
    const conversationId =
      detail?.mail.id === selected ? detail.mail.conversationId : undefined;
    const index = data.messages.findIndex(
      (m) =>
        m.id === selected ||
        (!!m.conversationId && m.conversationId === conversationId),
    );
    if (index >= 0)
      return data.messages[index + (direction === "previous" ? -1 : 1)];
    const anchor = readingNeighbors.current;
    if (anchor?.scope !== readingScope()) return undefined;
    const byId = new Map(data.messages.map((m) => [m.id, m]));
    const id = anchor[direction].find((id) => byId.has(id));
    return id ? byId.get(id) : undefined;
  }
  async function openMail(m: Mail) {
    const index = data.messages.findIndex(
      (item) =>
        item.id === m.id ||
        (!!m.conversationId && item.conversationId === m.conversationId),
    );
    if (index >= 0)
      readingNeighbors.current = {
        scope: readingScope(),
        previous: data.messages
          .slice(0, index)
          .reverse()
          .map((item) => item.id),
        next: data.messages.slice(index + 1).map((item) => item.id),
      };
    setSelected(m.id);
    try {
      const conversation = await call<Mail[]>("mail_conversation", {
        id: m.id,
      });
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
      const n =
        query.remoteFolder && query.accountId
          ? await call<number>("sync_remote_folder", {
              id: query.accountId,
              folder: query.remoteFolder,
            })
          : await call<number>("sync_mail");
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
    });
    setSearch("");
    void refresh();
  }
  async function showDrafts() {
    setPage("drafts");
    try {
      setDrafts(await call<Compose[]>("list_drafts"));
    } catch (e) {
      toast.error(String(e));
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
      setServerFolders((all) => [
        ...all.filter((f) => f.accountId !== id),
        ...folders,
      ]);
    } catch (e) {
      setFolderErrors((errors) => ({ ...errors, [id]: String(e) }));
    } finally {
      setFolderLoading((ids) => ids.filter((value) => value !== id));
    }
  }
  async function openRemoteFolder(accountId: string, folder: string) {
    navigate("remote", accountId, "", folder);
    if (
      demo ||
      serverFolders.find(
        (item) => item.accountId === accountId && item.name === folder,
      )?.syncError
    )
      return;
    try {
      await call("sync_remote_folder", { id: accountId, folder });
      await refresh();
    } catch (e) {
      toast.error(String(e));
    }
  }
  const activeAccount = data.accounts.find((a) => a.id === query.accountId),
    title = query.remoteFolder
      ? (() => {
          const folder = serverFolders.find(
            (f) =>
              f.accountId === query.accountId && f.name === query.remoteFolder,
          );
          return folder ? remoteFolderLabel(folder) : query.remoteFolder;
        })()
      : query.folder || activeAccount?.name || viewNames[query.view];
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
        <UpdateIndicator updates={updates} />
        {demo && (
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
                <img src="/app-icon.png" alt="雁信应用图标" />
                <div>
                  <strong>
                    雁信<span>邮件，自在有序</span>
                  </strong>
                </div>
                <Badge variant="outline" className="brand-version">
                  α
                </Badge>
              </div>
              <Button className="compose-button" onClick={() => compose()}>
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
                      {a.error && (
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
                            <p>{a.error}</p>
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
                      {folderLoading.includes(a.id) && (
                        <div role="status" aria-label="正在加载服务器文件夹">
                          <Skeleton className="h-6 mb-2" />
                          <Skeleton className="h-6" />
                        </div>
                      )}
                      {folderErrors[a.id] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void loadFolders(a.id)}
                        >
                          加载失败，重试
                        </Button>
                      )}
                      <RemoteFolderList
                        folders={serverFolders.filter(
                          (f) => f.accountId === a.id,
                        )}
                        selected={
                          query.accountId === a.id
                            ? query.remoteFolder || ""
                            : ""
                        }
                        onSelect={(name) => void openRemoteFolder(a.id, name)}
                      />
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
            <RulesPanel data={data} onChange={() => void refresh()} />
          ) : page === "settings" || page === "storage" ? (
            <section className="workspace-panel">
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
                  <Button onClick={() => setAccountDialog(true)}>
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
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingAccount(a);
                                setAccountDialog(true);
                              }}
                            >
                              编辑账号配置
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
                </div>
                <div className="storage-actions">
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
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void call("open_data_folder").catch((e) =>
                        toast.error(String(e)),
                      )
                    }
                  >
                    <FolderOpen size={15} />
                    打开存储位置
                  </Button>
                </div>
                <p className="storage-path">{data.dataDir}</p>
              </Card>
              <StorageTools />
              {page === "settings" && <UpdateSettings updates={updates} />}
              <div className="flex flex-col gap-6">
                <ServerOperations />
                <FolderHealthPanel />
                <DirectoryOperationsPanel />
              </div>
              <div className="info-strip">
                <Info size={17} />
                <span>
                  关闭窗口后继续收取；退出
                  App、睡眠或断网时暂停。邮件须在服务器删除前完整下载。
                </span>
              </div>
              <div className="section-title">
                <h3>最近活动</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void refresh()}
                >
                  <RefreshCw size={14} />
                  刷新
                </Button>
              </div>
              <div className="activity-list">
                {data.logs.length ? (
                  data.logs.map((l, i) => (
                    <p key={i}>
                      <Check size={13} />
                      {l}
                    </p>
                  ))
                ) : (
                  <p>连接邮箱后，这里会显示收取和规则执行记录。</p>
                )}
              </div>
              <div className="dev-note">
                <span>雁信 0.1.0 · 开发预览</span>
                <Button
                  variant="ghost"
                  className="text-link"
                  onClick={demoMode}
                >
                  {demo ? "退出演示" : "体验示例邮箱"}
                  <ArrowRight size={14} />
                </Button>
              </div>
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
                <Button onClick={() => compose()}>
                  <SquarePen size={16} />
                  写邮件
                </Button>
              </div>
              {drafts.length ? (
                drafts.map((d) => (
                  <article className="draft-card" key={d.id}>
                    <Button variant="ghost" onClick={() => setDraft(d)}>
                      <h3>{d.subject || "（无主题）"}</h3>
                      <p>收件人：{d.to || "尚未填写"}</p>
                      <small>{d.body.slice(0, 120) || "空白草稿"}</small>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="删除草稿"
                      onClick={async () => {
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
                      <span>{data.matched} 个对话</span>
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
                  {serverFolders.find(
                    (f) =>
                      f.accountId === query.accountId &&
                      f.name === query.remoteFolder,
                  )?.syncError && (
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant={
                            query.starredOnly ||
                            query.attachmentsOnly ||
                            query.searchField
                              ? "secondary"
                              : "ghost"
                          }
                          size="icon-lg"
                          aria-label="筛选邮件"
                          title={
                            query.starredOnly ||
                            query.attachmentsOnly ||
                            query.searchField
                              ? "筛选邮件（已启用）"
                              : "筛选邮件"
                          }
                        >
                          <SlidersHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>邮件筛选</DropdownMenuLabel>
                        <DropdownMenuCheckboxItem
                          checked={!!query.starredOnly}
                          onCheckedChange={(checked) =>
                            setQuery((q) => ({
                              ...q,
                              starredOnly: checked,
                              limit: 200,
                            }))
                          }
                        >
                          <Star size={14} />
                          星标邮件
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={!!query.attachmentsOnly}
                          onCheckedChange={(checked) =>
                            setQuery((q) => ({
                              ...q,
                              attachmentsOnly: checked,
                              limit: 200,
                            }))
                          }
                        >
                          <Paperclip size={14} />
                          有附件
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>搜索字段</DropdownMenuLabel>
                        <DropdownMenuRadioGroup
                          value={query.searchField || ""}
                          onValueChange={(value) =>
                            setQuery((q) => ({
                              ...q,
                              searchField: value,
                              limit: 200,
                            }))
                          }
                        >
                          {[
                            ["", "全部字段"],
                            ["subject", "主题"],
                            ["sender", "发件人"],
                            ["recipients", "收件人"],
                            ["body", "正文"],
                          ].map(([value, label]) => (
                            <DropdownMenuRadioItem value={value} key={value}>
                              {label}
                            </DropdownMenuRadioItem>
                          ))}
                        </DropdownMenuRadioGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
                  </div>
                  {checked.length > 0 && (
                    <div className="batch-toolbar">
                      <span>已选 {checked.length} 个对话</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="标记为已读"
                        onClick={() =>
                          void mutate(checked, "read", "true", true)
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
                          setMoveThreads(true);
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
                            true,
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
                        <div
                          key={m.id}
                          className={`mail-row ${selected === m.id || (!!m.conversationId && m.conversationId === detail?.mail.conversationId) ? "selected" : ""} ${!m.isRead ? "unread" : ""}`}
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
                              <time>{time(m.date)}</time>
                            </div>
                            <div className="row-subject">
                              {!m.isRead && <i />}
                              {m.subject}
                              {(m.conversationCount || 0) > 1 && (
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
                              />
                              <span>
                                {data.accounts.find((a) => a.id === m.accountId)
                                  ?.name || "已移除账号"}
                              </span>
                              {m.localFolder !== "全部存档" && (
                                <small>{m.localFolder}</small>
                              )}
                              {m.hasAttachments && <Paperclip size={12} />}
                              <span className="row-spacer" />
                              {m.starred && (
                                <Star size={13} className="star-on" />
                              )}
                            </div>
                          </Button>
                        </div>
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
                    {data.matched > data.messages.length && (
                      <Button
                        variant="ghost"
                        className="load-more"
                        onClick={() =>
                          setQuery((q) => ({
                            ...q,
                            limit: Math.min(q.limit + 200, 5000),
                          }))
                        }
                        disabled={query.limit >= 5000}
                      >
                        加载更多（{data.messages.length} / {data.matched}）
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
                                  disabled={!neighboringMail("previous")}
                                  onClick={() => {
                                    const mail = neighboringMail("previous");
                                    if (mail) void openMail(mail);
                                  }}
                                >
                                  <ArrowLeft size={17} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>上一封邮件（⌥↑）</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="下一封邮件"
                                  disabled={!neighboringMail("next")}
                                  onClick={() => {
                                    const mail = neighboringMail("next");
                                    if (mail) void openMail(mail);
                                  }}
                                >
                                  <ArrowRight size={17} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>下一封邮件（⌥↓）</TooltipContent>
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
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={
                                detail.mail.isRead ? "标记未读" : "标记已读"
                              }
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
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="星标"
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
                                className={detail.mail.starred ? "star-on" : ""}
                              />
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
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="回复"
                              title="回复"
                              onClick={() => compose(detail.mail)}
                            >
                              <Reply size={15} />
                              <span className="action-label">回复</span>
                            </Button>
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
                                <DropdownMenuItem
                                  onClick={() =>
                                    compose(detail.mail, false, true)
                                  }
                                >
                                  <ReplyAll size={15} />
                                  全部回复
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
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label="转发"
                              title="转发"
                              onClick={() => compose(detail.mail, true)}
                            >
                              <ArrowRight size={15} />
                              <span className="action-label">转发</span>
                            </Button>
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
                        </div>
                      </div>
                      <h1>{detail.mail.subject}</h1>
                    </div>
                    <ConversationReader
                      key={selected}
                      selected={detail}
                      revision={data.messages}
                      accounts={data.accounts}
                      demo={demo}
                      scrollRef={readerRef}
                      editorOpen={!!draft}
                      onReply={(source, forward = false, all = false) =>
                        compose(source.mail, forward, all, source)
                      }
                      onEdit={setDraft}
                      onSent={() => void refresh()}
                      onExport={(mail) => void exportMail(mail)}
                      onAttachment={(mail, index, name) =>
                        attachment(index, name, mail)
                      }
                      onAction={(mail, action, value) =>
                        void mutate([mail.id], action, value, false, [mail])
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
                      <img src="/app-icon.png" alt="雁信" />
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
      <AccountDialog
        open={accountDialog}
        editing={editingAccount}
        onOpenChange={(open) => {
          setAccountDialog(open);
          if (!open) setEditingAccount(null);
        }}
        onDone={() => {
          void refresh();
          void sync();
        }}
      />
      <ComposeDialog
        draft={draft}
        onClose={() => setDraft(null)}
        accounts={data.accounts}
        onSent={() => void refresh()}
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
