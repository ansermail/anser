import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { mailShortcutKeys, type MailShortcut } from "@/lib/mail-shortcuts";

export function MailActionTooltip({
  action,
  label,
  children,
}: {
  action: MailShortcut;
  label: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label} · {mailShortcutKeys[action]}
      </TooltipContent>
    </Tooltip>
  );
}
