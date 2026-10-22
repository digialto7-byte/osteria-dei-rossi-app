"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, following changes. False on the server and during the first
 * client render, so the page starts as the phone layout and widens once the browser reports it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", notify);
      return () => list.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
