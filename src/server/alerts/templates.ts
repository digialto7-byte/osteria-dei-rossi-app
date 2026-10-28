import { z } from "zod";
import type { MessageKey } from "@/lib/i18n";
import { formatEuro } from "@/lib/money/format";
import {
  formatCalendarDate,
  formatDateTime,
  formatWeekday,
  formatWeekdayTime,
} from "@/lib/time/format";
import type { Locale } from "@/lib/i18n/locale";
import { formatMeasuredQty, formatNumber, formatQty } from "@/lib/units/format";
import { INTL_LOCALE } from "@/lib/i18n/locale";
import { t, tn } from "@/lib/i18n";
import type { QuantityUnit } from "@/lib/units/convert";
import type { AlertKind } from "./kinds";
import { nameOf, type AlertNames } from "./names";

/** The formatters a template uses to turn payload values into text, bound to the reader's locale. */
export interface AlertFormatters {
  /** Money: a number under a `<name>_eur` key. */
  eur(amount: number): string;
  /** A quantity with its unit (`<name>_qty` and a sibling `unit`). */
  qty(qty: number, unit: QuantityUnit): string;
  /** A measured quantity with at least one decimal ("5,0 kg"), for readings and requirements (M16). */
  measuredQty(qty: number, unit: QuantityUnit): string;
  /** The short weekday and clock time of an instant in Europe/Rome: "mar 11:00" / "Tue 11:00" (M16). */
  weekdayTime(iso: string): string;
  /** The short weekday of a calendar date: "gio" / "Thu" (M16). */
  weekday(isoDate: string): string;
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
    measuredQty: (qty, unit) => formatMeasuredQty(qty, unit, locale),
    weekdayTime: (iso) => formatWeekdayTime(new Date(iso), locale),
    weekday: (isoDate) => formatWeekday(isoDate, locale),
    date: (isoDate) => formatCalendarDate(isoDate, locale),
    instant: (iso) => formatDateTime(new Date(iso), locale),
    pct: (value) => formatPct(value, locale, false),
    signedPct: (value) => formatPct(value, locale, true),
    locale,
  };
}

type Values = Record<string, string | number>;

/** The master tables whose names an alert may show (resolved at render time, M12 plan §3.1.9). */
export type NameTable = "ingredient" | "location" | "recipe" | "supplier" | "raw_lot" | "batch";

/** Another payload shape of the same kind (M19: negative_stock for a batch shortage), tried when the main schema fails. */
export interface TemplateVariant {
  payload: z.ZodObject;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  nameRefs?: Readonly<Record<string, NameTable>>;
  /** The texts may differ in form by the payload (a singular and a plural); `bodyKey` is the plural base then. */
  params(payload: unknown, format: AlertFormatters, names: AlertNames): Values;
  /** Overrides `bodyKey` for this payload (the singular/plural choice), when set. */
  bodyKeyFor?(payload: unknown): MessageKey;
}

export interface AlertTemplate {
  /** Strict schema of the stored payload; a payload that fails it (and every variant) renders as the fallback. */
  payload: z.ZodObject;
  /** Other strict payload shapes of the same kind, tried in order after `payload` (M19). */
  variants?: readonly TemplateVariant[];
  /** Payload keys that hold money. Each ends in `_eur`; only cost-bearing kinds have any. */
  moneyFields: readonly string[];
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** Payload keys that hold the id of a named record: `{key: table}`. The name is looked up when shown. */
  nameRefs?: Readonly<Record<string, NameTable>>;
  /** The `{placeholder}` values of the two texts, from the validated payload. */
  params(payload: unknown, format: AlertFormatters, names: AlertNames): Values;
}

