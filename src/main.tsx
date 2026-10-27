import React from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import { ExternalMailWindow } from "./components/external-mail-window";
import "./index.css";
import { isWindows } from "./lib/platform";
document.documentElement.dataset.platform = isWindows() ? "windows" : "macos";
const label = isTauri() ? getCurrentWebviewWindow().label : "main";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {label?.startsWith("external-mail-") ? <ExternalMailWindow /> : <App />}
  </React.StrictMode>,
);
