import type { Mail } from "./types";

// Match RFC reply links, scoped to the original account. A shared missing
// ancestor still connects branches; equal subjects alone never connect mail.
export function conversationIndex(messages: Mail[]) {
  const parents = messages.map((_, i) => i);
  const root = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  const owners = new Map<string, number>();
  messages.forEach((mail, i) => {
    for (const id of [
      mail.messageId,
      mail.serverMessageId,
      ...(mail.inReplyTo || []),
      ...(mail.references || []),
    ].filter(Boolean)) {
      const key = JSON.stringify([mail.accountId, id]);
      const other = owners.get(key);
      if (other === undefined) owners.set(key, i);
      else parents[root(i)] = root(other);
    }
  });
  const names = new Map<number, string>();
  messages.forEach((mail, i) => {
    const key = root(i);
    if (!names.has(key) || mail.id < names.get(key)!) names.set(key, mail.id);
  });
  return new Map(messages.map((mail, i) => [mail.id, names.get(root(i))!]));
}
export function conversationMessages(messages: Mail[], selected: Mail) {
  const index = conversationIndex(messages);
  const seen = new Map<string, Mail>();
  for (const mail of messages) {
    if (
      mail.trashed !== selected.trashed ||
      index.get(mail.id) !== index.get(selected.id)
    )
      continue;
    const key = mail.serverMessageId || mail.messageId || mail.id;
    if (!seen.has(key) || mail.id === selected.id) seen.set(key, mail);
  }
  return [...seen.values()].sort(
    (a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime() ||
      a.id.localeCompare(b.id),
  );
}
export function conversationSummaries(filtered: Mail[], all: Mail[]) {
  const index = conversationIndex(all);
  const groups = new Map<string, Mail>();
  const counts = new Map<string, Set<string>>();
  for (const mail of all) {
    const key = JSON.stringify([index.get(mail.id), mail.trashed]);
    let identities = counts.get(key);
    if (!identities) counts.set(key, (identities = new Set()));
    identities.add(mail.serverMessageId || mail.messageId || mail.id);
  }
  for (const mail of filtered) {
    const key = index.get(mail.id)!;
    const existing = groups.get(key);
    if (existing) {
      existing.isRead &&= mail.isRead;
      existing.starred ||= mail.starred;
      existing.hasAttachments ||= mail.hasAttachments;
    } else
      groups.set(key, {
        ...mail,
        conversationId: key,
        conversationCount:
          counts.get(JSON.stringify([key, mail.trashed]))?.size || 1,
      });
  }
  return [...groups.values()];
}
export function replyHeaders(mail: Mail) {
  const messageId = mail.serverMessageId || mail.messageId;
  if (!messageId) return {};
  const references = [
    ...new Set([
      ...(mail.references?.length ? mail.references : mail.inReplyTo || []),
      messageId,
    ]),
  ];
  // Keep root plus recent ancestry within the outgoing-header bound.
  return {
    inReplyTo: messageId,
    references:
      references.length > 100
        ? [references[0], ...references.slice(-99)]
        : references,
  };
}
export function mailTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
