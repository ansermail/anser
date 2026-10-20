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
        <CardTitle>{t("本地保存状态")}</CardTitle>
        <CardDescription>
          {t("统计已缓存的邮件；尚未发现的服务器历史邮件不包含在内。")}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">{t("已缓存")}</dt>
            <dd>
              {summary.known}
              {t(" 封")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("完整保存")}</dt>
            <dd>
              {summary.saved}
              {t(" 封")}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("范围内待保存")}</dt>
            <dd>
              {summary.pending}
              {t(" 封")}
            </dd>
          </div>
        </dl>
        <p className="text-sm text-muted-foreground">
          {t("已保存原始邮件大小：")}
          {formatSize(summary.savedBytes)}
          {t("。待保存数量按当前已保存的范围设置统计。")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("最近成功收取：")}
          {last && !Number.isNaN(last.getTime())
            ? last.toLocaleString(dateLocale())
            : t("尚无成功记录")}
        </p>
        <p className="break-all text-sm">
          {t("保存位置：")}
          {summary.dataDir}
        </p>
        {budgetContent}
        {summary.receiveError && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("最近收取异常：")}
              {summary.receiveError}
            </AlertDescription>
          </Alert>
        )}
        {summary.failedJobs > 0 && (
          <Alert variant="destructive">
            <AlertDescription>
              {t("有 ")}
              {summary.failedJobs}{" "}
              {t(
                "项完整保存任务失败，请在设置的“完整保存任务”查看原因并重试。",
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
          {t("打开保存位置")}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={onRefresh}>
          <RefreshCw data-icon="inline-start" />
          {t("刷新保存状态")}
        </Button>
      </CardFooter>
    </Card>
  );
}
