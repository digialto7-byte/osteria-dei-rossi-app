import type { ErrorDetail } from "@/lib/api/errors";
import { isMessageKey, t, type MessageKey } from "@/lib/i18n";
import { parseDecimal, toField } from "@/lib/numbers/parse-decimal";
import type { CostSettings } from "@/server/costing/types";

// The cost forms' state is text (what the inputs hold). These helpers turn it into the API body,
// reading numbers typed with a decimal comma, and word the API's field errors. The server decides
// what is in range; nothing here validates a business rule.

export type FieldErrors = Record<string, string>;
type Parsed<B> = { ok: true; body: B } | { ok: false; errors: FieldErrors };

export interface FixedCostFormState {
  /** YYYY-MM, as a month input holds it. */
  month: string;
  rent: string;
  labour: string;
  utilities: string;
}

export const emptyFixedCostForm = (): FixedCostFormState => ({
  month: "",
  rent: "",
  labour: "",
  utilities: "",
});

export interface FixedCostBodyOut {
  month: string;
  rentEur: number;
  labourEur: number;
  utilitiesEur: number;
}

function number(text: string): number | null {
  const parsed = parseDecimal(text);
  return parsed.ok ? parsed.value : null;
}

export function toFixedCostBody(state: FixedCostFormState): Parsed<FixedCostBodyOut> {
  const errors: FieldErrors = {};
  if (state.month === "") errors.month = t("costCode.required");
  const amounts = {
    rentEur: number(state.rent),
    labourEur: number(state.labour),
    utilitiesEur: number(state.utilities),
  };
  for (const [field, value] of Object.entries(amounts)) {
    if (value === null) errors[field] = t("costs.form.invalidNumber");
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      month: state.month,
      rentEur: amounts.rentEur!,
      labourEur: amounts.labourEur!,
      utilitiesEur: amounts.utilitiesEur!,
    },
  };
}

export interface RulesFormState {
  avgCostN: string;
  priceVariancePct: string;
  saleVatPct: string;
}

export const rulesFormFrom = (settings: CostSettings): RulesFormState => ({
  avgCostN: toField(settings.avgCostN),
  priceVariancePct: toField(settings.priceVariancePct),
  saleVatPct: toField(settings.saleVatPct),
});

export function toSettingsPatch(state: RulesFormState): Parsed<CostSettings> {
  const values = {
    avgCostN: number(state.avgCostN),
    priceVariancePct: number(state.priceVariancePct),
    saleVatPct: number(state.saleVatPct),
  };
  const errors: FieldErrors = {};
  for (const [field, value] of Object.entries(values)) {
    if (value === null) errors[field] = t("costs.form.invalidNumber");
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: values as CostSettings };
}

/** The API's `details` ([{field, code}]) as one Italian text per field. */
export function fieldErrors(details: ErrorDetail[] | undefined): FieldErrors {
  const out: FieldErrors = {};
  for (const detail of details ?? []) {
    if (typeof detail.field !== "string" || detail.field === "") continue;
    const code = String(detail.code ?? "");
    const key = `costCode.${code}`;
    out[detail.field] = isMessageKey(key) ? t(key as MessageKey) : code;
  }
  return out;
}
