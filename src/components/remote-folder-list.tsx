import { t, useLanguage } from "@/lib/i18n";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Archive,
  AlertCircle,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  MailWarning,
  Mail,
  Send,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  remoteFolderTree,
  localizedFolderLabel,
  sidebarFolderError,
  type FolderNode,
} from "../lib/remote-folders";
import type { RemoteFolder } from "../lib/types";

export function RemoteFolderList({
  folders,
  selected,
  selectedTree = false,
  starredSelected = false,
  unread = {},
  starredUnread = 0,
  onSelect,
  onSelectStarred,
  onMarkRead,
}: {
  folders: RemoteFolder[];
  selected: string;
  selectedTree?: boolean;
  starredSelected?: boolean;
  unread?: Record<string, { direct: number; tree: number }>;
  starredUnread?: number;
  onSelect: (name: string, tree: boolean, delimiter: string) => void;
  onSelectStarred?: () => void;
  onMarkRead?: (
    name: string,
    tree: boolean,
    delimiter: string,
    starred: boolean,
  ) => void;
}) {
  const language = useLanguage();
  const tree = useMemo(() => remoteFolderTree(folders), [folders, language]);
  const hasFlagged = folders.some((folder) =>
    folder.roles?.includes("flagged"),
  );
  const starred = !hasFlagged && onSelectStarred && (
    <div className="remote-folder-row" key="virtual-starred">
      <span className="folder-toggle-space" />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`nav-item folder-item ${starredSelected ? "active" : ""}`}
            onClick={onSelectStarred}
          >
            <Star data-icon="inline-start" />
            <span>{t("Starred mail")}</span>
            {starredUnread > 0 && (
              <em
                aria-label={t("{value0} unread messages", {
                  value0: starredUnread,
                })}
              >
                {starredUnread}
              </em>
            )}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onMarkRead?.("", false, "", true)}>
            {t("Mark as read")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
  const hasInbox = tree.some((node) => node.folder?.roles?.includes("inbox"));
  return (
    <div className="remote-folder-tree">
      {!hasInbox && starred}
      {tree.map((node) => (
        <Fragment key={node.key}>
          <FolderBranch
            node={node}
            selected={selected}
            selectedTree={selectedTree}
            unread={unread}
            starredSelected={starredSelected}
            starredUnread={starredUnread}
            onSelect={onSelect}
            onSelectStarred={onSelectStarred}
            onMarkRead={onMarkRead}
          />
          {node.folder?.roles?.includes("inbox") && starred}
        </Fragment>
      ))}
    </div>
  );
}

function FolderBranch({
  node,
  selected,
  selectedTree,
  unread,
  starredSelected,
  starredUnread,
  onSelect,
  onSelectStarred,
  onMarkRead,
}: {
  node: FolderNode;
  selected: string;
  selectedTree: boolean;
  unread: Record<string, { direct: number; tree: number }>;
  starredSelected: boolean;
  starredUnread: number;
  onSelect: (name: string, tree: boolean, delimiter: string) => void;
  onSelectStarred?: () => void;
  onMarkRead?: (
    name: string,
    tree: boolean,
    delimiter: string,
    starred: boolean,
  ) => void;
}) {
  const containsSelected = (node: FolderNode): boolean =>
    node.path === selected || node.children.some(containsSelected);
  const hasChildren = node.children.length > 0;
  const flagged = !!node.folder?.roles?.includes("flagged");
  const activePath = containsSelected(node);
  const [open, setOpen] = useState(activePath);
  const RoleIcon = {
    inbox: Inbox,
    sent: Send,
    drafts: FileText,
    trash: Trash2,
    junk: ShieldAlert,
    archive: Archive,
    all: Mail,
    flagged: Star,
    important: MailWarning,
  }[node.folder?.roles?.[0] || "inbox"];
  const Icon = node.folder?.roles?.length
    ? RoleIcon
    : open && hasChildren
      ? FolderOpen
      : Folder;
  const unreadCount = unread[node.path];
  const count = flagged
    ? starredUnread
    : hasChildren
      ? unreadCount?.tree
      : unreadCount?.direct;
  const showUnread = !node.folder?.roles?.some(
    (role) => role === "sent" || role === "drafts",
  );
  const showMarkRead = !node.folder?.roles?.some(
    (role) => role === "inbox" || role === "drafts" || role === "sent",
  );
  const active = flagged
    ? starredSelected
    : node.path === selected && hasChildren === selectedTree;
  const syncError = node.folder && sidebarFolderError(node.folder);
  useEffect(() => {
    if (activePath) setOpen(true);
  }, [activePath]);
  const row = (
    <div className="remote-folder-row">
      {hasChildren ? (
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("{value0}folder {value1}", {
              value0: open ? t("Collapse") : t("Expand"),
              value1: node.label,
            })}
          >
            <ChevronRight className={open ? "rotate-90" : ""} />
          </Button>
        </CollapsibleTrigger>
      ) : (
        <span className="folder-toggle-space" />
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`nav-item folder-item ${active ? "active" : ""}`}
            title={syncError || node.folder?.displayName || node.label}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              if (flagged && onSelectStarred) {
                onSelectStarred();
              } else if (hasChildren) {
                setOpen(true);
                onSelect(node.path, true, node.delimiter || "");
              } else if (node.folder?.selectable) {
                onSelect(node.folder.name, false, "");
              }
            }}
            disabled={!node.folder?.selectable && !hasChildren}
          >
            <Icon data-icon="inline-start" />
            <span>{localizedFolderLabel(node.folder, node.label)}</span>
            {showUnread && !!count && (
              <em aria-label={t("{value0} unread messages", { value0: count })}>
                {count}
              </em>
            )}
            {syncError && (
              <AlertCircle
                className="text-destructive"
                aria-label={t("Folder source quarantined")}
              />
            )}
          </Button>
        </ContextMenuTrigger>
        {showMarkRead && (
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() =>
                onMarkRead?.(
                  flagged ? "" : node.path,
                  !flagged && hasChildren,
                  flagged ? "" : node.delimiter || "",
                  flagged,
                )
              }
            >
              {t("Mark as read")}
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
    </div>
  );
  if (!hasChildren) return row;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {row}
      <CollapsibleContent className="remote-folder-children">
        {node.children.map((child) => (
          <FolderBranch
            key={child.key}
            node={child}
            selected={selected}
            selectedTree={selectedTree}
            unread={unread}
            starredSelected={starredSelected}
            starredUnread={starredUnread}
            onSelect={onSelect}
            onSelectStarred={onSelectStarred}
            onMarkRead={onMarkRead}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