/** Types `params` by the schema, so a template cannot read a field its payload does not have. */
export function defineTemplate<S extends z.ZodObject>(template: {
  payload: S;
  moneyFields: readonly string[];
  titleKey: MessageKey;
  bodyKey: MessageKey;
  nameRefs?: Readonly<Record<string, NameTable>>;
  variants?: readonly TemplateVariant[];
  params?: (payload: z.infer<S>, format: AlertFormatters, names: AlertNames) => Values;
}): AlertTemplate {
  const { params, ...rest } = template;
  return {
    ...rest,
    params: (payload, format, names) =>
      params ? params(payload as z.infer<S>, format, names) : {},
  };
}

/** Types a variant's `params` and `bodyKeyFor` by its schema, like defineTemplate. */
export function defineVariant<S extends z.ZodObject>(variant: {
  payload: S;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  nameRefs?: Readonly<Record<string, NameTable>>;
  params: (payload: z.infer<S>, format: AlertFormatters, names: AlertNames) => Values;
  bodyKeyFor?: (payload: z.infer<S>) => MessageKey;
}): TemplateVariant {
  const { params, bodyKeyFor, ...rest } = variant;
  return {
    ...rest,
    params: (payload, format, names) => params(payload as z.infer<S>, format, names),
    ...(bodyKeyFor ? { bodyKeyFor: (payload: unknown) => bodyKeyFor(payload as z.infer<S>) } : {}),
  };
}

const noPayload = z.strictObject({});

const NEUTRAL_NAME: Record<NameTable, MessageKey> = {
  ingredient: "alerts.name.ingredient_missing",
  location: "alerts.name.location_missing",
  recipe: "alerts.name.recipe_missing",
  supplier: "alerts.name.supplier_missing",
  raw_lot: "alerts.name.lot_missing",
  batch: "alerts.name.lot_missing",
};

/** The looked-up name of a record, or the neutral word of its table (never the id). */
function named(names: AlertNames, table: NameTable, id: string | null, f: AlertFormatters): string {
  return nameOf(names, table, id) ?? t(NEUTRAL_NAME[table], {}, f.locale);
}

/** A message with a `.one` and an `.other` form chosen by `count`; `{count}` is filled with the formatted number. */
function plural(base: string, count: number, values: Values, f: AlertFormatters): string {
  return t(
    `${base}.${count === 1 ? "one" : "other"}` as MessageKey,
    { ...values, count: formatNumber(count, f.locale) },
    f.locale,
  );
}

/** A quantity that can be negative, with the real minus sign (U+2212) instead of Intl's hyphen-minus. */
function signedQty(qty: number, unit: QuantityUnit, f: AlertFormatters): string {
  return `${qty < 0 ? MINUS : ""}${f.qty(Math.abs(qty), unit)}`;
}

const unitSchema = z.enum(["kg", "l", "pz"]);
const stateSchema = z.enum(["due_soon", "expired"]);

// The payload of the three payable reminders (M9; built by app.payable_reminder_rule).
const reminderPayload = z.strictObject({
  payable_id: z.uuid(),
  invoice_id: z.uuid(),
  invoice_number: z.string().max(80),
  supplier_id: z.uuid(),
  supplier_name: z.string().max(80),
  amount_eur: z.number(),
  due_date: z.iso.date(),
});

function reminderTemplate(kind: "payable_due_7d" | "payable_due_today" | "payable_overdue_3d") {
  return defineTemplate({
    payload: reminderPayload,
    moneyFields: ["amount_eur"],
    titleKey: `alerts.kind.${kind}.title`,
    bodyKey: `alerts.kind.${kind}.body`,
    params: (p, f) => ({
      supplier: p.supplier_name,
      number: p.invoice_number,
      amount: f.eur(p.amount_eur),
      due: f.date(p.due_date),
    }),
  });
}

/** The checks of the nightly invariant check (app.ledger_checks_body and app.job_health_checks, M13; fire_depletion is M19's). */
export const DRIFT_CHECK_KEYS = [
  "lot_receipt_missing",
  "receipt_lot_mismatch",
  "movement_user",
  "lot_negative",
  "reversal_mirror",
  "transfer_unbalanced",
  "count_mismatch",
  "fire_depletion",
  "job_stale",
  "job_failed",
  "job_unscheduled",
  "extract_backlog",
  "alerts_refused",
] as const;

