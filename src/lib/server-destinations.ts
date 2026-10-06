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
    throw new Error("邮件已不在当前服务器文件夹，请刷新后重新打开。");
  }
  const inbox = available.find((s) => s.toUpperCase() === "INBOX");
  if (view === "all") {
    if (inbox) return inbox;
    throw new Error("收件箱来源已失效，请刷新后重新打开。");
  }
  if (view === "sent") {
    const sent = available.filter((s) =>
      folders.some((f) => f.name === s && f.roles?.includes("sent")),
    );
    if (sent.length === 1) return sent[0];
    throw new Error("无法确定已发送来源，请从具体服务器文件夹打开邮件。");
  }
  // Match the canonical active source used by the aggregated reader.
  if (inbox) return inbox;
  if (available.includes(mail.sourceFolder)) return mail.sourceFolder;
  if (available.length === 1) return available[0];
  throw new Error(
    available.length
      ? "邮件有多个服务器来源，请从具体服务器文件夹打开。"
      : "这封邮件没有可信的 IMAP 来源。",
  );
}

export const moveShortcuts = [
  { role: "archive", label: "归档" },
  { role: "junk", label: "移到垃圾邮件" },
  { role: "trash", label: "移到服务器废纸篓" },
] as const;

export function directoryShortcuts(folders: RemoteFolder[], source: string) {
  return moveShortcuts.map((shortcut) => {
    const matches = folders.filter((f) => f.roles?.includes(shortcut.role));
    const folder = matches.length === 1 ? matches[0] : undefined;
    const reason = !matches.length
      ? "请在账号中设置目标目录"
      : matches.length > 1
        ? "请在账号中指定唯一目标"
        : !folder?.selectable || folder.syncError
          ? "目标目录不可用"
          : folder.name === source
            ? "已在此目录"
            : "";
    return { ...shortcut, folder, reason };
  });
}
