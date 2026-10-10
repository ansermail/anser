import { describe, it, expect } from "vitest";
import { ruleMatches, ruleMatchState } from "./rule-match";
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
it("does not treat an online or undecodable body as an empty matching body", () => {
  const negative = {
    ...rule,
    conditions: [{ field: "body", operator: "notContains", value: "missing" }],
  };
  const online = { ...mail, body: "", savedLocally: false };
  expect(ruleMatches(negative, online)).toBe(false);
  expect(ruleMatches(negative, { ...online, savedLocally: true })).toBe(true);
  expect(
    ruleMatches(negative, {
      ...online,
      savedLocally: true,
      parseWarnings: ["text/plain 正文片段无法解码：fixture"],
    }),
  ).toBe(false);
  expect(
    ruleMatches(
      {
        ...negative,
        mode: "any",
        conditions: [
          ...negative.conditions,
          { field: "subject", operator: "contains", value: "invoice" },
        ],
      },
      online,
    ),
  ).toBe(true);
});

it("keeps unknown attachment metadata distinct from a known empty attachment list", () => {
  const online = { ...mail, savedLocally: false, hasAttachments: false };
  const absent = {
    ...rule,
    conditions: [{ field: "attachment", operator: "equals", value: "false" }],
  };
  expect(ruleMatchState(absent, online)).toBe("needsBody");
  expect(ruleMatches(absent, online)).toBe(false);
  expect(
    ruleMatchState(absent, { ...online, attachmentMetadataKnown: true }),
  ).toBe("match");
  expect(
    ruleMatchState(
      {
        ...absent,
        conditions: [
          ...absent.conditions,
          { field: "subject", operator: "contains", value: "missing" },
        ],
      },
      online,
    ),
  ).toBe("noMatch");
  expect(
    ruleMatchState(
      {
        ...absent,
        mode: "any",
        conditions: [
          ...absent.conditions,
          { field: "subject", operator: "contains", value: "invoice" },
        ],
      },
      online,
    ),
  ).toBe("match");
  expect(
    ruleMatchState(
      {
        ...absent,
        conditions: [
          { field: "attachment", operator: "equals", value: "true" },
        ],
      },
      { ...online, hasAttachments: true },
    ),
  ).toBe("match");
});
it("a damaged attachment does not discard a successfully decoded body", () => {
  expect(
    ruleMatches(
      {
        ...rule,
        conditions: [{ field: "body", operator: "contains", value: "invoice" }],
      },
      {
        ...mail,
        savedLocally: true,
        body: "invoice",
        parseWarnings: ["附件片段无法解码：fixture"],
      },
    ),
  ).toBe(true);
});
