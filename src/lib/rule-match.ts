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
      (condition.field === "body" && !bodyAvailable) ||
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
    else {
      const values: Record<string, string> = {
        sender: mail.sender,
        recipients: mail.recipients,
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