/** The scheduled jobs a job-health finding can name: cron job names and app.job_run job names. */
const DRIFT_JOB_KEYS = [
  "extract",
  "extract-invoices",
  "alert-rules",
  "ledger-invariants",
  "auth-purge",
] as const;

export const TEMPLATES: Record<AlertKind, AlertTemplate> = {
  // M11: raised by pin_login_finish when a venue device hits 20 failed PINs in 60 minutes. The payload
  // names the device, never a person (the owner types the device label; the form hints at that).
  device_locked: defineTemplate({
    payload: z.strictObject({
      device_id: z.uuid(),
      device_label: z.string().max(60),
      failures_count: z.number().int().min(1),
      window_minutes: z.number().int().min(1),
      locked_at: z.iso.datetime({ offset: true }),
    }),
    moneyFields: [],
    titleKey: "alerts.kind.device_locked.title",
    bodyKey: "alerts.kind.device_locked.body",
    params: (p) => ({
      device_label: p.device_label,
      failures_count: p.failures_count,
      window_minutes: p.window_minutes,
    }),
  }),
  // M13: check codes, counts and sample ids only (owner only; the texts name the problem, never a record).
  ledger_drift: defineTemplate({
    payload: z.strictObject({
      checks: z
        .array(
          z.strictObject({
            check_key: z.enum(DRIFT_CHECK_KEYS),
            rows_count: z.number().int().min(0),
            sample_ids: z.array(z.uuid()).max(5),
            job_key: z.enum(DRIFT_JOB_KEYS).optional(),
          }),
        )
        .max(50),
      checked_at: z.string().max(40),
    }),
    moneyFields: [],
    titleKey: "alerts.kind.ledger_drift.title",
    bodyKey: "alerts.kind.ledger_drift.body",
    params: (p, f) => ({
      problems: tn("alerts.kind.ledger_drift.problems", p.checks.length, f.locale),
      list: p.checks
        .map((c) =>
          t(`alerts.kind.ledger_drift.check.${c.check_key}`, { job: c.job_key ?? "" }, f.locale),
        )
        .join("; "),
    }),
  }),
  // M12: quantities and ids only (it reaches the chef); the names are looked up when the alert is shown.
  negative_stock: defineTemplate({
    payload: z.strictObject({
      ingredient_id: z.uuid(),
      location_id: z.uuid(),
      on_hand_qty: z.number(),
      unit: z.enum(["kg", "l", "pz"]),
      movement_id: z.uuid(),
    }),
    moneyFields: [],
    titleKey: "alerts.kind.negative_stock.title",
    bodyKey: "alerts.kind.negative_stock.body",
    nameRefs: { ingredient_id: "ingredient", location_id: "location" },
    params: (p, f, names) => ({
      ingredient: named(names, "ingredient", p.ingredient_id, f),
      location: named(names, "location", p.location_id, f),
      // Intl writes a hyphen-minus; the screens use the real minus sign (U+2212).
      qty: `${p.on_hand_qty < 0 ? MINUS : ""}${f.qty(Math.abs(p.on_hand_qty), p.unit)}`,
    }),
    // M19: a plate was sent with fewer portions than its batches held (ids and quantities only, like the main payload).
    variants: [
      defineVariant({
        payload: z.strictObject({
          recipe_key: z.uuid(),
          batch_id: z.uuid().nullable(),
          remaining_portions_qty: z.number(),
          short_portions_qty: z.number().positive(),
          order_line_id: z.uuid(),
          movement_id: z.uuid().nullable(),
        }),
        titleKey: "alerts.kind.negative_stock.batch.title",
        bodyKey: "alerts.kind.negative_stock.batch.body.other",
        nameRefs: { recipe_key: "recipe" },
        bodyKeyFor: (p) =>
          p.short_portions_qty === 1
            ? "alerts.kind.negative_stock.batch.body.one"
            : "alerts.kind.negative_stock.batch.body.other",
        params: (p, f, names) => ({
          recipe: named(names, "recipe", p.recipe_key, f),
          count: formatNumber(p.short_portions_qty, f.locale),
          detail:
            p.batch_id === null
              ? t("alerts.kind.negative_stock.batch.no_batch", {}, f.locale)
              : t(
                  "alerts.kind.negative_stock.batch.balance",
                  {
                    balance: `${p.remaining_portions_qty < 0 ? MINUS : ""}${formatNumber(Math.abs(p.remaining_portions_qty), f.locale)}`,
                  },
                  f.locale,
                ),
        }),
      }),
    ],
  }),
  // M16: the rule alerts. Ids, quantities, dates, UTC instants and codes only (they reach the chef); the names are looked
  // up when shown. Dedup: one per item per Rome day (plan §3.1.9).
  prep_due: defineTemplate({
    payload: z.strictObject({
      recipe_key: z.uuid(),
      recipe_id: z.uuid(),
      remaining_portions_qty: z.number().min(0),
      min_portions_count: z.number().int().min(1),
      target_portions_count: z.number().int().min(0).nullable(),
      batches_count: z.number().int().min(1),
      prep_hours: z.number().min(0).nullable(),
      ingredient_id: z.uuid().nullable(),
      needed_qty: z.number().nullable(),
      on_hand_qty: z.number().nullable(),
      unit: unitSchema.nullable(),
    }),
    moneyFields: [],
    titleKey: "alerts.kind.prep_due.title",
    bodyKey: "alerts.kind.prep_due.body",
    nameRefs: { recipe_key: "recipe", ingredient_id: "ingredient" },
    params: (p, f, names) => {
      const recipe = named(names, "recipe", p.recipe_key, f);
      const lead =
        p.ingredient_id !== null &&
        p.needed_qty !== null &&
        p.on_hand_qty !== null &&
        p.unit !== null
          ? t(
              "alerts.kind.prep_due.lead",
              {
                recipe,
                needed: f.measuredQty(p.needed_qty, p.unit),
                ingredient: named(names, "ingredient", p.ingredient_id, f),
                onHand: f.measuredQty(p.on_hand_qty, p.unit),
              },
              f.locale,
            )
          : t("alerts.kind.prep_due.lead_plain", { recipe }, f.locale);
      const extra = [
        p.batches_count > 1 && p.target_portions_count !== null
          ? t(
              "alerts.kind.prep_due.batches",
              { target: formatNumber(p.target_portions_count, f.locale), batches: p.batches_count },
              f.locale,
            )
          : null,
        p.prep_hours !== null
          ? t(
              "alerts.kind.prep_due.prep",
              { hours: formatNumber(p.prep_hours, f.locale) },
              f.locale,
            )
          : null,
      ]
        .filter((sentence) => sentence !== null)
        .map((sentence) => ` ${sentence}`)
        .join("");
      return {
        recipe,
        lead,
        left: plural(
          "alerts.kind.prep_due.left",
          p.remaining_portions_qty,
          { min: p.min_portions_count },
          f,
        ),
        extra,
      };
    },
  }),
  prep_raw_short: defineTemplate({
    payload: z.strictObject({
      recipe_key: z.uuid(),
      recipe_id: z.uuid(),
      remaining_portions_qty: z.number().min(0),
      min_portions_count: z.number().int().min(1),
      ingredient_id: z.uuid(),
      needed_qty: z.number(),
      on_hand_qty: z.number(),
      unit: unitSchema,
      short_count: z.number().int().min(1),
      supplier_id: z.uuid().nullable(),
      order_by_at: z.iso.datetime({ offset: true }).nullable(),
      delivery_date: z.iso.date().nullable(),
    }),
    moneyFields: [],
    titleKey: "alerts.kind.prep_raw_short.title",
    bodyKey: "alerts.kind.prep_raw_short.body",
    nameRefs: { recipe_key: "recipe", ingredient_id: "ingredient", supplier_id: "supplier" },
    params: (p, f, names) => {
      const extra = [
        p.short_count > 1
          ? plural("alerts.kind.prep_raw_short.more", p.short_count - 1, {}, f)
          : null,
        p.supplier_id !== null && p.order_by_at !== null && p.delivery_date !== null
          ? t(
              "alerts.kind.prep_raw_short.order",
              {
                supplier: named(names, "supplier", p.supplier_id, f),
                orderBy: f.weekdayTime(p.order_by_at),
                delivery: f.weekday(p.delivery_date),
              },
              f.locale,
            )
          : null,
      ]
        .filter((sentence) => sentence !== null)
        .map((sentence) => ` ${sentence}`)
        .join("");
      return {
        recipe: named(names, "recipe", p.recipe_key, f),
        left: plural(
          "alerts.kind.prep_raw_short.left",
          p.remaining_portions_qty,
          { min: p.min_portions_count },
          f,
        ),
        needed: f.measuredQty(p.needed_qty, p.unit),
        ingredient: named(names, "ingredient", p.ingredient_id, f),
        onHand: f.measuredQty(p.on_hand_qty, p.unit),
        extra,
      };
    },
  }),
  // Owner only by the registry default (Q60); the content is chef-safe all the same.
  purchase_due: defineTemplate({
    payload: z.strictObject({
      ingredient_id: z.uuid(),
      supplier_id: z.uuid(),
      supplier_item_id: z.uuid(),
      order_qty: z.number().min(0),
      packs_count: z.number().int().min(1),
      pack_qty: z.number().min(0),
      unit: unitSchema,
      order_by_at: z.iso.datetime({ offset: true }),
      delivery_date: z.iso.date(),
      horizon_days: z.number().int().min(0),
      on_hand_qty: z.number(),
      forecast_qty: z.number(),
      projected_qty: z.number(),
      min_qty: z.number(),
      target_qty: z.number(),
    }),
    moneyFields: [],
    titleKey: "alerts.kind.purchase_due.title",
    bodyKey: "alerts.kind.purchase_due.body",
    nameRefs: { ingredient_id: "ingredient", supplier_id: "supplier" },
    params: (p, f, names) => ({
      qty: f.qty(p.order_qty, p.unit),
      ingredient: named(names, "ingredient", p.ingredient_id, f),
      supplier: named(names, "supplier", p.supplier_id, f),
      orderBy: f.weekdayTime(p.order_by_at),
      delivery: f.weekday(p.delivery_date),
      packs: plural(
        "alerts.kind.purchase_due.packs",
        p.packs_count,
        { pack: f.qty(p.pack_qty, p.unit) },
        f,
      ),
      deliveryDate: f.date(p.delivery_date),
      onHand: signedQty(p.on_hand_qty, p.unit, f),
      forecast: f.qty(p.forecast_qty, p.unit),
      days: plural("alerts.kind.purchase_due.days", p.horizon_days, {}, f),
      projected: signedQty(p.projected_qty, p.unit, f),
      min: f.qty(p.min_qty, p.unit),
      target: f.qty(p.target_qty, p.unit),
    }),
  }),
  raw_lot_expiring: defineTemplate({
    payload: z.strictObject({
      raw_lot_id: z.uuid(),
      ingredient_id: z.uuid(),
      remaining_qty: z.number().min(0),
      unit: unitSchema,
      expiry_date: z.iso.date(),
      state_key: stateSchema,
    }),
    moneyFields: [],
    titleKey: "alerts.kind.raw_lot_expiring.title",
    bodyKey: "alerts.kind.raw_lot_expiring.body",
    nameRefs: { ingredient_id: "ingredient", raw_lot_id: "raw_lot" },
    params: (p, f, names) => ({
      head: t(`alerts.kind.raw_lot_expiring.head.${p.state_key}`, {}, f.locale),
      ingredient: named(names, "ingredient", p.ingredient_id, f),
      lot: named(names, "raw_lot", p.raw_lot_id, f),
      qty: f.qty(p.remaining_qty, p.unit),
      expiryDate: f.date(p.expiry_date),
    }),
  }),
  batch_expiring: defineTemplate({
    payload: z.strictObject({
      batch_id: z.uuid(),
      recipe_key: z.uuid(),
      remaining_portions_qty: z.number().min(0),
      use_by_at: z.iso.datetime({ offset: true }),
      state_key: stateSchema,
    }),
    moneyFields: [],
    titleKey: "alerts.kind.batch_expiring.title",
    bodyKey: "alerts.kind.batch_expiring.body",
    nameRefs: { recipe_key: "recipe", batch_id: "batch" },
    params: (p, f, names) => {
      const recipe = named(names, "recipe", p.recipe_key, f);
      return {
        head: t(
          `alerts.kind.batch_expiring.head.${p.state_key}`,
          { recipe, useBy: f.instant(p.use_by_at) },
          f.locale,
        ),
        lot: named(names, "batch", p.batch_id, f),
        left: plural("alerts.kind.batch_expiring.left", p.remaining_portions_qty, {}, f),
      };
    },
  }),
  payable_due_7d: reminderTemplate("payable_due_7d"),
  payable_due_today: reminderTemplate("payable_due_today"),
  payable_overdue_3d: reminderTemplate("payable_overdue_3d"),
  payables_weekly_digest: defineTemplate({
    payload: z.strictObject({
      week_start_date: z.iso.date(),
      as_of_date: z.iso.date(),
      payables_count: z.number().int().min(1),
      // Money fields: amount_eur, overdue_amount_eur and suppliers[].amount_eur (the entries are nested,
      // so only the top level is listed in moneyFields, like price_variance's recipes).
      amount_eur: z.number(),
      overdue_count: z.number().int().min(0),
      overdue_amount_eur: z.number(),
      suppliers_count: z.number().int().min(1),
      suppliers_listed: z.number().int().min(1),
      // At most DIGEST_MAX_SUPPLIERS (15) entries; the database keeps the payload under 8 KB.
      suppliers: z
        .array(
          z.strictObject({
            supplier_id: z.uuid(),
            supplier_name: z.string().max(80),
            payables_count: z.number().int().min(1),
            amount_eur: z.number(),
            overdue_count: z.number().int().min(0),
            next_due_date: z.iso.date(),
          }),
        )
        .max(15),
    }),
    moneyFields: ["amount_eur", "overdue_amount_eur"],
    titleKey: "alerts.kind.payables_weekly_digest.title",
    bodyKey: "alerts.kind.payables_weekly_digest.body",
    params: (p, f) => {
      const listed = p.suppliers.map((s) =>
        t(
          "alerts.kind.payables_weekly_digest.supplier",
          { name: s.supplier_name, amount: f.eur(s.amount_eur), count: s.payables_count },
          f.locale,
        ),
      );
      const notListed = p.suppliers_count - p.suppliers_listed;
      const parts =
        notListed > 0
          ? [...listed, tn("alerts.kind.payables_weekly_digest.more", notListed, f.locale)]
          : listed;
      return {
        asOf: f.date(p.as_of_date),
        count: tn("alerts.kind.payables_weekly_digest.invoices", p.payables_count, f.locale),
        amount: f.eur(p.amount_eur),
        overdue: tn("alerts.kind.payables_weekly_digest.overdue", p.overdue_count, f.locale),
        list: parts.length > 0 ? ` ${parts.join("; ")}.` : "",
      };
    },
  }),
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
