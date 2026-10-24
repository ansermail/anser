import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call, isDemo, native } from "@/lib/api";
import { t } from "@/lib/i18n";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
} from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";
import { Alert, AlertDescription } from "./ui/alert";

type Association = {
  extension: string;
  currentName: string;
  currentId: string;
  isDefault: boolean;
};
type Associations = { supported: boolean; busy: boolean; items: Association[] };
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
        "Could not read or change file associations. Refresh and try again.",
      );
  }
}
export function FileAssociations() {
  const enabled = native && !isDemo();
  const [data, setData] = useState<Associations>({
    supported: enabled,
    busy: false,
    items: [],
  });
  const [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState("");
  const live = useRef(false),
    ticket = useRef(0),
    pending = useRef(false);
  async function read() {
    const request = ++ticket.current;
    const next = await call<Associations>("get_file_associations");
    if (live.current && request === ticket.current) setData(next);
    return next;
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
    if (!enabled || !data.busy) return;
    const interval = setInterval(() => {
      if (!pending.current) void read().catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [enabled, data.busy]);
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
      const actual = await read();
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
  const disabled =
    busy || refreshing || data.busy || !enabled || !data.supported;
  const items = enabled
    ? data.items
    : ["eml", "emlx", "msg"].map((extension) => ({
        extension,
        currentName: "",
        currentId: "",
        isDefault: false,
      }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("File associations")}</CardTitle>
        <CardDescription>
          {t(
            "Open single-message EML, EMLX and MSG files read-only. MBOX mailboxes use Import mail in Local archive.",
          )}
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || refreshing || !enabled || !data.supported}
            onClick={() => void refresh()}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
            {refreshing ? t("Refreshing…") : t("Refresh")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!enabled && (
          <p className="text-sm text-muted-foreground">
            {t("Sample mode does not read or change system file associations.")}
          </p>
        )}
        {enabled && !data.supported && (
          <p className="text-sm text-muted-foreground">
            {t("File association settings are currently available on macOS.")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {t(
            "Turn on to use Anser. Turn off to restore the previous default application.",
          )}
        </p>
        {!!items.length && (
          <Badge variant="secondary" className="w-fit">
            {t("Associated {count} of {total}", {
              count: items.filter((x) => x.isDefault).length,
              total: items.length,
            })}
          </Badge>
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
        <div className="divide-y">
          {items.map((item) => (
            <div
              key={item.extension}
              className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={`file-association-${item.extension}`}
                  className="gap-2"
                >
                  {item.extension.toUpperCase()}
                  <span className="font-normal text-muted-foreground">
                    .{item.extension}
                  </span>
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("Default application: {name}", {
                    name: item.currentName || t("Not associated"),
                  })}
                </p>
              </div>
              <Switch
                id={`file-association-${item.extension}`}
                checked={item.isDefault}
                disabled={disabled}
                aria-label={t("Open {extension} files with Anser", {
                  extension: `.${item.extension}`,
                })}
                onCheckedChange={(checked) =>
                  void change(item.extension, checked)
                }
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
