import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Message({
  from,
  className,
  ...props
}: ComponentProps<"div"> & { from: "user" | "assistant" }) {
  return (
    <div
      data-slot="ai-message"
      data-role={from}
      className={cn(
        "flex flex-col gap-2",
        from === "user" ? "items-end" : "items-start",
        className,
      )}
      {...props}
    />
  );
}

export function MessageContent({
  from,
  className,
  ...props
}: ComponentProps<"div"> & { from: "user" | "assistant" }) {
  return (
    <div
      data-slot="ai-message-content"
      className={cn(
        "break-words whitespace-pre-wrap",
        from === "user"
          ? "max-w-[92%] rounded-lg rounded-br-sm bg-secondary px-3 py-2 text-foreground"
          : "w-full leading-relaxed text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MessageActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="ai-message-actions"
      className={cn("flex items-center gap-1", className)}
      {...props}
    />
  );
}

export function MessageAction({
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      {...props}
    />
  );
}
