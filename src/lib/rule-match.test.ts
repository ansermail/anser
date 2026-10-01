import { describe, it, expect } from "vitest";
import { ruleMatches } from "./rule-match";
import type { Mail, Rule } from "./types";
const mail = {
  accountId: "work",
  subject: "项目 INVOICE",
  sender: "alice@example.com",
  hasAttachments: true,
  date: "2026-09-30T01:00:00Z",
} as Mail;
const rule: Rule = {
  id: "1",
  name: "发票",
  accountId: "work",
  enabled: true,
  mode: "all",
  conditions: [
    { field: "subject", operator: "contains", value: "invoice" },
    { field: "attachment", operator: "equals", value: "true" },
  ],
  action: "folder",
  destination: "财务",
  stop: true,
};
describe("rule preview semantics", () => {
  it("requires all conditions and respects account scope", () => {
    expect(ruleMatches(rule, mail)).toBe(true);
    expect(ruleMatches(rule, { ...mail, accountId: "personal" })).toBe(false);
    expect(ruleMatches(rule, { ...mail, hasAttachments: false })).toBe(false);
  });
  it("matches any condition only for enabled nonempty rules", () => {
    expect(
      ruleMatches({ ...rule, mode: "any" }, { ...mail, hasAttachments: false }),
    ).toBe(true);
    expect(ruleMatches({ ...rule, enabled: false }, mail)).toBe(false);
    expect(ruleMatches({ ...rule, conditions: [] }, mail)).toBe(false);
  });
  it("compares dates by calendar day", () => {
    expect(
      ruleMatches(
        {
          ...rule,
          conditions: [
            { field: "date", operator: "after", value: "2026-09-29" },
          ],
        },
        mail,
      ),
    ).toBe(true);
    expect(
      ruleMatches(
        {
          ...rule,
          conditions: [
            { field: "date", operator: "before", value: "2026-09-30" },
          ],
        },
        mail,
      ),
    ).toBe(false);
  });
});
