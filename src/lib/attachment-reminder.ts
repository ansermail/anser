import { htmlToText, prepareEditorCompose } from "./compose-format";
import type { Compose } from "./types";

export interface AttachmentReminder {
  key: string;
  keywords: string[];
}

const attachmentPatterns = [
  /(?:详见|参见|参阅|参考|查看|查阅|请查收|请接收|请查看|请参阅|请见|请看|见)\s*(?:本(?:封|次)邮件的?\s*)?(?:附件|随附文件|附加文件|附档)/i,
  /(?:附件|随附文件|附加文件|附档)\s*(?:如下|见下|在下方|附后|随附|请查收|请查看|供参考)/i,
  /(?:附件|随附文件|附加文件|附档)\s*(?:是|为)\s*(?:最新|修订|整理|签字|盖章)?(?:版)?(?:文件|资料|文档|材料|清单|表格|报告|合同|发票|报价|方案|提案)(?:单|表|书)?/i,
  /(?:随信|随函|一并|现|谨|稍后|会|将)?\s*附上(?=$|[。！？!?；;，,\s]|(?:最新|修订|更新|签字|盖章|整理|相关|以下|一份)?.{0,8}(?:文件|资料|文档|材料|清单|表格|报告|合同|发票|报价|方案|提案|附件|报表|证明|截图|图片|照片|简历))/i,
  /附在(?:这封|本封)?邮件(?:里|中)/i,
  /(?:作为|以)\s*(?:一个|一份)?\s*附件(?:形式)?/i,
  /通过\s*(?:邮件)?附件(?:发送|提供)?/i,
  /附件(?:将|会)?(?:单独|另外|稍后|随后)(?:发送|提供)/i,
  /(?:附件|附档)(?:中|里|内)(?:有|包含|提供|列出|说明)/i,
  /(?:详情|内容|资料|说明|明细|链接|地址).{0,12}(?:在|位于)?(?:附件|随附文件|附档)(?:中|里|内)?/i,
  /(?:查看|查收|下载|打开|参考|参阅|参见).{0,12}(?:附件|随附文件|附加文件|附档)/i,
  /(?:附件|随附文件|附加文件|附档).{0,12}(?:查看|查收|下载|打开|参考|参阅|参见)/i,
  /(?:另附|附后)(?=$|[。！？!?；;，,\s]|(?:文件|资料|文档|材料|清单|表格|报告|合同|发票))/i,
  /\b(?:see|find|review|check|open|refer to)\s+(?:the\s+)?(?:attached|attachment|enclosure)\b/i,
  /\b(?:please\s+)?(?:find|see)\s+(?:the\s+)?(?:attached|enclosed)\b/i,
  /\b(?:enclosed|attached)\s+(?:please\s+)?find\b/i,
  /\b(?:attached|enclosed)\s+(?:is|are|you will find)\b/i,
  /\b(?:i|we)(?:'ve| have)?\s+attach(?:ed|ing)?\b/i,
  /\b(?:i|we)\s+will\s+attach\b/i,
  /\bas\s+(?:an?\s+)?attachment\b/i,
  /\battached\s+(?:below|to\s+(?:this\s+)?(?:email|message))\b/i,
  /\battached\s+(?:you(?:'ll| will)?\s+find|is|are)\b/i,
  /\benclosed\s+(?:file|document|report|image|photo|spreadsheet|invoice|contract|presentation|proposal|pdf|archive)\b/i,
  /\battached\s+(?:file|document|report|image|photo|spreadsheet|invoice|contract|presentation|proposal|pdf|archive)\b/i,
  /\b(?:(?:latest|revised|updated|signed|final|draft)\s+)?(?:file|document|report|image|photo|spreadsheet|invoice|contract|presentation|proposal|pdf|archive)(?:\s+(?:is|are))?\s+attached\b/i,
  /\b(?:herewith|hereto)\s+attach(?:ed)?\b/i,
  /\b(?:details|information|instructions|report|data)\s+(?:is|are)?\s+(?:in|within)\s+(?:the\s+)?attachment\b/i,
];

const negativeContexts = [
  /(?:无|没有|不含|未有|不需要?|无需|不必|请勿|不要|不用)(?:任何)?(?:附件|附上|附加|随附)/i,
  /(?:附件|文件).{0,10}(?:功能|大小|格式|类型|上限|限制|策略|安全|病毒|预览|图标|管理|系统|设置|按钮|菜单|字段|路径|选项)/i,
  /(?:附件|文件).{0,10}(?:打不开|无法打开|下载失败|上传失败|添加失败|损坏|丢失|不可用)/i,
  /(?:你|您|对方|收件人|客户).{0,12}(?:发来|发送|提供|传来)的?(?:附件|文件)/i,
  /(?:此前|之前|上一封|上封).{0,12}(?:附件|文件)/i,
  /\b(?:no|without)\s+(?:an?\s+)?(?:attachment|attached file|enclosure)\b/i,
  /\b(?:do not|don't|never)\s+(?:attach|include an attachment)\b/i,
  /\b(?:unable|cannot|can't|failed)\s+to\s+(?:attach|upload)\b/i,
  /\battachment\s+(?:size|format|type|limit|policy|security|preview|icon|manager)\b/i,
  /\b(?:attached|enclosed)\s+(?:file|document|report|image|photo|spreadsheet|invoice|contract|presentation|proposal|pdf|archive)\b.{0,16}\b(?:failed|could not|unavailable|damaged|missing|too large)\b/i,
  /\battachment\b.{0,12}\b(?:failed|could not|unavailable|damaged|missing|too large)\b/i,
  /\b(?:sent|provided|included)\b.{0,12}\b(?:in|with)\s+(?:the\s+)?(?:previous|earlier|last)\s+(?:email|message)\b/i,
  /\b(?:file|document|report|image|photo|spreadsheet|invoice|contract|presentation|proposal|pdf|archive)\b.{0,6}\battached\s+(?:previously|earlier|before)\b/i,
];

function authoredText(draft: Compose) {
  const editor = prepareEditorCompose(draft);
  const body = editor.body.replaceAll("\u00a0", " ").trim();
  return body || htmlToText(editor.html || "");
}

function clauses(text: string) {
  return text
    .normalize("NFKC")
    .replace(/\r/g, "\n")
    .replace(/([.!?])(?=\s+[A-Z])/g, "$1\n")
    .replace(/\bhttps?:\/\/\S+/gi, " ")
    .split(/[。！？!?；;，,\n]+/)
    .map((clause) => clause.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * Detect attachment intent only in the current author's visible body. Claims
 * about attachment settings, missing attachments and earlier messages are
 * excluded because they describe attachments without requiring a new file.
 */
export function detectAttachmentReminder(
  draft: Compose,
): AttachmentReminder | null {
  const keywords: string[] = [];
  const evidence: string[] = [];
  for (const clause of clauses(authoredText(draft))) {
    if (negativeContexts.some((pattern) => pattern.test(clause))) continue;
    const match = attachmentPatterns
      .map((pattern) => pattern.exec(clause))
      .find((candidate) => candidate !== null);
    if (!match) continue;
    const keyword = match[0].replace(/\s+/g, " ").trim().slice(0, 42);
    if (!keywords.includes(keyword)) keywords.push(keyword);
    evidence.push(clause);
  }
  if (!keywords.length) return null;
  return {
    key: evidence.join("\u0001"),
    keywords: keywords.slice(0, 2),
  };
}

export function composeHasIncludedAttachment(draft: Compose) {
  if (draft.attachments.length) return true;
  if (draft.forwardFiles?.some((file) => file.included)) return true;
  const editor = prepareEditorCompose(draft);
  if (!editor.html) return false;
  const doc = new DOMParser().parseFromString(editor.html, "text/html");
  return !!doc.body.querySelector("img,video,audio,object,embed");
}
