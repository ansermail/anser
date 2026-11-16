import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { call, newDraft, snapshot } from "./lib/api";
import { setInterfaceLanguage } from "./lib/i18n";
import { setThemeMode } from "./lib/theme";
import "./index.css";

async function renderPreview() {
  const params = new URLSearchParams(window.location.search);
  const embedded = params.get("embed") === "1" && window.parent !== window;
  const view = params.get("view");
  const language = params.get("lang");
  if (language === "en" || language === "zh-CN") {
    await call("set_interface_language", { language });
    setInterfaceLanguage(language);
  }
  if (embedded) setThemeMode("dark", false);

  const sample =
    view === "inbox" || view === "compose"
      ? await snapshot({
          view: "all",
          accountId: "",
          search: "",
          folder: "",
          limit: 1,
          unreadOnly: false,
        })
      : null;
  const account = sample?.accounts.find((item) => item.enabled);

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {!embedded && (
        <a
          className="demo-home-link"
          href={import.meta.env.BASE_URL}
          aria-label={language === "en" ? "Anser home" : "返回雁信官网"}
        >
          ← Anser
        </a>
      )}
      <App
        initialPage={
          view === "archive" ? "settings" : view === "rules" ? "rules" : "mail"
        }
        initialSettingsSection={view === "archive" ? "archive" : "accounts"}
        initialMailId={view === "inbox" ? sample?.messages[0]?.id : undefined}
        initialDraft={
          view === "compose" && account ? newDraft(account.id) : null
        }
      />
    </React.StrictMode>,
  );
}

void renderPreview();
