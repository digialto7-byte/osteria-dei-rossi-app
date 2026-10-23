import { describe, expect, it } from "vitest";
import { isMessageKey, messages } from "@/lib/i18n";
import { ALERT_KIND_NAMES, ALERT_KINDS, isAlertKind } from "@/server/alerts/kinds";
import { TEMPLATES } from "@/server/alerts/templates";
import { ALERT_LIST_PAGE_SIZE } from "@/server/alerts/constants";

// The same rule as app.payload_money_keys in the database (20261022150600_alert_rules_warning.sql); keep the
// two in agreement. iva and vat match as words only (attiva, relativa and elevation are not money).
const MONEY_LIKE_WORDS = /(_eur$|cost|price|prezz|margin|amount|importo|total|valore|imponibile)/i;
const TAX_WORD = /(^|[^A-Za-z])([Ii][Vv][Aa]|[Vv][Aa][Tt])([^a-z]|$)/;
const TAX_CAMEL = /[a-z](Iva|IVA|Vat|VAT)([^a-z]|$)/;
const isMoneyLikeKey = (key: string) =>
  MONEY_LIKE_WORDS.test(key) || TAX_WORD.test(key) || TAX_CAMEL.test(key);

describe("alert kinds (src/server/alerts/kinds.ts)", () => {
  it("lists the M6 test kinds, price_variance (M8), the four payable kinds (M9) and device_locked (M11)", () => {
    expect([...ALERT_KIND_NAMES].sort()).toEqual([
      "device_locked",
      "payable_due_7d",
      "payable_due_today",
      "payable_overdue_3d",
      "payables_weekly_digest",
      "price_variance",
      "test_alert",
      "test_alert_kitchen",
    ]);
    expect(ALERT_KINDS.test_alert.costBearing).toBe(false);
    expect(ALERT_KINDS.test_alert_kitchen.costBearing).toBe(false);
  });

  it("price_variance and every payable kind are cost-bearing (they show euro amounts)", () => {
    for (const kind of [
      "price_variance",
      "payable_due_7d",
      "payable_due_today",
      "payable_overdue_3d",
      "payables_weekly_digest",
    ] as const) {
      expect(ALERT_KINDS[kind].costBearing, kind).toBe(true);
    }
  });

  it("device_locked is not cost-bearing", () => {
    expect(ALERT_KINDS.device_locked.costBearing).toBe(false);
  });

  it("isAlertKind accepts registered kinds only", () => {
    expect(isAlertKind("test_alert")).toBe(true);
    expect(isAlertKind("price_variance")).toBe(true);
    expect(isAlertKind("no_such_kind")).toBe(false);
    expect(isAlertKind("toString")).toBe(false);
  });

  it("pages of the list hold 50 items", () => {
    expect(ALERT_LIST_PAGE_SIZE).toBe(50);
  });
});

describe("money-like keys (TypeScript mirror of app.payload_money_keys)", () => {
  // The same vectors as supabase/tests/database/043_alert_table.test.sql.
  it.each([
    "price_eur",
    "unit_cost",
    "Margin",
    "importo",
    "total",
    "totale",
    "valore",
    "imponibile",
    "iva",
    "vat",
    "IVA",
    "Totale_riga",
    "VAT_rate",
    "vatRate",
    "rateIva",
    "sub_total",
  ])("%s is a money key", (key) => {
    expect(isMoneyLikeKey(key)).toBe(true);
  });

  it.each(["needed_qty", "unit", "attiva", "relativa", "elevation", "ivan", "vatican", "due_date"])(
    "%s is not",
    (key) => {
      expect(isMoneyLikeKey(key)).toBe(false);
    },
  );
});

