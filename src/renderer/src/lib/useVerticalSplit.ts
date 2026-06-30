import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Options = {
  /** Initial height share for the top pane (0–1). Default 0.55. */
  initialFraction?: number;
  /** Minimum top pane height in px. */
  minFirstPx?: number;
  /** Minimum bottom pane height in px. */
  minSecondPx?: number;
};

/**
 * Draggable vertical split between two stacked panes.
 * Returns a fraction (top share) and pointer handlers for a horizontal divider.
 */
export function useVerticalSplit(
  containerRef: React.RefObject<HTMLElement | null>,
  {
    initialFraction = 0.55,
    minFirstPx = 100,
    minSecondPx = 220,
  }: Options = {},
) {
  const [fraction, setFraction] = useState(initialFraction);
  const dragRef = useRef<{ startY: number; startFraction: number; height: number } | null>(null);

  const clampFraction = useCallback(
    (f: number) => {
      const el = containerRef.current;
      if (!el) return f;
      const h = el.clientHeight;
      if (h <= 0) return f;
      const minFirst = minFirstPx / h;
      const minSecond = minSecondPx / h;
      return Math.max(minFirst, Math.min(1 - minSecond, f));
    },
    [containerRef, minFirstPx, minSecondPx],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setFraction((f) => clampFraction(f));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef, clampFraction]);

  const onDividerPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      dragRef.current = {
        startY: e.clientY,
        startFraction: fraction,
        height: el.clientHeight,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [containerRef, fraction],
  );

  const onDividerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d || d.height <= 0) return;
      const delta = e.clientY - d.startY;
      setFraction(clampFraction(d.startFraction + delta / d.height));
    },
    [clampFraction],
  );

  const onDividerPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  return {
    fraction,
    onDividerPointerDown,
    onDividerPointerMove,
    onDividerPointerUp,
  };
}
