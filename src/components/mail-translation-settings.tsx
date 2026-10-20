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
  type TranslationPart,
} from "@/lib/mail-translation";
import { Button } from "./ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Field, FieldLabel, FieldDescription, FieldGroup } from "./ui/field";
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
  const [testResult, setTestResult] = useState<{
    status: "running" | "success" | "error";
    message: string;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const testing = testResult?.status === "running";
  const activeTest = useRef("");
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
      if (activeTest.current)
        void call("cancel_translation", {
          requestId: activeTest.current,
        }).catch(() => {});
      activeTest.current = "";
      if (activeModels.current)
        void call("cancel_translation", {
          requestId: activeModels.current,
        }).catch(() => {});
      activeModels.current = "";
    };
  }, []);
  async function save() {
    if (busy || activeTest.current) return;
    setBusy(true);
    setTestResult(null);
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
      toast.success(t("Translation settings saved"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    if (!saved || busy || activeTest.current) return;
    const requestId = crypto.randomUUID();
    activeTest.current = requestId;
    setBusy(true);
    setCancelling(false);
    setTestResult({
      status: "running",
      message: t(
        "Sending fixed test text and waiting for the model (up to 180 seconds). Cancel anytime. No real messages are sent.",
      ),
    });
    try {
      const parts = await call<TranslationPart[]>("test_translation_settings", {
        requestId,
        revision: saved.revision,
      });
      if (mounted.current && activeTest.current === requestId) {
        const message = t("Connection successful: {value0}", {
          value0: parts[0].text.slice(0, 100),
        });
        setTestResult({ status: "success", message });
        toast.success(message);
      }
    } catch (e) {
      if (mounted.current && activeTest.current === requestId) {
        setTestResult({ status: "error", message: String(e) });
        toast.error(String(e));
      }
    } finally {
      if (activeTest.current === requestId) {
        activeTest.current = "";
        if (mounted.current) {
          setBusy(false);
          setCancelling(false);
        }
      }
    }
  }
  async function cancelTest() {
    const requestId = activeTest.current;
    if (!requestId || cancelling) return;
    // 先废弃旧结果，防止取消回执之前的成功/失败覆盖取消状态。
    activeTest.current = "";
    setCancelling(true);
    try {
      await call("cancel_translation", { requestId });
      if (mounted.current)
        setTestResult({
          status: "success",
          message: t("Test canceled. No automatic retry was made."),
        });
    } catch (e) {
      if (mounted.current) {
        setTestResult({
          status: "error",
          message: t(
            "Could not cancel test: {value0}. Wait for the original request to time out.",
            {
              value0: String(e),
            },
          ),
        });
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
        setCancelling(false);
      }
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
  const isConnected =
    testResult?.status === "success" &&
    testResult.message.startsWith("连接成功");
  function changeAddress(baseUrl: string) {
    setConfig((previous) => ({ ...previous, baseUrl }));
    setProvider(translationProvider(baseUrl));
    setKey("");
    setClearKey(false);
    setModels([]);
    setModelsError("");
    setTestResult(null);
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
        <CardTitle>{t("AI translation")}</CardTitle>
        <CardDescription>
          {t(
            "Keep the original message and show translations below each paragraph. Supports OpenAI-compatible services and local models.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="translation-settings-grid">
          <form
            id="translation-settings"
            className="flex min-w-0 flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="translation-provider">
                  {t("Model service")}
                </FieldLabel>
                <SelectField
                  id="translation-provider"
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
                    setTestResult(null);
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
              </Field>
              <Field>
                <FieldLabel htmlFor="translation-url">
                  {t("Service URL")}
                </FieldLabel>
                <Input
                  id="translation-url"
                  value={config.baseUrl}
                  placeholder="https://api.example.com/v1"
                  required
                  disabled={!ready || busy}
                  onChange={(event) => changeAddress(event.target.value)}
                />
                <FieldDescription>
                  {t(
                    "Enter a base URL or full /chat/completions URL. Local models support HTTP.",
                  )}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="translation-key">
                  {t("API key (optional)")}
                </FieldLabel>
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldDescription>
                    {t(
                      "Keys are stored only in local Keychain. Enter a new key after changing the URL.",
                    )}
                  </FieldDescription>
                  {sameAddress && saved?.hasApiKey && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
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
              <Field>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <FieldLabel htmlFor="translation-model">
                    {t("Model name")}
                  </FieldLabel>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={
                      !ready ||
                      (busy && !loadingModels) ||
                      !config.baseUrl.trim()
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
              </Field>
            </FieldGroup>
            {modelsError && (
              <Alert variant="destructive">
                <AlertDescription>{modelsError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!ready || busy}>
                {busy && !testing && !loadingModels
                  ? t("Processing…")
                  : t("Save translation settings")}
              </Button>
              <Badge variant="outline">
                {dirty ? t("Unsaved") : t("Saved")}
              </Badge>
            </div>
          </form>
          <Separator
            orientation="vertical"
            className="translation-settings-divider"
          />
          <section
            className="translation-settings-test flex min-w-0 flex-col gap-5"
            aria-label={t("Translation preferences & connection test")}
          >
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="translation-language">
                  {t("Target language")}
                </FieldLabel>
                <SelectField
                  id="translation-language"
                  value={config.targetLanguage}
                  disabled={!ready || busy}
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
                <FieldDescription>
                  {t(
                    "Applies after clicking the translation icon beside a message title.",
                  )}
                </FieldDescription>
              </Field>
            </FieldGroup>
            <Separator />
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4>{t("Connection test")}</h4>
                <Badge
                  variant={
                    testResult?.status === "error"
                      ? "destructive"
                      : isConnected
                        ? "secondary"
                        : "outline"
                  }
                >
                  {testing
                    ? t("Testing")
                    : isConnected
                      ? t("Connected")
                      : testResult?.status === "error"
                        ? t("Connection failed")
                        : t("Not tested")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {t(
                  "Sends only the fixed text “Hello, world.”, never email content.",
                )}
              </p>
              {testResult ? (
                <Alert
                  variant={
                    testResult.status === "error" ? "destructive" : "default"
                  }
                  role={testResult.status === "error" ? "alert" : "status"}
                >
                  <AlertDescription className="break-words">
                    {testResult.message}
                  </AlertDescription>
                </Alert>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {dirty
                    ? t(
                        "Save the current settings before testing the connection.",
                      )
                    : t("Settings saved. You can test the current model.")}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!saved || busy || dirty}
                  onClick={() => void test()}
                >
                  {testing && (
                    <LoaderCircle
                      data-icon="inline-start"
                      aria-hidden="true"
                      className="animate-spin"
                    />
                  )}
                  {testing ? t("Testing…") : t("Test saved settings")}
                </Button>
                {testing && (
                  <Button
                    variant="outline"
                    disabled={cancelling}
                    onClick={() => void cancelTest()}
                  >
                    {cancelling ? t("Canceling…") : t("Cancel test")}
                  </Button>
                )}
              </div>
            </div>
            <Separator />
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                {t(
                  "Remote requests use the global proxy; local models connect directly. Completed translations are cached locally for reuse.",
                )}
              </p>
              <Button
                variant="ghost"
                disabled={!saved || busy}
                onClick={() => {
                  setBusy(true);
                  setTestResult(null);
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
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
