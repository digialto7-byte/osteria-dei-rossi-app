// Quantities and amounts are compared as whole ten-thousandths, never as floats (the same rule
// the API and the database use for the exact sum check).
const units = (value: number | null) => Math.round((value ?? 0) * 1e4);

/** What is left of a line after the parts entered so far; an empty field counts as zero. */
export function splitRemainder(
  parent: { qty: number; lineAmount: number },
  parts: readonly { qty: number | null; lineAmount: number | null }[],
): { qty: number; lineAmount: number } {
  const sum = (pick: (part: { qty: number | null; lineAmount: number | null }) => number | null) =>
    parts.reduce((total, part) => total + units(pick(part)), 0);
  return {
    qty: (units(parent.qty) - sum((part) => part.qty)) / 1e4 || 0,
    lineAmount: (units(parent.lineAmount) - sum((part) => part.lineAmount)) / 1e4 || 0,
  };
}
