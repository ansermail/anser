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
        {checking ? "正在校验…" : "校验存档"}
      </Button>
      <p className="text-xs text-muted-foreground" role="status">
        {checking
          ? "正在校验原始邮件与附件…"
          : health
            ? `${health.healthy} / ${health.checked} 封校验通过`
            : "检查本地原件与附件的完整性"}
      </p>
      {health && (
        <p className="text-xs text-muted-foreground">
          最近校验：
          {new Date(health.checkedAt).toLocaleString("zh-CN", {
            hour12: false,
          })}
        </p>
      )}
      {(error || !!health?.problems.length) && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>
            {error ? "校验未完成" : `${health!.problems.length} 封需要检查`}
          </AlertTitle>
          <AlertDescription className="max-h-48 overflow-auto">
            {error || (
              <ul className="flex flex-col gap-2">
                {health!.problems.map((p) => (
                  <li key={p.mailId}>
                    <p>{p.subject || "（无主题）"}</p>
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
          演示模式仅展示示例校验结果。
        </p>
      )}
    </div>
  );
}
