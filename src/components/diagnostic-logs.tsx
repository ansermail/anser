import { useEffect, useState } from "react";
import { Download, FolderOpen, FileText } from "lucide-react";
import { toast } from "sonner";
import { call, isDemo, native, publicPreview } from "@/lib/api";
import { t } from "@/lib/i18n";
import { formatSize } from "@/lib/providers";
import { useSettingsTabActive } from "./settings-layout";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";

export type DiagnosticLogStatus = {
  path: string;
  fileCount: number;
  totalBytes: number;
};

function defaultLogFileName() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `anser-diagnostics-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.log`;
}

export function DiagnosticLogsCard() {
  const tabActive = useSettingsTabActive();
  const [status, setStatus] = useState<DiagnosticLogStatus | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!tabActive) return;
    let live = true;
    void call<DiagnosticLogStatus>("diagnostic_log_status")
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [tabActive]);

  async function exportLogs() {
    if (exporting) return;
    if (publicPreview || !native || isDemo()) {
      toast.info(
        t("Diagnostic log export is available in the desktop application."),
      );
      return;
    }
    setExporting(true);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        title: t("Export redacted diagnostic log"),
        defaultPath: defaultLogFileName(),
        filters: [{ name: "Log", extensions: ["log", "txt"] }],
      });
      if (!path) return;
      const bytes = await call<number>("export_diagnostic_log", { path });
      toast.success(
        t("Diagnostic log exported ({value0})", { value0: formatSize(bytes) }),
      );
      const next = await call<DiagnosticLogStatus>(
        "diagnostic_log_status",
      ).catch(() => null);
      if (next) setStatus(next);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setExporting(false);
    }
  }

  async function openFolder() {
    if (publicPreview || !native || isDemo()) {
      toast.info(
        t("Diagnostic log folder is available in the desktop application."),
      );
      return;
    }
    try {
      await call("open_log_dir");
    } catch (error) {
      toast.error(String(error));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <FileText size={16} className="text-muted-foreground" />
            <CardTitle>{t("Local diagnostic logs")}</CardTitle>
            {status && (
              <Badge variant="secondary" className="tabular-nums">
                {t("{value0} files · {value1}", {
                  value0: status.fileCount,
                  value1: formatSize(status.totalBytes),
                })}
              </Badge>
            )}
          </div>
          <CardDescription>
            {t(
              "Rotating local logs record login, sync, and protocol errors without storing passwords, tokens, or message bodies. Exported logs mask email addresses and omit subjects.",
            )}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={exporting || publicPreview}
          onClick={() => void exportLogs()}
        >
          <Download size={14} data-icon="inline-start" />
          {exporting
            ? t("Exporting diagnostic log…")
            : t("Export redacted diagnostic log")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={publicPreview}
          onClick={() => void openFolder()}
        >
          <FolderOpen size={14} data-icon="inline-start" />
          {t("Open log folder")}
        </Button>
      </CardContent>
    </Card>
  );
}
