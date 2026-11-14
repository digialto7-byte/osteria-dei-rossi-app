/**
 * Decimal maths on strings, with BigInt: a value is a whole number of 10^-8 (the finest step of a
 * FatturaPA amount). No float is ever involved, so "0.1" + "0.2" is exactly "0.3".
 */

const SCALE_DIGITS = 8;
const SCALE = 10n ** BigInt(SCALE_DIGITS);
const DECIMAL = /^(-?)([0-9]{1,18})(?:\.([0-9]{1,8}))?$/;

/** A decimal string (optional minus, up to 8 decimals) as a scaled integer; null when it is not one. */
export function parseDec(text: string): bigint | null {
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const whole = BigInt(match[2]!) * SCALE;
  const fraction = BigInt((match[3] ?? "").padEnd(SCALE_DIGITS, "0"));
  return match[1] === "-" ? -(whole + fraction) : whole + fraction;
}

/** Divides, rounding half away from zero. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  return negative ? -quotient : quotient;
}

/** a / b as a scaled value. */
export function divDec(a: bigint, b: bigint): bigint {
  return roundDiv(a * SCALE, b);
}

/** The value with `decimals` decimals (0 to 8), rounded half away from zero. */
export function formatDec(value: bigint, decimals: number): string {
  const step = 10n ** BigInt(SCALE_DIGITS - decimals);
  const negative = value < 0n;
  const rounded = roundDiv(negative ? -value : value, step);
  const unit = 10n ** BigInt(decimals);
  const whole = rounded / unit;
  const fraction = decimals === 0 ? "" : `.${(rounded % unit).toString().padStart(decimals, "0")}`;
  return `${negative && rounded !== 0n ? "-" : ""}${whole}${fraction}`;
}

/** A scaled value of whole units (for limits written as "10000000"). */
export function wholeDec(whole: string): bigint {
  return BigInt(whole) * SCALE;
}

export const ZERO = 0n;
