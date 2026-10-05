import type { RemoteFolder } from "./types";

export interface FolderNode {
  key: string;
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
  const sort = (nodes: FolderNode[]) => {
    const rank = (node: FolderNode) => {
      const role =
        node.folder?.roles?.[0] ||
        (node.folder?.name.toUpperCase() === "INBOX" ? "inbox" : "");
      const index = [
        "inbox",
        "sent",
        "drafts",
        "archive",
        "all",
        "flagged",
        "junk",
        "trash",
      ].indexOf(role);
      return index < 0 ? 8 : index;
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
