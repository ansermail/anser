export const themePalettes = [
  { id: "pine", name: "Anser Pine" },
  { id: "github", name: "GitHub" },
  { id: "vscode", name: "VS Code Modern" },
  { id: "dracula", name: "Dracula", light: "Alucard" },
  { id: "catppuccin", name: "Catppuccin", light: "Latte", dark: "Mocha" },
  { id: "solarized", name: "Solarized" },
  { id: "nord", name: "Nord", light: "Snow Storm", dark: "Polar Night" },
  { id: "tokyo", name: "Tokyo Night", light: "Day", dark: "Night" },
  { id: "blue", name: "Sea Mist Blue" },
  { id: "sand", name: "Warm Sand" },
] as const;

export type ThemePalette = (typeof themePalettes)[number]["id"];

export function normalizeThemePalette(value: unknown): ThemePalette {
  return themePalettes.find(({ id }) => id === value)?.id ?? "pine";
}
