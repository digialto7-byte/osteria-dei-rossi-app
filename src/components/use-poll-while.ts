"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `tick` every `intervalMs` while `active`, and not at all otherwise or after the component has gone. The newest
 * `tick` is used, so a caller can pass an inline function.
 */
export function usePollWhile(active: boolean, intervalMs: number, tick: () => void): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => latest.current(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
}
