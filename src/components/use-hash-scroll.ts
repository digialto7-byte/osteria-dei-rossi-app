"use client";

import { useEffect } from "react";

/**
 * Scrolls to the element named by the address' #hash once the list that holds it has loaded. A browser does this by
 * itself only for elements that exist at page load, and these rows arrive from /api/* afterwards.
 */
export function useHashScroll(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [ready]);
}
