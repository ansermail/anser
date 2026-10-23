import { t } from "@/lib/i18n";
import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useState } from "react";
import { call, isDemo } from "@/lib/api";
import type { Preferences } from "@/lib/types";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import {
  Card,
  CardAction,
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
      toast.success(t("Background check interval updated"));
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
      toast.success(
        enabled ? t("Launch at login enabled") : t("Launch at login disabled"),
      );
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDesktopBusy(false);
    }
  }
  return (
    <div className="storage-tools">
      <Card className="storage-checks-card">
        <CardHeader>
          <CardTitle>{t("Background checks")}</CardTitle>
          <CardDescription className="flex flex-col gap-1 leading-relaxed">
            <span>{t("Choose how often to check for new mail.")}</span>
            <span>
              {t(
                "IMAP prioritizes real-time mail. This interval covers periodic checks and POP3. Checks continue after closing the window and catch up after waking.",
              )}
            </span>
          </CardDescription>
          <CardAction className="self-center">
            <div className="settings-tool-row">
              <SelectField
                aria-label={t("Background check interval")}
                value={interval}
                disabled={!ready || saving}
                onValueChange={(value) => setInterval(Number(value))}
              >
                {[1, 5, 10, 15, 30, 60].map((n) => (
                  <SelectOption key={n} value={n}>
                    {t("Every ")}
                    {n}
                    {t(" minutes")}
                  </SelectOption>
                ))}
              </SelectField>
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !ready ||
                  saving ||
                  interval === preferences.syncIntervalMinutes
                }
                onClick={() => void save()}
              >
                {saving ? t("Saving…") : t("Save")}
              </Button>
            </div>
          </CardAction>
        </CardHeader>
      </Card>
      <Card className="storage-notifications-card">
        <CardHeader>
          <CardTitle>{t("Notifications & startup")}</CardTitle>
          <CardDescription>
            {t("Choose notification and startup behavior.")}
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void call("test_notification", { id: testMailId || null })
                  .then(() =>
                    toast.success(
                      isDemo()
                        ? t("Demo mode does not send system notifications")
                        : t(
                            "Test notification submitted. Check Notification Center.",
                          ),
                    ),
                  )
                  .catch((e) => toast.error(String(e)))
              }
            >
              {t("Test system notification")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="settings-tool-row justify-between">
            <Label htmlFor="new-mail-notifications">
              {t("New mail notifications")}
            </Label>
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
              {t("Send result notifications")}
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
              "System notifications cover new mail and successful, failed or unconfirmed sends. Initial imports do not notify. Notification banners are controlled by macOS settings.",
            )}
          </p>
          <Separator />
          <div className="settings-tool-row items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="auto-start">{t("Launch at login")}</Label>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {desktop?.autoStartAvailable === false
                  ? t(
                      "Development previews require the frontend server. Enable launch at login in the released app.",
                    )
                  : t(
                      "Start in the background after logging into your Mac, then continue checking mail and scheduled sends.",
                    )}
              </p>
              {isDemo() && (
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t("Demo mode does not change system login items.")}
                </p>
              )}
            </div>
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
        </CardContent>
      </Card>
    </div>
  );
}
