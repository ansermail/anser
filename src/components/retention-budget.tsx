import { dateLocale, t } from "@/lib/i18n";
import type { RetentionBudget } from "@/lib/types";
import { formatSize } from "@/lib/providers";
import { Alert, AlertDescription } from "./ui/alert";
import { Separator } from "./ui/separator";

function budgetSize(bytes: number) {
  return bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : formatSize(bytes);
}
export function RetentionBudgetView({
  budget,
  currentPath,
}: {
  budget: RetentionBudget;
  currentPath: string;
}) {
  const total = budget.folders.reduce((n, f) => n + (f.total ?? 0), 0);
  const uncached = budget.folders.reduce((n, f) => n + (f.uncached ?? 0), 0);
  const pending = budget.folders.reduce((n, f) => n + (f.pending ?? 0), 0);
  return (
    <section
      className="flex flex-col gap-3"
      aria-label={t("Server count & space estimate")}
    >
      <Separator />
      <p className="text-sm font-medium">
        {t("Server review for the selected retention scope")}
      </p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">
            {t("Server message locations")}
          </dt>
          <dd>
            {budget.complete
              ? t("{value0} items", { value0: total })
              : t("Check incomplete")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("Locations not cached")}</dt>
          <dd>
            {budget.complete
              ? t("{value0} items", { value0: uncached })
              : t("Unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t("Estimated remaining to save")}
          </dt>
          <dd>
            {budget.complete
              ? t("{value0} items", { value0: pending })
              : t("Unknown")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {t("Available space on archive disk")}
          </dt>
          <dd>
            {budget.availableBytes === null
              ? t("Could not read")
              : budgetSize(budget.availableBytes)}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("Estimated space needed: ")}
        {budget.requiredBytes === null
          ? t("Cannot estimate completely")
          : budgetSize(budget.requiredBytes)}
        {t(
          ". Estimates use original sizes and local saving records, plus 10% and 128 MB headroom. Messages in multiple folders may be counted more than once.",
        )}
      </p>
      {budget.dataDir !== currentPath && (
        <p className="break-all text-sm text-muted-foreground">
          {t("Estimated disk location: ")}
          {budget.dataDir}
          {t(". The save location changed. Refresh local status.")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("Checked: ")}
        {new Date(budget.checkedAt).toLocaleString(dateLocale())}
        {t(
          ". Counts and sizes only; no messages are downloaded. Recheck after changing the retention scope.",
        )}
      </p>
      {budget.folders.map((f) => (
        <p key={f.folder} className="text-sm break-words">
          {f.displayName}：
          {f.error
            ? t("Incomplete · {value0}", { value0: f.error })
            : t("{value0} items; estimated {value1} remaining · {value2}", {
                value0: f.total,
                value1: f.pending,
                value2: budgetSize(f.pendingBytes ?? 0),
              })}
          {f.conservative &&
            t("(No stable server IDs; estimate includes all originals)")}
        </p>
      ))}
      {(budget.diskError || budget.lowSpace || !budget.complete) && (
        <Alert variant="destructive">
          <AlertDescription>
            {budget.diskError ||
              (budget.lowSpace
                ? t(
                    "The archive disk cannot cover this estimate. Adjust the retention scope or archive location.",
                  )
                : t(
                    "Some folders could not be checked. Remaining mail and space are unknown. Resolve the problems and check again.",
                  ))}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
