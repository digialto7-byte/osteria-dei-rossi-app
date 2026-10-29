"use client";

import { useSyncExternalStore } from "react";

// `navigator.onLine` as a store (M20): false when the phone knows it has no connection. It is a hint, not proof (a dead Wi-Fi spot can
// still report online): the real test is a request that fails, and the queue works either way.
function subscribe(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** True while the browser says it is online (and on the server, where there is no phone). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
