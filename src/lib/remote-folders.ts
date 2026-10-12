import type { RemoteFolder } from "./types";

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
      node.label === "其他文件夹" &&
      node.children.length === 0 &&
      node.folder?.syncError
    )
      roots.splice(i, 1);
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
