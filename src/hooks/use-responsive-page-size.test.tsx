// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useResponsivePageSize } from "./use-responsive-page-size";

function Probe() {
  const pageSize = useResponsivePageSize(15);
  return <output>{pageSize}</output>;
}

it("uses more rows when the window has room, without shrinking below the 15-row baseline", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const originalHeight = window.innerHeight;
  try {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    await act(async () => root.render(<Probe />));
    const small = Number(host.querySelector("output")!.textContent);
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1400,
    });
    await act(async () => window.dispatchEvent(new Event("resize")));
    const tall = Number(host.querySelector("output")!.textContent);
    expect(small).toBeGreaterThanOrEqual(15);
    expect(tall).toBeGreaterThan(small);
  } finally {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
    });
    await act(async () => root.unmount());
    host.remove();
  }
});
