// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  composeHasIncludedAttachment,
  detectAttachmentReminder,
} from "./attachment-reminder";
import type { Compose } from "./types";

function draft(patch: Partial<Compose> = {}): Compose {
  return {
    id: "attachment-reminder",
    accountId: "account",
    to: "receiver@example.com",
    cc: "",
    bcc: "",
    subject: "Report",
    body: "",
    format: "plain",
    attachments: [],
    ...patch,
  };
}

describe("attachment wording detection", () => {
  it.each([
    "详情参见附件",
    "我会附上最新报价",
    "随信附上整理后的资料",
    "附件如下，请查收",
    "附件是签字版合同",
    "报价单附在这封邮件中",
    "相关资料已作为附件提供",
    "详情在附件中",
    "表单另附",
    "我会附上。",
    "附件稍后发送",
    "请从邮件附件下载材料",
  ])("recognizes the Chinese attachment intent in %s", (body) => {
    expect(
      detectAttachmentReminder(draft({ body }))?.keywords,
    ).not.toHaveLength(0);
  });

  it.each([
    "Please see the attached document.",
    "Please find the attached report.",
    "I have attached the latest quotation.",
    "The signed contract is attached.",
    "Please find the revised proposal attached.",
    "Enclosed please find the revised proposal.",
    "The detailed instructions are in the attachment.",
    "Attached to this email is the latest report.",
    "Please see attached below.",
  ])("recognizes the English attachment intent in %s", (body) => {
    expect(
      detectAttachmentReminder(draft({ body }))?.keywords,
    ).not.toHaveLength(0);
  });

  it.each([
    "附件大小限制为 20 MB",
    "没有附件，请忽略",
    "附件下载失败",
    "你发来的附件打不开",
    "我会另附近日安排说明",
    "The attachment size limit is 25 MB.",
    "No attachment was sent.",
    "I sent the attachment in the previous email.",
    "The bug is in the attachment parser.",
    "The report attached previously is still relevant.",
    "I cannot attach the file because it is too large.",
    "附件是在哪里设置的？",
    "我会附上我的联系方式",
    "附件为必填项",
    "通过附件系统发送",
    "The attached file could not be opened.",
  ])("does not treat descriptive or negative context as intent: %s", (body) => {
    expect(detectAttachmentReminder(draft({ body }))).toBeNull();
  });

  it("reads the visible rich-text and Markdown bodies", () => {
    const rich = detectAttachmentReminder(
      draft({
        format: "rich",
        html: "<p>详细内容请见附件。</p>",
      }),
    );
    expect(rich?.keywords.join(" ")).toContain("附件");
    const markdown = detectAttachmentReminder(
      draft({
        format: "markdown",
        source: "请查收附件中的**报价单**。",
      }),
    );
    expect(markdown?.keywords.join(" ")).toContain("附件");
  });

  it("does not inspect the signature or quoted original", () => {
    expect(
      detectAttachmentReminder(
        draft({
          body: "收到，谢谢。",
          signature: {
            accountId: "account",
            included: true,
            body: "详见附件",
            html: "<p>详见附件</p>",
          },
          quote: {
            kind: "reply",
            included: true,
            sender: "sender@example.com",
            recipients: "receiver@example.com",
            date: "2026-11-15T08:00:00Z",
            subject: "Previous",
            body: "请见附件",
            html: "<p>请见附件</p>",
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("included attachment content", () => {
  it("counts selected files, included forwarded files and authored inline media", () => {
    expect(
      composeHasIncludedAttachment(draft({ attachments: ["/tmp/report.pdf"] })),
    ).toBe(true);
    expect(
      composeHasIncludedAttachment(
        draft({
          forwardFiles: [
            {
              id: "forwarded",
              name: "report.pdf",
              mime: "application/pdf",
              size: 1024,
              included: true,
            },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      composeHasIncludedAttachment(
        draft({
          format: "rich",
          html: '<p><img src="data:image/png;base64,AA=="></p>',
        }),
      ),
    ).toBe(true);
  });

  it("does not count an unchecked forwarded attachment", () => {
    expect(
      composeHasIncludedAttachment(
        draft({
          forwardFiles: [
            {
              id: "forwarded",
              name: "report.pdf",
              mime: "application/pdf",
              size: 1024,
              included: false,
            },
          ],
        }),
      ),
    ).toBe(false);
  });
});
