"use client";

import { useSyncExternalStore } from "react";

// Nothing to subscribe to: whether React has taken over the page never changes after it does.
const subscribe = () => () => undefined;

/**
 * False in the server render and until React has hydrated the page, true after (and on every later render).
 * A form keeps its buttons disabled while this is false: a tap before hydration would otherwise submit the
 * form natively, and the browser would send what was typed to the server instead of to the API handler.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
