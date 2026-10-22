// WCAG 2.x contrast maths (https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio), used by the design
// token tests so every text/background pair is checked, not eyeballed.

const HEX = /^#([0-9a-f]{6})$/i;

/** Parses "#RRGGBB" into 0–255 channels; anything else is a programming error. */
export function parseHex(hex: string): [number, number, number] {
  const digits = HEX.exec(hex)?.[1];
  if (!digits) throw new TypeError(`parseHex: expected #RRGGBB, got "${hex}"`);
  const value = Number.parseInt(digits, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of an sRGB colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 to 21, independent of argument order. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
