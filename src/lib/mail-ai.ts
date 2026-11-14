import { call, isDemo, native } from "./api";
import { interfaceLanguage, t } from "./i18n";
import type { TranslationConfig } from "./mail-translation";

export type MailSummary = {
  conclusion: string;
  points: string[];
  reminders: { title: string; date: string; time: string; evidence: string }[];
};

export type MailRepair = {
  message: string;
  edits: { index: number; text: string }[];
};

export const mailAiSettingsEvent = "anser-open-ai-settings";

export async function openMailAiSettings() {
  if (native && !isDemo()) await call("open_mail_ai_settings");
  else window.dispatchEvent(new Event(mailAiSettingsEvent));
}

export async function mailAiConfig() {
  const config = await call<TranslationConfig | null>(
    "get_translation_settings",
  );
  if (!config && !isDemo()) return null;
  return {
    revision: config?.revision ?? "demo",
    targetLanguage: config?.targetLanguage ?? interfaceLanguage(),
  };
}

export function cancelMailAi(requestId: string) {
  if (requestId) void call("cancel_translation", { requestId }).catch(() => {});
}

export function mailAiError(error: unknown) {
  const detail = String(error);
  const status = /HTTP\s*(\d{3})/.exec(detail)?.[1];
  if (status) {
    const hint =
      {
        "401":
          "The model service rejected the API key. Check the saved credential.",
        "402": "The model account has insufficient balance or quota.",
        "403":
          "The model service denied access. Check the account permissions and service region.",
        "404":
          "The model endpoint or model name was not found. Check both settings.",
        "429":
          "The model service is rate limiting requests. Retry later or check the quota.",
      }[status] ??
      (Number(status) >= 500
        ? "The model service is temporarily unavailable. Retry later."
        : "The model service rejected the request. Check the saved configuration.");
    return t(hint);
  }
  const known: [RegExp, string][] = [
    [
      /^模型配置已变化/,
      "The model configuration changed. Submit this change again.",
    ],
    [/^AI 请求已取消/, "The AI request was cancelled."],
    [/^AI 请求超时/, "The AI request timed out. Try again."],
    [
      /^连接模型服务超时/,
      "The model connection timed out. Check the service address and global proxy.",
    ],
    [
      /^(等待模型响应|读取完整模型响应)超时/,
      "The model response timed out. Retry later or use a faster model.",
    ],
    [
      /^(无法建立模型连接|模型连接初始化失败)/,
      "The model service could not be reached. Check the network, proxy, and service address.",
    ],
    [
      /^模型响应读取中断/,
      "The model response was interrupted. Check the network and retry.",
    ],
    [
      /^模型请求传输失败/,
      "The model request could not be completed. Check the service and proxy, then retry.",
    ],
    [
      /^模型返回的内容不符合格式/,
      "The model returned an invalid format. Retry or choose a model that supports JSON output.",
    ],
    [
      /^模型输出提前结束/,
      "The model output ended before it was complete. Shorten the text or retry.",
    ],
    [
      /^模型响应过大/,
      "The model response was too large. Shorten the text or use another model.",
    ],
    [
      /^(无法访问翻译密钥钥匙串|无法读取本地凭据库密钥|凭据库保存失败)/,
      "The local credential store is unavailable. Unlock the system keychain and reopen Anser.",
    ],
    [
      /^模型返回的内容|^模型没有返回|^模型返回了|^模型未返回/,
      "The model returned an invalid revision. Retry or use another model.",
    ],
    [/^模型已(停止|取消)|^AI 请求已取消/, "The AI request was cancelled."],
    [/^Invalid repair$/, "The model returned an invalid revision. Retry."],
  ];
  const match = known.find(([pattern]) => pattern.test(detail));
  return match
    ? t(match[1])
    : t("The AI request failed. Check the saved model settings and try again.");
}
