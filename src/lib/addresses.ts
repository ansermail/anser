import type { Address, Detail } from "./types";

// Keep commas inside quoted display names together. Native MIME parsing supplies
// structured addresses for real mail; this fallback handles old demo records.
export function addressTokens(value: string): string[] {
  const out: string[] = [];
  let quoted = false,
    escaped = false,
    angle = 0,
    start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if (ch === "<") angle++;
      if (ch === ">") angle = Math.max(0, angle - 1);
      if (!angle && [",", ";", "，", "；"].includes(ch)) {
        out.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
  }
  out.push(value.slice(start).trim());
  return out;
}
export function parseAddresses(value: string): Address[] {
  return addressTokens(value)
    .filter(Boolean)
    .flatMap((token) => {
      const match = token.match(/^(.*?)<([^<>]+)>$/);
      const email = (match?.[2] ?? token).trim();
      if (!/^[^\s@<>]+@[^\s@<>]+$/.test(email)) return [];
      let name = match?.[1].trim() ?? "";
      if (name.startsWith('"') && name.endsWith('"'))
        name = name.slice(1, -1).replace(/\\(.)/g, "$1");
      return [{ name, email }];
    });
}
export function formatAddress(a: Address) {
  return a.name ? `${JSON.stringify(a.name)} <${a.email}>` : a.email;
}
export function replyRecipients(
  detail: Detail,
  ownEmails: string[],
  all = false,
) {
  const own = new Set(ownEmails.map((e) => e.toLowerCase()));
  const used = new Set<string>();
  function unique(items: Address[]) {
    return items.filter((a) => {
      const key = a.email.toLowerCase();
      if (own.has(key) || used.has(key)) return false;
      used.add(key);
      return true;
    });
  }
  const reply = detail.replyTo?.length
    ? detail.replyTo
    : parseAddresses(detail.mail.sender);
  const originalTo = detail.to ?? parseAddresses(detail.mail.recipients);
  const to = unique(reply);
  // Replying to your own sent message targets its original recipients.
  if (all || !to.length) to.push(...unique(originalTo));
  const cc = all ? unique(detail.cc ?? []) : [];
  return {
    to: to.map(formatAddress).join(", "),
    cc: cc.map(formatAddress).join(", "),
  };
}
