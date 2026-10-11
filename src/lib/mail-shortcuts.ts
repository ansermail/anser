export type MailShortcut = "reply" | "replyAll" | "forward" | "read" | "star";

// Reader actions use Command; Ctrl is also accepted for the browser preview.
export function mailShortcut(event: KeyboardEvent): MailShortcut | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === "r") return event.shiftKey ? "replyAll" : "reply";
  if (!event.shiftKey) return;
  if (key === "f") return "forward";
  if (key === "u") return "read";
  if (key === "l") return "star";
}

export const mailShortcutKeys = {
  reply: "⌘R",
  replyAll: "⌘⇧R",
  forward: "⌘⇧F",
  read: "⌘⇧U",
  star: "⌘⇧L",
} as const;
