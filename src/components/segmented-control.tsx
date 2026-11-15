"use client";

import { useRef, type KeyboardEvent } from "react";

export interface Segment<K extends string> {
  key: K;
  /** The visible text, count included ("Primi · 2"): the caller words it. */
  label: string;
  /** The tab button's id, when something refers to it. */
  id?: string;
  /** The id of the panel the tab controls. */
  controls?: string;
}

/**
 * The house tabs (docs/ux/costi-design-system.md §10.3): one tablist of 44 px buttons, the selected one filled in ink and never in the action
 * green. `comfort` makes them the 52 px gloved-thumb target. They wrap onto a second row rather than scroll. `className` styles the tablist
 * (for example to pin it).
 *
 * Keyboard: manual activation (WAI-ARIA tabs): arrows move focus, Enter/Space selects. The selected tab is the one tab stop (the others have
 * tabIndex -1, so Tab leaves the group); ArrowLeft/ArrowRight move focus and wrap, Home/End go to the first/last tab. Moving focus never
 * calls `onSelect`; the native button's Enter/Space click does. Every other key is left alone.
 */
export function SegmentedControl<K extends string>({
  label,
  segments,
  selected,
  onSelect,
  comfort = false,
  className = "",
}: {
  label: string;
  segments: Segment<K>[];
  selected: K;
  onSelect: (key: K) => void;
  comfort?: boolean;
  className?: string;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // The tab stop is derived, so it is right whenever `selected` or the list changes; with no match the first tab is the stop.
  const stop = segments.some((segment) => segment.key === selected) ? selected : segments[0]?.key;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const last = segments.length - 1;
    const here = tabs.current.findIndex((tab) => tab !== null && tab === event.target);
    if (here < 0) return;
    const next =
      event.key === "ArrowRight"
        ? (here + 1) % segments.length
        : event.key === "ArrowLeft"
          ? (here + last) % segments.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    tabs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex flex-wrap gap-2 ${className}`}
    >
      {segments.map((segment, index) => {
        const on = segment.key === selected;
        return (
          <button
            key={segment.key}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            tabIndex={segment.key === stop ? 0 : -1}
            id={segment.id}
            aria-selected={on}
            aria-controls={segment.controls}
            onClick={() => onSelect(segment.key)}
            className={
              `${comfort ? "min-h-tap-comfort" : "min-h-tap"} rounded-lg px-3 text-base font-bold transition-colors duration-150 ` +
              (on
                ? "bg-ink text-paper"
                : "border border-rule-strong bg-surface text-ink hover:bg-sunk")
            }
          >
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
