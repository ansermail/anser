import { useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  normalizeTheme,
  type ThemeAppearance,
  type useTheme,
} from "@/lib/theme";
import { normalizeThemePalette, themePalettes } from "@/lib/theme-palettes";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";

export function AppearanceSettings({
  theme,
}: {
  theme: ReturnType<typeof useTheme>;
}) {
  const [editing, setEditing] = useState<ThemeAppearance | null>(null);
  const appearance = editing ?? theme.appearance;
  const modeLabel = t("Appearance mode");
  const lightLabel = t("Light palette");
  const darkLabel = t("Dark palette");

  return (
    <Card className="appearance-settings-card gap-4">
      <CardHeader>
        <CardTitle>{t("Appearance")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{modeLabel}</span>
          <ToggleGroup
            aria-label={modeLabel}
            className="appearance-mode"
            size="sm"
            variant="outline"
            type="single"
            value={theme.mode}
            onValueChange={(mode) => {
              if (!mode) return;
              setEditing(null);
              theme.setMode(normalizeTheme(mode));
            }}
          >
            <ToggleGroupItem value="light">
              <Sun aria-hidden="true" />
              {t("Light mode")}
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              <Moon aria-hidden="true" />
              {t("Dark mode")}
            </ToggleGroupItem>
            <ToggleGroupItem value="system">
              <Monitor aria-hidden="true" />
              {t("Follow system")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-col gap-3">
          <ToggleGroup
            aria-label={t("Color palettes")}
            className="appearance-mode"
            size="sm"
            variant="outline"
            type="single"
            value={appearance}
            onValueChange={(value) => {
              if (value === "light" || value === "dark") setEditing(value);
            }}
          >
            <ToggleGroupItem value="light">{lightLabel}</ToggleGroupItem>
            <ToggleGroupItem value="dark">{darkLabel}</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            aria-label={appearance === "light" ? lightLabel : darkLabel}
            className="appearance-palette-grid"
            type="single"
            variant="outline"
            spacing={1}
            value={theme.palettes[appearance]}
            onValueChange={(palette) => {
              if (palette)
                theme.setPalette(appearance, normalizeThemePalette(palette));
            }}
          >
            {themePalettes.map((palette) => {
              const variant =
                appearance === "light"
                  ? "light" in palette && palette.light
                  : "dark" in palette && palette.dark;
              return (
                <ToggleGroupItem
                  key={palette.id}
                  className="appearance-palette-option"
                  value={palette.id}
                >
                  <span
                    className="appearance-palette-sample"
                    data-theme-appearance={appearance}
                    data-theme-palette={palette.id}
                    aria-hidden="true"
                  />
                  <span className="appearance-palette-name">
                    <span>{t(palette.name)}</span>
                    {variant && (
                      <span className="text-xs text-muted-foreground">
                        {t(variant)}
                      </span>
                    )}
                  </span>
                  <Check
                    className="appearance-palette-check"
                    aria-hidden="true"
                  />
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </div>
      </CardContent>
    </Card>
  );
}
