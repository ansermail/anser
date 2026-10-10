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
          ? "文件夹保存范围已保存"
          : "本地保存设置已保存",
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
              ? "邮箱已连接"
              : account.protocol === "imap"
                ? "文件夹保存范围"
                : "本地保存设置"}
          </DialogTitle>
          <DialogDescription>
            {account.name} · {account.email}
          </DialogDescription>
        </DialogHeader>
        {onboarding && (
          <Alert>
            <AlertDescription>
              收发服务器验证通过。后台将按你选择的账号默认方式收取；这里可以进一步调整保存范围，之后也能在设置与账号中修改。
            </AlertDescription>
          </Alert>
        )}
        <p className="text-sm text-muted-foreground">
          账号默认：
          {settings
            ? settings.defaultSave
              ? "完整保存"
              : "在线阅读"
            : "读取中"}
          。可为每个文件夹单独设置；已有完整存档保留。
        </p>
        <p className="text-sm text-muted-foreground">
          {account.protocol === "pop3"
            ? "POP3 保存服务端可收取的邮件及本客户端发送的邮件，保存方式跟随账号设置。"
            : "垃圾邮件和废纸篓默认不自动收取。选择“完整保存”后纳入后台收取；下次收取会补齐可用邮件的正文与附件。"}
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
                  取消预算检查
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || loading || !settings || missing.length > 0}
                  onClick={() => void inspectBudget()}
                >
                  检查服务器数量与空间
                </Button>
              )
            }
          />
        )}
        {loading && !settings && (
          <Skeleton className="h-48" aria-label="正在加载保存范围" />
        )}
        {settings && (
          <FieldGroup className="gap-4">
            <Field data-invalid={!validDays}>
              <FieldLabel htmlFor="server-retention-days">
                服务器保留期（天，可选）
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
                placeholder="例如 3；未知时留空"
                onChange={(e) => setDays(e.target.value)}
              />
              <FieldDescription>
                {validDays
                  ? "仅用于待保存提醒，不改变服务器删除规则。可填写 1–3650 天；只有删除前完整下载的邮件才有本地副本。"
                  : "请输入 1–3650 的整数，未知时留空。"}
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
                      来源需核查，设置保存后仍须通过来源检查。
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
                    aria-label={`${folder.displayName}保存方式`}
                    className="w-40 shrink-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="inherit">跟随账号</SelectItem>
                      <SelectItem value="save">完整保存</SelectItem>
                      <SelectItem value="online">在线阅读</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            ))}
            {!folders.length && account.protocol === "imap" && (
              <FieldDescription>
                尚无可读取文件夹，请刷新目录或先完成收取。当前按账号默认方式处理。
              </FieldDescription>
            )}
            {missing.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  有 {missing.length} 个已失效文件夹设置。请刷新目录，或
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
                    移除失效设置
                  </Button>
                  后保存。
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
            刷新目录
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {onboarding ? "以后再设置" : "取消"}
          </Button>
          <Button
            disabled={
              !settings || loading || busy || missing.length > 0 || !validDays
            }
            onClick={() => void save()}
          >
            {busy
              ? "正在保存…"
              : account.protocol === "imap"
                ? "保存范围"
                : "保存设置"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
