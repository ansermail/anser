import { dateLocale, t } from "@/lib/i18n";
import { useRef, useState } from "react";
import { ShieldCheck, LoaderCircle, AlertCircle } from "lucide-react";
import { call, isDemo } from "@/lib/api";
import type { ArchiveHealth } from "@/lib/types";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
export function ArchiveIntegrity() {
  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<ArchiveHealth | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function check() {
    if (pending.current) return;
    pending.current = true;
    setChecking(true);
    setHealth(null);
    setError("");
    try {
      setHealth(await call<ArchiveHealth>("archive_health"));
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setChecking(false);
    }
  }
  return (
    <div className="archive-integrity flex min-w-0 flex-col justify-center gap-3">
      <Button
        variant="outline"
        className="self-start"
        disabled={checking}
        onClick={() => void check()}
      >
        {checking ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" />
        ) : (
          <ShieldCheck data-icon="inline-start" />
        )}
        {checking ? t("Verifying…") : t("Verify archives")}
      </Button>
      <p className="text-xs text-muted-foreground" role="status">
        {checking
          ? t("Verifying original messages and attachments…")
          : health
            ? t("{value0} / {value1} messages verified", {
                value0: health.healthy,
                value1: health.checked,
              })
            : t("Check the integrity of local originals and attachments")}
      </p>
      {health && (
        <p className="text-xs text-muted-foreground">
          {t("Last verified: ")}
          {new Date(health.checkedAt).toLocaleString(dateLocale(), {
            hour12: false,
          })}
        </p>
      )}
      {(error || !!health?.problems.length) && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>
            {error
              ? t("Verification incomplete")
              : t("{value0} messages need attention", {
                  value0: health!.problems.length,
                })}
          </AlertTitle>
          <AlertDescription className="max-h-48 overflow-auto">
            {error || (
              <ul className="flex flex-col gap-2">
                {health!.problems.map((p) => (
                  <li key={p.mailId}>
                    <p>{p.subject || t("(No subject)")}</p>
                    <p>{p.error}</p>
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
      {isDemo() && (
        <p className="text-xs text-muted-foreground">
          {t("Demo mode shows sample verification results only.")}
        </p>
      )}
    </div>
  );
}
