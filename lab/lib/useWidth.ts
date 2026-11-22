"use client";
import { useEffect, useRef, useState } from "react";

/** Width of an element in CSS pixels, so SVG charts lay out at true size (text never scales down). */
export function useWidth<T extends HTMLElement>(fallback = 760) {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Two-decimal rounding for SVG coordinates (identical server and client output). */
export const r2 = (x: number) => Math.round(x * 100) / 100;
