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

export function ComposeQuoteSettings({
  englishQuoteHeader,
  ready,
  saving,
  onChange,
}: {
  englishQuoteHeader: boolean;
  ready: boolean;
  saving: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <Card className="compose-quote-settings-card">
      <CardHeader>
        <CardTitle>
          <Label htmlFor="english-quote-header">
            {t("English reply & forward headers")}
          </Label>
        </CardTitle>
        <CardDescription id="english-quote-header-description">
          {t(
            "Use standard English RFC headers (Original Message / Forwarded Message, From, To, Date, Subject) in quoted messages instead of following the interface language.",
          )}
        </CardDescription>
        <CardAction className="self-center">
          <Switch
            id="english-quote-header"
            aria-label={t("Use English headers for replies and forwards")}
            aria-describedby="english-quote-header-description"
            checked={englishQuoteHeader}
            disabled={!ready || saving}
            onCheckedChange={onChange}
          />
        </CardAction>
      </CardHeader>
    </Card>
  );
}
