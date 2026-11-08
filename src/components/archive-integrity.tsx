import { dateLocale, t } from "@/lib/i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck, LoaderCircle, AlertCircle, Zap, X } from "lucide-react";
import { call, isDemo } from "@/lib/api";
import type { ArchiveHealth } from "@/lib/types";
import { Button } from "./ui/button";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Progress } from "./ui/progress";
export function ArchiveIntegrity({ children }: { children?: ReactNode }) {
  const [health, setHealth] = useState<ArchiveHealth | null>(null);
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const requestSequence = useRef(0);
  const polling = useRef(false);
  useEffect(() => {
    let live = true;
    const request = ++requestSequence.current;
    void call<ArchiveHealth>("archive_verification_status")
      .then((value) => {
        if (live && request === requestSequence.current) {
          setHealth(value);
          setError("");
        }
      })
      .catch((e) => {
        if (live && request === requestSequence.current) setError(String(e));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!health?.running) return;
    let live = true;
    const timer = setInterval(() => {
      if (polling.current) return;
      polling.current = true;
      const request = ++requestSequence.current;
      void call<ArchiveHealth>("archive_verification_status")
        .then((value) => {
          if (live && request === requestSequence.current) {
            setHealth(value);
            setError("");
          }
        })
        .catch((e) => {
          if (live && request === requestSequence.current) {
            setError(String(e));
          }
        })
        .finally(() => {
          polling.current = false;
        });
    }, 600);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [health?.running]);
  async function check(mode: "fast" | "deep") {
    if (pending.current) return;
    pending.current = true;
    const request = ++requestSequence.current;
    setStarting(true);
    setError("");
    try {
      const value = await call<ArchiveHealth>("start_archive_verification", {
        mode,
      });
      if (request === requestSequence.current) setHealth(value);
    } catch (e) {
      if (request === requestSequence.current) setError(String(e));
    } finally {
      pending.current = false;
      if (request === requestSequence.current) setStarting(false);
    }
  }
  async function cancel() {
    if (pending.current) return;
    pending.current = true;
    const request = ++requestSequence.current;
    setStarting(true);
    setError("");
    try {
      const value = await call<ArchiveHealth>("cancel_archive_verification");
      if (request === requestSequence.current) setHealth(value);
    } catch (e) {
      if (request === requestSequence.current) setError(String(e));
    } finally {
      pending.current = false;
      if (request === requestSequence.current) setStarting(false);
    }
  }
  const running = !!health?.running;
  const total = health?.total || 0;
  const checked = health?.checked || 0;
  const problems = health?.problems || [];
  const problemCount = health?.problemCount ?? problems.length;
  const fast = health?.mode === "fast";
  return (
    <div className="archive-integrity flex min-w-0 flex-col justify-center gap-3">
      <div className="storage-actions flex-wrap items-center">
        <Button
          variant="outline"
          disabled={loading || starting || running}
          onClick={() => void check("fast")}
        >
          {starting && !running ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" />
          ) : (
            <Zap data-icon="inline-start" />
          )}
          {t("Fast check")}
        </Button>
        <Button
          variant="outline"
          disabled={loading || starting || running}
          onClick={() => void check("deep")}
        >
          <ShieldCheck data-icon="inline-start" />
          {t("Deep check")}
        </Button>
        {running && (
          <Button
            variant="ghost"
            disabled={starting}
            onClick={() => void cancel()}
          >
            <X data-icon="inline-start" />
            {t("Cancel check")}
          </Button>
        )}
        {children}
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {running
          ? t(
              fast
                ? "Fast check in progress: {value0} / {value1} messages"
                : "Deep check in progress: {value0} / {value1} messages",
              { value0: checked, value1: total },
            )
          : health?.cancelled
            ? t("Verification cancelled after {value0} / {value1} messages.", {
                value0: checked,
                value1: total,
              })
            : checked
              ? t(
                  fast
                    ? "{value0} / {value1} messages passed the fast check"
                    : "{value0} / {value1} messages verified",
                  { value0: health?.healthy || 0, value1: checked },
                )
              : t(
                  "Fast check confirms files and indexed sizes; deep check verifies hashes and attachments.",
                )}
      </p>
      {running && total > 0 && <Progress value={(checked / total) * 100} />}
      {health?.completed && health.checkedAt && (
        <p className="text-xs text-muted-foreground">
          {t("Last verified: ")}
          {new Date(health.checkedAt).toLocaleString(dateLocale(), {
            hour12: false,
          })}
          {" · "}
          {fast ? t("Fast check") : t("Deep check")}
        </p>
      )}
      {(error || !!health?.error || problemCount > 0) && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>
            {error || health?.error
              ? t("Verification incomplete")
              : t("{value0} messages need attention", {
                  value0: problemCount,
                })}
          </AlertTitle>
          <AlertDescription className="max-h-48 overflow-auto">
            {error || health?.error ? (
              error || health?.error
            ) : (
              <>
                {problemCount > problems.length && (
                  <p>
                    {t("Showing the first {value0} problems.", {
                      value0: problems.length,
                    })}
                  </p>
                )}
                <ul className="flex flex-col gap-2">
                  {problems.map((p) => (
                    <li key={p.mailId}>
                      <p>{p.subject || t("(No subject)")}</p>
                      <p>{p.error}</p>
                    </li>
                  ))}
                </ul>
              </>
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
