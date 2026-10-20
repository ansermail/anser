import { t } from "./i18n";
import type { Mail, RemoteFolder } from "./types";

// A folder view is authoritative. Never silently move a different physical
// copy if this view's source disappeared while the user was reading.
export function directorySource(
  mail: Mail,
  sources: string[],
  folders: RemoteFolder[],
  view: string,
  remoteFolder?: string,
): string {
  const available = sources.filter(
    (name) =>
      !folders.some((f) => f.name === name && (!f.selectable || f.syncError)),
  );
  if (remoteFolder) {
    if (available.includes(remoteFolder)) return remoteFolder;
    throw new Error(
      t(
        "This message is no longer in the current server folder. Refresh and open it again.",
      ),
    );
  }
  const inbox = available.find((s) => s.toUpperCase() === "INBOX");
  if (view === "all" && inbox) return inbox;
  if (view === "sent") {
    const sent = available.filter((s) =>
      folders.some((f) => f.name === s && f.roles?.includes("sent")),
    );
    if (sent.length === 1) return sent[0];
    throw new Error(
      t(
        "Could not determine the sent source. Open the message from a specific server folder.",
      ),
    );
  }
  // Match the canonical active source used by the aggregated reader.
  if (inbox) return inbox;
  if (available.includes(mail.sourceFolder)) return mail.sourceFolder;
  if (available.length === 1) return available[0];
  throw new Error(
    available.length
      ? t(
          "This message has multiple server sources. Open it from a specific server folder.",
        )
      : t("This message has no trusted IMAP source."),
  );
}

export const moveShortcuts = [
  { role: "archive", label: "Archive" },
  { role: "junk", label: "Move to junk" },
  { role: "trash", label: "Move to server trash" },
] as const;

export function directoryShortcuts(folders: RemoteFolder[], source: string) {
  return moveShortcuts.map((shortcut) => {
    const matches = folders.filter((f) => f.roles?.includes(shortcut.role));
    const folder = matches.length === 1 ? matches[0] : undefined;
    const reason = !matches.length
      ? t("Set a target folder in the account")
      : matches.length > 1
        ? t("Choose a single target in the account")
        : !folder?.selectable || folder.syncError
          ? t("Target folder unavailable")
          : folder.name === source
            ? t("Already in this folder")
            : "";
    return { role: shortcut.role, label: t(shortcut.label), folder, reason };
  });
}
