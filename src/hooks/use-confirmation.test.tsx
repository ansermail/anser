// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConfirmation } from "./use-confirmation";
import { Button } from "@/components/ui/button";
let root: Root, host: HTMLDivElement;
const perform = vi.fn();
function Harness() {
  const { askConfirmation, confirmationDialog } = useConfirmation();
  return (
    <>
      <Button
        onClick={async () => {
          if (
            await askConfirmation({
              title: "删除测试记录？",
              description: "只有确认后执行。",
              action: "确认删除",
              destructive: true,
            })
          )
            perform();
        }}
      >
        删除
      </Button>
      {confirmationDialog}
    </>
  );
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label,
  )!;
  await act(async () => button.click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  perform.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("does not perform the action until the user confirms and executes only once", async () => {
  await click("删除");
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
    "删除测试记录？",
  );
  expect(perform).not.toHaveBeenCalled();
  await click("确认删除");
  expect(perform).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
it("cancels without performing and a later request can still be confirmed", async () => {
  await click("删除");
  await click("取消");
  expect(perform).not.toHaveBeenCalled();
  await click("删除");
  await click("确认删除");
  expect(perform).toHaveBeenCalledOnce();
});
it("unmounts an open request without performing or leaving an unresolved action", async () => {
  await click("删除");
  await act(async () => root.render(null));
  expect(perform).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
