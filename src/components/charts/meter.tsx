import { barPct } from "@/lib/charts/scale";

/**
 * A single 0-100 % bar beside its figure (ADR-021). The visible figure carries the meaning; the SVG is decoration.
 */
export function Meter({
  value,
  valueText,
  label,
}: {
  value: number | null;
  valueText: string;
  /** What the figure measures; read by assistive technology before the figure. */
  label: string;
}) {
  return (
    <div className="grid gap-2">
      <p className="num text-3xl font-bold">
        <span className="sr-only">{label}: </span>
        {valueText}
      </p>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        className="block h-2 w-full"
      >
        <rect data-chart-track x="0" y="0" width="100" height="8" className="fill-sunk" />
        <rect
          data-chart-value
          x="0"
          y="0"
          width={barPct(value, 100)}
          height="8"
          className="fill-accent"
        />
      </svg>
    </div>
  );
}
