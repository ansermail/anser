import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import type {
  Account,
  FolderMapping,
  FolderRole,
  FolderSettings,
} from "@/lib/types";
import { Button } from "./ui/button";
import { Alert, AlertDescription } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
} from "./ui/field";
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

const roles: [FolderRole, string][] = [
  ["sent", "已发送"],
  ["drafts", "草稿箱"],
  ["trash", "废纸篓"],
  ["junk", "垃圾邮件"],
  ["archive", "归档"],
  ["all", "所有邮件"],
  ["flagged", "星标邮件"],
];
const AUTO = "auto",
  NONE = "none",
  PREFIX = "folder:";
export function FolderMappingDialog({
  account,
  onClose,
  onSaved,
}: {
  account: Account | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const epoch = useRef(0);
  const [settings, setSettings] = useState<FolderSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!account) return;
    const current = ++epoch.current;
    setSaving(false);
    let live = true;
    setSettings(null);
    setValues({});
    setError("");
    setLoading(true);
    void call<FolderSettings>("folder_settings", { id: account.id })
      .then((data) => {
        if (!live) return;
        setSettings(data);
        setValues(
          Object.fromEntries(
            data.mappings.map((m) => [
              m.role,
              m.folder === null ? NONE : PREFIX + m.folder,
            ]),
          ),
        );
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      if (epoch.current === current) epoch.current++;
    };
  }, [account?.id, revision]);
  if (!account) return null;
  const selectable =
    settings?.folders.filter(
      (f) =>
        f.selectable &&
        !f.syncError &&
        !f.roles?.includes("inbox") &&
        f.name.toUpperCase() !== "INBOX",
    ) || [];
  const missing = roles.filter(
    ([role]) =>
      values[role]?.startsWith(PREFIX) &&
      !selectable.some((f) => PREFIX + f.name === values[role]),
  );
  async function refreshFolders() {
    if (loading || saving || !account) return;
    const current = epoch.current;
    setLoading(true);
    setError("");
    try {
      await call("account_folders", { id: account.id });
      const next = await call<FolderSettings>("folder_settings", {
        id: account.id,
      });
      if (epoch.current !== current) return;
      setSettings(next); // Keep unsaved selections while refreshing discovery.
    } catch (e) {
      if (epoch.current === current) setError(String(e));
    } finally {
      if (epoch.current === current) setLoading(false);
    }
  }
  async function save() {
    if (!account || !settings || loading || saving || missing.length) return;
    const current = epoch.current;
    setSaving(true);
    setError("");
    const mappings: FolderMapping[] = roles.flatMap(([role]) => {
      const value = values[role] || AUTO;
      return value === AUTO
        ? []
        : [
            {
              role,
              folder: value === NONE ? null : value.slice(PREFIX.length),
            },
          ];
    });
    try {
      await call("save_folder_mappings", { id: account.id, mappings });
      if (epoch.current !== current) return;
      toast.success("特殊文件夹设置已保存");
      onSaved();
      onClose();
    } catch (e) {
      if (epoch.current === current) setError(String(e));
    } finally {
      if (epoch.current === current) setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-xl max-h-[85vh] overflow-y-auto"
        showCloseButton={!saving}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>特殊文件夹</DialogTitle>
          <DialogDescription>
            {account.name} · {account.email}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          指定服务器目录的用途。垃圾邮件和废纸篓不自动收取，仍可从侧栏手动查看。
        </p>
        {loading && !settings && <Skeleton className="h-64 w-full" />}
        {settings && (
          <FieldGroup className="gap-4">
            {roles.map(([role, label]) => {
              const value = values[role] || AUTO;
              const invalid = missing.some(([r]) => r === role);
              const detected = settings.folders.filter((f) =>
                (f.detectedRoles ?? f.roles)?.includes(role),
              );
              return (
                <Field
                  key={role}
                  orientation="horizontal"
                  data-invalid={invalid}
                  data-disabled={loading || saving}
                >
                  <FieldLabel htmlFor={`folder-role-${role}`}>
                    {label}
                  </FieldLabel>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Select
                      value={value}
                      onValueChange={(v) =>
                        setValues((prev) => ({ ...prev, [role]: v }))
                      }
                      disabled={loading || saving}
                    >
                      <SelectTrigger
                        id={`folder-role-${role}`}
                        aria-label={label}
                        aria-invalid={invalid}
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={AUTO}>自动识别</SelectItem>
                          <SelectItem value={NONE}>不指定</SelectItem>
                          {invalid && (
                            <SelectItem value={value} disabled>
                              已设置的目录不可用
                            </SelectItem>
                          )}
                          {selectable.map((f) => (
                            <SelectItem key={f.name} value={PREFIX + f.name}>
                              {f.displayName}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {invalid ? (
                      <FieldError>
                        目录已移除或不能存放邮件，请重新选择。
                      </FieldError>
                    ) : (
                      value === AUTO && (
                        <FieldDescription>
                          {detected.length
                            ? `已识别：${detected.map((f) => f.displayName).join("、")}`
                            : "未识别到此用途的目录"}
                        </FieldDescription>
                      )
                    )}
                  </div>
                </Field>
              );
            })}
          </FieldGroup>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            disabled={loading || saving}
            onClick={() =>
              settings ? void refreshFolders() : setRevision((v) => v + 1)
            }
          >
            <RefreshCw data-icon="inline-start" />
            {loading ? "刷新中…" : "刷新目录"}
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={loading || saving || !settings}
              onClick={() => setValues({})}
            >
              恢复自动识别
            </Button>
            <Button
              disabled={loading || saving || !settings || missing.length > 0}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
