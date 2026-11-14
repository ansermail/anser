import { CalendarDays } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

export function WorkspaceSettings({
  visible,
  ready,
  saving,
  onVisibilityChange,
}: {
  visible: boolean;
  ready: boolean;
  saving: boolean;
  onVisibilityChange: (visible: boolean) => void;
}) {
  return (
    <Card className="workspace-settings-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays aria-hidden="true" />
          {t("Workbench")}
        </CardTitle>
        <CardDescription id="show-workbench-description">
          {t(
            "Show the workbench entry in the sidebar. Hide it when you do not use the calendar, task views or work reports.",
          )}
        </CardDescription>
        <CardAction className="self-center">
          <div className="settings-tool-row">
            <Label htmlFor="show-workbench">{t("Show workbench")}</Label>
            <Switch
              id="show-workbench"
              aria-describedby="show-workbench-description"
              checked={visible}
              disabled={!ready || saving}
              onCheckedChange={onVisibilityChange}
            />
          </div>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
