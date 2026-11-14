import type { Compose } from "./types";

export type MailtoFields = Pick<
  Compose,
  "to" | "cc" | "bcc" | "subject" | "body"
>;

const MAX_MAILTO_LENGTH = 64 * 1024;

function decode(value: string, field: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Invalid ${field} encoding in mailto link`);
  }
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function recipients(value: string) {
  return value
    .split(/[,;]/)
    .map((address) => cleanHeader(decode(address, "recipient")))
    .filter(Boolean);
}

function queryFields(query: string) {
  const fields = new Map<string, string[]>();
  if (!query) return fields;
  for (const part of query.split("&")) {
    if (!part) continue;
    const separator = part.indexOf("=");
    const rawKey = separator < 0 ? part : part.slice(0, separator);
    const rawValue = separator < 0 ? "" : part.slice(separator + 1);
    const key = decode(rawKey, "header").toLowerCase();
    fields.set(key, [...(fields.get(key) || []), rawValue]);
  }
  return fields;
}

export function parseMailtoLink(href: string): MailtoFields {
  if (href.length > MAX_MAILTO_LENGTH)
    throw new Error("Mailto link is too long");
  const value = href.trim();
  const colon = value.indexOf(":");
  if (colon < 0 || value.slice(0, colon).toLowerCase() !== "mailto")
    throw new Error("Not a mailto link");

  const question = value.indexOf("?", colon + 1);
  const rawRecipients =
    question < 0 ? value.slice(colon + 1) : value.slice(colon + 1, question);
  const fields = queryFields(question < 0 ? "" : value.slice(question + 1));
  const to = [
    ...recipients(rawRecipients),
    ...(fields.get("to") || []).flatMap(recipients),
  ];
  const cc = (fields.get("cc") || []).flatMap(recipients);
  const bcc = (fields.get("bcc") || []).flatMap(recipients);
  const subject = cleanHeader(
    decode(fields.get("subject")?.at(-1) || "", "subject"),
  );
  const body = decode(fields.get("body")?.at(-1) || "", "body");

  return {
    to: to.join(", "),
    cc: cc.join(", "),
    bcc: bcc.join(", "),
    subject,
    body,
  };
}
