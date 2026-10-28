"use client";

import { useEffect, useRef } from "react";

/**
 * A ref for the heading of a card that has just opened: on mount the heading is scrolled into view and takes focus
 * (it needs tabIndex -1), so a tap on a tile far down the page does not leave the card off-screen and the keyboard or
 * screen reader starts in it.
 */
export function useFocusIntoView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    // Not in every browser or test environment.
    element.scrollIntoView?.({ block: "nearest" });
  }, []);
  return ref;
}
