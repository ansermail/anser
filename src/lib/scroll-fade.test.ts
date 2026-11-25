// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { observeScrollFade } from "./scroll-fade";

function scrollContainer(axis: "vertical" | "horizontal", content: number) {
  const element = document.createElement("div");
  const size = { viewport: 100, content };
  const vertical = axis === "vertical";
  Object.defineProperties(element, {
    [vertical ? "clientHeight" : "clientWidth"]: { get: () => size.viewport },
    [vertical ? "scrollHeight" : "scrollWidth"]: { get: () => size.content },
  });
  const stop = observeScrollFade(element, axis);

  return {
    element,
    size,
    stop,
    edges: () =>
      element
        .getAttributeNames()
        .map((name) => name.replace("data-scroll-fade-", "")),
    scrollTo(offset: number) {
      if (vertical) element.scrollTop = offset;
      else element.scrollLeft = offset;
      element.dispatchEvent(new Event("scroll"));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

it("leaves all edges clear for content that fits within the two-pixel tolerance", () => {
  const scroll = scrollContainer("vertical", 102);
  expect(scroll.edges()).toEqual([]);
  scroll.scrollTo(2);
  expect(scroll.edges()).toEqual([]);
  scroll.stop();
});

it.each([
  ["vertical", "top", "bottom"],
  ["horizontal", "left", "right"],
] as const)(
  "updates the %s start and end edges and clears them on cleanup",
  (axis, start, end) => {
    const scroll = scrollContainer(axis, 200);

    expect(scroll.edges()).toEqual([end]);
    scroll.scrollTo(2);
    expect(scroll.edges()).toEqual([end]);
    scroll.scrollTo(50);
    expect(scroll.edges()).toEqual(expect.arrayContaining([start, end]));
    scroll.scrollTo(98);
    expect(scroll.edges()).toEqual([start]);
    scroll.scrollTo(100);
    expect(scroll.edges()).toEqual([start]);
    scroll.scrollTo(0);
    expect(scroll.edges()).toEqual([end]);

    scroll.stop();
    scroll.scrollTo(50);
    expect(scroll.edges()).toEqual([]);
  },
);

it("refreshes the edges when content changes or the viewport resizes", async () => {
  let resize!: () => void;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(update: () => void) {
        resize = update;
      }
      observe() {}
      disconnect() {}
    },
  );
  const scroll = scrollContainer("vertical", 100);
  expect(scroll.edges()).toEqual([]);

  scroll.size.content = 200;
  scroll.element.append(document.createElement("div"));
  await Promise.resolve();
  expect(scroll.edges()).toEqual(["bottom"]);

  scroll.size.viewport = 200;
  resize();
  expect(scroll.edges()).toEqual([]);
  scroll.stop();
});
