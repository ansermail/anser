import type { Mail, Rule } from "./types";
export function ruleMatches(rule: Rule, mail: Mail): boolean {
  if (
    !rule.enabled ||
    !rule.conditions.length ||
    (rule.accountId && rule.accountId !== mail.accountId)
  )
    return false;
  const results = rule.conditions.map((c) => {
    if (
      c.field === "body" &&
      (mail.savedLocally === false ||
        mail.parseWarnings?.some(
          (w) =>
            w.startsWith("text/plain 正文片段无法解码：") ||
            w.startsWith("text/html 正文片段无法解码："),
        ))
    )
      return false;
    if (c.field === "attachment")
      return mail.hasAttachments === (c.value !== "false");
    const values: Record<string, string> = {
      sender: mail.sender,
      recipients: mail.recipients,
      subject: mail.subject,
      body: mail.body,
      date: mail.date,
    };
    if (!(c.field in values)) return false;
    const text = values[c.field].toLowerCase(),
      value = c.value.toLowerCase();
    switch (c.operator) {
      case "contains":
        return text.includes(value);
      case "notContains":
        return !text.includes(value);
      case "equals":
        return text === value;
      case "before":
        return text.slice(0, 10) < value;
      case "after":
        return text.slice(0, 10) > value;
      default:
        return false;
    }
  });
  return rule.mode === "any" ? results.some(Boolean) : results.every(Boolean);
}
