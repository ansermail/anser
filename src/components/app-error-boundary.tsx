import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
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
