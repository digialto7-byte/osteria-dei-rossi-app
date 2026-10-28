"use client";

import { useEffect, useRef } from "react";

/**
 * Calls `tick` every `intervalMs` while `active`, and not at all otherwise or after the component has gone. A tick that
 * returns a promise is waited for: while it is pending the next ticks are skipped, so two reads are never in flight and
 * an older answer cannot land after a newer one. A tick that throws or rejects does not stop the polling. The newest
 * `tick` is used, so a caller can pass an inline function.
 */
export function usePollWhile(
  active: boolean,
  intervalMs: number,
  tick: () => void | Promise<void>,
): void {
  const latest = useRef(tick);
  useEffect(() => {
    latest.current = tick;
  });
  useEffect(() => {
    if (!active) return;
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void Promise.resolve()
        .then(() => latest.current())
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
}
