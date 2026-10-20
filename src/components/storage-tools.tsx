import { t } from "@/lib/i18n";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useState } from "react";
import { call, isDemo } from "@/lib/api";
import type { Preferences } from "@/lib/types";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "./ui/card";
import { Separator } from "./ui/separator";
import { Button } from "./ui/button";
import { toast } from "sonner";

export function StorageTools({ testMailId = "" }: { testMailId?: string }) {
  const [preferences, setPreferences] = useState<Preferences>({
      syncIntervalMinutes: 5,
      newMailNotifications: true,
      sendResultNotifications: true,
    }),
    [interval, setInterval] = useState(5),
    [ready, setReady] = useState(false);
  const [desktop, setDesktop] = useState<{
    autoStart: boolean;
    autoStartAvailable: boolean;
  } | null>(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let live = true;
    void call<Preferences>("get_preferences")
      .then((p) => {
        if (live) {
          setPreferences(p);
          setInterval(p.syncIntervalMinutes);
          setReady(true);
        }
      })
      .catch((e) => toast.error(String(e)));
    void call<{ autoStart: boolean; autoStartAvailable: boolean }>(
      "desktop_settings",
    )
      .then((p) => {
        if (live) setDesktop(p);
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      live = false;
    };
  }, []);
  async function save() {
    setSaving(true);
    try {
      const p = { ...preferences, syncIntervalMinutes: interval };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      toast.success(t("后台检查间隔已更新"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }
  async function notifications(
    key: "newMailNotifications" | "sendResultNotifications",
    enabled: boolean,
  ) {
    setSaving(true);
    try {
      const p = { ...preferences, [key]: enabled };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }
  async function autoStart(enabled: boolean) {
    setDesktopBusy(true);
    try {
      await call("set_auto_start", { enabled });
      setDesktop(await call("desktop_settings"));
      toast.success(enabled ? t("开机自启已开启") : t("开机自启已关闭"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDesktopBusy(false);
    }
  }
  return (
    <div className="storage-tools">
      <Card>
        <CardHeader>
          <CardTitle>{t("系统通知与启动")}</CardTitle>
          <CardDescription>{t("选择提醒方式与应用启动行为。")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="settings-tool-row justify-between">
            <Label htmlFor="new-mail-notifications">{t("新邮件通知")}</Label>
            <Switch
              id="new-mail-notifications"
              checked={preferences.newMailNotifications ?? true}
              disabled={!ready || saving}
              onCheckedChange={(enabled) =>
                void notifications("newMailNotifications", enabled)
              }
            />
          </div>
          <div className="settings-tool-row justify-between">
            <Label htmlFor="send-result-notifications">
              {t("发送结果通知")}
            </Label>
            <Switch
              id="send-result-notifications"
              checked={preferences.sendResultNotifications ?? true}
              disabled={!ready || saving}
              onCheckedChange={(enabled) =>
                void notifications("sendResultNotifications", enabled)
              }
            />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t(
              "新邮件和发送成功、失败或结果未确认时使用系统通知。首次导入旧邮件不通知；通知横幅由 macOS 设置控制。",
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void call("test_notification", { id: testMailId || null })
                .then(() =>
                  toast.success(
                    isDemo()
                      ? t("演示模式不发送系统通知")
                      : t("测试通知已提交，请检查通知中心"),
                  ),
                )
                .catch((e) => toast.error(String(e)))
            }
          >
            {t("测试系统通知")}
          </Button>
          <Separator />
          <div className="settings-tool-row justify-between">
            <Label htmlFor="auto-start">{t("开机自启")}</Label>
            <Switch
              id="auto-start"
              checked={desktop?.autoStart || false}
              disabled={
                !desktop ||
                desktopBusy ||
                (!desktop.autoStartAvailable && !desktop.autoStart)
              }
              onCheckedChange={(enabled) => void autoStart(enabled)}
            />
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {desktop?.autoStartAvailable === false
              ? t("开发预览依赖前端服务，请在正式应用中开启开机自启。")
              : t("登录 Mac 后自动在后台启动，继续收信和处理定时发送。")}
          </p>
          {isDemo() && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t("演示模式不修改系统启动项。")}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("后台检查")}</CardTitle>
          <CardDescription>{t("设置定时补查新邮件的频率。")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="settings-tool-row">
            <SelectField
              aria-label={t("后台检查间隔")}
              value={interval}
              disabled={!ready || saving}
              onValueChange={(value) => setInterval(Number(value))}
            >
              {[1, 5, 10, 15, 30, 60].map((n) => (
                <SelectOption key={n} value={n}>
                  {t("每 ")}
                  {n}
                  {t(" 分钟")}
                </SelectOption>
              ))}
            </SelectField>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !ready || saving || interval === preferences.syncIntervalMinutes
              }
              onClick={() => void save()}
            >
              {saving ? t("保存中…") : t("保存")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t(
              "IMAP 优先实时收取；此间隔用于定时补查和 POP3。关闭窗口后继续运行，唤醒后补收。",
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
