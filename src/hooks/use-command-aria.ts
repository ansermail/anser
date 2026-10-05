import { useCallback, useLayoutEffect, useRef, useState } from "react";

// cmdk owns its accessibility IDs. Link the external input to the mounted portal.
export function useCommandAria(
  open: boolean,
  active: number,
  value: string,
  count: number,
) {
  const items = useRef<(HTMLDivElement | null)[]>([]);
  const [listId, setListId] = useState<string>();
  const [itemId, setItemId] = useState<string>();
  const selected = Math.min(active, count - 1);
  const listRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setListId(node.id);
  }, []);
  const itemRef = useCallback(
    (index: number, node: HTMLDivElement | null) => {
      items.current[index] = node;
      if (node && index === selected) setItemId(node.id);
    },
    [selected],
  );
  useLayoutEffect(() => {
    setItemId(items.current[selected]?.id);
  }, [open, selected, value, count]);
  return {
    listRef,
    itemRef,
    controls: open ? listId : undefined,
    activeDescendant: open ? itemId : undefined,
  };
}
