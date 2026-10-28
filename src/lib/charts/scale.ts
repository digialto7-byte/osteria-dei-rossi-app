// Geometry of the dashboard's SVG charts (ADR-021). Pure: the components only draw what these return.

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/**
 * The width of a value bar as a percentage of its track: 0 to 100 with one decimal. A missing, negative or non-finite
 * value, or a maximum that is not positive, is an empty bar (never NaN in an SVG attribute).
 */
export function barPct(value: number | null | undefined, max: number): number {
  if (value === null || value === undefined) return 0;
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0 || value <= 0) return 0;
  return round1(clamp((value / max) * 100, 0, 100));
}

/** Where the target tick sits on a 0-100 scale, or null when the row has no target. */
export function tickPct(target: number | null | undefined): number | null {
  if (target === null || target === undefined || !Number.isFinite(target)) return null;
  return round1(clamp(target, 0, 100));
}

/**
 * The scale of a bar chart: the largest finite, positive value of the rows, or 0 when there is none (every bar is then
 * empty). A loop, not `Math.max(...values)`, so a long list cannot overflow the call stack.
 */
export function maxValue(values: ReadonlyArray<number | null | undefined>): number {
  let largest = 0;
  for (const value of values) {
    if (value !== null && value !== undefined && Number.isFinite(value) && value > largest) {
      largest = value;
    }
  }
  return largest;
}
