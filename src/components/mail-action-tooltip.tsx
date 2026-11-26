import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { mailShortcutKeys, type MailShortcut } from "@/lib/mail-shortcuts";

export function MailActionTooltip({
  action,
  label,
  disabledReason,
  children,
}: {
  action: MailShortcut;
  label: string;
  disabledReason?: string;
  children: ReactElement<{ disabled?: boolean }>;
}) {
  const disabled = Boolean(children.props?.disabled);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span tabIndex={0} className="inline-flex">
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent>
        {disabled && disabledReason
          ? disabledReason
          : `${label} · ${mailShortcutKeys[action]}`}
      </TooltipContent>
    </Tooltip>
  );
}
