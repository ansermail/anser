import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  AlertCircle,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  Mail,
  Send,
  ShieldAlert,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import { remoteFolderTree, type FolderNode } from "../lib/remote-folders";
import type { RemoteFolder } from "../lib/types";

export function RemoteFolderList({
  folders,
  selected,
  onSelect,
}: {
  folders: RemoteFolder[];
  selected: string;
  onSelect: (name: string) => void;
}) {
  const tree = useMemo(() => remoteFolderTree(folders), [folders]);
  return (
    <div className="remote-folder-tree">
      {tree.map((node) => (
        <FolderBranch
          key={node.key}
          node={node}
          selected={selected}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function FolderBranch({
  node,
  selected,
  onSelect,
}: {
  node: FolderNode;
  selected: string;
  onSelect: (name: string) => void;
}) {
  const containsSelected = (node: FolderNode): boolean =>
    node.folder?.name === selected || node.children.some(containsSelected);
  const hasChildren = node.children.length > 0;
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
  }[node.folder?.roles?.[0] || "inbox"];
  const Icon = node.folder?.roles?.length
    ? RoleIcon
    : open && hasChildren
      ? FolderOpen
      : Folder;
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
            aria-label={`${open ? "收起" : "展开"}文件夹 ${node.label}`}
          >
            <ChevronRight className={open ? "rotate-90" : ""} />
          </Button>
        </CollapsibleTrigger>
      ) : (
        <span className="folder-toggle-space" />
      )}
      <Button
        variant="ghost"
        size="sm"
        className={`nav-item folder-item ${node.folder?.name === selected ? "active" : ""}`}
        title={node.folder?.syncError || node.folder?.displayName || node.label}
        aria-current={node.folder?.name === selected ? "page" : undefined}
        onClick={() =>
          node.folder?.selectable
            ? onSelect(node.folder.name)
            : setOpen((v) => !v)
        }
        disabled={!node.folder?.selectable && !hasChildren}
      >
        <Icon data-icon="inline-start" />
        <span>{node.label}</span>
        {node.folder?.syncError && (
          <AlertCircle
            className="text-destructive"
            aria-label="目录来源已隔离"
          />
        )}
      </Button>
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
            onSelect={onSelect}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
