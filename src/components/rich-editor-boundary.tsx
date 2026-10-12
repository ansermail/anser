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
    return { error: error.message || "未知错误" };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Alert variant="destructive" className="m-6 w-auto">
        <AlertTitle>富文本编辑器暂时无法加载</AlertTitle>
        <AlertDescription>
          <p>草稿内容仍保留，可以重试或切换到 HTML 源码继续编辑。</p>
          <p>{this.state.error}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => this.setState({ error: "" })}
          >
            重试编辑器
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
}
