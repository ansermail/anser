import { Cloud, ShieldCheck } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "./ui/tooltip";

/** Describes complete originals, independently of temporary reading caches. */
export function MailStorageStatus({
  savedLocally,
  demo = false,
}: {
  savedLocally?: boolean;
  demo?: boolean;
}) {
  const online = savedLocally === false;
  const Icon = online ? Cloud : ShieldCheck;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="saved-chip" tabIndex={0}>
            <Icon size={13} aria-hidden="true" />
            {demo
              ? t("Demo archive")
              : online
                ? t("Online · Not fully saved")
                : t("Complete original saved")}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">
          {demo
            ? t("Fictional messages for exploring the interface.")
            : online
              ? t(
                  "The complete original is on the server. Reading caches are temporary copies and may be cleared. Save the complete message for long-term access.",
                )
              : t(
                  "The complete original is in your local archive. If it has been moved to an attached archive, connect that disk to read it.",
                )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
