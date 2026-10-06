import { useEffect, useRef, useState, type ReactNode } from "react";
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
}: {
  sidebar: ReactNode;
  children: ReactNode;
  open: boolean;
  expanded: boolean;
}) {
  const panel = usePanelRef();
  const visibleWidth = useRef<number | undefined>(undefined);
  const restoreWidth = visibleWidth.current;
  const hidden = !open || expanded;
  const [layout] = useState(() =>
    readLayout("yanxin-navigation-layout", ["navigation", "workspace"]),
  );
  useEffect(() => {
    // Apply the button action after Resizable has registered the new constraints.
    const frame = requestAnimationFrame(() => {
      if (!hidden && restoreWidth) {
        panel.current?.resize(restoreWidth);
      }
    });
    return () => cancelAnimationFrame(frame);
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
        minSize={hidden ? 0 : 220}
        maxSize={hidden ? 0 : 380}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size) => {
          if (!hidden && size.inPixels > 0)
            visibleWidth.current = size.inPixels;
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
        minSize={620}
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
  const visibleWidth = useRef<number | undefined>(undefined);
  const restoreWidth = visibleWidth.current;
  const [layout] = useState(() =>
    readLayout("yanxin-mail-layout", ["mail-list", "mail-reader"]),
  );
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (!expanded && restoreWidth) {
        panel.current?.resize(restoreWidth);
      }
    });
    return () => cancelAnimationFrame(frame);
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
        minSize={expanded ? 0 : 280}
        maxSize={expanded ? 0 : 560}
        onResize={(size) => {
          if (!expanded && size.inPixels > 0)
            visibleWidth.current = size.inPixels;
        }}
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
        // The list's minimum width also bounds the reader's maximum width.
        minSize={320}
        className="mail-reader-panel"
      >
        {children}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
