import { Check, Monitor, Moon, Sun } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  normalizeTheme,
  type ThemeAppearance,
  type useTheme,
} from "@/lib/theme";
import { themePalettes, type ThemePalette } from "@/lib/theme-palettes";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function AppearanceSettings({
  theme,
}: {
  theme: ReturnType<typeof useTheme>;
}) {
  const modeLabel = t("Appearance mode");

  function selectSwatch(appearance: ThemeAppearance, palette: ThemePalette) {
    theme.setPalette(appearance, palette);
    if (theme.appearance !== appearance) {
      theme.setMode(appearance);
    }
  }

  function selectFamily(palette: ThemePalette) {
    theme.setPalette("light", palette);
    theme.setPalette("dark", palette);
  }

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
        <div
          className="appearance-palette-grid"
          role="group"
          aria-label={t("Color palettes")}
        >
          {themePalettes.map((palette) => {
            const lightSelected = theme.palettes.light === palette.id;
            const darkSelected = theme.palettes.dark === palette.id;
            const currentActive = theme.palette === palette.id;
            const baseName = t(palette.name);
            const lightVariant = "light" in palette && palette.light;
            const darkVariant = "dark" in palette && palette.dark;
            const lightTitle = lightVariant
              ? `${baseName} · ${t(lightVariant)}`
              : baseName;
            const darkTitle = darkVariant
              ? `${baseName} · ${t(darkVariant)}`
              : baseName;
            const lightLabel = t("Light: {value0}", { value0: lightTitle });
            const darkLabel = t("Dark: {value0}", { value0: darkTitle });
            return (
              <div
                key={palette.id}
                className="appearance-palette-card"
                data-active={currentActive ? "true" : undefined}
              >
                <div className="appearance-palette-swatches">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="appearance-swatch"
                        data-theme-appearance="light"
                        data-theme-palette={palette.id}
                        data-selected={lightSelected ? "true" : undefined}
                        aria-pressed={lightSelected}
                        aria-label={lightLabel}
                        onClick={() => selectSwatch("light", palette.id)}
                      >
                        {lightSelected && (
                          <span
                            className="appearance-swatch-check"
                            aria-hidden="true"
                          >
                            <Check size={11} strokeWidth={2.8} />
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      {lightLabel}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="appearance-swatch"
                        data-theme-appearance="dark"
                        data-theme-palette={palette.id}
                        data-selected={darkSelected ? "true" : undefined}
                        aria-pressed={darkSelected}
                        aria-label={darkLabel}
                        onClick={() => selectSwatch("dark", palette.id)}
                      >
                        {darkSelected && (
                          <span
                            className="appearance-swatch-check"
                            aria-hidden="true"
                          >
                            <Check size={11} strokeWidth={2.8} />
                          </span>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      {darkLabel}
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="appearance-palette-title"
                  aria-label={t("Apply {value0} to both light and dark", {
                    value0: baseName,
                  })}
                  onClick={() => selectFamily(palette.id)}
                >
                  <span>{baseName}</span>
                </Button>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
