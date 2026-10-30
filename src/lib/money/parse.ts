// Reads an amount typed by the owner ("1.234,50", "1234,5", "1234.50") into the decimal STRING the API takes ("1234.50"), or null.
// Strings only: no Number, no float, no arithmetic, so the value the person typed is the value the database stores (M21 plan §3.6).

/** At most 7 integer digits, so the largest amount is 9 999 999,99 (the database's bound). */
const MAX_INTEGER_DIGITS = 7;

const GROUPED = /^[0-9]{1,3}(\.[0-9]{3})+$/;
const PLAIN = /^[0-9]+$/;
const DECIMALS = /^[0-9]{1,2}$/;

export function parseEuroInput(text: string): string | null {
  const input = text.trim();
  if (!/^[0-9.,]+$/.test(input)) return null;

  let integer: string;
  let decimals = "";
  const commas = input.split(",").length - 1;
  if (commas > 1) return null;
  if (commas === 1) {
    // The comma is the decimal separator, dots only group thousands ("1.234,50").
    const [left, right] = input.split(",") as [string, string];
    if (!DECIMALS.test(right)) return null;
    if (!PLAIN.test(left) && !GROUPED.test(left)) return null;
    integer = left.replaceAll(".", "");
    decimals = right;
  } else if (input.includes(".")) {
    // No comma: a single dot with one or two digits after it is the decimal point ("1234.50"). "1.234" is ambiguous and refused.
    const parts = input.split(".");
    if (parts.length !== 2 || !PLAIN.test(parts[0]!) || !DECIMALS.test(parts[1]!)) return null;
    integer = parts[0]!;
    decimals = parts[1]!;
  } else {
    integer = input;
  }

  integer = integer.replace(/^0+(?=[0-9])/, "");
  if (integer.length > MAX_INTEGER_DIGITS) return null;
  return `${integer}.${decimals.padEnd(2, "0")}`;
}
