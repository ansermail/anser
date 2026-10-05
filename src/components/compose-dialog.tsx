import { useConfirmation } from "@/hooks/use-confirmation";
import { MailContent } from "./mail-content";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { disableFrameContextMenu } from "@/lib/context-menu";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import {
  Paperclip,
  Send,
  Check,
  Undo2,
  X,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Clock3,
  Eye,
  Code2,
  FileUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { call, native, isDemo } from "@/lib/api";
import type { Account, Address, Compose } from "@/lib/types";
import {
  textToHtml,
  composeFormat,
  compileSource,
  prepareCompose,
  prepareEditorCompose,
  type ComposeFormat,
} from "@/lib/compose-format";
import { safeMailHtml } from "@/lib/mail-html";
import { localDateTime, scheduledIso } from "@/lib/schedule-time";
import { SchedulePicker } from "./schedule-picker";
const RichEditor = lazy(() =>
  import("./rich-editor").then((m) => ({ default: m.RichEditor })),
);
import { RecipientInput } from "./recipient-input";
import { addressTokens, parseAddresses } from "@/lib/addresses";
import { toast } from "sonner";
export function ComposeDialog({
  draft,
  onClose,
  accounts,
  onSent,
}: {
  draft: Compose | null;
  onClose: () => void;
  accounts: Account[];
  onSent: () => void;
}) {
  const { askConfirmation, cancelConfirmation, confirmationDialog } =
    useConfirmation();
  const [value, setValue] = useState<Compose | null>(null),
    [saved, setSaved] = useState(false),
    [countdown, setCountdown] = useState<number | null>(null),
    [sending, setSending] = useState(false),
    [extra, setExtra] = useState(false);
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  const [deliveryPreview, setDeliveryPreview] = useState(false);
  const previewContent = useMemo(
    () => (deliveryPreview && value ? prepareCompose(value) : null),
    [deliveryPreview, value],
  );
  const [expanded, setExpanded] = useState(false),
    [preview, setPreview] = useState(true),
    [planning, setPlanning] = useState(false),
    [planTime, setPlanTime] = useState(localDateTime);
  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceFile = useRef<HTMLInputElement>(null);
  const previewFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (previewFrame.current)
      return disableFrameContextMenu(previewFrame.current);
  }, [preview, value?.html, value?.format]);
  useEffect(() => {
    cancelConfirmation();
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setValue(draft);
    setCountdown(null);
    setSaved(false);
    setExtra(!!draft?.cc || !!draft?.bcc);
    setExpanded(false);
    setPlanning(false);
    setDeliveryPreview(false);
    setPlanTime(localDateTime());
  }, [draft, cancelConfirmation]);
  useEffect(() => {
    if (!draft) return;
    let live = true;
    void call<Address[]>("contact_suggestions")
      .then((list) => {
        if (live) setSuggestions(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [draft?.id]);
  useEffect(() => {
    if (!value || sending || countdown !== null) return;
    setSaved(false);
    const t = setTimeout(() => {
      void call("save_draft", { draft: value })
        .then(() => setSaved(true))
        .catch((e) => toast.error(String(e)));
    }, 600);
    return () => clearTimeout(t);
  }, [value, sending, countdown]);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );
  function update(p: Partial<Compose>) {
    setValue((v) => (v ? { ...v, ...p } : null));
  }
  async function close() {
    if (sending) return;
    if (timer.current) clearInterval(timer.current);
    setCountdown(null);
    if (latest.current)
      try {
        await call("save_draft", { draft: latest.current });
      } catch (e) {
        toast.error(`草稿保存失败：${e}`);
        return;
      }
    onClose();
  }
  async function send() {
    const current = latest.current;
    if (!current) return;
    setSending(true);
    setCountdown(null);
    try {
      const result = await call<string>("send_mail", {
        draft: prepareCompose(current),
      });
      toast.success(result);
      onSent();
      onClose();
    } catch (e) {
      toast.error(String(e), { duration: 10000 });
    } finally {
      setSending(false);
    }
  }
  async function valid() {
    if (!value?.accountId || !value.to.trim()) {
      toast.error("请选择发件账号并填写收件人");
      return false;
    }
    for (const [name, addresses] of [
      ["收件人", value.to],
      ["抄送", value.cc],
      ["密送", value.bcc],
    ]) {
      if (
        addressTokens(addresses).filter(Boolean).length !==
        parseAddresses(addresses).length
      ) {
        toast.error(`${name}中存在无效的邮箱地址`);
        return false;
      }
    }
    if (
      !value.subject.trim() &&
      !(await askConfirmation({
        title: "邮件主题为空",
        description: "这封邮件没有主题，仍要继续发送或安排定时发送吗？",
        action: "继续",
      }))
    )
      return false;
    return true;
  }
  async function queue() {
    const draftId = value?.id;
    if (!(await valid()) || !draftId || latest.current?.id !== draftId) return;
    setCountdown(8);
    let remaining = 8;
    timer.current = setInterval(() => {
      remaining--;
      if (remaining === 0) {
        clearInterval(timer.current!);
        timer.current = null;
        void send();
      } else setCountdown(remaining);
    }, 1000);
  }
  async function schedule(selectedTime = planTime) {
    const draftId = value?.id;
    if (!(await valid()) || !draftId || latest.current?.id !== draftId) return;
    let scheduledAt: string;
    try {
      scheduledAt = scheduledIso(selectedTime);
    } catch (e) {
      toast.error(String(e));
      return;
    }
    setSending(true);
    try {
      await call("schedule_mail", {
        draft: prepareCompose(latest.current),
        scheduledAt,
      });
      toast.success(
        isDemo()
          ? "演示发送计划已保存，不会发送邮件"
          : "发送计划已保存，可在发送记录中修改或取消",
      );
      onSent();
      onClose();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSending(false);
    }
  }
  function changeFormat(format: ComposeFormat) {
    if (!value) return;
    const prepared = prepareEditorCompose(value);
    if (format === "plain")
      update({ format, body: prepared.body, html: "", source: "" });
    else if (format === "rich")
      update({
        format,
        body: prepared.body,
        html: prepared.html || textToHtml(prepared.body),
        source: "",
      });
    else {
      const source =
        format === "html"
          ? prepared.html || textToHtml(prepared.body)
          : prepared.body;
      update({ format, source, ...compileSource(source, format) });
    }
  }
  async function importSource(file: File) {
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("正文文件超过 10 MB，请精简后导入");
      const source = await file.text();
      const format = /\.html?$/i.test(file.name) ? "html" : "markdown";
      update({ format, source, ...compileSource(source, format) });
      toast.success(`已导入 ${file.name}`);
    } catch (e) {
      toast.error(String(e));
    }
  }
  const format = value ? composeFormat(value) : "plain";
  async function attach() {
    if (!native || isDemo()) {
      toast.info("请在桌面客户端中添加真实附件");
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const paths = await open({ multiple: true, directory: false });
    if (paths)
      update({
        attachments: [
          ...(value?.attachments || []),
          ...(Array.isArray(paths) ? paths : [paths]),
        ],
      });
  }
  return (
    <Dialog
      open={!!draft}
      onOpenChange={(v) => {
        if (!v) void close();
      }}
    >
      <DialogContent
        className={`compose-dialog ${expanded ? "compose-expanded" : ""}`}
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (sending) e.preventDefault();
          else if (expanded) {
            e.preventDefault();
            setExpanded(false);
          }
        }}
      >
        <DialogHeader>
          <div className="compose-heading">
            <DialogTitle>
              {draft?.subject.startsWith("Re:")
                ? "回复邮件"
                : draft?.subject.startsWith("Fwd:")
                  ? "转发邮件"
                  : "写邮件"}
            </DialogTitle>
            <div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? "还原写信窗口" : "最大化写信窗口"}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="保存草稿并关闭"
                disabled={sending}
                onClick={() => void close()}
              >
                <X size={18} />
              </Button>
            </div>
          </div>
          <DialogDescription className="sr-only">
            编辑邮件，草稿会自动保存在本机。
          </DialogDescription>
        </DialogHeader>
        {value && (
          <>
            <fieldset disabled={sending || countdown !== null}>
              <div className="compose-row">
                <Label>发件人</Label>
                <SelectField
                  value={value.accountId}
                  onValueChange={(value) => update({ accountId: value })}
                >
                  <SelectOption value="" disabled>
                    选择发件账号
                  </SelectOption>
                  {accounts
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <SelectOption key={a.id} value={a.id}>
                        {a.name} &lt;{a.email}&gt;
                      </SelectOption>
                    ))}
                </SelectField>
              </div>
              <div className="compose-row">
                <Label htmlFor="to">收件人</Label>
                <RecipientInput
                  id="to"
                  autoFocus
                  value={value.to}
                  onChange={(to) => update({ to })}
                  suggestions={suggestions}
                />
                <Button
                  variant="ghost"
                  type="button"
                  className="text-link"
                  onClick={() => setExtra(!extra)}
                >
                  抄送 / 密送
                </Button>
              </div>
              {extra && (
                <>
                  <div className="compose-row">
                    <Label htmlFor="cc">抄送</Label>
                    <RecipientInput
                      id="cc"
                      value={value.cc}
                      onChange={(cc) => update({ cc })}
                      suggestions={suggestions}
                    />
                  </div>
                  <div className="compose-row">
                    <Label htmlFor="bcc">密送</Label>
                    <RecipientInput
                      id="bcc"
                      value={value.bcc}
                      onChange={(bcc) => update({ bcc })}
                      suggestions={suggestions}
                    />
                  </div>
                </>
              )}
              <div className="compose-row">
                <Label htmlFor="subject">主题</Label>
                <Input
                  id="subject"
                  value={value.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                  placeholder="给这封邮件一个主题"
                />
              </div>
              <div className="compose-format">
                <span>正文</span>
                <SelectField
                  aria-label="正文格式"
                  value={format}
                  onValueChange={(value) =>
                    changeFormat(value as ComposeFormat)
                  }
                >
                  <SelectOption value="plain">纯文本</SelectOption>
                  <SelectOption value="rich">富文本</SelectOption>
                  <SelectOption value="markdown">Markdown</SelectOption>
                  <SelectOption value="html">HTML 源码</SelectOption>
                </SelectField>
                {value.quote && (
                  <Label
                    htmlFor={`include-original-${value.id}`}
                    className="compose-quote-toggle"
                  >
                    <Switch
                      id={`include-original-${value.id}`}
                      checked={value.quote.included}
                      disabled={sending || countdown !== null}
                      onCheckedChange={(included) =>
                        update({ quote: { ...value.quote!, included } })
                      }
                    />
                    包含原文
                  </Label>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeliveryPreview(true)}
                >
                  <Eye size={14} />
                  发送预览
                </Button>
                {(format === "markdown" || format === "html") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPreview(!preview)}
                  >
                    <Eye size={14} />
                    {preview ? "收起预览" : "预览正文"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => sourceFile.current?.click()}
                >
                  <FileUp size={14} />
                  导入文件
                </Button>
                <Input
                  ref={sourceFile}
                  type="file"
                  accept=".html,.htm,.md,.markdown"
                  className="sr-only"
                  aria-label="导入正文文件"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void importSource(file);
                  }}
                />
              </div>
              <div
                className={`compose-editor ${(format === "markdown" || format === "html") && preview ? "source-with-preview" : ""}`}
              >
                {format === "rich" ? (
                  <Suspense
                    fallback={
                      <div className="editor-loading">
                        <LoaderCircle className="animate-spin" size={18} />
                        正在加载编辑器…
                      </div>
                    }
                  >
                    <RichEditor
                      key={`${value.id}-${format}`}
                      body={value.body}
                      html={value.html || textToHtml(value.body)}
                      disabled={sending || countdown !== null}
                      onChange={(body, html) => update({ body, html })}
                    />
                  </Suspense>
                ) : format === "markdown" || format === "html" ? (
                  <>
                    <Textarea
                      className="compose-body compose-source"
                      aria-label={
                        format === "markdown" ? "Markdown 源码" : "HTML 源码"
                      }
                      spellCheck={false}
                      placeholder={
                        format === "markdown"
                          ? "# 标题\n\n支持 **加粗**、列表、链接和表格…"
                          : "粘贴完整 HTML 文档或片段…"
                      }
                      value={value.source ?? ""}
                      onChange={(e) =>
                        update({
                          source: e.target.value,
                          ...compileSource(e.target.value, format),
                        })
                      }
                    />
                    {preview && (
                      <div
                        className="compose-preview"
                        onContextMenu={(event) => event.preventDefault()}
                      >
                        <div>
                          <Code2 size={13} />
                          正文预览
                        </div>
                        <iframe
                          ref={previewFrame}
                          title="写信正文预览"
                          sandbox="allow-same-origin"
                          referrerPolicy="no-referrer"
                          srcDoc={safeMailHtml(
                            value.html || textToHtml(value.body),
                          )}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <Textarea
                    className="compose-body"
                    aria-label="邮件正文"
                    placeholder="从一句问候开始…"
                    value={value.body}
                    onChange={(e) => update({ body: e.target.value })}
                  />
                )}
              </div>
              {value.quote?.included && (
                <section
                  className="compose-quoted-original"
                  aria-label="引用的原邮件"
                >
                  <div className="compose-quote-heading">
                    原文 · {value.quote.subject}
                  </div>
                  <MailContent
                    html={value.quote.html || textToHtml(value.quote.body)}
                    title="引用原文"
                    onOpenLink={() => {}}
                  />
                </section>
              )}
              {value.attachments.length > 0 && (
                <div className="compose-attachments">
                  {value.attachments.map((p, i) => (
                    <span key={p + i}>
                      <Paperclip size={13} />
                      {p.split("/").pop()}
                      <Button
                        variant="ghost"
                        title="移除附件"
                        onClick={() =>
                          update({
                            attachments: value.attachments.filter(
                              (_, j) => i !== j,
                            ),
                          })
                        }
                      >
                        <X size={13} />
                      </Button>
                    </span>
                  ))}
                </div>
              )}
            </fieldset>
            {planning && (
              <SchedulePicker
                value={planTime}
                onChange={setPlanTime}
                onConfirm={(time) => void schedule(time)}
                onCancel={() => setPlanning(false)}
                busy={sending}
              />
            )}
            <div className="compose-footer">
              <Button
                disabled={sending || isDemo() || !native}
                onClick={
                  countdown !== null
                    ? () => {
                        clearInterval(timer.current!);
                        timer.current = null;
                        setCountdown(null);
                      }
                    : queue
                }
              >
                {sending ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : countdown !== null ? (
                  <Undo2 size={16} />
                ) : (
                  <Send size={16} />
                )}{" "}
                {sending
                  ? "发送中…"
                  : countdown !== null
                    ? `撤销发送 · ${countdown}s`
                    : "发送邮件"}
              </Button>
              <Button
                variant="outline"
                disabled={
                  sending || countdown !== null || (!native && !isDemo())
                }
                onClick={() => setPlanning(!planning)}
              >
                <Clock3 size={16} />
                定时发送
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void attach()}
                disabled={sending || countdown !== null}
                title="添加附件"
              >
                <Paperclip size={18} />
              </Button>
              <span>
                {saved && <Check size={13} />}{" "}
                {saved ? "草稿已保存" : "正在保存草稿…"}
              </span>
              {isDemo() && <small>演示模式不会发送邮件</small>}
            </div>
          </>
        )}
      </DialogContent>
      <Dialog
        open={deliveryPreview && !!value}
        onOpenChange={setDeliveryPreview}
      >
        <DialogContent className="delivery-preview-dialog">
          <DialogHeader>
            <DialogTitle>发送效果预览</DialogTitle>
            <DialogDescription className="sr-only">
              发送正文预览，包含当前选择的原文。
            </DialogDescription>
          </DialogHeader>
          <div className="delivery-preview-body">
            {previewContent && (
              <MailContent
                title="发送效果预览正文"
                html={
                  previewContent.deliveryHtml ||
                  textToHtml(previewContent.deliveryBody || "")
                }
                onOpenLink={() => {}}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      {confirmationDialog}
    </Dialog>
  );
}
