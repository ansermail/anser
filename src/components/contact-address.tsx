import { Copy, Mail, UserPlus } from "lucide-react";
import { cn } from "cn";
import { toast } from "sonner";
import { t } from "@/lib/i18n";
import { copyText } from "@/lib/clipboard";
import { displayAddress } from "@/lib/addresses";
import type { Address } from "@/lib/types";
import { Button } from "./ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";

/** A focusable address chip with the address actions used across reading views. */
export function ContactAddress({
  address,
  text,
  className,
  onComposeAddress,
  onAddContact,
}: {
  address: Address;
  text?: string;
  className?: string;
  onComposeAddress?: (address: Address) => void;
  onAddContact?: (address: Address) => void;
}) {
  const addressLabel = displayAddress(address);
  const label = text ?? addressLabel;
  async function copy(value: string, success: string) {
    if (await copyText(value)) toast.success(t(success));
    else toast.error(t("Could not copy email address"));
  }
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn("contact-address", className)}
          title={label}
          aria-haspopup="menu"
          aria-label={t("Email address actions for {value0}", {
            value0: address.email,
          })}
          onKeyDown={(event) => {
            if (
              event.key !== "ContextMenu" &&
              !(event.shiftKey && event.key === "F10")
            )
              return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + 4,
                clientY: rect.bottom,
              }),
            );
          }}
        >
          <span className="contact-address-label">{label}</span>
        </Button>
      </ContextMenuTrigger>
      <ContextMenuContent className="contact-address-menu">
        <ContextMenuLabel className="contact-address-menu-label">
          {addressLabel}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onComposeAddress}
          onSelect={() => onComposeAddress?.(address)}
        >
          <Mail />
          {t("Compose")}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void copy(address.email, "Copied email address")}
        >
          <Copy />
          {t("Copy email address")}
        </ContextMenuItem>
        {!!address.name && (
          <ContextMenuItem
            onSelect={() =>
              void copy(addressLabel, "Copied name and email address")
            }
          >
            <Copy />
            {t("Copy name and email address")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={!onAddContact}
          onSelect={() => onAddContact?.(address)}
        >
          <UserPlus />
          {t("Add contact")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
