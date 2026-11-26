import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import { AppErrorBoundary } from "./components/app-error-boundary";
import { ExternalMailWindow } from "./components/external-mail-window";
import "./index.css";
import { isWindows } from "./lib/platform";
import { initializeAppearance } from "./lib/theme";
import { installBackspaceGuard } from "./lib/webview-keys";
document.documentElement.dataset.platform = isWindows() ? "windows" : "macos";
document.documentElement.dataset.desktop = String(isTauri());
installBackspaceGuard();
initializeAppearance();
const label = isTauri() ? getCurrentWebviewWindow().label : "main";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      {label?.startsWith("external-mail-") ? <ExternalMailWindow /> : <App />}
    </AppErrorBoundary>
  </React.StrictMode>,
);
