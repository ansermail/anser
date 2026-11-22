// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { installBackspaceGuard } from "./webview-keys";

let removeGuard: (() => void) | undefined;

afterEach(() => {
  removeGuard?.();
  removeGuard = undefined;
});

function backspace(target: EventTarget) {
  const event = new KeyboardEvent("keydown", {
    key: "Backspace",
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

it("prevents Backspace from navigating the webview outside editable fields", () => {
  removeGuard = installBackspaceGuard(window);
  expect(backspace(document.body).defaultPrevented).toBe(true);

  const input = document.createElement("input");
  document.body.append(input);
  expect(backspace(input).defaultPrevented).toBe(false);
  input.remove();
});
