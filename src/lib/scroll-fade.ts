import { useCallback } from "react";

type ScrollAxis = "vertical" | "horizontal";

const edgeTolerance = 2;

export function observeScrollFade(element: HTMLElement, axis: ScrollAxis) {
  const vertical = axis === "vertical";
  const startAttribute = vertical
    ? "data-scroll-fade-top"
    : "data-scroll-fade-left";
  const endAttribute = vertical
    ? "data-scroll-fade-bottom"
    : "data-scroll-fade-right";

  function update() {
    const offset = vertical ? element.scrollTop : element.scrollLeft;
    const overflow = vertical
      ? element.scrollHeight - element.clientHeight
      : element.scrollWidth - element.clientWidth;
    const scrollable = overflow > edgeTolerance;
    element.toggleAttribute(
      startAttribute,
      scrollable && offset > edgeTolerance,
    );
    element.toggleAttribute(
      endAttribute,
      scrollable && overflow - offset > edgeTolerance,
    );
  }

  const resize =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
  function observeSizes() {
    resize?.disconnect();
    resize?.observe(element);
    for (const child of element.children) resize?.observe(child);
  }
  observeSizes();

  const mutations = new MutationObserver((records) => {
    if (
      records.some(
        (record) => record.target === element && record.type === "childList",
      )
    )
      observeSizes();
    update();
  });
  mutations.observe(element, {
    childList: true,
    subtree: true,
    characterData: true,
    attributeFilter: ["hidden", "class", "style", "data-state"],
  });
  element.addEventListener("scroll", update, { passive: true });
  update();

  return () => {
    element.removeEventListener("scroll", update);
    resize?.disconnect();
    mutations.disconnect();
    element.removeAttribute(startAttribute);
    element.removeAttribute(endAttribute);
  };
}

export function useScrollFade(axis: ScrollAxis) {
  return useCallback(
    (element: HTMLElement | null) => {
      if (element) return observeScrollFade(element, axis);
    },
    [axis],
  );
}
