import { useEffect, useState } from "react";

/** Use the available workspace height to choose a useful number of rows. */
export function useResponsivePageSize(minimum: number, rowHeight = 36) {
  const [pageSize, setPageSize] = useState(minimum);

  useEffect(() => {
    const update = () => {
      const available = Math.max(0, window.innerHeight - 210);
      setPageSize(
        Math.max(minimum, Math.min(80, Math.floor(available / rowHeight))),
      );
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [minimum, rowHeight]);

  return pageSize;
}
