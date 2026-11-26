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
        <CardTitle id="interface-language-title">
          {t("Interface language")}
        </CardTitle>
        <CardDescription id="interface-language-description">
          {t("Interface language and translation language are set separately.")}
        </CardDescription>
        <CardAction className="self-center">
          <SelectField
            id="interface-language"
            className="settings-choice"
            aria-labelledby="interface-language-title"
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
        </CardAction>
      </CardHeader>
    </Card>
  );
}
