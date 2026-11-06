import { useEffect, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { t } from "@/lib/i18n";
import { formatSize } from "@/lib/providers";
import type { Preferences, ReadingCacheStatus } from "@/lib/types";
import { useConfirmation } from "@/hooks/use-confirmation";
import { Button } from "./ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Label } from "./ui/label";
import { SelectField, SelectOption } from "./ui/select-field";
import { Separator } from "./ui/separator";

const retentionOptions = [0, 7, 30, 90, 365];
const limitOptions = [
  { value: 256, label: "256 MB" },
  { value: 512, label: "512 MB" },
  { value: 1024, label: "1 GB" },
  { value: 2048, label: "2 GB" },
  { value: 4096, label: "4 GB" },
];

function cacheSize(bytes: number) {
  const gigabyte = 1024 * 1024 * 1024;
  if (bytes < gigabyte) return formatSize(bytes);
  const value = bytes / gigabyte;
  return `${Number.isInteger(value) ? value : value.toFixed(1)} GB`;
}

export function ReadingCacheSettings() {
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [status, setStatus] = useState<ReadingCacheStatus | null>(null);
  const [days, setDays] = useState(30);
  const [limitMb, setLimitMb] = useState(1024);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const { askConfirmation, confirmationDialog } = useConfirmation();

  useEffect(() => {
    let live = true;
    Promise.all([
      call<Preferences>("get_preferences"),
      call<ReadingCacheStatus>("reading_cache_status"),
    ])
      .then(([preferences, status]) => {
        if (!live) return;
        setPreferences(preferences);
        setStatus(status);
        setDays(preferences.readingCacheDays ?? 30);
        setLimitMb(preferences.readingCacheLimitMb ?? 1024);
      })
      .catch((error) => {
        if (live) toast.error(String(error));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const changed =
    !!preferences &&
    (days !== (preferences.readingCacheDays ?? 30) ||
      limitMb !== (preferences.readingCacheLimitMb ?? 1024));

  async function save() {
    if (!preferences) return;
    setSaving(true);
    try {
      const current = await call<Preferences>("get_preferences");
      const next = {
        ...current,
        readingCacheDays: days,
        readingCacheLimitMb: limitMb,
      };
      await call("save_preferences", { preferences: next });
      const nextStatus = await call<ReadingCacheStatus>("reading_cache_status");
      setPreferences(next);
      setStatus(nextStatus);
      toast.success(t("Reading cache settings saved"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  }

  async function clear() {
    if (
      !(await askConfirmation({
        title: t("Clear reading cache?"),
        description: t(
          "Cached bodies and attachments will be removed. The next opening fetches them from the server again. Full local archives are not affected.",
        ),
        action: t("Clear cache"),
        destructive: true,
      }))
    )
      return;
    setClearing(true);
    try {
      setStatus(await call<ReadingCacheStatus>("clear_reading_cache"));
      toast.success(t("Reading cache cleared"));
    } catch (error) {
      toast.error(String(error));
    } finally {
      setClearing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Reading cache")}</CardTitle>
        <CardDescription className="flex flex-col gap-1 leading-relaxed">
          <span>
            {t(
              "Messages opened in online mode are kept locally for a limited time so reopening them is fast. Expired content is fetched from the server again.",
            )}
          </span>
          <span>
            {t(
              "Reading cache is separate from full local archives. It does not make a message permanent and is excluded from archive backup and integrity checks.",
            )}
          </span>
        </CardDescription>
        <CardAction className="self-center">
          <Button
            size="sm"
            variant="outline"
            disabled={loading || saving || !changed}
            onClick={() => void save()}
          >
            {saving && (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            )}
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="settings-tool-row">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="reading-cache-days">{t("Keep for")}</Label>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t(
                "Counted from the last time a message was opened. Choose Off to fetch every online message from the server.",
              )}
            </p>
          </div>
          <SelectField
            id="reading-cache-days"
            aria-label={t("Reading cache retention")}
            value={days}
            disabled={loading || saving}
            onValueChange={(value) => setDays(Number(value))}
          >
            {retentionOptions.map((value) => (
              <SelectOption key={value} value={value}>
                {value === 0 ? t("Off") : t("{value0} days", { value0: value })}
              </SelectOption>
            ))}
          </SelectField>
        </div>
        <Separator />
        <div className="settings-tool-row">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="reading-cache-limit">{t("Size limit")}</Label>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t(
                "When the limit is reached, the least recently opened messages are removed first.",
              )}
            </p>
          </div>
          <SelectField
            id="reading-cache-limit"
            aria-label={t("Reading cache size limit")}
            value={limitMb}
            disabled={loading || saving}
            onValueChange={(value) => setLimitMb(Number(value))}
          >
            {limitOptions.map((option) => (
              <SelectOption key={option.value} value={option.value}>
                {option.label}
              </SelectOption>
            ))}
          </SelectField>
        </div>
        <Separator />
        <div className="settings-tool-row items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <strong className="text-sm">
              {status
                ? t("{value0} messages · {value1}", {
                    value0: status.entries,
                    value1: cacheSize(status.bytes),
                  })
                : t("Reading cache unavailable")}
            </strong>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {t(
                "Clearing the cache only removes temporary copies. Messages marked as fully saved stay in the local archive.",
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || clearing || !status?.entries}
            onClick={() => void clear()}
          >
            {clearing ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Trash2 data-icon="inline-start" />
            )}
            {clearing ? t("Clearing…") : t("Clear cache")}
          </Button>
        </div>
      </CardContent>
      {confirmationDialog}
    </Card>
  );
}
