import { useEffect, useRef, useState } from "react";
import { AlertCircle, FileUp, X } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type { Account, MailSignature } from "@/lib/types";
import {
  emptySignature,
  importSignature,
  signatureContent,
} from "@/lib/signatures";
import { textToHtml } from "@/lib/compose-format";
import { MailContent } from "./mail-content";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { SelectField, SelectOption } from "./ui/select-field";
export function MailSignatures({ accounts }: { accounts: Account[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || "");
  const [signature, setSignature] = useState(emptySignature);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null),
    revision = useRef(0),
    fileRevision = useRef(0);
  const selected = useRef(accountId);
  selected.current = accountId;
  useEffect(() => {
    if (!accounts.some((a) => a.id === accountId))
      setAccountId(accounts[0]?.id || "");
  }, [accounts, accountId]);
  useEffect(() => {
    const current = ++revision.current;
    fileRevision.current++;
    setError("");
    setSignature(emptySignature());
    if (!accountId) return;
    setLoading(true);
    void call<MailSignature>("mail_signature", { accountId })
      .then((value) => {
        if (revision.current === current) setSignature(value);
      })
      .catch((e) => {
        if (revision.current === current) setError(String(e));
      })
      .finally(() => {
        if (revision.current === current) setLoading(false);
      });
    return () => {
      revision.current++;
    };
  }, [accountId]);
  async function save() {
    if (busy || loading || !accountId) return;
    const id = accountId;
    setBusy(true);
    setError("");
    try {
      await call("save_mail_signature", { accountId: id, signature });
      if (selected.current === id)
        toast.success("邮件签名已保存，新邮件和回复将使用此签名");
    } catch (e) {
      if (selected.current === id) setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const content = signatureContent(accountId, signature);
  return (
    <Card>
      <CardHeader>
        <CardTitle>邮件签名</CardTitle>
        <CardDescription>
          按发件账号设置。签名与正文分开保存，切换账号会换用对应签名；已保存的草稿保留自己的签名。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field>
            <FieldLabel>发件账号</FieldLabel>
            <SelectField
              aria-label="签名所属账号"
              value={accountId}
              disabled={busy || !accounts.length}
              onValueChange={setAccountId}
            >
              {accounts.map((a) => (
                <SelectOption key={a.id} value={a.id}>
                  {a.name} · {a.email}
                </SelectOption>
              ))}
            </SelectField>
          </Field>
          <Field orientation="horizontal">
            <Switch
              id="signature-enabled"
              checked={signature.enabled}
              disabled={!accountId || busy || loading}
              onCheckedChange={(enabled) =>
                setSignature((v) => ({ ...v, enabled }))
              }
            />
            <FieldLabel htmlFor="signature-enabled">
              自动附加邮件签名
            </FieldLabel>
          </Field>
          <Field>
            <FieldLabel htmlFor="signature-text">签名文字</FieldLabel>
            <Textarea
              id="signature-text"
              rows={6}
              disabled={!accountId || busy || loading}
              value={signature.text}
              onChange={(e) =>
                setSignature((v) => ({ ...v, text: e.target.value }))
              }
              placeholder={"祝工作愉快！\n姓名 · 公司\n联系方式"}
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="signature-html"
              checked={signature.useHtml}
              disabled={!accountId || busy || loading}
              onCheckedChange={(checked) =>
                setSignature((v) => ({ ...v, useHtml: checked === true }))
              }
            />
            <FieldLabel htmlFor="signature-html">使用 HTML</FieldLabel>
          </Field>
          <Field>
            <FieldLabel>签名文件</FieldLabel>
            <FieldDescription>
              可以附加文本、HTML
              或图片。导入后保存文件内容，原文件移走后签名仍可使用。
            </FieldDescription>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={!accountId || busy || loading}
                onClick={() => file.current?.click()}
              >
                <FileUp data-icon="inline-start" />
                选择文件
              </Button>
              {signature.fileName && (
                <>
                  <span className="text-sm text-muted-foreground">
                    {signature.fileName}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="移除签名文件"
                    disabled={busy || loading}
                    onClick={() => {
                      fileRevision.current++;
                      setSignature((v) => ({
                        ...v,
                        fileName: "",
                        fileText: "",
                        fileHtml: "",
                      }));
                    }}
                  >
                    <X />
                  </Button>
                </>
              )}
            </div>
            <Input
              ref={file}
              type="file"
              className="sr-only"
              aria-label="导入签名文件"
              disabled={!accountId || busy || loading}
              accept=".txt,.html,.htm,.png,.jpg,.jpeg,.gif,.webp"
              onChange={(e) => {
                const input = e.target.files?.[0],
                  id = accountId;
                const fileEpoch = ++fileRevision.current;
                e.target.value = "";
                if (input)
                  void importSignature(input)
                    .then((value) => {
                      if (
                        selected.current === id &&
                        fileRevision.current === fileEpoch
                      )
                        setSignature((v) => ({ ...v, ...value }));
                    })
                    .catch((e) => toast.error(String(e)));
              }}
            />
          </Field>
        </FieldGroup>
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>签名未保存</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {(signature.text || signature.fileName) && (
          <div className="max-h-64 overflow-auto">
            <MailContent
              html={content.html || textToHtml(content.body)}
              title="签名预览"
              onOpenLink={() => {}}
            />
          </div>
        )}
        <Button
          className="self-start"
          disabled={!accountId || busy || loading}
          onClick={() => void save()}
        >
          {busy ? "正在保存…" : "保存签名"}
        </Button>
      </CardContent>
    </Card>
  );
}
