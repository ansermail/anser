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
    <section className="flex flex-col gap-3" aria-label="服务器数量与空间预算">
      <Separator />
      <p className="text-sm font-medium">所选保存范围的服务器检查</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">服务器邮件位置</dt>
          <dd>{budget.complete ? `${total} 项` : "检查未完成"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">尚未缓存的位置</dt>
          <dd>{budget.complete ? `${uncached} 项` : "未知"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">预计仍需保存</dt>
          <dd>{budget.complete ? `${pending} 项` : "未知"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">存档磁盘可用空间</dt>
          <dd>
            {budget.availableBytes === null
              ? "无法读取"
              : budgetSize(budget.availableBytes)}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">
        预计需预留：
        {budget.requiredBytes === null
          ? "无法完整估算"
          : budgetSize(budget.requiredBytes)}
        。 以服务器原件大小及本机保存记录估算，另加 10% 与 128 MB
        余量；多个目录的同一邮件可能重复计入。
      </p>
      {budget.dataDir !== currentPath && (
        <p className="break-all text-sm text-muted-foreground">
          预算磁盘位置：{budget.dataDir}。保存位置已变化，请刷新本地状态。
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        检查时间：{new Date(budget.checkedAt).toLocaleString("zh-CN")}
        。仅核对数量和大小，不下载邮件；保存范围变更后需重新检查。
      </p>
      {budget.folders.map((f) => (
        <p key={f.folder} className="text-sm break-words">
          {f.displayName}：
          {f.error
            ? `未完成 · ${f.error}`
            : `${f.total} 项，预计待保存 ${f.pending} 项 · ${budgetSize(f.pendingBytes ?? 0)}`}
          {f.conservative && "（服务器未提供稳定编号，按全部原件估算）"}
        </p>
      ))}
      {(budget.diskError || budget.lowSpace || !budget.complete) && (
        <Alert variant="destructive">
          <AlertDescription>
            {budget.diskError ||
              (budget.lowSpace
                ? "存档磁盘可用空间不足以覆盖当前预算，请调整保存范围或存档位置。"
                : "部分目录未完成检查，剩余邮件和所需空间仍未知，请处理异常后重新检查。")}
          </AlertDescription>
        </Alert>
      )}
    </section>
  );
}
