import { t } from "@/lib/i18n";
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
import { cn } from "@/lib/utils";
import { MailContent } from "./mail-content";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "./ui/card";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
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
  const [loadedAccountId, setLoadedAccountId] = useState("");
  const savedSignature = useRef(emptySignature());
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
    setLoadedAccountId("");
    if (!accountId) return;
    setLoading(true);
    void call<MailSignature>("mail_signature", { accountId })
      .then((value) => {
        if (revision.current === current) {
          savedSignature.current = value;
          setSignature(value);
          setLoadedAccountId(accountId);
        }
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
    if (busy || loading || !accountId || loadedAccountId !== accountId) return;
    const id = accountId;
    setBusy(true);
    setError("");
    try {
      await call("save_mail_signature", { accountId: id, signature });
      if (selected.current === id) {
        savedSignature.current = signature;
        toast.success(
          t("Signature saved. New messages and replies will use it."),
        );
      }
    } catch (e) {
      if (selected.current === id) setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(enabled: boolean) {
    if (busy || loading || !accountId || loadedAccountId !== accountId) return;
    const id = accountId;
    // Toggle only the persisted enabled flag; keep unsaved edits in the editor.
    const config = { ...savedSignature.current, enabled };
    setBusy(true);
    setError("");
    try {
      await call("save_mail_signature", { accountId: id, signature: config });
      if (selected.current === id) {
        savedSignature.current = config;
        setSignature((current) => ({ ...current, enabled }));
      }
    } catch (e) {
      if (selected.current === id) setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const content = signatureContent(accountId, signature);
  return (
    <Collapsible open={signature.enabled} asChild>
      <Card>
        <CardHeader>
          <CardTitle>{t("Email signature")}</CardTitle>
          <CardDescription>
            {t(
              "Configure per sending account. Signatures are stored separately from the body. Switching accounts changes the signature; saved drafts retain their own.",
            )}
          </CardDescription>
          <CardAction className="flex flex-wrap items-center gap-3">
            <Field className="w-56 max-w-full">
              <FieldLabel className="sr-only">
                {t("Sending account")}
              </FieldLabel>
              <SelectField
                aria-label={t("Signature account")}
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

            <Switch
              id="signature-enabled"
              aria-label={t("Enable email signature")}
              aria-controls="signature-settings-content"
              aria-expanded={signature.enabled}
              checked={signature.enabled}
              disabled={
                busy || loading || loadedAccountId !== accountId || !accountId
              }
              onCheckedChange={(enabled) => void toggle(enabled)}
            />
          </CardAction>
        </CardHeader>
        {error && (
          <CardContent>
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>{t("Signature not saved")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </CardContent>
        )}
        <CollapsibleContent id="signature-settings-content" asChild>
          <CardContent className="mail-signature-layout">
            <div className="mail-signature-columns">
              <div className="flex min-w-0 flex-col gap-6">
                <FieldGroup>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="signature-html"
                      checked={signature.useHtml}
                      disabled={!accountId || busy || loading}
                      onCheckedChange={(checked) =>
                        setSignature((v) => ({
                          ...v,
                          useHtml: checked === true,
                        }))
                      }
                    />
                    <FieldLabel htmlFor="signature-html">
                      {t("Use HTML")}
                    </FieldLabel>
                  </Field>
                  <Field>
                    <FieldLabel>{t("Signature file")}</FieldLabel>
                    <FieldDescription>
                      {t(
                        "Attach text, HTML or an image. Imported content is saved and remains available after the source file is moved.",
                      )}
                    </FieldDescription>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        disabled={!accountId || busy || loading}
                        onClick={() => file.current?.click()}
                      >
                        <FileUp data-icon="inline-start" />
                        {t("Choose file")}
                      </Button>
                      {signature.fileName && (
                        <>
                          <span className="text-sm text-muted-foreground">
                            {signature.fileName}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("Remove signature file")}
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
                      aria-label={t("Import signature file")}
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
                <Button
                  className="self-start"
                  disabled={
                    !accountId ||
                    busy ||
                    loading ||
                    loadedAccountId !== accountId
                  }
                  onClick={() => void save()}
                >
                  {busy ? t("Saving…") : t("Save signature")}
                </Button>
              </div>
              <div className="mail-signature-content">
                <div
                  className={cn("signature-editor-grid", {
                    "has-preview": signature.useHtml || !!signature.fileHtml,
                  })}
                >
                  <FieldGroup>
                    <Field data-disabled={!accountId || busy || loading}>
                      <FieldLabel htmlFor="signature-text">
                        {signature.useHtml
                          ? t("HTML source")
                          : t("Signature content")}
                      </FieldLabel>
                      <Textarea
                        id="signature-text"
                        rows={14}
                        className="signature-editor-area"
                        disabled={!accountId || busy || loading}
                        value={signature.text}
                        onChange={(e) =>
                          setSignature((v) => ({ ...v, text: e.target.value }))
                        }
                        placeholder={
                          signature.useHtml
                            ? t(
                                "<p>Best regards!<br><strong>Name · Company</strong></p>",
                              )
                            : t(
                                "Best regards,\nName · Company\nContact details",
                              )
                        }
                      />
                    </Field>
                    {signature.fileName && !signature.fileHtml && (
                      <Field>
                        <FieldLabel htmlFor="signature-file-content">
                          {t("Imported text")}
                        </FieldLabel>
                        <Textarea
                          id="signature-file-content"
                          readOnly
                          value={signature.fileText}
                          rows={5}
                        />
                        <FieldDescription>
                          {t(
                            "File content follows the signature text. Import again to replace it.",
                          )}
                        </FieldDescription>
                      </Field>
                    )}
                  </FieldGroup>
                  {(signature.useHtml || signature.fileHtml) && (
                    <Field>
                      <FieldLabel id="signature-preview-label">
                        {t("Signature preview")}
                      </FieldLabel>
                      <Card
                        className="signature-preview-frame min-w-0"
                        role="region"
                        aria-labelledby="signature-preview-label"
                      >
                        <CardContent className="min-h-0 flex-1 overflow-auto">
                          <MailContent
                            html={content.html || textToHtml(content.body)}
                            title={t("Signature preview")}
                            onOpenLink={() => {}}
                          />
                        </CardContent>
                      </Card>
                      <FieldDescription>
                        {t("Preview updates as you edit")}
                      </FieldDescription>
                    </Field>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
