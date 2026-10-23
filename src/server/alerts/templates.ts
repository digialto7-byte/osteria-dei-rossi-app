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
import type { AlertNames } from "./names";

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

/** The master tables whose names an alert may show (resolved at render time, M12 plan §3.1.9). */
export type NameTable = "ingredient" | "location";

export interface AlertTemplate {
  /** Strict schema of the stored payload; a payload that fails it renders as the fallback. */
  payload: z.ZodObject;
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
  params?: (payload: z.infer<S>, format: AlertFormatters, names: AlertNames) => Values;
}): AlertTemplate {
  const { params, ...rest } = template;
  return {
    ...rest,
    params: (payload, format, names) =>
      params ? params(payload as z.infer<S>, format, names) : {},
  };
}

const noPayload = z.strictObject({});

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

/** The checks of the nightly invariant check (app.ledger_checks_body and app.job_health_checks, M13). */
export const DRIFT_CHECK_KEYS = [
  "lot_receipt_missing",
  "receipt_lot_mismatch",
  "movement_user",
  "lot_negative",
  "reversal_mirror",
  "transfer_unbalanced",
  "count_mismatch",
  "job_stale",
  "job_failed",
  "job_unscheduled",
  "extract_backlog",
  "alerts_refused",
] as const;

/** The scheduled jobs a job-health finding can name: cron job names and app.job_run job names. */
const DRIFT_JOB_KEYS = ["extract", "extract-invoices", "alert-rules", "ledger-invariants"] as const;

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
      ingredient:
        names.ingredient.get(p.ingredient_id) ?? t("alerts.name.ingredient_missing", {}, f.locale),
      location:
        names.location.get(p.location_id) ?? t("alerts.name.location_missing", {}, f.locale),
      // Intl writes a hyphen-minus; the screens use the real minus sign (U+2212).
      qty: `${p.on_hand_qty < 0 ? MINUS : ""}${f.qty(Math.abs(p.on_hand_qty), p.unit)}`,
    }),
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
