import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type {
  Account,
  FolderRetention,
  RetentionSettings,
  RetentionBudget,
} from "@/lib/types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { RetentionBudgetView } from "./retention-budget";
import { RetentionSummaryView } from "./retention-summary";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from "./ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

export function RetentionDialog({
  account,
  onClose,
  onSaved,
  onboarding = false,
}: {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
  onboarding?: boolean;
}) {
  const epoch = useRef(0);
  const inspection = useRef<string | null>(null);
  const [budget, setBudget] = useState<RetentionBudget | null>(null);
  const [checking, setChecking] = useState(false);
  const [budgetError, setBudgetError] = useState("");
  function cancelInspection() {
    const requestId = inspection.current;
    inspection.current = null;
    if (requestId)
      void call("cancel_retention_inspection", { requestId }).catch(() => {});
    setChecking(false);
  }

  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [days, setDays] = useState("");
  const summaryFlight = useRef(false);
  const refreshSummaryRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!account) return;
    const timer = window.setInterval(() => refreshSummaryRef.current(), 5000);
    return () => window.clearInterval(timer);
  }, [account?.id]);
  useEffect(() => {
    const current = ++epoch.current;
    setSettings(null);
    setBudget(null);
    setBudgetError("");
    setChecking(false);
    setValues({});
    setError("");
    setBusy(false);
    setDays("");
    if (!account) return;
    setLoading(true);
    void call<RetentionSettings>("retention_settings", { id: account.id })
      .then((data) => {
        if (epoch.current !== current) return;
        setSettings(data);
        setDays(data.account?.serverRetentionDays?.toString() || "");
        setValues(
          Object.fromEntries(
            data.overrides.map((item) => [
              item.folder,
              item.saveLocally ? "save" : "online",
            ]),
          ),
        );
      })
      .catch((e) => {
        if (epoch.current === current) setError(String(e));
      })
      .finally(() => {
        if (epoch.current === current) setLoading(false);
      });
    return () => {
      if (epoch.current === current) epoch.current++;
      const requestId = inspection.current;
      inspection.current = null;
      if (requestId)
        void call("cancel_retention_inspection", { requestId }).catch(() => {});
    };
  }, [account?.id]);
  // Every scope change invalidates a prior snapshot, including edits that have
  // not been saved. Closing/changing account also interrupts its socket.
  useEffect(() => {
    cancelInspection();
    setBudget(null);
    setBudgetError("");
  }, [
    JSON.stringify(values),
    settings?.defaultSave,
    JSON.stringify(settings?.folders),
  ]);
  if (!account) return null;
  const folders =
    account.protocol === "imap"
      ? settings?.folders.filter((f) => f.selectable) || []
      : [];
  const validDays =
    days === "" ||
    (/^\d+$/.test(days) && Number(days) > 0 && Number(days) <= 3650);
  const missing = Object.keys(values).filter(
    (name) => !folders.some((f) => f.name === name),
  );
  async function inspectBudget() {
    if (
      !account ||
      !settings ||
      busy ||
      loading ||
      checking ||
      inspection.current ||
      missing.length
    )
      return;
    const requestId = crypto.randomUUID();
    const current = epoch.current;
    inspection.current = requestId;
    setChecking(true);
    setBudget(null);
    setBudgetError("");
    try {
      const result = await call<RetentionBudget>("inspect_retention_budget", {
        account: settings.account || account,
        overrides: Object.entries(values).map(([folder, value]) => ({
          folder,
          saveLocally: value === "save",
        })),
        requestId,
      });
      if (epoch.current === current && inspection.current === requestId)
        setBudget(result);
    } catch (cause) {
      if (epoch.current === current && inspection.current === requestId)
        setBudgetError(String(cause));
    } finally {
      if (inspection.current === requestId) {
        inspection.current = null;
        setChecking(false);
      }
    }
  }
  async function refresh() {
    if (!account || loading || busy) return;
    const current = epoch.current;
    setLoading(true);
    setError("");
    try {
      await call("account_folders", { id: account.id });
      const data = await call<RetentionSettings>("retention_settings", {
        id: account.id,
      });
      if (epoch.current === current) setSettings(data);
    } catch (e) {
      if (epoch.current === current) setError(String(e));
    } finally {
      if (epoch.current === current) setLoading(false);
    }
  }
  async function refreshSummary(background = false) {
    if (!account || loading || busy || summaryFlight.current) return;
    const current = epoch.current;
    summaryFlight.current = true;
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const data = await call<RetentionSettings>("retention_settings", {
        id: account.id,
      });
      if (epoch.current === current)
        setSettings((old) => (old ? { ...old, summary: data.summary } : data));
    } catch (e) {
      if (epoch.current === current && !background) setError(String(e));
    } finally {
      summaryFlight.current = false;
      if (epoch.current === current && !background) setLoading(false);
    }
  }
  refreshSummaryRef.current = () => void refreshSummary(true);
  async function save() {
    if (
      !account ||
      !settings ||
      loading ||
      busy ||
      missing.length ||
      !validDays
    )
      return;
    const current = epoch.current;
    cancelInspection();
    setBusy(true);
    setError("");
    const overrides: FolderRetention[] = Object.entries(values).map(
      ([folder, value]) => ({ folder, saveLocally: value === "save" }),
    );
    try {
      await call("save_retention", {
        account: {
          ...(settings.account || account),
          serverRetentionDays: days === "" ? null : Number(days),
        },
        overrides,
      });
      if (epoch.current !== current) return;
      toast.success(
        account.protocol === "imap"
          ? t("Folder retention scope saved")
          : t("Local storage settings saved"),
      );
      onSaved();
      onClose();
    } catch (e) {
      if (epoch.current === current) setError(String(e));
    } finally {
      if (epoch.current === current) setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] overflow-y-auto"
        showCloseButton={!busy}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {onboarding
              ? t("Mailbox connected")
              : account.protocol === "imap"
                ? t("Folder retention scope")
                : t("Local storage settings")}
          </DialogTitle>
          <DialogDescription>
            {account.name} · {account.email}
          </DialogDescription>
        </DialogHeader>
        {onboarding && (
          <Alert>
            <AlertDescription>
              {t(
                "Incoming and outgoing servers verified. Background checks use your selected account default. Adjust the retention scope here or later in Settings & accounts.",
              )}
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          {t("Account default: ")}
          {settings
            ? settings.defaultSave
              ? t("Save complete messages")
              : t("Read online")
            : t("Reading")}
          {t(". Each folder can override this; existing full archives remain.")}
        </p>
        <p className="text-sm text-muted-foreground">
          {account.protocol === "pop3"
            ? t(
                "POP3 saves messages available from the server and mail sent by this client, following the account setting.",
              )
            : t(
                "Junk and Trash are not fetched automatically. Choosing Save complete messages includes them in background checks; the next check fills in available bodies and attachments.",
              )}
        </p>
        {settings?.summary && (
          <RetentionSummaryView
            summary={settings.summary}
            busy={busy || loading}
            onRefresh={() => void refreshSummary()}
            budgetContent={
              budget ? (
                <RetentionBudgetView
                  budget={budget}
                  currentPath={settings.summary.dataDir}
                />
              ) : budgetError ? (
                <Alert variant="destructive">
                  <AlertDescription>{budgetError}</AlertDescription>
                </Alert>
              ) : null
            }
            budgetActions={
              checking ? (
                <Button variant="outline" size="sm" onClick={cancelInspection}>
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                  {t("Cancel estimate")}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || loading || !settings || missing.length > 0}
                  onClick={() => void inspectBudget()}
                >
                  {t("Check server count & space")}
                </Button>
              )
            }
          />
        )}
        {loading && !settings && (
          <Skeleton
            className="h-48"
            aria-label={t("Loading retention scope")}
          />
        )}
        {settings && (
          <FieldGroup className="gap-4">
            <Field data-invalid={!validDays}>
              <FieldLabel htmlFor="server-retention-days">
                {t("Server retention (days, optional)")}
              </FieldLabel>
              <Input
                id="server-retention-days"
                type="number"
                min={1}
                max={3650}
                step={1}
                value={days}
                disabled={busy || loading}
                aria-invalid={!validDays}
                placeholder={t("For example: 3. Leave blank if unknown.")}
                onChange={(e) => setDays(e.target.value)}
              />
              <FieldDescription>
                {validDays
                  ? t(
                      "Used for saving reminders only; server deletion rules are unchanged. Enter 1–3650 days. Only fully downloaded messages have local copies.",
                    )
                  : t(
                      "Enter an integer from 1 to 3650, or leave blank if unknown.",
                    )}
              </FieldDescription>
            </Field>
            {folders.map((folder, i) => (
              <Field key={folder.name} orientation="horizontal">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <FieldLabel htmlFor={`retention-${i}`}>
                    {folder.displayName}
                  </FieldLabel>
                  {folder.syncError && (
                    <FieldDescription>
                      {t(
                        "Source needs review. Saving settings does not bypass source verification.",
                      )}
                    </FieldDescription>
                  )}
                </div>
                <Select
                  value={values[folder.name] || "inherit"}
                  disabled={loading || busy}
                  onValueChange={(value) =>
                    setValues((old) => {
                      const next = { ...old };
                      if (value === "inherit") delete next[folder.name];
                      else next[folder.name] = value;
                      return next;
                    })
                  }
                >
                  <SelectTrigger
                    id={`retention-${i}`}
                    aria-label={t("Retention for {value0}", {
                      value0: folder.displayName,
                    })}
                    className="w-40 shrink-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="inherit">
                        {t("Follow account default")}
                      </SelectItem>
                      <SelectItem value="save">
                        {t("Save complete messages")}
                      </SelectItem>
                      <SelectItem value="online">{t("Read online")}</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ))}
            {!folders.length && account.protocol === "imap" && (
              <FieldDescription>
                {t(
                  "No readable folders. Refresh the folders or complete a mail check. The account default applies for now.",
                )}
              </FieldDescription>
            )}
            {missing.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  {t("There are ")}
                  {missing.length}
                  {t(" obsolete folder settings. Refresh folders, or ")}
                  <Button
                    variant="link"
                    disabled={busy || loading}
                    onClick={() =>
                      setValues((old) =>
                        Object.fromEntries(
                          Object.entries(old).filter(
                            ([name]) => !missing.includes(name),
                          ),
                        ),
                      )
                    }
                  >
                    {t("remove obsolete settings")}
                  </Button>
                  {t(" before saving.")}
                </AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw />
            {t("Refresh folders")}
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {onboarding ? t("Set up later") : t("Cancel")}
          </Button>
          <Button
            disabled={
              !settings || loading || busy || missing.length > 0 || !validDays
            }
            onClick={() => void save()}
          >
            {busy
              ? t("Saving…")
              : account.protocol === "imap"
                ? t("Save scope")
                : t("Save settings")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
