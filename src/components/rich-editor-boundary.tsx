import { t } from "@/lib/i18n";
import { Component, type ReactNode } from "react";
import { Alert, AlertTitle, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";

// Keep a failed lazy editor from taking the mailbox and unsaved compose state
// down with it. The parent still owns the draft and the body format control.
export class RichEditorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message || t("Unknown error") };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert variant="destructive" className="m-6 w-auto">
        <AlertTitle>
          {t("The rich-text editor is temporarily unavailable")}
        </AlertTitle>
        <AlertDescription>
          <p>
            {t(
              "Your draft is preserved. Retry or switch to HTML source to continue editing.",
            )}
          </p>
          <p>{this.state.error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => this.setState({ error: "" })}
          >
            {t("Retry editor")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
}
