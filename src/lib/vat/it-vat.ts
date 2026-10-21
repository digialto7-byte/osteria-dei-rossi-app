// Italian VAT number (partita IVA): "IT" + 11 digits, the 11th a Luhn-style check digit.
// Odd positions (1st, 3rd, … 9th) count as they are; even positions are doubled, minus 9 when
// above 9. The check digit makes the total of all 11 a multiple of 10. The same algorithm is
// enforced in SQL by app.is_valid_it_vat and tested on the same vectors.
const IT_VAT = /^IT[0-9]{11}$/;
const BODY_DIGITS = 10;

export function normaliseItVat(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export function itVatCheckDigit(firstTen: string): number {
  if (!/^[0-9]{10}$/.test(firstTen)) throw new RangeError("itVatCheckDigit needs 10 digits");
  let sum = 0;
  for (let index = 0; index < BODY_DIGITS; index++) {
    const digit = Number(firstTen[index]);
    const isEvenPosition = index % 2 === 1;
    const doubled = digit * 2;
    sum += isEvenPosition ? (doubled > 9 ? doubled - 9 : doubled) : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** True for "IT" + 11 digits with a correct check digit; normalise user input first. */
export function isValidItVat(vat: string): boolean {
  if (!IT_VAT.test(vat)) return false;
  return itVatCheckDigit(vat.slice(2, 12)) === Number(vat[12]);
}