describe("alert templates (src/server/alerts/templates.ts)", () => {
  it("has a template for every kind and no template for an unregistered kind", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...ALERT_KIND_NAMES].sort());
  });

  it("every kind has its title and body in both languages", () => {
    for (const kind of ALERT_KIND_NAMES) {
      const template = TEMPLATES[kind];
      for (const key of [template.titleKey, template.bodyKey]) {
        expect(isMessageKey(key), `${kind} ${key}`).toBe(true);
        for (const locale of ["it", "en"] as const) {
          expect(messages[locale][key].trim(), `${kind} ${key} ${locale}`).not.toBe("");
        }
      }
      expect(template.titleKey).toBe(`alerts.kind.${kind}.title`);
      expect(template.bodyKey).toBe(`alerts.kind.${kind}.body`);
    }
  });

  it("every money field ends in _eur, and every money-like payload key is declared as money", () => {
    for (const kind of ALERT_KIND_NAMES) {
      const template = TEMPLATES[kind];
      for (const field of template.moneyFields) expect(field, kind).toMatch(/_eur$/);
      const moneyLike = Object.keys(template.payload.shape).filter(isMoneyLikeKey);
      expect([...moneyLike].sort(), kind).toEqual([...template.moneyFields].sort());
    }
  });

  it("no kind that is not cost-bearing declares a money field", () => {
    for (const kind of ALERT_KIND_NAMES) {
      if (!ALERT_KINDS[kind].costBearing) expect(TEMPLATES[kind].moneyFields, kind).toEqual([]);
    }
  });

  it("the test kinds take an empty payload and refuse extra keys", () => {
    for (const kind of ["test_alert", "test_alert_kitchen"] as const) {
      expect(TEMPLATES[kind].payload.safeParse({}).success).toBe(true);
      expect(TEMPLATES[kind].payload.safeParse({ x: 1 }).success).toBe(false);
    }
  });
});

describe("price_variance template (M8)", () => {
  const recipe = {
    recipe_key: "ec000000-0000-4000-8000-0000000000e2",
    type: "plate",
    name: "Spezzatino con polenta (demo)",
    unit_cost_eur: 2.1,
    cost_unit: "piatto",
    margin_eur: 8.48,
    gp_pct: 77.7,
    target_gp_pct: 70,
    status: "ok",
  };
  const payload = {
    ingredient_id: "1a000000-0000-4000-8000-00000000001a",
    ingredient_name: "Manzo muscolo (demo)",
    unit: "kg",
    invoice_id: "00000000-0000-4000-8000-000000000021",
    invoice_number: "FT 21",
    supplier_id: "5a000000-0000-4000-8000-00000000005a",
    supplier_name: "Fornitore Demo Srl",
    new_price_eur: 11.1,
    baseline_eur: 10,
    change_pct: 11,
    threshold_pct: 10,
    purchases_in_baseline: 3,
    recipes_count: 1,
    recipes_listed: 1,
    recipes: [recipe],
  };
  const schema = TEMPLATES.price_variance.payload;

  it("declares exactly new_price_eur and baseline_eur as money, both ending in _eur", () => {
    expect([...TEMPLATES.price_variance.moneyFields].sort()).toEqual([
      "baseline_eur",
      "new_price_eur",
    ]);
  });

  it("accepts the payload built by the database, a decrease, and a batch or sub entry", () => {
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, change_pct: -12 }).success).toBe(true);
    const batch = {
      recipe_key: recipe.recipe_key,
      type: "batch",
      name: "Spezzatino (demo)",
      unit_cost_eur: 1.85,
      cost_unit: "porz",
    };
    expect(schema.safeParse({ ...payload, recipes: [batch] }).success).toBe(true);
    const incomplete = {
      ...recipe,
      unit_cost_eur: null,
      margin_eur: null,
      gp_pct: null,
      status: "incomplete",
    };
    expect(schema.safeParse({ ...payload, recipes: [incomplete] }).success).toBe(true);
  });

  it("refuses extra keys, at the top and in an entry, and an unknown status", () => {
    expect(schema.safeParse({ ...payload, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...payload, recipes: [{ ...recipe, extra: 1 }] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...payload, recipes: [{ ...recipe, status: "fixed_cost_unallocated" }] })
        .success,
    ).toBe(false);
  });

  it("bounds the list: at most 20 entries and names of at most 80 characters", () => {
    expect(schema.safeParse({ ...payload, recipes: Array(21).fill(recipe) }).success).toBe(false);
    expect(schema.safeParse({ ...payload, recipes: Array(20).fill(recipe) }).success).toBe(true);
    expect(
      schema.safeParse({ ...payload, recipes: [{ ...recipe, name: "x".repeat(81) }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...payload, ingredient_name: "x".repeat(81) }).success).toBe(false);
  });
});

