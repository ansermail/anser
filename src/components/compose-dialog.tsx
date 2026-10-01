import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Paperclip, Send, Check, Undo2, X, LoaderCircle } from "lucide-react";
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
import { textToHtml } from "@/lib/compose-format";
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
  const [value, setValue] = useState<Compose | null>(null),
    [saved, setSaved] = useState(false),
    [countdown, setCountdown] = useState<number | null>(null),
    [sending, setSending] = useState(false),
    [extra, setExtra] = useState(false);
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setValue(draft);
    setCountdown(null);
    setSaved(false);
    setExtra(!!draft?.cc || !!draft?.bcc);
  }, [draft]);
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
    if (!value) return;
    setSaved(false);
    const t = setTimeout(() => {
      void call("save_draft", { draft: value })
        .then(() => setSaved(true))
        .catch((e) => toast.error(String(e)));
    }, 600);
    return () => clearTimeout(t);
  }, [value]);
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
      const result = await call<string>("send_mail", { draft: current });
      toast.success(result);
      onSent();
      onClose();
    } catch (e) {
      toast.error(String(e), { duration: 10000 });
    } finally {
      setSending(false);
    }
  }
  function queue() {
    if (!value?.accountId || !value.to.trim()) {
      toast.error("请选择发件账号并填写收件人");
      return;
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
        return;
      }
    }
    if (!value.subject.trim() && !window.confirm("主题为空，仍然发送吗？"))
      return;
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
        className="compose-dialog sm:max-w-[780px]"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (sending) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>写一封新邮件</DialogTitle>
          <DialogDescription className="sr-only">
            编辑邮件，草稿会自动保存在本机。
          </DialogDescription>
        </DialogHeader>
        {value && (
          <>
            <fieldset disabled={sending || countdown !== null}>
              <div className="compose-row">
                <label>发件人</label>
                <select
                  value={value.accountId}
                  onChange={(e) => update({ accountId: e.target.value })}
                >
                  <option value="" disabled>
                    选择发件账号
                  </option>
                  {accounts
                    .filter((a) => a.enabled)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} &lt;{a.email}&gt;
                      </option>
                    ))}
                </select>
              </div>
              <div className="compose-row">
                <label htmlFor="to">收件人</label>
                <RecipientInput
                  id="to"
                  autoFocus
                  value={value.to}
                  onChange={(to) => update({ to })}
                  suggestions={suggestions}
                />
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setExtra(!extra)}
                >
                  抄送 / 密送
                </button>
              </div>
              {extra && (
                <>
                  <div className="compose-row">
                    <label htmlFor="cc">抄送</label>
                    <RecipientInput
                      id="cc"
                      value={value.cc}
                      onChange={(cc) => update({ cc })}
                      suggestions={suggestions}
                    />
                  </div>
                  <div className="compose-row">
                    <label htmlFor="bcc">密送</label>
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
                <label htmlFor="subject">主题</label>
                <Input
                  id="subject"
                  value={value.subject}
                  onChange={(e) => update({ subject: e.target.value })}
                  placeholder="给这封邮件一个主题"
                />
              </div>
              <div className="compose-format">
                <span>正文</span>
                <select
                  aria-label="正文格式"
                  value={value.html ? "html" : "plain"}
                  onChange={(e) =>
                    update({
                      html:
                        e.target.value === "html" ? textToHtml(value.body) : "",
                    })
                  }
                >
                  <option value="plain">纯文本</option>
                  <option value="html">富文本</option>
                </select>
              </div>
              {value.html ? (
                <Suspense
                  fallback={
                    <div className="editor-loading">
                      <LoaderCircle className="animate-spin" size={18} />
                      正在加载编辑器…
                    </div>
                  }
                >
                  <RichEditor
                    key={value.id}
                    body={value.body}
                    html={value.html}
                    disabled={sending || countdown !== null}
                    onChange={(body, html) => update({ body, html })}
                  />
                </Suspense>
              ) : (
                <Textarea
                  className="compose-body"
                  aria-label="邮件正文"
                  placeholder="从一句问候开始…"
                  value={value.body}
                  onChange={(e) => update({ body: e.target.value })}
                />
              )}
              {value.attachments.length > 0 && (
                <div className="compose-attachments">
                  {value.attachments.map((p, i) => (
                    <span key={p + i}>
                      <Paperclip size={13} />
                      {p.split("/").pop()}
                      <button
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
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </fieldset>
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
    </Dialog>
  );
}
