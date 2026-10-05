import { useEffect, useState, type ReactNode } from "react";
import { usePanelRef, type Layout } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./ui/resizable";

function readLayout(key: string, ids: string[]): Layout | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (
      value &&
      ids.every(
        (id) => Number.isFinite(value[id]) && value[id] > 0 && value[id] < 100,
      ) &&
      Math.abs(ids.reduce((sum, id) => sum + value[id], 0) - 100) < 0.1
    )
      return value;
  } catch {
    /* Discard an invalid saved layout. */
  }
}
function remember(key: string, layout: Layout) {
  try {
    localStorage.setItem(key, JSON.stringify(layout));
  } catch {
    /* Resizing works even when storage is unavailable. */
  }
}

export function NavigationLayout({
  sidebar,
  children,
  open,
  expanded,
  onOpenChange,
}: {
  sidebar: ReactNode;
  children: ReactNode;
  open: boolean;
  expanded: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const panel = usePanelRef();
  const hidden = !open || expanded;
  const [layout] = useState(() =>
    readLayout("yanxin-navigation-layout", ["navigation", "workspace"]),
  );
  useEffect(() => {
    if (hidden) panel.current?.collapse();
    else panel.current?.expand();
  }, [hidden, panel]);
  return (
    <ResizablePanelGroup
      className="navigation-layout"
      orientation="horizontal"
      resizeTargetMinimumSize={{ fine: 16, coarse: 24 }}
      defaultLayout={layout}
      onLayoutChanged={(next) => {
        if (!hidden && next.navigation > 0)
          remember("yanxin-navigation-layout", next);
      }}
    >
      <ResizablePanel
        id="navigation"
        inert={hidden}
        aria-hidden={hidden}
        panelRef={panel}
        defaultSize={288}
        minSize={220}
        maxSize={380}
        collapsible
        collapsedSize={0}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size, _id, previous) => {
          if (previous && !expanded) onOpenChange(size.asPercentage > 0);
        }}
        className="navigation-panel"
      >
        {sidebar}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="调整左侧菜单宽度"
        className={`navigation-handle ${hidden ? "handle-hidden" : ""}`}
        disabled={hidden}
      />
      <ResizablePanel
        id="workspace"
        minSize={580}
        className="workspace-resizable-panel"
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

export function MailLayout({
  list,
  children,
  expanded,
}: {
  list: ReactNode;
  children: ReactNode;
  expanded: boolean;
}) {
  const panel = usePanelRef();
  const [layout] = useState(() =>
    readLayout("yanxin-mail-layout", ["mail-list", "mail-reader"]),
  );
  useEffect(() => {
    if (expanded) panel.current?.collapse();
    else panel.current?.expand();
  }, [expanded, panel]);
  return (
    <ResizablePanelGroup
      className="mail-workspace"
      orientation="horizontal"
      resizeTargetMinimumSize={{ fine: 16, coarse: 24 }}
      defaultLayout={layout}
      onLayoutChanged={(next) => {
        if (!expanded && next["mail-list"] > 0)
          remember("yanxin-mail-layout", next);
      }}
    >
      <ResizablePanel
        id="mail-list"
        inert={expanded}
        aria-hidden={expanded}
        panelRef={panel}
        defaultSize={340}
        minSize={240}
        maxSize="55%"
        collapsible
        collapsedSize={0}
        collapsedThreshold={0}
        className="mail-list-panel"
      >
        {list}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="调整邮件列表与正文宽度"
        className={`mail-pane-handle ${expanded ? "handle-hidden" : ""}`}
        disabled={expanded}
      />
      <ResizablePanel
        id="mail-reader"
        minSize={300}
        className="mail-reader-panel"
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
