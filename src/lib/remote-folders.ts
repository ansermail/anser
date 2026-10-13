import type { Account, RemoteFolder } from "./types";

const gmailContainer = (name: string) =>
  ["[gmail]", "[google mail]", "[googlemail]"].includes(name.toLowerCase());

// These provider roots group mailboxes; they never identify a mailbox source.
export function providerFolderContainer(
  account: Pick<Account, "incomingHost">,
  folder: RemoteFolder,
) {
  const host = account.incomingHost.toLowerCase();
  return (
    !folder.roles?.length &&
    ((["imap.qq.com", "imap.exmail.qq.com"].includes(host) &&
      ["其他文件夹", "我的文件夹"].includes(folder.displayName)) ||
      (host === "imap.gmail.com" && gmailContainer(folder.name)))
  );
}

export function sidebarFolderError(folder: RemoteFolder) {
  if (
    !folder.selectable &&
    (["其他文件夹", "我的文件夹"].includes(folder.displayName) ||
      gmailContainer(folder.name)) &&
    (folder.syncError?.includes("服务器报告该文件夹为空，但又返回邮件 UID") ||
      folder.syncError?.includes("服务器未返回该文件夹的邮件数量") ||
      (gmailContainer(folder.name) &&
        folder.syncError?.includes("[NONEXISTENT]")))
  )
    return undefined;
  return folder.syncError;
}

// Old persisted sync summaries can outlive corrected LIST metadata. Suppress
// only the known container-selection failure; keep other folders/errors visible.
export function sidebarAccountError(account: Account, folders: RemoteFolder[]) {
  if (!account.error) return null;
  const summary =
    /；其余文件夹已继续检查，本次新增 \d+ 封邮件$/.exec(account.error)?.[0] ||
    "";
  const failures = account.error.slice(
    0,
    account.error.length - summary.length,
  );
  const visible = failures.split(/；(?=文件夹「)/).filter((failure) => {
    const name = /^文件夹「([^」]+)」/.exec(failure)?.[1];
    if (!name) return true;
    const folder = folders.find(
      (folder) =>
        folder.accountId === account.id &&
        (folder.name === name || folder.displayName === name) &&
        providerFolderContainer(account, folder),
    );
    return (
      !folder ||
      !!sidebarFolderError({ ...folder, selectable: false, syncError: failure })
    );
  });
  if (!visible.length) return null;
  return visible.join("；") + summary;
}

export interface FolderNode {
  key: string;
  path: string;
  delimiter: string | null;
  label: string;
  folder?: RemoteFolder;
  children: FolderNode[];
}

// The delimiter belongs to the server. A slash in a NIL-delimited name is
// literal text; display labels must never be passed back to IMAP SELECT.
export function remoteFolderTree(folders: RemoteFolder[]): FolderNode[] {
  const roots: FolderNode[] = [];
  const nodes = new Map<string, FolderNode>();
  for (const folder of folders) {
    const separator = folder.delimiter;
    const parts = separator ? folder.name.split(separator) : [folder.name];
    const labels = separator
      ? folder.displayName.split(separator)
      : [folder.displayName];
    let children = roots;
    for (let i = 0; i < parts.length; i++) {
      const path = parts.slice(0, i + 1).join(separator || "");
      const key = `${folder.accountId}:${path}`;
      let node = nodes.get(key);
      if (!node) {
        node = {
          key,
          path,
          delimiter: separator,
          label: labels.length === parts.length ? labels[i] : parts[i],
          children: [],
        };
        nodes.set(key, node);
        children.push(node);
      }
      if (i === parts.length - 1) {
        node.folder = folder;
        node.label =
          labels.length === parts.length ? labels[i] : folder.displayName;
      }
      children = node.children;
    }
  }
  // Some servers expose an isolated empty placeholder although the account
  // has no user folders. Keep a real parent when it has children.
  for (let i = roots.length - 1; i >= 0; i--) {
    const node = roots[i];
    if (
      ["其他文件夹", "我的文件夹"].includes(node.label) &&
      node.children.length === 0 &&
      (node.folder?.syncError || node.folder?.selectable === false)
    )
      roots.splice(i, 1);
    else if (
      gmailContainer(node.path) &&
      (!node.folder || node.folder.selectable === false)
    )
      roots.splice(i, 1, ...node.children);
  }
  const sort = (nodes: FolderNode[]) => {
    const rank = (node: FolderNode) => {
      const role =
        node.folder?.roles?.[0] ||
        (node.folder?.name.toUpperCase() === "INBOX" ? "inbox" : "");
      const index = [
        "inbox",
        "flagged",
        "important",
        "sent",
        "drafts",
        "archive",
        "all",
        "junk",
        "trash",
      ].indexOf(role);
      return index < 0 ? 9 : index;
    };
    nodes.sort(
      (a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, "zh-CN"),
    );
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function remoteFolderLabel(folder: RemoteFolder) {
  return folder.delimiter
    ? folder.displayName.split(folder.delimiter).at(-1) || folder.displayName
    : folder.displayName;
}
