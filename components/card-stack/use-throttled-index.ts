"use client";

import { useEffect, useRef, useState } from "react";

type Shown = { index: number; direction: number };

/**
 * Follows `index` at most once per `interval` ms (always settling on the latest
 * value), so a fast sweep doesn't stack up a dozen half-faded titles.
 */
export function useThrottledIndex(index: number, interval: number): Shown {
  const [shown, setShown] = useState<Shown>({ index, direction: 1 });
  const lastUpdate = useRef(0);

  useEffect(() => {
    const wait = Math.max(0, lastUpdate.current + interval - performance.now());
    const id = window.setTimeout(() => {
      lastUpdate.current = performance.now();
      setShown((previous) =>
        previous.index === index
          ? previous
          : { index, direction: index > previous.index ? 1 : -1 },
      );
    }, wait);
    return () => window.clearTimeout(id);
  }, [index, interval]);

  return shown;
}