describe("payable templates (M9)", () => {
  const reminder = {
    payable_id: "90000000-0000-4000-8000-000000000001",
    invoice_id: "e0000000-0000-4000-8000-000000000001",
    invoice_number: "FT 123/A",
    supplier_id: "5a000000-0000-4000-8000-00000000005a",
    supplier_name: "Fornitore Demo Srl",
    amount_eur: 1234.5,
    due_date: "2026-12-10",
  };
  const supplier = {
    supplier_id: "5a000000-0000-4000-8000-00000000005a",
    supplier_name: "Fornitore Demo Srl",
    payables_count: 2,
    amount_eur: 1234.5,
    overdue_count: 1,
    next_due_date: "2026-12-10",
  };
  const digest = {
    week_start_date: "2026-10-26",
    as_of_date: "2026-10-26",
    payables_count: 2,
    amount_eur: 1234.5,
    overdue_count: 1,
    overdue_amount_eur: 100,
    suppliers_count: 1,
    suppliers_listed: 1,
    suppliers: [supplier],
  };
  const REMINDERS = ["payable_due_7d", "payable_due_today", "payable_overdue_3d"] as const;

  it.each(REMINDERS)("%s accepts the database payload and declares amount_eur as money", (kind) => {
    expect(TEMPLATES[kind].payload.safeParse(reminder).success).toBe(true);
    expect([...TEMPLATES[kind].moneyFields]).toEqual(["amount_eur"]);
  });

  it.each(REMINDERS)("%s refuses extra keys and names longer than 80 characters", (kind) => {
    const schema = TEMPLATES[kind].payload;
    expect(schema.safeParse({ ...reminder, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...reminder, supplier_name: "x".repeat(81) }).success).toBe(false);
    expect(schema.safeParse({ ...reminder, invoice_number: "x".repeat(81) }).success).toBe(false);
    expect(schema.safeParse({ ...reminder, due_date: "10/12/2026" }).success).toBe(false);
  });

  it("the digest accepts its payload and declares the two money keys of its top level", () => {
    const template = TEMPLATES.payables_weekly_digest;
    expect(template.payload.safeParse(digest).success).toBe(true);
    expect([...template.moneyFields].sort()).toEqual(["amount_eur", "overdue_amount_eur"]);
  });

  it("the digest refuses extra keys, in an entry too, and more than 15 suppliers", () => {
    const schema = TEMPLATES.payables_weekly_digest.payload;
    expect(schema.safeParse({ ...digest, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...digest, suppliers: [{ ...supplier, extra: 1 }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...digest, suppliers: Array(16).fill(supplier) }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...digest, suppliers: Array(15).fill(supplier) }).success).toBe(true);
  });

  it("no payable text mentions email", () => {
    for (const kind of [...REMINDERS, "payables_weekly_digest"] as const) {
      for (const locale of ["it", "en"] as const) {
        for (const key of Object.keys(messages[locale])) {
          if (key.startsWith(`alerts.kind.${kind}.`)) {
            expect(messages[locale][key as keyof (typeof messages)["it"]], key).not.toMatch(
              /e-?mail/i,
            );
          }
        }
      }
    }
  });
});

describe("device_locked template (M11)", () => {
  const schema = TEMPLATES.device_locked.payload;
  const good = {
    device_id: "d2000000-0000-4000-8000-0000000000d2",
    device_label: "Telefono sala (demo)",
    failures_count: 20,
    window_minutes: 60,
    locked_at: "2026-10-24T19:00:00Z",
  };

  it("accepts the payload built by pin_login_finish", () => {
    expect(schema.safeParse(good).success).toBe(true);
  });

  it("has no money field and no key that names a person (only device_label)", () => {
    expect(TEMPLATES.device_locked.moneyFields).toEqual([]);
    const keys = Object.keys(schema.shape);
    expect(keys.filter(isMoneyLikeKey)).toEqual([]);
    expect(keys.filter((key) => /name|staff|user/i.test(key))).toEqual([]);
    expect(keys.sort()).toEqual([
      "device_id",
      "device_label",
      "failures_count",
      "locked_at",
      "window_minutes",
    ]);
  });

  it("is strict: an extra key such as a staff name fails", () => {
    expect(schema.safeParse({ ...good, staff_name: "Mario" }).success).toBe(false);
  });

  it("has Italian and English texts for the title and the body", () => {
    for (const key of [TEMPLATES.device_locked.titleKey, TEMPLATES.device_locked.bodyKey]) {
      expect(isMessageKey(key)).toBe(true);
      expect(messages.it[key]).toBeTruthy();
      expect(messages.en[key]).toBeTruthy();
    }
  });
});
