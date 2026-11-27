// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TooltipProvider } from "./ui/tooltip";
import { AppearanceSettings } from "./appearance-settings";
import {
  resetThemeForTest,
  setThemeMode,
  themeSnapshot,
  useTheme,
} from "@/lib/theme";

let host: HTMLDivElement;
let root: Root;

function Harness() {
  const theme = useTheme();
  return (
    <TooltipProvider>
      <AppearanceSettings theme={theme} />
    </TooltipProvider>
  );
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  resetThemeForTest();
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<Harness />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  resetThemeForTest();
  localStorage.clear();
});

it("pairs light and dark swatches per theme without a separate palette polarity toggle", async () => {
  expect(host.querySelectorAll(".appearance-palette-card")).toHaveLength(10);
  expect(host.textContent).not.toContain("浅色配色");
  expect(host.textContent).not.toContain("深色配色");

  // Click Catppuccin dark swatch while currently in light mode -> sets dark palette and switches to dark
  const catppuccinDark = host.querySelector<HTMLButtonElement>(
    '.appearance-swatch[data-theme-palette="catppuccin"][data-theme-appearance="dark"]',
  )!;
  expect(catppuccinDark).not.toBeNull();
  await act(async () => {
    catppuccinDark.click();
  });
  expect(themeSnapshot()).toBe("dark:dark:pine:catppuccin");

  // Click GitHub light swatch -> sets light palette and switches to light
  const githubLight = host.querySelector<HTMLButtonElement>(
    '.appearance-swatch[data-theme-palette="github"][data-theme-appearance="light"]',
  )!;
  await act(async () => {
    githubLight.click();
  });
  expect(themeSnapshot()).toBe("light:light:github:catppuccin");

  // Switch to system mode and click Nord theme title -> updates both light & dark palettes while staying in system mode
  await act(async () => {
    setThemeMode("system");
  });
  const nordTitle = [
    ...host.querySelectorAll<HTMLButtonElement>(".appearance-palette-title"),
  ].find((btn) => btn.textContent?.includes("Nord"))!;
  await act(async () => {
    nordTitle.click();
  });
  expect(themeSnapshot()).toBe("system:light:nord:nord");
});
