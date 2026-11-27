import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { call, isDemo, native } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";

type State = { failed: boolean };

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled interface error", error, info.componentStack);
    if (native && !isDemo()) {
      const stack = (info.componentStack || "")
        .split("\n")
        .slice(0, 8)
        .join(" | ");
      void call("record_frontend_error", {
        source: "error_boundary",
        message: `${error.name}: ${error.message} ${stack}`.trim(),
      }).catch(() => {});
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-error-screen">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{t("Something went wrong")}</AlertTitle>
          <AlertDescription>
            {t(
              "The interface could not continue rendering. Reload to restore the mailbox.",
            )}
          </AlertDescription>
        </Alert>
        <Button onClick={() => window.location.reload()}>
          {t("Reload app")}
        </Button>
      </main>
    );
  }
}
