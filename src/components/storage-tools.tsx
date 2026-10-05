import { SelectField, SelectOption } from "@/components/ui/select-field";
import { useEffect, useState } from "react";
import { Clock3, LoaderCircle, ShieldCheck, AlertCircle } from "lucide-react";
import { call, isDemo } from "@/lib/api";
import type { ArchiveHealth, Preferences } from "@/lib/types";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { toast } from "sonner";

export function StorageTools() {
  const [preferences, setPreferences] = useState<Preferences>({
      syncIntervalMinutes: 5,
      newMailNotifications: true,
      sendResultNotifications: true,
    }),
    [interval, setInterval] = useState(5),
    [ready, setReady] = useState(false);
  const [desktop, setDesktop] = useState<{
    autoStart: boolean;
    autoStartAvailable: boolean;
  } | null>(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
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
    void call<{ autoStart: boolean; autoStartAvailable: boolean }>(
      "desktop_settings",
    )
      .then((p) => {
        if (live) setDesktop(p);
      })
      .catch((e) => toast.error(String(e)));
    return () => {
      live = false;
    };
  }, []);
  async function save() {
    setSaving(true);
    try {
      const p = { ...preferences, syncIntervalMinutes: interval };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
      toast.success("后台检查间隔已更新");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }
  async function notifications(
    key: "newMailNotifications" | "sendResultNotifications",
    enabled: boolean,
  ) {
    setSaving(true);
    try {
      const p = { ...preferences, [key]: enabled };
      await call("save_preferences", { preferences: p });
      setPreferences(p);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }
  async function autoStart(enabled: boolean) {
    setDesktopBusy(true);
    try {
      await call("set_auto_start", { enabled });
      setDesktop(await call("desktop_settings"));
      toast.success(enabled ? "开机自启已开启" : "开机自启已关闭");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDesktopBusy(false);
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
        <h3>系统通知与启动</h3>
        <div className="settings-tool-row justify-between">
          <Label htmlFor="new-mail-notifications">新邮件通知</Label>
          <Switch
            id="new-mail-notifications"
            checked={preferences.newMailNotifications ?? true}
            disabled={!ready || saving}
            onCheckedChange={(enabled) =>
              void notifications("newMailNotifications", enabled)
            }
          />
        </div>
        <div className="settings-tool-row justify-between">
          <Label htmlFor="send-result-notifications">发送结果通知</Label>
          <Switch
            id="send-result-notifications"
            checked={preferences.sendResultNotifications ?? true}
            disabled={!ready || saving}
            onCheckedChange={(enabled) =>
              void notifications("sendResultNotifications", enabled)
            }
          />
        </div>
        <p>
          新邮件和发送成功、失败或结果未确认时使用系统通知。首次导入旧邮件不通知；通知横幅由
          macOS 设置控制。
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void call("test_notification")
              .then(() =>
                toast.success(
                  isDemo()
                    ? "演示模式不发送系统通知"
                    : "测试通知已提交，请检查通知中心",
                ),
              )
              .catch((e) => toast.error(String(e)))
          }
        >
          测试系统通知
        </Button>
        <div className="settings-tool-row justify-between">
          <Label htmlFor="auto-start">开机自启</Label>
          <Switch
            id="auto-start"
            checked={desktop?.autoStart || false}
            disabled={
              !desktop ||
              desktopBusy ||
              (!desktop.autoStartAvailable && !desktop.autoStart)
            }
            onCheckedChange={(enabled) => void autoStart(enabled)}
          />
        </div>
        <p>
          {desktop?.autoStartAvailable === false
            ? "开发预览依赖前端服务，请在正式应用中开启开机自启。"
            : "登录 Mac 后自动在后台启动，继续收信和处理定时发送。"}
        </p>
        {isDemo() && <p>演示模式不修改系统启动项。</p>}
      </Card>
      <Card className="settings-tool">
        <div className="settings-tool-title">
          <Clock3 size={18} />
          <h3>后台检查</h3>
        </div>
        <div className="settings-tool-row">
          <SelectField
            aria-label="后台检查间隔"
            value={interval}
            disabled={!ready || saving}
            onValueChange={(value) => setInterval(Number(value))}
          >
            {[1, 5, 10, 15, 30, 60].map((n) => (
              <SelectOption key={n} value={n}>
                每 {n} 分钟
              </SelectOption>
            ))}
          </SelectField>
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
        <p>
          IMAP 优先实时收取；此间隔用于定时补查和
          POP3。关闭窗口后继续运行，唤醒后补收。
        </p>
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
