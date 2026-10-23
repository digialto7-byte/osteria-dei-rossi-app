import { z } from "zod";
import type { MessageKey } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import { formatCalendarDate, formatDateTime } from "@/lib/time/format";
import type { Locale } from "@/lib/i18n/locale";
import { formatQty } from "@/lib/units/format";
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
}

export function formattersFor(locale: Locale): AlertFormatters {
  return {
    eur: (amount) => formatEuro(amount, locale),
    qty: (qty, unit) => formatQty(qty, unit, locale),
    date: (isoDate) => formatCalendarDate(isoDate, locale),
    instant: (iso) => formatDateTime(new Date(iso), locale),
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
};
