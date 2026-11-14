import { Children, type ReactNode } from "react";

/**
 * A bar of one or two actions that sticks to the bottom of the screen (P3 Sala W1). Presentational only: the children share the
 * width (one child takes all of it) and the page decides what they say. It must be a direct child of the page wrapper to stick.
 * globals.css reserves its height as scroll padding, so a focused control is never hidden under it (WCAG 2.4.11).
 */
export function StickyActionBar({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="sticky-action-bar"
      className="sticky bottom-0 z-10 -mx-4 flex gap-2 border-t border-rule bg-paper px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      {Children.toArray(children).map((child, index) => (
        <div key={index} className="flex min-w-0 flex-1 flex-col">
          {child}
        </div>
      ))}
    </div>
  );
}
