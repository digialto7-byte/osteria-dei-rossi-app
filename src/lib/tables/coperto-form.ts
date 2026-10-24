import { t } from "@/lib/i18n";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/locale";
import { parsePrice } from "@/lib/menu/menu-form";
import { VAT_RATES } from "@/server/menu/constants";
import type { CopertoBody } from "@/server/tables/schemas";
import { MAX_COPERTO_EUR } from "@/server/tables/constants";

// The coperto card: what is typed to and from the PATCH /api/settings/coperto body. Pure. An empty amount clears the
// coperto; a number needs its own VAT rate. The database stays the authority on the bounds.

export interface CopertoFormState {
  amount: string;
  vatRate: string;
}

/** The card's fields: the coperto if set, else an empty amount and the server's default rate. */
export function copertoFormFromRead(
  coperto: { amount: number; vatRate: number } | null,
  defaultVatRate: number | null,
): CopertoFormState {
  if (coperto) {
    return {
      amount: coperto.amount.toFixed(2).replace(".", ","),
      vatRate: String(coperto.vatRate),
    };
  }
  return { amount: "", vatRate: defaultVatRate === null ? "" : String(defaultVatRate) };
}

/** The PATCH body, or the Italian message. Empty amount: null and null (no coperto). */
export function copertoBodyFromForm(
  form: CopertoFormState,
  locale: Locale = DEFAULT_LOCALE,
): { ok: true; body: CopertoBody } | { ok: false; error: string } {
  const invalid = { ok: false, error: t("tableError.coperto_invalid", {}, locale) } as const;
  if (form.amount.trim() === "") {
    return { ok: true, body: { copertoAmount: null, copertoVatRate: null } };
  }
  const amount = parsePrice(form.amount);
  const rate = Number(form.vatRate);
  const rateOk = form.vatRate.trim() !== "" && (VAT_RATES as readonly number[]).includes(rate);
  if (!amount.ok || amount.value === null || amount.value <= 0 || amount.value > MAX_COPERTO_EUR) {
    return invalid;
  }
  if (!rateOk) return invalid;
  return { ok: true, body: { copertoAmount: amount.value, copertoVatRate: rate } };
}
