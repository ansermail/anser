import { dateLocale, t } from "@/lib/i18n";
import type { ReactNode } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { call } from "@/lib/api";
import { formatSize } from "@/lib/providers";
import type { RetentionSummary } from "@/lib/types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./ui/card";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

export function RetentionSummaryView({
  summary,
  onRefresh,
  busy,
  budgetContent,
  budgetActions,
}: {
  summary: RetentionSummary;
  onRefresh: () => void;
  busy: boolean;
  budgetContent?: ReactNode;
  budgetActions?: ReactNode;
}) {
  const last = summary.lastSync ? new Date(summary.lastSync) : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Local saving status")}</CardTitle>
        <CardDescription>
          {t(
            "Counts cached messages only; undiscovered server history is not included.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("Cached")}</dt>
            <dd>
              {summary.known}
              {t("messages (storage)")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("Save complete messages")}
            </dt>
            <dd>
              {summary.saved}
              {t("messages (storage)")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {t("Pending within scope")}
            </dt>
            <dd>
              {summary.pending}
              {t("messages (storage)")}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {t("Saved original message size: ")}
          {formatSize(summary.savedBytes)}
          {t(". Pending counts use the current saved retention scope.")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("Last successful check: ")}
          {last && !Number.isNaN(last.getTime())
            ? last.toLocaleString(dateLocale())
            : t("No successful checks yet")}
        </p>
        <p className="break-all text-sm">
          {t("Save location: ")}
          {summary.dataDir}
        </p>
        {budgetContent}
        {summary.receiveError && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("Last mail check error: ")}
              {summary.receiveError}
            </AlertDescription>
          </Alert>
        )}
        {summary.failedJobs > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("There are ")}
              {summary.failedJobs}{" "}
              {t(
                " full-message saving tasks failed. Review and retry them under Full-message saving tasks in Settings.",
              )}
            </AlertDescription>
          </Alert>
        )}
        {summary.warning && (
          <Alert variant="destructive">
            <AlertDescription>{summary.warning}</AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {budgetActions}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void call("open_data_folder").catch((e) => toast.error(String(e)))
          }
        >
          <FolderOpen data-icon="inline-start" />
          {t("Open save location")}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>
          <RefreshCw data-icon="inline-start" />
          {t("Refresh saving status")}
        </Button>
      </CardFooter>
    </Card>
  );
}
