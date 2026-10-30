"use client";

import { useEffect, useState } from "react";

/** The clock in milliseconds, read once and then every `tickMs` (null: never again). Screens that count down use it. */
export function useNow(tickMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (tickMs === null) return;
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}
