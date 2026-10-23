import { z } from "zod";
import type { MessageKey } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import type { Locale } from "@/lib/i18n/locale";
import { formatQty } from "@/lib/units/format";
import { INTL_LOCALE } from "@/lib/i18n/locale";
import { t, tn } from "@/lib/i18n";
import type { QuantityUnit } from "@/lib/units/convert";
import type { AlertKind } from "./kinds";

/** The formatters a template uses to turn payload values into text, bound to the reader's locale. */
export interface AlertFormatters {
  /** Money: a number under a `<name>_eur` key. */
  eur(amount: number): string;
  /** A quantity with its unit (`<name>_qty` and a sibling `unit`). */
  qty(qty: number, unit: QuantityUnit): string;
  /** A calendar date (`<name>_date`, YYYY-MM-DD). */
  date(isoDate: string): string;
  /** An instant (`<name>_at`, ISO with zone), shown in Europe/Rome. */
  instant(iso: string): string;
  /** A percentage given in percent units (`<name>_pct`): 77.7 -> "77,7 %". */
  pct(value: number): string;
  /** The same with an explicit sign: 11 -> "+11,0 %", -12 -> "−12,0 %". */
  signedPct(value: number): string;
  /** The reader's locale, for a template that composes sentences from several messages. */
  locale: Locale;
}

const MINUS = "\u2212";
const percentFormatters = new Map<Locale, Intl.NumberFormat>();

function formatPct(value: number, locale: Locale, signed: boolean): string {
  let formatter = percentFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(INTL_LOCALE[locale], {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
      useGrouping: false,
      roundingMode: "halfExpand",
    });
    percentFormatters.set(locale, formatter);
  }
  const magnitude = formatter.format(Math.abs(value));
  const shown = Number(magnitude.replace(",", ".")) === 0 ? 0 : value;
  const sign = !signed ? (shown < 0 ? MINUS : "") : shown < 0 ? MINUS : shown > 0 ? "+" : "";
  // Italian writes a space before the percent sign (as before the euro sign); English does not.
  return `${sign}${magnitude}${locale === "it" ? "\u00a0%" : "%"}`;
}

export function formattersFor(locale: Locale): AlertFormatters {
  return {
    eur: (amount) => formatEuro(amount, locale),
    qty: (qty, unit) => formatQty(qty, unit, locale),
    date: (isoDate) => formatCalendarDate(isoDate, locale),
    instant: (iso) => formatDateTime(new Date(iso), locale),
    pct: (value) => formatPct(value, locale, false),
    signedPct: (value) => formatPct(value, locale, true),
    locale,
  };
}

type Values = Record<string, string | number>;

export interface AlertTemplate {
  /** Strict schema of the stored payload; a payload that fails it renders as the fallback. */
  payload: z.ZodObject;
  /** Payload keys that hold money. Each ends in `_eur`; only cost-bearing kinds have any. */
  moneyFields: readonly string[];
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** The `{placeholder}` values of the two texts, from the validated payload. */
  params(payload: unknown, format: AlertFormatters): Values;
}

/** Types `params` by the schema, so a template cannot read a field its payload does not have. */
export function defineTemplate<S extends z.ZodObject>(template: {
  payload: S;
  moneyFields: readonly string[];
  titleKey: MessageKey;
  bodyKey: MessageKey;
  params?: (payload: z.infer<S>, format: AlertFormatters) => Values;
}): AlertTemplate {
  const { params, ...rest } = template;
  return {
    ...rest,
    params: (payload, format) => (params ? params(payload as z.infer<S>, format) : {}),
  };
}

const noPayload = z.strictObject({});

export const TEMPLATES: Record<AlertKind, AlertTemplate> = {
  test_alert: defineTemplate({
    payload: noPayload,
    moneyFields: [],
    titleKey: "alerts.kind.test_alert.title",
    bodyKey: "alerts.kind.test_alert.body",
  }),
  test_alert_kitchen: defineTemplate({
    payload: noPayload,
    moneyFields: [],
    titleKey: "alerts.kind.test_alert_kitchen.title",
    bodyKey: "alerts.kind.test_alert_kitchen.body",
  }),
  price_variance: defineTemplate({
    payload: z.strictObject({
      ingredient_id: z.uuid(),
      ingredient_name: z.string().max(80),
      unit: z.enum(["kg", "l", "pz"]),
      invoice_id: z.uuid(),
      invoice_number: z.string().max(80),
      supplier_id: z.uuid(),
      supplier_name: z.string().max(80),
      new_price_eur: z.number(),
      baseline_eur: z.number(),
      change_pct: z.number(),
      threshold_pct: z.number(),
      purchases_in_baseline: z.number().int().min(1),
      recipes_count: z.number().int().min(0),
      recipes_listed: z.number().int().min(0),
      // At most PRICE_ALERT_MAX_RECIPES (20) entries; the database keeps the payload under 8 KB.
      recipes: z
        .array(
          z.strictObject({
            recipe_key: z.uuid(),
            type: z.enum(["plate", "batch", "sub"]),
            name: z.string().max(80),
            unit_cost_eur: z.number().nullable(),
            cost_unit: z.string().max(20),
            margin_eur: z.number().nullable().optional(),
            gp_pct: z.number().nullable().optional(),
            target_gp_pct: z.number().nullable().optional(),
            status: z.enum(["ok", "below_target", "incomplete"]).optional(),
          }),
        )
        .max(20),
    }),
    moneyFields: ["new_price_eur", "baseline_eur"],
    titleKey: "alerts.kind.price_variance.title",
    bodyKey: "alerts.kind.price_variance.body",
    params: (p, f) => {
      const dash = "—";
      const plates = p.recipes
        .filter((r) => r.type === "plate")
        .map((r) =>
          t(
            "alerts.kind.price_variance.plate",
            {
              name: r.name,
              margin: r.margin_eur == null ? dash : f.eur(r.margin_eur),
              gp: r.gp_pct == null ? dash : f.pct(r.gp_pct),
              status: t(`alerts.kind.price_variance.status.${r.status ?? "ok"}`, {}, f.locale),
            },
            f.locale,
          ),
        );
      const notListed = p.recipes_count - p.recipes_listed;
      const parts =
        notListed > 0
          ? [...plates, tn("alerts.kind.price_variance.more", notListed, f.locale)]
          : plates;
      return {
        ingredient: p.ingredient_name,
        change: f.signedPct(p.change_pct),
        new_price: f.eur(p.new_price_eur),
        baseline: f.eur(p.baseline_eur),
        unit: p.unit,
        n: p.purchases_in_baseline,
        invoice: p.invoice_number,
        supplier: p.supplier_name,
        count: p.recipes_count,
        tail: parts.length > 0 ? ` ${parts.join("; ")}.` : "",
      };
    },
  }),
};
