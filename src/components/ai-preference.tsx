import { t } from "@/lib/i18n";
import type { useAiPreference } from "@/hooks/use-ai-preference";
import { toast } from "sonner";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Label } from "./ui/label";
import { Switch } from "./ui/switch";

export function AiPreference({
  preference,
}: {
  preference: ReturnType<typeof useAiPreference>;
}) {
  return (
    <Card className="workspace-settings-card">
      <CardHeader>
        <CardTitle>
          <Label htmlFor="ai-enabled">{t("AI features")}</Label>
        </CardTitle>
        <CardDescription id="ai-enabled-description">
          {t(
            "Use AI for translation, summaries, writing assistance and work reports.",
          )}
        </CardDescription>
        <CardAction className="self-center">
          <Switch
            id="ai-enabled"
            aria-describedby="ai-enabled-description"
            checked={preference.enabled}
            disabled={!preference.ready || preference.saving}
            onCheckedChange={(enabled) =>
              void preference
                .change(enabled)
                .catch(() =>
                  toast.error(t("Could not save the AI preference.")),
                )
            }
          />
        </CardAction>
      </CardHeader>
    </Card>
  );
}
