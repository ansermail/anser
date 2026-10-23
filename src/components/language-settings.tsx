import { useEffect, useRef, useState } from "react";
import { call } from "@/lib/api";
import {
  setInterfaceLanguage,
  interfaceLanguageRevision,
  languageOptions,
  t,
  useLanguage,
  type InterfaceLanguage,
} from "@/lib/i18n";
import { toast } from "sonner";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Field, FieldLabel } from "./ui/field";
import { SelectField, SelectOption } from "./ui/select-field";
import { SelectGroup } from "./ui/select";

export function LanguageSettings() {
  const language = useLanguage();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    const revision = interfaceLanguageRevision();
    void call<InterfaceLanguage>("get_interface_language")
      .then((saved) => {
        if (live.current) {
          if (revision === interfaceLanguageRevision())
            setInterfaceLanguage(saved);
          setReady(true);
        }
      })
      .catch((error) => {
        if (live.current) toast.error(String(error));
      });
    return () => {
      live.current = false;
    };
  }, []);
  async function change(next: string) {
    if (saving.current || !ready || (next !== "zh-CN" && next !== "en")) return;
    saving.current = true;
    setBusy(true);
    try {
      await call("set_interface_language", { language: next });
      if (live.current) setInterfaceLanguage(next);
    } catch (error) {
      if (live.current) toast.error(String(error));
    } finally {
      saving.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <Card className="language-settings-card">
      <CardHeader>
        <CardTitle>{t("Interface language")}</CardTitle>
        <CardDescription
          id="interface-language-description"
          className="flex flex-col gap-1 leading-relaxed"
        >
          <span>
            {t("Choose Anser's display language. Changes apply immediately.")}
          </span>
          <span>
            {t(
              "Changes the application interface only. Original messages and the body translation target keep their own settings.",
            )}
          </span>
        </CardDescription>
        <CardAction className="self-center">
          <Field orientation="horizontal" className="w-fit max-w-full">
            <FieldLabel htmlFor="interface-language">
              {t("Language / 语言")}
            </FieldLabel>
            <SelectField
              id="interface-language"
              className="w-40 shrink-0"
              aria-describedby="interface-language-description"
              value={language}
              disabled={!ready || busy}
              onValueChange={(value) => void change(value)}
            >
              <SelectGroup>
                {languageOptions.map((option) => (
                  <SelectOption key={option.code} value={option.code}>
                    {option.label}
                  </SelectOption>
                ))}
              </SelectGroup>
            </SelectField>
          </Field>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
