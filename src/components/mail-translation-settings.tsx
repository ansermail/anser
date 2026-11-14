import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, ChevronDown, LoaderCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "./ui/alert";
import { call } from "@/lib/api";
import {
  translationLanguages,
  translationProvider,
  translationProviders,
  type TranslationModel,
  type TranslationConfig,
} from "@/lib/mail-translation";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "./ui/field";
import { Input } from "./ui/input";
import { SelectField, SelectOption } from "./ui/select-field";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";

const empty: TranslationConfig = {
  baseUrl: "",
  model: "",
  targetLanguage: "zh-CN",
  revision: "",
  hasApiKey: false,
};
export function MailTranslationSettings() {
  const [config, setConfig] = useState<TranslationConfig>(empty);
  const [provider, setProvider] = useState("custom");
  const [models, setModels] = useState<TranslationModel[]>([]);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const activeModels = useRef("");
  const [saved, setSaved] = useState<TranslationConfig | null>(null);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    let live = true;
    mounted.current = true;
    void call<TranslationConfig | null>("get_translation_settings")
      .then((c) => {
        if (live) {
          setProvider(translationProvider(c?.baseUrl || ""));
          setSaved(c);
          setConfig(c || empty);
          setReady(true);
        }
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      live = false;
      mounted.current = false;
      if (activeModels.current)
        void call("cancel_translation", {
          requestId: activeModels.current,
        }).catch(() => {});
      activeModels.current = "";
    };
  }, []);
  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const next = await call<TranslationConfig>("save_translation_settings", {
        config,
        apiKey: key,
        clearKey,
      });
      setSaved(next);
      setConfig(next);
      setKey("");
      setClearKey(false);
      window.dispatchEvent(new Event("anser-translation-config-changed"));
      toast.success(t("Model settings saved"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  const sameAddress =
    !!saved && config.baseUrl.trim().replace(/\/+$/, "") === saved.baseUrl;
  const dirty =
    !saved ||
    !sameAddress ||
    config.model.trim() !== saved.model ||
    config.targetLanguage !== saved.targetLanguage ||
    !!key ||
    clearKey;
  const translationConfigured = !!saved?.baseUrl.trim() && !!saved.model.trim();
  const controlColumn = "translation-settings-control";
  function changeAddress(baseUrl: string) {
    setConfig((previous) => ({ ...previous, baseUrl }));
    setProvider(translationProvider(baseUrl));
    setKey("");
    setClearKey(false);
    setModels([]);
    setModelsError("");
  }
  async function fetchModels() {
    if (busy || activeModels.current) return;
    const requestId = crypto.randomUUID();
    activeModels.current = requestId;
    setBusy(true);
    setLoadingModels(true);
    setModelsError("");
    try {
      const result = await call<TranslationModel[]>("get_translation_models", {
        requestId,
        config,
        apiKey: key,
        clearKey,
      });
      if (mounted.current && activeModels.current === requestId) {
        setModels(result);
        setModelsOpen(true);
      }
    } catch (error) {
      if (mounted.current && activeModels.current === requestId)
        setModelsError(String(error));
    } finally {
      if (activeModels.current === requestId) {
        activeModels.current = "";
        if (mounted.current) {
          setBusy(false);
          setLoadingModels(false);
        }
      }
    }
  }
  function cancelModels() {
    const requestId = activeModels.current;
    activeModels.current = "";
    setBusy(false);
    setLoadingModels(false);
    if (requestId)
      void call("cancel_translation", { requestId }).catch((error) =>
        toast.error(String(error)),
      );
  }
  return (
    <Card className="translation-settings-card">
      <CardHeader>
        <CardTitle>{t("AI assistant")}</CardTitle>
        <CardDescription>
          {t(
            "Translation, email summaries and writing repair share an OpenAI-compatible model configuration.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="translation-settings"
          className="flex min-w-0 flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup className="gap-5">
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="translation-provider">
                  {t("Model service")}
                </FieldLabel>
                <FieldDescription>
                  {t(
                    "Choose an OpenAI-compatible service or enter a custom endpoint.",
                  )}
                </FieldDescription>
              </FieldContent>
              <div className={controlColumn}>
                <SelectField
                  id="translation-provider"
                  className="w-full"
                  value={provider}
                  disabled={!ready || busy}
                  onValueChange={(value) => {
                    const next = translationProviders[value];
                    if (!next) return;
                    setProvider(value);
                    setKey("");
                    setClearKey(false);
                    setModels([]);
                    setModelsError("");
                    if (value !== "custom")
                      setConfig((previous) => ({
                        ...previous,
                        baseUrl: next.baseUrl,
                        model:
                          translationProvider(previous.baseUrl) === value
                            ? previous.model
                            : next.model,
                      }));
                  }}
                >
                  {Object.entries(translationProviders).map(([value, item]) => (
                    <SelectOption value={value} key={value}>
                      {t(item.name)}
                    </SelectOption>
                  ))}
                </SelectField>
              </div>
            </Field>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="translation-url">
                  {t("Service URL")}
                </FieldLabel>
                <FieldDescription>
                  {t(
                    "Enter a base URL or full /chat/completions URL. Local models support HTTP.",
                  )}
                </FieldDescription>
              </FieldContent>
              <Input
                className={controlColumn}
                id="translation-url"
                value={config.baseUrl}
                placeholder="https://api.example.com/v1"
                required
                disabled={!ready || busy}
                onChange={(event) => changeAddress(event.target.value)}
              />
            </Field>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="translation-key">
                  {t("API key (optional)")}
                </FieldLabel>
                <FieldDescription>
                  {t(
                    "Keys are stored only in local Keychain. Enter a new key after changing the URL.",
                  )}
                </FieldDescription>
              </FieldContent>
              <div className={`${controlColumn} flex flex-col gap-2`}>
                <Input
                  id="translation-key"
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  disabled={!ready || busy}
                  placeholder={
                    clearKey
                      ? t("Clear saved key on save")
                      : sameAddress && saved?.hasApiKey
                        ? t("Saved. Leave blank to keep the current key.")
                        : t(
                            "Enter a key for this service; local services may not need one",
                          )
                  }
                  onChange={(event) => {
                    setKey(event.target.value);
                    setClearKey(false);
                  }}
                />
                {sameAddress && saved?.hasApiKey && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    disabled={busy}
                    onClick={() => {
                      setClearKey(!clearKey);
                      setKey("");
                    }}
                  >
                    {clearKey ? t("Keep saved key") : t("Clear key on save")}
                  </Button>
                )}
              </div>
            </Field>
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor="translation-model">
                  {t("Model name")}
                </FieldLabel>
                <FieldDescription>
                  {models.length
                    ? t(
                        "Found {value0} models. Select one or enter another ID.",
                        {
                          value0: models.length,
                        },
                      )
                    : t(
                        "Fetch available models. Enter an ID manually if the service does not provide a list.",
                      )}
                </FieldDescription>
              </FieldContent>
              <div className={`${controlColumn} flex flex-col gap-2`}>
                <div className="flex min-w-0 items-center gap-2">
                  <Input
                    id="translation-model"
                    value={config.model}
                    placeholder={t("Enter a model ID or choose from the list")}
                    required
                    disabled={!ready || busy}
                    onChange={(event) =>
                      setConfig({ ...config, model: event.target.value })
                    }
                  />
                  <Popover open={modelsOpen} onOpenChange={setModelsOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={!ready || busy}
                        aria-label={t("Choose model")}
                        aria-expanded={modelsOpen}
                      >
                        <ChevronDown />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-80 max-w-[calc(100vw-2rem)] p-0"
                    >
                      <Command>
                        <CommandInput placeholder={t("Search models")} />
                        <CommandList>
                          <CommandEmpty>
                            {models.length
                              ? t(
                                  "No matching model. Enter a model ID directly.",
                                )
                              : t(
                                  "Fetch the model list first, or enter a model ID",
                                )}
                          </CommandEmpty>
                          <CommandGroup>
                            {models.map((model) => (
                              <CommandItem
                                value={model.id}
                                keywords={[model.name]}
                                key={model.id}
                                onSelect={() => {
                                  setConfig((previous) => ({
                                    ...previous,
                                    model: model.id,
                                  }));
                                  setModelsOpen(false);
                                }}
                              >
                                <div className="flex min-w-0 flex-1 flex-col">
                                  <span className="break-all">
                                    {model.name}
                                  </span>
                                  {model.name !== model.id && (
                                    <span className="text-xs text-muted-foreground break-all">
                                      {model.id}
                                    </span>
                                  )}
                                </div>
                                {model.id === config.model && <Check />}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="self-end"
                  disabled={
                    !ready || (busy && !loadingModels) || !config.baseUrl.trim()
                  }
                  onClick={() =>
                    loadingModels ? cancelModels() : void fetchModels()
                  }
                >
                  {loadingModels ? (
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  {loadingModels
                    ? t("Cancel discovery")
                    : t("Fetch model list")}
                </Button>
              </div>
            </Field>
          </FieldGroup>
          {modelsError && (
            <Alert variant="destructive">
              <AlertDescription>{modelsError}</AlertDescription>
            </Alert>
          )}
          <Separator />
          <section
            className="flex flex-col gap-4"
            aria-labelledby="translation-preferences-title"
          >
            <div className="flex flex-col gap-1">
              <h3
                id="translation-preferences-title"
                className="text-sm font-semibold"
              >
                {t("Translation preferences")}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t(
                  "A saved model configuration is required before email translation can be used.",
                )}
              </p>
            </div>
            <FieldGroup className="gap-5">
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="translation-language">
                    {t("Target language")}
                  </FieldLabel>
                  <FieldDescription>
                    {translationConfigured
                      ? t(
                          "Applies after clicking the translation icon beside a message title.",
                        )
                      : t(
                          "Save the model configuration first to enable email translation.",
                        )}
                  </FieldDescription>
                </FieldContent>
                <div className={controlColumn}>
                  <SelectField
                    id="translation-language"
                    className="w-full"
                    value={config.targetLanguage}
                    disabled={!ready || busy || !translationConfigured}
                    onValueChange={(targetLanguage) =>
                      setConfig({ ...config, targetLanguage })
                    }
                  >
                    {Object.entries(translationLanguages).map(
                      ([value, label]) => (
                        <SelectOption key={value} value={value}>
                          {label}
                        </SelectOption>
                      ),
                    )}
                  </SelectField>
                </div>
              </Field>
              <Field orientation="responsive">
                <FieldContent>
                  <FieldTitle>{t("Translation cache")}</FieldTitle>
                  <FieldDescription>
                    {t("Completed translations are cached locally for reuse.")}
                  </FieldDescription>
                </FieldContent>
                <div className={controlColumn}>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!translationConfigured || busy}
                    onClick={() => {
                      setBusy(true);
                      void call("clear_translation_cache")
                        .then(async () => {
                          const next = await call<TranslationConfig | null>(
                            "get_translation_settings",
                          );
                          setSaved(next);
                          if (next)
                            setConfig((previous) => ({
                              ...previous,
                              revision: next.revision,
                              hasApiKey: next.hasApiKey,
                            }));
                          window.dispatchEvent(
                            new Event("anser-translation-config-changed"),
                          );
                          toast.success(t("Translation cache cleared"));
                        })
                        .catch((error) => toast.error(String(error)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {t("Clear translation cache")}
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </section>
          <Separator />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              disabled={
                !ready || busy || !config.baseUrl.trim() || !config.model.trim()
              }
            >
              {busy && !loadingModels ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : null}
              {busy
                ? loadingModels
                  ? t("Fetching model list…")
                  : t("Testing and saving…")
                : t("Save model settings")}
            </Button>
            <Badge variant="outline">{dirty ? t("Unsaved") : t("Saved")}</Badge>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
