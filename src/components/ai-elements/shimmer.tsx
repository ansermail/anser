import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Shimmer({
  className,
  children,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="ai-shimmer"
      className={cn("ai-shimmer inline-block", className)}
      {...props}
    >
      {children}
    </span>
  );
}
