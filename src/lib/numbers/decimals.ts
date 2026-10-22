/**
 * True when a number has at most 4 decimals (the scale of the numeric(12,4) columns). The float
 * error of value * 1e4 grows with the magnitude, so the tolerance is scaled to it (a fixed 1e-6
 * rejected valid cents above about 1,048,000). A fifth decimal leaves a remainder of at least 0.1,
 * far above any tolerance used here.
 */
export function decimals4(value: number): boolean {
  const scaled = Math.abs(value) * 1e4;
  return Math.abs(scaled - Math.round(scaled)) <= Math.max(1e-6, scaled * 4 * Number.EPSILON);
}
