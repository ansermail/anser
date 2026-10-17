import type { Mail, Rule } from "./types";
export type RuleMatchState = "match" | "noMatch" | "needsBody";
export function ruleBodyAvailable(mail: Mail): boolean {
  return (
    mail.savedLocally !== false &&
    !mail.parseWarnings?.some(
      (w) =>
        w.startsWith("text/plain 正文片段无法解码：") ||
        w.startsWith("text/html 正文片段无法解码："),
    )
  );
}
export function ruleMatchState(
  rule: Rule,
  mail: Mail,
  bodyAvailable = ruleBodyAvailable(mail),
): RuleMatchState {
  if (
    !rule.enabled ||
    !rule.conditions.length ||
    (rule.accountId && rule.accountId !== mail.accountId)
  )
    return "noMatch";
  let unknown = false;
  for (const condition of rule.conditions) {
    if (
      ((condition.field === "body" || condition.field === "sizeKb") &&
        !bodyAvailable) ||
      (["cc", "recipientsOrCc", "priority"].includes(condition.field) &&
        mail.headerMetadataKnown === false) ||
      (condition.field === "attachment" &&
        !bodyAvailable &&
        !mail.attachmentMetadataKnown &&
        !mail.hasAttachments)
    ) {
      unknown = true;
      continue;
    }
    let matched: boolean;
    if (condition.field === "attachment")
      matched = mail.hasAttachments === (condition.value !== "false");
    else if (condition.field === "read" || condition.field === "starred")
      matched =
        (condition.field === "read" ? mail.isRead : mail.starred) ===
        (condition.value !== "false");
    else if (condition.field === "priority")
      matched =
        (["high", "low"].includes(mail.priority ?? "")
          ? mail.priority
          : "normal") === condition.value;
    else if (condition.field === "ageDays") {
      const days = Number(condition.value);
      const sent = Date.parse(mail.date);
      const age = Number.isFinite(sent)
        ? Math.floor((Date.now() - sent) / 86_400_000)
        : NaN;
      matched =
        Number.isSafeInteger(days) &&
        days >= 0 &&
        Number.isFinite(age) &&
        (condition.operator === "greaterThan"
          ? age > days
          : condition.operator === "lessThan"
            ? age < days
            : condition.operator === "equals" && age === days);
    } else if (condition.field === "recipientsOrCc") {
      const value = condition.value.toLowerCase();
      const hit = (text: string) => {
        const lower = text.toLowerCase();
        switch (condition.operator) {
          case "contains":
            return lower.includes(value);
          case "notContains":
            return !lower.includes(value);
          case "equals":
            return lower === value;
          case "startsWith":
            return lower.startsWith(value);
          case "endsWith":
            return lower.endsWith(value);
          default:
            return false;
        }
      };
      const to = hit(mail.recipients ?? "");
      const cc = hit(mail.cc ?? "");
      matched = condition.operator === "notContains" ? to && cc : to || cc;
    } else if (condition.field === "sizeKb") {
      const kb = Number(condition.value);
      const bytes = kb * 1024;
      matched =
        Number.isSafeInteger(bytes) &&
        bytes >= 0 &&
        (condition.operator === "greaterThan"
          ? mail.size > bytes
          : condition.operator === "lessThan"
            ? mail.size < bytes
            : condition.operator === "equals" && mail.size === bytes);
    } else {
      const values: Record<string, string> = {
        sender: mail.sender,
        recipients: mail.recipients,
        cc: mail.cc ?? "",
        subject: mail.subject,
        body: mail.body,
        date: mail.date,
      };
      const text = (values[condition.field] ?? "").toLowerCase(),
        value = condition.value.toLowerCase();
      switch (condition.operator) {
        case "contains":
          matched = text.includes(value);
          break;
        case "notContains":
          matched = !text.includes(value);
          break;
        case "equals":
          matched = text === value;
          break;
        case "startsWith":
          matched = text.startsWith(value);
          break;
        case "endsWith":
          matched = text.endsWith(value);
          break;
        case "before":
          matched = text.slice(0, 10) < value;
          break;
        case "after":
          matched = text.slice(0, 10) > value;
          break;
        default:
          matched = false;
      }
      if (!(condition.field in values)) matched = false;
    }
    if (rule.mode === "all" && !matched) return "noMatch";
    if (rule.mode === "any" && matched) return "match";
  }
  return unknown ? "needsBody" : rule.mode === "all" ? "match" : "noMatch";
}
export function ruleMatches(rule: Rule, mail: Mail): boolean {
  return ruleMatchState(rule, mail) === "match";
}
