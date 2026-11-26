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
        <CardTitle>
          <Label htmlFor="show-workbench">{t("Workbench")}</Label>
        </CardTitle>
        <CardDescription id="show-workbench-description">
          {t("Hiding the entry keeps all locally saved work items.")}
        </CardDescription>
        <CardAction className="self-center">
          <Switch
            id="show-workbench"
            aria-label={t("Show workbench")}
            aria-describedby="show-workbench-description"
            checked={visible}
            disabled={!ready || saving}
            onCheckedChange={onVisibilityChange}
          />
        </CardAction>
      </CardHeader>
    </Card>
  );
}
