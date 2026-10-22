export type DecimalResult = { ok: true; value: number | null } | { ok: false };

// Digits, then optionally a comma or dot and 1 to 4 decimals (the scale of the numeric(12,4)
// columns). No sign, no thousands separator, no exponent: what a person types in a quantity box.
const DECIMAL = /^\d+(?:[.,]\d{1,4})?$/;

/** Reads a number typed with a decimal comma or dot. An empty field is `null`; anything else odd is not ok. */
export function parseDecimal(text: string): DecimalResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!DECIMAL.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed.replace(",", ".")) };
}

/** A number as it goes into a text field: decimal comma, no grouping. */
export const toField = (value: number | null): string =>
  value === null ? "" : String(value).replace(".", ",");
