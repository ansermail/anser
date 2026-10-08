import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type { Account, FolderRetention, RetentionSettings } from "@/lib/types";
import { Button } from "./ui/button";
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
}: {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const epoch = useRef(0);
  const [settings, setSettings] = useState<RetentionSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const current = ++epoch.current;
    setSettings(null);
    setValues({});
    setError("");
    setBusy(false);
    if (!account) return;
    setLoading(true);
    void call<RetentionSettings>("retention_settings", { id: account.id })
      .then((data) => {
        if (epoch.current !== current) return;
        setSettings(data);
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
    };
  }, [account?.id]);
  if (!account) return null;
  const folders = settings?.folders.filter((f) => f.selectable) || [];
  const missing = Object.keys(values).filter(
    (name) => !folders.some((f) => f.name === name),
  );
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
  async function save() {
    if (!account || !settings || loading || busy || missing.length) return;
    const current = epoch.current;
    setBusy(true);
    setError("");
    const overrides: FolderRetention[] = Object.entries(values).map(
      ([folder, value]) => ({ folder, saveLocally: value === "save" }),
    );
    try {
      await call("save_retention", { account, overrides });
      if (epoch.current !== current) return;
      toast.success("文件夹保存范围已保存");
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
          <DialogTitle>文件夹保存范围</DialogTitle>
          <DialogDescription>
            {account.name} · {account.email}
          </DialogDescription>
        </DialogHeader>
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
          垃圾邮件和废纸篓默认不自动收取。选择“完整保存”后纳入后台收取；下次收取会补齐可用邮件的正文与附件。
        </p>
        {loading && !settings && (
          <Skeleton className="h-48" aria-label="正在加载保存范围" />
        )}
        {settings && (
          <FieldGroup className="gap-4">
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
            {!folders.length && (
              <FieldDescription>
                尚无可读取文件夹，请刷新目录或先完成收取。
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
            取消
          </Button>
          <Button
            disabled={!settings || loading || busy || missing.length > 0}
            onClick={() => void save()}
          >
            {busy ? "正在保存…" : "保存范围"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
