export type AccountDropPosition = "before" | "after";

export function reorderAccountIds(
  accounts: readonly { id: string }[],
  sourceId: string,
  targetId: string,
  position: AccountDropPosition,
): string[] | null {
  if (!sourceId || !targetId || sourceId === targetId) return null;
  const ids = accounts.map((account) => account.id);
  const from = ids.indexOf(sourceId);
  const target = ids.indexOf(targetId);
  if (from < 0 || target < 0) return null;
  const remaining = ids.filter((id) => id !== sourceId);
  const anchor = remaining.indexOf(targetId);
  if (anchor < 0) return null;
  const insertAt = position === "before" ? anchor : anchor + 1;
  remaining.splice(insertAt, 0, sourceId);
  if (remaining.every((id, index) => id === ids[index])) return null;
  return remaining;
}

export function moveAccountId(
  accounts: readonly { id: string }[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const ids = accounts.map((account) => account.id);
  const index = ids.indexOf(id);
  const next = index + delta;
  if (index < 0 || next < 0 || next >= ids.length) return null;
  const copy = [...ids];
  const [moved] = copy.splice(index, 1);
  copy.splice(next, 0, moved);
  return copy;
}

export function applyAccountOrder<T extends { id: string }>(
  accounts: readonly T[],
  ids: readonly string[],
): T[] {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const ordered: T[] = [];
  const placed = new Set<string>();
  for (const id of ids) {
    const item = byId.get(id);
    if (item && !placed.has(id)) {
      ordered.push(item);
      placed.add(id);
    }
  }
  for (const account of accounts) {
    if (!placed.has(account.id)) ordered.push(account);
  }
  return ordered;
}
