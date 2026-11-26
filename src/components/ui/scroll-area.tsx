import * as React from "react";
import { cn } from "cn";
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { observeScrollFade } from "@/lib/scroll-fade";

function ScrollArea({
  className,
  children,
  viewportRef,
  viewportProps,
  orientation = "vertical",
  fade,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  viewportRef?: React.Ref<HTMLDivElement>;
  viewportProps?: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>;
  orientation?: "vertical" | "horizontal" | "both";
  fade?: "vertical" | "horizontal";
}) {
  const mergedViewportRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof viewportRef === "function") viewportRef(node);
      else if (viewportRef && "current" in viewportRef)
        (viewportRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
      if (node && fade) return observeScrollFade(node, fade);
    },
    [viewportRef, fade],
  );
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        {...viewportProps}
        ref={mergedViewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1",
          viewportProps?.className,
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      {orientation !== "horizontal" && <ScrollBar />}
      {orientation !== "vertical" && (
        <ScrollBar orientation="horizontal" className="table-scrollbar" />
      )}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-[5px] flex-col border-t-0 p-0",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative flex-1 rounded-full bg-muted-foreground/45",
          "transition-colors hover:bg-muted-foreground/65",
        )}
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
