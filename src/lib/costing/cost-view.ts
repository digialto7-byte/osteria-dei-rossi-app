import type { BadgeTone } from "@/components/ui";
import { isMessageKey, t, tn, type MessageKey } from "@/lib/i18n";
import { DEFAULT_LOCALE, INTL_LOCALE, type Locale } from "@/lib/i18n/locale";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate } from "@/lib/time/format";
import { formatNumber } from "@/lib/units/format";
import type {
  CostBasis,
  CostLine,
  FixedCostStatus,
  IngredientCost,
  PlateCost,
  PlateStatus,
} from "@/server/costing/types";

// Presentation helpers for the cost screens. Pure: they only word what the API already decided
// (status, margins, missing prices). Nothing here computes a cost, a margin or a status.

const DASH = "—";
const MINUS = "−";
const NBSP = " ";

const STATUS_TONE: Record<PlateStatus, BadgeTone> = {
  ok: "success",
  below_target: "warning",
  fixed_cost_unallocated: "info",
  incomplete: "danger",
};

/** The badge tone and its word; the word always says it, colour is only a reinforcement. */
export function statusView(
  status: PlateStatus,
  locale: Locale = DEFAULT_LOCALE,
): { tone: BadgeTone; label: string } {
  return { tone: STATUS_TONE[status], label: t(`costs.status.${status}`, {}, locale) };
}

const pctFormatters = new Map<string, Intl.NumberFormat>();

function pctFormatter(locale: Locale, minDecimals: number, signed: boolean): Intl.NumberFormat {
  const id = `${locale}:${minDecimals}:${signed}`;
  let formatter = pctFormatters.get(id);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: 1,
      useGrouping: false,
      roundingMode: "halfExpand",
    });
    pctFormatters.set(id, formatter);
  }
  return formatter;
}

const sign = (text: string, locale: Locale) => `${text}${locale === "it" ? NBSP : ""}%`;

/** A percentage given in percent units (18.85 is "18,9 %"); null is a dash. */
export function formatPct(
  value: number | null,
  minDecimals = 1,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (value === null) return DASH;
  return sign(pctFormatter(locale, minDecimals, false).format(value), locale);
}

/** The same with an explicit sign and a real minus: +6,0 % and −6,0 %. */
export function signedPct(value: number, locale: Locale = DEFAULT_LOCALE): string {
  const magnitude = pctFormatter(locale, 1, true).format(Math.abs(value));
  const shown = Number(magnitude.replace(",", ".")) === 0 ? 0 : value;
  const prefix = shown > 0 ? "+" : shown < 0 ? MINUS : "";
  return sign(`${prefix}${magnitude}`, locale);
}

const eur = (value: number | null, locale: Locale) =>
  value === null ? DASH : formatEuro(value, locale);

/** "Ottobre 2026" for a first-of-month date. */
export function monthLabel(isoMonth: string, locale: Locale = DEFAULT_LOCALE): string {
  const text = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoMonth.slice(0, 7)}-01T00:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The Italian words for a reason code the cost engine returned; an unknown code is still said. */
export function reasonText(code: string, locale: Locale = DEFAULT_LOCALE): string {
  const key = `costs.reason.${code}`;
  return t(isMessageKey(key) ? (key as MessageKey) : "costs.reason.unknown", {}, locale);
}

export interface PlateFigures {
  /** "Costo cibo 2,06 € · Food cost 18,9 % · GP 81,2 % (obiettivo 70 %)"; null while the cost is unknown. */
  costLine: string | null;
  /** "Prezzo IVA esclusa 10,91 € · Margine lordo 8,85 € · Costo pieno —"; null without a sale price. */
  priceLine: string | null;
}

export function plateFigures(plate: PlateCost, locale: Locale = DEFAULT_LOCALE): PlateFigures {
  let costLine: string | null = null;
  if (plate.foodCostEur !== null) {
    const parts = [
      t("costs.plate.foodCost", { value: eur(plate.foodCostEur, locale) }, locale),
      t("costs.plate.foodPct", { value: formatPct(plate.foodCostPct, 1, locale) }, locale),
      t("costs.plate.gp", { value: formatPct(plate.gpPct, 1, locale) }, locale),
    ];
    costLine = parts.join(" · ");
    if (plate.targetGpPct !== null) {
      const target = t(
        "costs.plate.target",
        { value: formatPct(plate.targetGpPct, 0, locale) },
        locale,
      );
      costLine += ` (${target})`;
    }
  }

  let priceLine: string | null = null;
  if (plate.salePriceExVatEur !== null) {
    const parts = [t("costs.plate.exVat", { value: eur(plate.salePriceExVatEur, locale) }, locale)];
    if (plate.grossMarginEur !== null) {
      parts.push(
        t("costs.plate.grossMargin", { value: eur(plate.grossMarginEur, locale) }, locale),
      );
    }
    // null: the reader may not see fixed costs (admin); false: not allocated yet; true: allocated.
    if (plate.fixedCostAllocated !== null) {
      parts.push(t("costs.plate.fullCost", { value: eur(plate.fullCostEur, locale) }, locale));
      if (plate.fixedCostAllocated && plate.netMarginEur !== null) {
        parts.push(t("costs.plate.netMargin", { value: eur(plate.netMarginEur, locale) }, locale));
      }
    }
    priceLine = parts.join(" · ");
  }
  return { costLine, priceLine };
}

