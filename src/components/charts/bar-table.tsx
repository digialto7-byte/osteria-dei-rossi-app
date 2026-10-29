import type { ReactNode } from "react";
import { barPct, tickPct } from "@/lib/charts/scale";

export interface BarRow {
  key: string;
  label: string;
  /** The value as words and figures: the table, not the bar, is what a screen reader gets. */
  valueText: string;
  value: number | null;
  /** A target on the same scale as the bar (0-100), drawn as a tick. */
  target?: number | null;
  /** The row misses its target: the bar is drawn in the danger colour (the row also says so in words). */
  below?: boolean;
  /** A badge or note beside the value. */
  extra?: ReactNode;
  /** `data-*` attributes of the row, for tests and for links (for example `data-recipe-key`). */
  data?: Record<`data-${string}`, string>;
}

/**
 * A bar chart that is a real table (ADR-021): the caption states the question, the row header is the name, the value is
 * text, and the bar is an aria-hidden SVG that adds nothing a screen reader needs. Below `sm` the bar wraps under the name
 * (a grid on the row), so nothing scrolls sideways. Colours are theme tokens (fill-*, stroke-*), so both themes work.
 */
export function BarTable({
  caption,
  rows,
  max,
}: {
  caption: string;
  rows: readonly BarRow[];
  max: number;
}) {
  if (rows.length === 0) return null;
  return (
    <table role="table" className="block w-full text-left sm:table">
      <caption className="sr-only">{caption}</caption>
      <tbody role="rowgroup" className="block sm:table-row-group">
        {rows.map((row) => {
          const tick = tickPct(row.target);
          return (
            <tr
              key={row.key}
              role="row"
              {...row.data}
              className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-rule py-2 last:border-b-0 sm:table-row"
            >
              <th
                scope="row"
                role="rowheader"
                className="min-w-0 break-words font-bold sm:table-cell sm:py-2 sm:pr-3"
              >
                {row.label}
              </th>
              <td
                role="cell"
                className="num flex flex-wrap items-center justify-end gap-2 text-right sm:table-cell sm:whitespace-nowrap sm:py-2 sm:pr-3"
              >
                {row.valueText}
                {row.extra}
              </td>
              <td role="cell" className="col-span-2 sm:table-cell sm:w-1/3 sm:py-2">
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
                    width={barPct(row.value, max)}
                    height="8"
                    className={row.below ? "fill-danger" : "fill-accent"}
                  />
                  {tick === null ? null : (
                    <line
                      data-chart-tick
                      x1={tick}
                      x2={tick}
                      y1="0"
                      y2="8"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                      className="stroke-ink"
                    />
                  )}
                </svg>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
