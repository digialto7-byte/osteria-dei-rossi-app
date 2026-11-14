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
  return (
    <div role="tablist" aria-label={label} className={`flex flex-wrap gap-2 ${className}`}>
      {segments.map((segment) => {
        const on = segment.key === selected;
        return (
          <button
            key={segment.key}
            type="button"
            role="tab"
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
