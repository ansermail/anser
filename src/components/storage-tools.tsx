import { useEffect, useState } from "react";
import { Clock3, LoaderCircle, ShieldCheck, AlertCircle } from "lucide-react";
import { call, isDemo } from "@/lib/api";
import type { ArchiveHealth, Preferences } from "@/lib/types";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { toast } from "sonner";

export function StorageTools() {
  const [preferences, setPreferences] = useState<Preferences>({
      syncIntervalMinutes: 5,
    }),
    [interval, setInterval] = useState(5),
    [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false),
    [checking, setChecking] = useState(false),
    [health, setHealth] = useState<ArchiveHealth | null>(null);
  useEffect(() => {
    let live = true;
    void call<Preferences>("get_preferences")
      .then((p) => {
        if (live) {
          setPreferences(p);
          setInterval(p.syncIntervalMinutes);
          setReady(true);
        }
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      live = false;
    };
  }, []);
  async function save() {
    setSaving(true);
    try {
      const p = { syncIntervalMinutes: interval };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      toast.success("后台检查间隔已更新");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }
  async function check() {
    setChecking(true);
    setHealth(null);
    try {
      setHealth(await call<ArchiveHealth>("archive_health"));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setChecking(false);
    }
  }
  return (
    <div className="storage-tools">
      <Card className="settings-tool">
        <div className="settings-tool-title">
          <Clock3 size={18} />
          <h3>后台检查</h3>
        </div>
        <div className="settings-tool-row">
          <select
            aria-label="后台检查间隔"
            value={interval}
            disabled={!ready || saving}
            onChange={(e) => setInterval(Number(e.target.value))}
          >
            {[1, 5, 10, 15, 30, 60].map((n) => (
              <option key={n} value={n}>
                每 {n} 分钟
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            disabled={
              !ready || saving || interval === preferences.syncIntervalMinutes
            }
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
        <p>默认 5 分钟；唤醒后补收。关闭窗口后继续运行。</p>
      </Card>
      <Card className="settings-tool">
        <div className="settings-tool-title">
          <ShieldCheck size={18} />
          <h3>存档完整性</h3>
        </div>
        <div className="settings-tool-row">
          <p>
            {checking
              ? "正在校验原始邮件与附件…"
              : health
                ? `${health.healthy} / ${health.checked} 封校验通过`
                : "校验本地原件及附件的完整性"}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={checking}
            onClick={() => void check()}
          >
            {checking && <LoaderCircle className="animate-spin" size={14} />}
            校验存档
          </Button>
        </div>
        {isDemo() && <p>演示模式仅展示示例校验结果。</p>}
        {health && (
          <>
            <small>
              最近校验：
              {new Date(health.checkedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </small>
            {health.problems.length > 0 && (
              <div className="archive-problems" role="alert">
                <p>
                  <AlertCircle size={14} /> {health.problems.length}{" "}
                  封需要检查，可从备份恢复
                </p>
                {health.problems.map((p) => (
                  <div key={p.mailId}>
                    <strong>{p.subject || "（无主题）"}</strong>
                    <span>{p.error}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