/** Why a plate is incomplete, in words: the unpriced ingredients by name, then each other reason once. */
export function incompleteNotes<T extends Pick<PlateCost, "missingIngredients" | "reasons">>(
  plate: T,
  locale: Locale = DEFAULT_LOCALE,
): string[] {
  const notes: string[] = [];
  if (plate.missingIngredients.length > 0) {
    const names = plate.missingIngredients.map((item) => item.name).join(", ");
    notes.push(t("costs.plate.missingIngredients", { names }, locale));
  }
  const namedMissing = plate.missingIngredients.length > 0;
  for (const code of new Set(plate.reasons)) {
    if (code === "missing_price" && namedMissing) continue;
    notes.push(reasonText(code, locale));
  }
  return notes;
}

const PER_UNIT: Record<string, string> = { g: "kg", ml: "l" };

/** "5 kg × 10,00 €/kg ÷ resa 1 = 50,00 €"; a portions line has no unit price or yield. */
export function costLineText(line: CostLine, locale: Locale = DEFAULT_LOCALE): string {
  const qty = `${formatNumber(line.qty, locale)}${NBSP}${line.unit}`;
  if (line.unitCostEur === null || line.lineCostEur === null) {
    return t("costs.line.unknown", { qty }, locale);
  }
  const cost = formatEuro(line.unitCostEur, locale);
  const total = formatEuro(line.lineCostEur, locale);
  if (line.unit === "porz") return t("costs.line.portions", { qty, cost, total }, locale);
  return t(
    "costs.line.priced",
    {
      qty,
      cost,
      perUnit: PER_UNIT[line.unit] ?? line.unit,
      yield: formatNumber(line.yieldFactor, locale),
      total,
    },
    locale,
  );
}

export type FixedCostView =
  | { kind: "allocated"; month: string; sold: string; perPlate: string }
  | { kind: "no_sales"; month: string; sold: string }
  | { kind: "no_fixed_costs" };

/** The fixed-cost card of the owner: allocated figures, or the reason nothing is allocated. */
export function fixedCostView(
  status: FixedCostStatus,
  locale: Locale = DEFAULT_LOCALE,
): FixedCostView {
  if (status.reason === "no_fixed_costs" || status.monthlyTotalEur === null) {
    return { kind: "no_fixed_costs" };
  }
  const month = formatEuro(status.monthlyTotalEur, locale);
  const sold = formatNumber(status.platesSold ?? 0, locale);
  if (status.perPlateEur === null || status.reason === "no_sales") {
    return { kind: "no_sales", month, sold };
  }
  return { kind: "allocated", month, sold, perPlate: formatEuro(status.perPlateEur, locale) };
}

/** "Media ultimi 3 acquisti" or "Ultimo prezzo". */
export function basisLabel(basis: CostBasis, n: number, locale: Locale = DEFAULT_LOCALE): string {
  return t(`costs.ing.basis.${basis}`, { n }, locale);
}

/** The other basis and the label of the button that switches to it. */
export function nextBasis(
  basis: CostBasis,
  locale: Locale = DEFAULT_LOCALE,
): { basis: CostBasis; label: string } {
  return basis === "moving_average"
    ? { basis: "last_price", label: t("costs.ing.useLast", {}, locale) }
    : { basis: "moving_average", label: t("costs.ing.useAverage", {}, locale) };
}

/**
 * "In uso 10,00 €/kg · media 10,00 € · ultimo 11,00 € · massimo 11,00 € · 3 acquisti, ultimo il
 * 20/10/2026"; null when nothing was ever bought (the screen says so; no 0,00 € is ever shown).
 */
export function ingredientFigures(
  ingredient: IngredientCost,
  locale: Locale = DEFAULT_LOCALE,
): string | null {
  if (ingredient.purchasesUsed === 0 || ingredient.unitCostEur === null) return null;
  const parts = [
    t(
      "costs.ing.inUse",
      { value: `${formatEuro(ingredient.unitCostEur, locale)}/${ingredient.baseUnit}` },
      locale,
    ),
  ];
  const optional: [MessageKey, number | null][] = [
    ["costs.ing.avg", ingredient.avgEur],
    ["costs.ing.last", ingredient.lastEur],
    ["costs.ing.max", ingredient.maxEur],
  ];
  for (const [key, value] of optional) {
    if (value !== null) parts.push(t(key, { value: formatEuro(value, locale) }, locale));
  }
  let purchases = tn("costs.ing.purchases", ingredient.purchasesUsed, locale);
  if (ingredient.lastPurchaseOn) {
    const date = formatCalendarDate(ingredient.lastPurchaseOn, locale);
    purchases += `, ${t("costs.ing.lastOn", { date }, locale)}`;
  }
  parts.push(purchases);
  return parts.join(" · ");
}

/** "App 10,60 € · foglio 10,00 € · +6,0 %" for a plate of the cost check. */
export function checkRowText(
  row: { appEur: number; sheetEur: number; diffPct: number },
  locale: Locale = DEFAULT_LOCALE,
): string {
  return t(
    "costs.check.listedRow",
    {
      app: formatEuro(row.appEur, locale),
      sheet: formatEuro(row.sheetEur, locale),
      diff: signedPct(row.diffPct, locale),
    },
    locale,
  );
}
