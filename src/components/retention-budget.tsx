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
      aria-label={t("服务器数量与空间预算")}
    >
      <Separator />
      <p className="text-sm font-medium">{t("所选保存范围的服务器检查")}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("服务器邮件位置")}</dt>
          <dd>
            {budget.complete
              ? t("{value0} 项", { value0: total })
              : t("检查未完成")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("尚未缓存的位置")}</dt>
          <dd>
            {budget.complete
              ? t("{value0} 项", { value0: uncached })
              : t("未知")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("预计仍需保存")}</dt>
          <dd>
            {budget.complete
              ? t("{value0} 项", { value0: pending })
              : t("未知")}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("存档磁盘可用空间")}</dt>
          <dd>
            {budget.availableBytes === null
              ? t("无法读取")
              : budgetSize(budget.availableBytes)}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        {t("预计需预留：")}
        {budget.requiredBytes === null
          ? t("无法完整估算")
          : budgetSize(budget.requiredBytes)}
        {t(
          "。 以服务器原件大小及本机保存记录估算，另加 10% 与 128 MB 余量；多个目录的同一邮件可能重复计入。",
        )}
      </p>
      {budget.dataDir !== currentPath && (
        <p className="break-all text-sm text-muted-foreground">
          {t("预算磁盘位置：")}
          {budget.dataDir}
          {t("。保存位置已变化，请刷新本地状态。")}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("检查时间：")}
        {new Date(budget.checkedAt).toLocaleString(dateLocale())}
        {t("。仅核对数量和大小，不下载邮件；保存范围变更后需重新检查。")}
      </p>
      {budget.folders.map((f) => (
        <p key={f.folder} className="text-sm break-words">
          {f.displayName}：
          {f.error
            ? t("未完成 · {value0}", { value0: f.error })
            : t("{value0} 项，预计待保存 {value1} 项 · {value2}", {
                value0: f.total,
                value1: f.pending,
                value2: budgetSize(f.pendingBytes ?? 0),
              })}
          {f.conservative && t("（服务器未提供稳定编号，按全部原件估算）")}
        </p>
      ))}
      {(budget.diskError || budget.lowSpace || !budget.complete) && (
        <Alert variant="destructive">
          <AlertDescription>
            {budget.diskError ||
              (budget.lowSpace
                ? t(
                    "存档磁盘可用空间不足以覆盖当前预算，请调整保存范围或存档位置。",
                  )
                : t(
                    "部分目录未完成检查，剩余邮件和所需空间仍未知，请处理异常后重新检查。",
                  ))}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
