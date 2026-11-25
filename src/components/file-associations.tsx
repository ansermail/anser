import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call, isDemo, native } from "@/lib/api";
import { t } from "@/lib/i18n";
import { isWindows } from "@/lib/platform";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "./ui/card";
import { Button, ButtonLabel } from "./ui/button";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Separator } from "./ui/separator";
import { Alert, AlertDescription } from "./ui/alert";

type Association = {
  extension: string;
  currentName: string;
  currentId: string;
  isDefault: boolean;
};
type Associations = { supported: boolean; busy: boolean; items: Association[] };
type DefaultMailClient = {
  supported: boolean;
  busy: boolean;
  currentName: string;
  currentId: string;
  isDefault: boolean;
};
function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  switch (code) {
    case "associationDenied":
      return t(
        "macOS did not complete the change. Refresh to check the actual association.",
      );
    case "associationBusy":
    case "associationPending":
      return t(
        "macOS is still processing the change. Refresh to check the actual association.",
      );
    case "associationNoPrevious":
      return t(
        "No previous default application is recorded. Change it with Open With in Finder.",
      );
    case "associationApplicationChanged":
      return t(
        "The selected application is no longer available. Refresh and choose again.",
      );
    default:
      return t(
        "Could not read or change the default application. Refresh and try again.",
      );
  }
}
export function FileAssociations() {
  const enabled = native && !isDemo();
  const windows = isWindows();
  const [data, setData] = useState<Associations>({
    supported: enabled,
    busy: false,
    items: [],
  });
  const [mailClient, setMailClient] = useState<DefaultMailClient>({
    supported: enabled && !windows,
    busy: false,
    currentName: "",
    currentId: "",
    isDefault: false,
  });
  const [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [mailClientBusy, setMailClientBusy] = useState(false),
    [error, setError] = useState("");
  const live = useRef(false),
    ticket = useRef(0),
    pending = useRef(false);
  async function read() {
    const request = ++ticket.current;
    const [next, client] = await Promise.all([
      call<Associations>("get_file_associations"),
      call<DefaultMailClient>("get_default_mail_client"),
    ]);
    if (live.current && request === ticket.current) {
      setData(next);
      setMailClient(client);
    }
    return { associations: next, mailClient: client };
  }
  useEffect(() => {
    live.current = true;
    if (enabled)
      void read().catch((e) => {
        if (live.current) setError(errorText(e));
      });
    const focus = () => {
      if (enabled && !pending.current) void read().catch(() => {});
    };
    window.addEventListener("focus", focus);
    return () => {
      live.current = false;
      ticket.current++;
      window.removeEventListener("focus", focus);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || (!data.busy && !mailClient.busy)) return;
    const interval = setInterval(() => {
      if (!pending.current) void read().catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [enabled, data.busy, mailClient.busy]);
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setRefreshing(true);
    setError("");
    try {
      await Promise.all([read(), new Promise((r) => setTimeout(r, 600))]);
    } catch (e) {
      if (live.current) setError(errorText(e));
    } finally {
      pending.current = false;
      if (live.current) setRefreshing(false);
    }
  }
  async function change(extension: string, checked: boolean) {
    if (!enabled || pending.current || data.busy) return;
    pending.current = true;
    const operation = ++ticket.current;
    setBusy(true);
    setError("");
    try {
      await call("set_file_association", {
        extension,
        application: checked ? "self" : "previous",
      });
      if (!live.current || operation !== ticket.current) return;
      const { associations: actual } = await read();
      if (
        actual.items.find((x) => x.extension === extension)?.isDefault !==
        checked
      )
        throw new Error("associationPending");
      toast.success(t("Default application updated."));
    } catch (e) {
      if (live.current) {
        setError(errorText(e));
        await read().catch(() => {});
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  async function setDefaultMailClient() {
    if (
      !enabled ||
      windows ||
      pending.current ||
      mailClient.busy ||
      mailClientBusy
    )
      return;
    pending.current = true;
    setMailClientBusy(true);
    setError("");
    try {
      await call("set_default_mail_client");
      const { mailClient: actual } = await read();
      if (!actual.isDefault) throw new Error("associationDenied");
      toast.success(t("Anser is now the default mail app."));
    } catch (e) {
      if (live.current) {
        setError(errorText(e));
        await read().catch(() => {});
      }
    } finally {
      pending.current = false;
      if (live.current) setMailClientBusy(false);
    }
  }
  function openDefaultApps() {
    void call("open_file_association_settings").catch((cause) =>
      toast.error(
        t("Could not open system settings: {value0}", {
          value0: String(cause),
        }),
      ),
    );
  }
  const disabled =
    busy ||
    refreshing ||
    mailClientBusy ||
    data.busy ||
    mailClient.busy ||
    !enabled ||
    !data.supported;
  const items = enabled
    ? data.items
    : ["eml", "emlx", "msg"].map((extension) => ({
        extension,
        currentName: "",
        currentId: "",
        isDefault: false,
      }));
  const mailApplication = mailClient.currentName || t("Not associated");
  return (
    <Card className="system-defaults-card">
      <CardHeader>
        <CardTitle>{t("System default apps")}</CardTitle>
        <CardDescription>
          {t("Anser opens EML, EMLX and MSG files in read-only mode.")}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            aria-busy={refreshing}
            disabled={busy || refreshing || !enabled || !data.supported}
            onClick={() => void refresh()}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
            <ButtonLabel reserve={[t("Refresh"), t("Refreshing…")]}>
              {refreshing ? t("Refreshing…") : t("Refresh")}
            </ButtonLabel>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!enabled && (
          <p className="text-sm text-muted-foreground">
            {t("Sample mode does not read or change system file associations.")}
          </p>
        )}
        {data.busy && (
          <p className="text-sm" role="status">
            {t(
              "macOS is still processing the change. Refresh to check the actual association.",
            )}
          </p>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {enabled && (
          <div className="system-default-mail">
            <div className="grid min-w-0 gap-1">
              <h3 className="text-sm font-semibold">{t("Default mail app")}</h3>
              <p className="text-sm leading-snug text-muted-foreground [overflow-wrap:anywhere]">
                {windows
                  ? t(
                      "Windows manages the default mail app. Open default app settings to choose Anser.",
                    )
                  : mailApplication}
              </p>
            </div>
            {windows ? (
              <Button variant="outline" size="sm" onClick={openDefaultApps}>
                {t("Open Windows default apps")}
              </Button>
            ) : mailClient.isDefault ? (
              <Badge variant="secondary">{t("Already default")}</Badge>
            ) : (
              <Button
                variant="default"
                size="sm"
                aria-busy={mailClientBusy}
                disabled={disabled || !mailClient.supported}
                onClick={() => void setDefaultMailClient()}
              >
                <ButtonLabel
                  reserve={[t("Set as default mail app"), t("Setting…")]}
                >
                  {mailClientBusy
                    ? t("Setting…")
                    : t("Set as default mail app")}
                </ButtonLabel>
              </Button>
            )}
          </div>
        )}
        {enabled && !data.supported && !windows && (
          <p className="text-xs text-muted-foreground">
            {t("File association settings are currently available on macOS.")}
          </p>
        )}
        {!!items.length && (
          <>
            {enabled && <Separator />}
            <section className="grid gap-2" aria-label={t("Mail files")}>
              <div className="system-file-row text-sm font-semibold">
                <h3>{t("Mail files")}</h3>
                <span>{t("Default application")}</span>
              </div>
              <div>
                {items.map((item) => (
                  <div
                    key={item.extension}
                    className="system-file-row py-2 first:pt-0 last:pb-0"
                  >
                    <Label
                      htmlFor={`file-association-${item.extension}`}
                      className="font-normal"
                    >
                      .{item.extension}
                    </Label>
                    <span
                      id={`file-association-app-${item.extension}`}
                      className="min-w-0 text-sm text-muted-foreground [overflow-wrap:anywhere]"
                    >
                      {item.currentName || t("Not associated")}
                    </span>
                    <Switch
                      id={`file-association-${item.extension}`}
                      className="justify-self-end"
                      checked={item.isDefault}
                      disabled={disabled}
                      aria-label={t("Open {extension} files with Anser", {
                        extension: `.${item.extension}`,
                      })}
                      aria-describedby={`file-association-app-${item.extension}`}
                      onCheckedChange={(checked) =>
                        void change(item.extension, checked)
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
