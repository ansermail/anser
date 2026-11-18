import type { ReactElement } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { t } from "@/lib/i18n";
import type { WorkItem } from "@/lib/workbench";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";

export function WorkItemDeleteMenuItem({
  disabled,
  onDelete,
}: {
  disabled: boolean;
  onDelete: () => void;
}) {
  return (
    <ContextMenuItem
      variant="destructive"
      disabled={disabled}
      onSelect={onDelete}
    >
      <Trash2 />
      <span className="wb-context-label">{t("Delete work item")}</span>
    </ContextMenuItem>
  );
}

export function WorkItemContextMenu({
  item,
  disabled,
  onOpen,
  onDelete,
  children,
}: {
  item: WorkItem;
  disabled: boolean;
  onOpen: (item: WorkItem) => void;
  onDelete: (item: WorkItem) => void;
  children: ReactElement;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        className="wb-work-item-menu"
        onClick={(event) => event.stopPropagation()}
      >
        <ContextMenuLabel className="wb-work-item-menu-label">
          {item.title}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem disabled={disabled} onSelect={() => onOpen(item)}>
            <Pencil />
            <span className="wb-context-label">{t("Edit work item")}</span>
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <WorkItemDeleteMenuItem
            disabled={disabled}
            onDelete={() => onDelete(item)}
          />
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
