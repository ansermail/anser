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
import { Button, ButtonLabel } from "./ui/button";
import { toast } from "sonner";
import { LoaderCircle } from "lucide-react";

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
  const [saving, setSaving] = useState<
    "interval" | "newMailNotifications" | "sendResultNotifications" | null
  >(null);
  const [testing, setTesting] = useState(false);
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
    if (saving) return;
    setSaving("interval");
    try {
      const current = await call<Preferences>("get_preferences");
      const p = { ...current, syncIntervalMinutes: interval };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      toast.success(t("Background check interval updated"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(null);
    }
  }
  async function notifications(
    key: "newMailNotifications" | "sendResultNotifications",
    enabled: boolean,
  ) {
    if (saving) return;
    setSaving(key);
    try {
      const current = await call<Preferences>("get_preferences");
      const p = { ...current, [key]: enabled };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(null);
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
  async function testNotification() {
    setTesting(true);
    try {
      await call("test_notification", { id: testMailId || null });
      toast.success(
        isDemo()
          ? t("Demo mode does not send system notifications")
          : t("Test notification submitted. Check Notification Center."),
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setTesting(false);
    }
  }
  return (
    <div className="storage-tools">
      <Card className="storage-checks-card">
        <CardHeader>
          <CardTitle>{t("Background checks")}</CardTitle>
          <CardDescription>
            {t(
              "IMAP checks in real time when possible, with this interval for catch-up checks and POP3.",
            )}
          </CardDescription>
          <CardAction className="self-center">
            <div className="settings-tool-row">
              <SelectField
                className="settings-choice"
                aria-label={t("Background check interval")}
                value={interval}
                disabled={!ready || !!saving}
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
                variant={
                  interval === preferences.syncIntervalMinutes
                    ? "outline"
                    : "default"
                }
                size="sm"
                aria-busy={saving === "interval"}
                disabled={
                  !ready ||
                  !!saving ||
                  interval === preferences.syncIntervalMinutes
                }
                onClick={() => void save()}
              >
                <ButtonLabel reserve={[t("Save"), t("Saving…")]}>
                  {saving === "interval" ? t("Saving…") : t("Save")}
                </ButtonLabel>
              </Button>
            </div>
          </CardAction>
        </CardHeader>
      </Card>
      <Card className="storage-notifications-card">
        <CardHeader>
          <CardTitle>{t("Notifications & startup")}</CardTitle>
          <CardDescription>
            {t("Initial imports do not send notifications.")}
          </CardDescription>
          <CardAction className="self-center">
            <Button
              variant="outline"
              size="sm"
              aria-busy={testing}
              disabled={testing}
              onClick={() => void testNotification()}
            >
              <ButtonLabel
                reserve={[
                  t("Test system notification"),
                  t("Sending test notification…"),
                ]}
                reserveIcon
                icon={testing && <LoaderCircle className="animate-spin" />}
              >
                {testing
                  ? t("Sending test notification…")
                  : t("Test system notification")}
              </ButtonLabel>
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
              aria-busy={saving === "newMailNotifications"}
              checked={preferences.newMailNotifications ?? true}
              disabled={!ready || !!saving}
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
              aria-busy={saving === "sendResultNotifications"}
              checked={preferences.sendResultNotifications ?? true}
              disabled={!ready || !!saving}
              onCheckedChange={(enabled) =>
                void notifications("sendResultNotifications", enabled)
              }
            />
          </div>
          <Separator />
          <div className="settings-tool-row items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="auto-start">{t("Launch at login")}</Label>
              <p
                id="auto-start-description"
                className="text-xs text-muted-foreground leading-relaxed"
              >
                {desktop?.autoStartAvailable === false
                  ? t("Launch at login requires the released app.")
                  : isDemo()
                    ? t("Demo mode does not change system login items.")
                    : t("Starts in the background when you sign in.")}
              </p>
            </div>
            <Switch
              id="auto-start"
              aria-describedby="auto-start-description"
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
