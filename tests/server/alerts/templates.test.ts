import { describe, expect, it } from "vitest";
import { isMessageKey, messages } from "@/lib/i18n";
import { ALERT_KIND_NAMES, ALERT_KINDS, isAlertKind } from "@/server/alerts/kinds";
import { formattersFor, TEMPLATES } from "@/server/alerts/templates";
import { renderAlert } from "@/server/alerts/render";
import { NO_NAMES, type AlertNames } from "@/server/alerts/names";
import type { AlertKind } from "@/server/alerts/kinds";
import { chefPayloadAllowed } from "@/server/alerts/chef-payload";
import { ALERT_LIST_PAGE_SIZE } from "@/server/alerts/constants";

// The same rule as app.payload_money_keys in the database (20261022150600_alert_rules_warning.sql); keep the
// two in agreement. iva and vat match as words only (attiva, relativa and elevation are not money).
const MONEY_LIKE_WORDS = /(_eur$|cost|price|prezz|margin|amount|importo|total|valore|imponibile)/i;
const TAX_WORD = /(^|[^A-Za-z])([Ii][Vv][Aa]|[Vv][Aa][Tt])([^a-z]|$)/;
const TAX_CAMEL = /[a-z](Iva|IVA|Vat|VAT)([^a-z]|$)/;
const isMoneyLikeKey = (key: string) =>
  MONEY_LIKE_WORDS.test(key) || TAX_WORD.test(key) || TAX_CAMEL.test(key);

describe("alert kinds (src/server/alerts/kinds.ts)", () => {
  it("lists the M6 test kinds, price_variance (M8), the four payable kinds (M9), device_locked (M11), negative_stock (M12), ledger_drift (M13) and the five rule kinds (M16)", () => {
    expect([...ALERT_KIND_NAMES].sort()).toEqual([
      "batch_expiring",
      "device_locked",
      "ledger_drift",
      "negative_stock",
      "payable_due_7d",
      "payable_due_today",
      "payable_overdue_3d",
      "payables_weekly_digest",
      "prep_due",
      "prep_raw_short",
      "price_variance",
      "purchase_due",
      "raw_lot_expiring",
      "test_alert",
      "test_alert_kitchen",
    ]);
    expect(ALERT_KINDS.test_alert.costBearing).toBe(false);
    expect(ALERT_KINDS.test_alert_kitchen.costBearing).toBe(false);
    expect(ALERT_KINDS.negative_stock.costBearing).toBe(false);
    expect(ALERT_KINDS.ledger_drift.costBearing).toBe(false);
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

describe("kinds that reach the chef (M12)", () => {
  // The SQL default audience of these kinds includes the chef (app.alert_kind): their payload schema may
  // only use keys the chef allow-list accepts (app.chef_payload_allowed).
  const CHEF_KINDS = ["negative_stock", "test_alert_kitchen"] as const;

  it.each(CHEF_KINDS)("%s: every key of the schema passes the allow-list", (kind) => {
    const shape = TEMPLATES[kind].payload.shape;
    for (const key of Object.keys(shape)) {
      expect(chefPayloadAllowed({ [key]: 1 }), `${kind}.${key}`).toBe(true);
    }
  });

  it("negative_stock carries ids, a quantity and a unit, no money and no name", () => {
    const template = TEMPLATES.negative_stock;
    expect(Object.keys(template.payload.shape).sort()).toEqual([
      "ingredient_id",
      "location_id",
      "movement_id",
      "on_hand_qty",
      "unit",
    ]);
    expect(template.moneyFields).toEqual([]);
    expect(template.nameRefs).toEqual({ ingredient_id: "ingredient", location_id: "location" });
  });

  it("negative_stock accepts the database payload and refuses extra keys", () => {
    const payload = {
      ingredient_id: "1a000000-0000-4000-8000-00000000001a",
      location_id: "10000000-0000-4000-8000-0000000000a1",
      on_hand_qty: -1,
      unit: "kg",
      movement_id: "0e000000-0000-4000-8000-0000000000e1",
    };
    const schema = TEMPLATES.negative_stock.payload;
    expect(schema.safeParse(payload).success).toBe(true);
    expect(schema.safeParse({ ...payload, ingredient_name: "x" }).success).toBe(false);
    expect(schema.safeParse({ ...payload, unit: "conf" }).success).toBe(false);
  });
});

describe("negative_stock batch variant (M19)", () => {
  const batch = {
    recipe_key: "ec000000-0000-4000-8000-0000000000e1",
    batch_id: "ba000000-0000-4000-8000-0000000000b2",
    remaining_portions_qty: -3,
    short_portions_qty: 3,
    order_line_id: "15000000-0000-4000-8000-000000000001",
    movement_id: "bb000000-0000-4000-8000-0000000000a1",
  };
  const variant = TEMPLATES.negative_stock.variants?.[0];

  it("declares one variant with ids and quantities only, and a recipe name reference", () => {
    expect(variant).toBeDefined();
    expect(Object.keys(variant!.payload.shape).sort()).toEqual([
      "batch_id",
      "movement_id",
      "order_line_id",
      "recipe_key",
      "remaining_portions_qty",
      "short_portions_qty",
    ]);
    expect(variant!.nameRefs).toEqual({ recipe_key: "recipe" });
    for (const key of Object.keys(variant!.payload.shape)) {
      expect(chefPayloadAllowed({ [key]: 1 }), key).toBe(true);
    }
  });

  it("accepts the database payload, also with a null batch and a null movement", () => {
    const schema = variant!.payload;
    expect(schema.safeParse(batch).success).toBe(true);
    expect(schema.safeParse({ ...batch, batch_id: null, movement_id: null }).success).toBe(true);
  });

  it("refuses an extra key, a missing key, a non-uuid and a negative shortage", () => {
    const schema = variant!.payload;
    expect(schema.safeParse({ ...batch, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...batch, recipe_key: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...batch, order_line_id: "nope" }).success).toBe(false);
    expect(schema.safeParse({ ...batch, short_portions_qty: -1 }).success).toBe(false);
  });

  it("keeps the M12 ingredient payload as the main schema and refuses the batch payload there", () => {
    expect(TEMPLATES.negative_stock.payload.safeParse(batch).success).toBe(false);
  });
});

describe("ledger_drift template (M13)", () => {
  const payload = {
    checks: [
      {
        check_key: "lot_receipt_missing",
        rows_count: 2,
        sample_ids: ["10700000-0000-4000-8000-0000000000a1"],
      },
      { check_key: "job_stale", rows_count: 1, sample_ids: [], job_key: "alert-rules" },
    ],
    checked_at: "2026-10-24T02:45:00Z",
  };
  const schema = TEMPLATES.ledger_drift.payload;

  it("carries codes, counts and ids only: no money field, no name reference", () => {
    const template = TEMPLATES.ledger_drift;
    expect(template.moneyFields).toEqual([]);
    expect(template.nameRefs).toBeUndefined();
    expect(Object.keys(template.payload.shape).sort()).toEqual(["checked_at", "checks"]);
  });

  it("accepts a finding about the M11 auth-purge job", () => {
    const schema = TEMPLATES.ledger_drift.payload;
    const payload = {
      checks: [{ check_key: "job_failed", rows_count: 1, sample_ids: [], job_key: "auth-purge" }],
      checked_at: "2027-06-15T02:45:00Z",
    };
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it("accepts the payload built by the database", () => {
    expect(schema.safeParse(payload).success).toBe(true);
  });

  it("refuses an unknown check, an extra key, more than 5 sample ids and a non-uuid id", () => {
    const first = payload.checks[0]!;
    expect(
      schema.safeParse({ ...payload, checks: [{ ...first, check_key: "something_else" }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...payload, extra: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...payload, checks: [{ ...first, name: "x" }] }).success).toBe(false);
    expect(
      schema.safeParse({
        ...payload,
        checks: [{ ...first, sample_ids: Array.from({ length: 6 }, () => first.sample_ids[0]) }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...payload, checks: [{ ...first, sample_ids: ["nope"] }] }).success,
    ).toBe(false);
  });

  it("is owner-only data: no key passes the chef allow-list as a free text", () => {
    expect(chefPayloadAllowed({ checks: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// M16: the five rule kinds (plan §3.3). The samples are the payloads app.prep_rule, app.purchase_rule and app.expiry_rule
// build (pgTAP 144-147 use the same shapes). A no-break space sits between a number and its unit: the tests compare with
// plain spaces so that the sentences read as in the plan.
// ---------------------------------------------------------------------------------------------------------------------
describe("rule kinds (M16)", () => {
  const plain = (text: string) => text.replaceAll("\u00a0", " ");
  const rendered = (
    kind: string,
    payload: unknown,
    locale: "it" | "en",
    names: AlertNames = NAMES,
  ) => {
    const out = renderAlert(
      { id: "a1a1a1a1-0000-4000-8000-000000000001", kind, payload },
      locale,
      TEMPLATES,
      names,
    );
    return { title: plain(out.title), body: plain(out.body) };
  };
  const STEW = "b2000000-0000-4000-8000-000000000001";
  const BEEF = "1a000000-0000-4000-8000-000000000001";
  const ONION = "1a000000-0000-4000-8000-000000000002";
  const MACELLERIA = "5a000000-0000-4000-8000-00000000005a";
  const LOT = "10700000-0000-4000-8000-0000000000a1";
  const BATCH = "ba000000-0000-4000-8000-0000000000a1";
  const NAMES: AlertNames = {
    ingredient: new Map([
      [BEEF, "Manzo muscolo (demo)"],
      [ONION, "Cipolla (demo)"],
    ]),
    location: new Map(),
    recipe: new Map([[STEW, "Spezzatino (demo)"]]),
    supplier: new Map([[MACELLERIA, "Macelleria X (demo)"]]),
    raw_lot: new Map([[LOT, "L-EXP"]]),
    batch: new Map([[BATCH, "261102-SPEZZA-1"]]),
  };

  const prepDue = {
    recipe_key: STEW,
    recipe_id: "c2000000-0000-4000-8000-000000000011",
    remaining_portions_qty: 4,
    min_portions_count: 5,
    target_portions_count: 30,
    batches_count: 1,
    prep_hours: 3,
    ingredient_id: BEEF,
    needed_qty: 5,
    on_hand_qty: 12.3,
    unit: "kg",
  };
  const rawShort = {
    recipe_key: STEW,
    recipe_id: "c2000000-0000-4000-8000-000000000011",
    remaining_portions_qty: 4,
    min_portions_count: 5,
    ingredient_id: BEEF,
    needed_qty: 5,
    on_hand_qty: 3,
    unit: "kg",
    short_count: 1,
    supplier_id: null,
    order_by_at: null,
    delivery_date: null,
  };
  const purchase = {
    ingredient_id: BEEF,
    supplier_id: MACELLERIA,
    supplier_item_id: "51000000-0000-4000-8000-000000000001",
    order_qty: 10,
    packs_count: 2,
    pack_qty: 5,
    unit: "kg",
    order_by_at: "2026-11-03T10:00:00Z",
    delivery_date: "2026-11-05",
    horizon_days: 3,
    on_hand_qty: 9,
    forecast_qty: 7,
    projected_qty: 2,
    min_qty: 5,
    target_qty: 12,
  };
  const lot = {
    raw_lot_id: LOT,
    ingredient_id: ONION,
    remaining_qty: 1,
    unit: "kg",
    expiry_date: "2026-11-03",
    state_key: "due_soon",
  };
  const batch = {
    batch_id: BATCH,
    recipe_key: STEW,
    remaining_portions_qty: 6,
    use_by_at: "2026-11-03T06:00:00Z",
    state_key: "due_soon",
  };
  const SAMPLES: Record<string, unknown> = {
    prep_due: prepDue,
    prep_raw_short: rawShort,
    purchase_due: purchase,
    raw_lot_expiring: lot,
    batch_expiring: batch,
  };

  it("registers the five kinds as not cost-bearing, with no money field", () => {
    for (const kind of Object.keys(SAMPLES) as AlertKind[]) {
      expect(ALERT_KINDS[kind].costBearing, kind).toBe(false);
      expect(TEMPLATES[kind].moneyFields, kind).toEqual([]);
    }
  });

  it("every sample passes its strict schema and refuses an extra key and a free-text name", () => {
    for (const [kind, payload] of Object.entries(SAMPLES)) {
      const schema = TEMPLATES[kind as AlertKind].payload;
      expect(schema.safeParse(payload).success, kind).toBe(true);
      expect(schema.safeParse({ ...(payload as object), extra: 1 }).success, kind).toBe(false);
      expect(schema.safeParse({ ...(payload as object), recipe_name: "x" }).success, kind).toBe(
        false,
      );
    }
  });

  it("declares the id keys whose names are looked up when the alert is shown", () => {
    expect(TEMPLATES.prep_due.nameRefs).toEqual({
      recipe_key: "recipe",
      ingredient_id: "ingredient",
    });
    expect(TEMPLATES.prep_raw_short.nameRefs).toEqual({
      recipe_key: "recipe",
      ingredient_id: "ingredient",
      supplier_id: "supplier",
    });
    expect(TEMPLATES.purchase_due.nameRefs).toEqual({
      ingredient_id: "ingredient",
      supplier_id: "supplier",
    });
    expect(TEMPLATES.raw_lot_expiring.nameRefs).toEqual({
      ingredient_id: "ingredient",
      raw_lot_id: "raw_lot",
    });
    expect(TEMPLATES.batch_expiring.nameRefs).toEqual({ recipe_key: "recipe", batch_id: "batch" });
  });

  describe("AT1: prep_due", () => {
    it("English: the PRD sentence", () => {
      const { title, body } = rendered("prep_due", prepDue, "en");
      expect(title).toBe("Prepare today: Spezzatino (demo)");
      expect(body).toBe(
        "Prepare Spezzatino (demo) today, 5.0 kg Manzo muscolo (demo) available (12.3 kg on hand). 4 portions left, minimum 5. Prep time: 3 h.",
      );
    });

    it("Italian: decimals with a comma", () => {
      const { title, body } = rendered("prep_due", prepDue, "it");
      expect(title).toBe("Da preparare oggi: Spezzatino (demo)");
      expect(body).toBe(
        "Prepara Spezzatino (demo) oggi, 5,0 kg di Manzo muscolo (demo) disponibili (12,3 kg in giacenza). Restano 4 porzioni, minimo 5. Preparazione: 3 h.",
      );
    });

    it("adds the batches sentence when more than one batch is needed", () => {
      const two = { ...prepDue, batches_count: 2, needed_qty: 10 };
      expect(rendered("prep_due", two, "en").body).toContain(
        "minimum 5. To reach 30 portions: 2 batches. Prep time: 3 h.",
      );
      expect(rendered("prep_due", two, "it").body).toContain(
        "minimo 5. Per arrivare a 30 porzioni: 2 lotti. Preparazione: 3 h.",
      );
    });

    it("leaves out the prep time when there is none, and the batches sentence without a target", () => {
      const bare = { ...prepDue, prep_hours: null, target_portions_count: null, batches_count: 2 };
      expect(rendered("prep_due", bare, "en").body).toBe(
        "Prepare Spezzatino (demo) today, 5.0 kg Manzo muscolo (demo) available (12.3 kg on hand). 4 portions left, minimum 5.",
      );
    });

    it("a recipe with no stock ingredient has a shorter first sentence", () => {
      const none = {
        ...prepDue,
        ingredient_id: null,
        needed_qty: null,
        on_hand_qty: null,
        unit: null,
        prep_hours: null,
      };
      expect(rendered("prep_due", none, "en").body).toBe(
        "Prepare Spezzatino (demo) today. 4 portions left, minimum 5.",
      );
      expect(rendered("prep_due", none, "it").body).toBe(
        "Prepara Spezzatino (demo) oggi. Restano 4 porzioni, minimo 5.",
      );
    });

    it("one portion left reads in the singular", () => {
      const one = { ...prepDue, remaining_portions_qty: 1, prep_hours: null };
      expect(rendered("prep_due", one, "en").body).toContain("1 portion left, minimum 5.");
      expect(rendered("prep_due", one, "it").body).toContain("Resta 1 porzione, minimo 5.");
    });
  });

  describe("AT2: prep_raw_short", () => {
    it("English and Italian without a supplier", () => {
      expect(rendered("prep_raw_short", rawShort, "en")).toEqual({
        title: "Raw stock short for Spezzatino (demo)",
        body: "4 portions left (minimum 5). One batch needs 5.0 kg Manzo muscolo (demo), 3.0 kg on hand.",
      });
      expect(rendered("prep_raw_short", rawShort, "it")).toEqual({
        title: "Manca materia prima per Spezzatino (demo)",
        body: "Restano 4 porzioni (minimo 5). Per un lotto servono 5,0 kg di Manzo muscolo (demo), in giacenza 3,0 kg.",
      });
    });

    it("adds the order sentence with the supplier's deadline and delivery weekday", () => {
      const withSupplier = {
        ...rawShort,
        supplier_id: MACELLERIA,
        order_by_at: "2026-11-03T10:00:00Z",
        delivery_date: "2026-11-05",
      };
      expect(rendered("prep_raw_short", withSupplier, "en").body).toContain(
        "3.0 kg on hand. Order from Macelleria X (demo) by Tue 11:00 for Thu delivery.",
      );
      expect(rendered("prep_raw_short", withSupplier, "it").body).toContain(
        "in giacenza 3,0 kg. Ordina da Macelleria X (demo) entro mar 11:00 per la consegna di gio.",
      );
    });

    it("says how many other ingredients are short", () => {
      const more = { ...rawShort, short_count: 3 };
      expect(rendered("prep_raw_short", more, "en").body).toContain(
        "3.0 kg on hand. 2 more ingredients are short.",
      );
      expect(rendered("prep_raw_short", more, "it").body).toContain(
        "in giacenza 3,0 kg. Mancano anche altri 2 ingredienti.",
      );
      const one = { ...rawShort, short_count: 2 };
      expect(rendered("prep_raw_short", one, "en").body).toContain("1 more ingredient is short.");
      expect(rendered("prep_raw_short", one, "it").body).toContain(
        "Manca anche 1 altro ingrediente.",
      );
    });
  });

  describe("AT3: purchase_due", () => {
    it("English title, exactly as in the PRD example", () => {
      expect(rendered("purchase_due", purchase, "en").title).toBe(
        "Order 10 kg Manzo muscolo (demo) from Macelleria X (demo) by Tue 11:00 for Thu delivery",
      );
    });

    it("Italian title", () => {
      expect(rendered("purchase_due", purchase, "it").title).toBe(
        "Ordina 10 kg di Manzo muscolo (demo) da Macelleria X (demo) entro mar 11:00 per la consegna di gio",
      );
    });

    it("the body gives the packs, the delivery date and the projection", () => {
      expect(rendered("purchase_due", purchase, "en").body).toBe(
        "2 packs of 5 kg. Delivery 05/11/2026. On hand 9 kg, expected use 7 kg in 3 days, projected stock 2 kg (minimum 5 kg, target 12 kg).",
      );
      expect(rendered("purchase_due", purchase, "it").body).toBe(
        "2 confezioni da 5 kg. Consegna 05/11/2026. Giacenza 9 kg, consumo previsto 7 kg in 3 giorni, scorta prevista 2 kg (minimo 5 kg, obiettivo 12 kg).",
      );
    });

    it("singular packs and days, and a negative projection with the real minus sign", () => {
      const one = { ...purchase, packs_count: 1, horizon_days: 1, projected_qty: -1.5 };
      const { body } = rendered("purchase_due", one, "en");
      expect(body).toContain("1 pack of 5 kg.");
      expect(body).toContain("in 1 day,");
      expect(body).toContain("projected stock \u22121.5 kg");
      expect(rendered("purchase_due", one, "it").body).toContain("1 confezione da 5 kg.");
    });

    it("has no euro sign", () => {
      expect(JSON.stringify(rendered("purchase_due", purchase, "it"))).not.toMatch(/€/);
    });
  });

  describe("AT5: expiry kinds", () => {
    it("raw_lot_expiring: due soon and expired", () => {
      expect(rendered("raw_lot_expiring", lot, "en")).toEqual({
        title: "Expiring: Cipolla (demo)",
        body: "Lot L-EXP: 1 kg left, expiry 03/11/2026.",
      });
      expect(rendered("raw_lot_expiring", lot, "it")).toEqual({
        title: "In scadenza: Cipolla (demo)",
        body: "Lotto L-EXP: 1 kg rimasti, scadenza 03/11/2026.",
      });
      const expired = { ...lot, state_key: "expired", remaining_qty: 0.5 };
      expect(rendered("raw_lot_expiring", expired, "en").title).toBe("Expired: Cipolla (demo)");
      expect(rendered("raw_lot_expiring", expired, "it").title).toBe("Scaduto: Cipolla (demo)");
      expect(rendered("raw_lot_expiring", expired, "it").body).toBe(
        "Lotto L-EXP: 0,5 kg rimasti, scadenza 03/11/2026.",
      );
    });

    it("batch_expiring: due soon and expired", () => {
      expect(rendered("batch_expiring", batch, "en")).toEqual({
        title: "Use by 03/11/2026, 07:00: Spezzatino (demo)",
        body: "Lot 261102-SPEZZA-1: 6 portions left.",
      });
      expect(rendered("batch_expiring", batch, "it")).toEqual({
        title: "Da consumare entro 03/11/2026, 07:00: Spezzatino (demo)",
        body: "Lotto 261102-SPEZZA-1: 6 porzioni rimaste.",
      });
      const expired = { ...batch, state_key: "expired", remaining_portions_qty: 1 };
      expect(rendered("batch_expiring", expired, "en").title).toBe("Expired: Spezzatino (demo)");
      expect(rendered("batch_expiring", expired, "it").title).toBe("Scaduto: Spezzatino (demo)");
      expect(rendered("batch_expiring", expired, "en").body).toBe(
        "Lot 261102-SPEZZA-1: 1 portion left.",
      );
      expect(rendered("batch_expiring", expired, "it").body).toBe(
        "Lotto 261102-SPEZZA-1: 1 porzione rimasta.",
      );
    });

    it("an unknown state_key fails the schema and shows the fallback", () => {
      expect(rendered("raw_lot_expiring", { ...lot, state_key: "ok" }, "it").title).toBe("Avviso");
    });
  });

  it("a missing name shows a neutral word, never the id", () => {
    const { title, body } = rendered("purchase_due", purchase, "it", NO_NAMES);
    expect(title + body).not.toContain(BEEF);
    expect(title + body).not.toContain(MACELLERIA);
    expect(title).toContain("ingrediente non disponibile");
    expect(title).toContain("fornitore non disponibile");
    expect(rendered("prep_due", prepDue, "it", NO_NAMES).title).toBe(
      "Da preparare oggi: ricetta non disponibile",
    );
    expect(rendered("raw_lot_expiring", lot, "it", NO_NAMES).body).toContain(
      "Lotto non disponibile:",
    );
  });

  it("AT6: weekdayTime reads the Rome clock across the DST change", () => {
    const f = formattersFor("it");
    expect(f.weekdayTime("2026-10-25T10:00:00Z")).toBe("dom 11:00");
    expect(f.weekdayTime("2026-10-24T09:00:00Z")).toBe("sab 11:00");
    expect(f.weekdayTime("2027-03-28T09:00:00Z")).toBe("dom 11:00");
    expect(formattersFor("en").weekdayTime("2026-11-03T10:00:00Z")).toBe("Tue 11:00");
    expect(f.weekday("2026-11-05")).toBe("gio");
    expect(formattersFor("en").weekday("2026-11-05")).toBe("Thu");
  });

  it("measuredQty always shows at least one decimal", () => {
    const f = formattersFor("it");
    expect(plain(f.measuredQty(5, "kg"))).toBe("5,0 kg");
    expect(plain(f.measuredQty(12.3, "kg"))).toBe("12,3 kg");
    expect(plain(f.measuredQty(0.125, "l"))).toBe("0,125 l");
    expect(plain(formattersFor("en").measuredQty(1234.5, "kg"))).toBe("1,234.5 kg");
  });

  it("keeps markup in a name as text", () => {
    const hostile: AlertNames = {
      ...NAMES,
      recipe: new Map([[STEW, "<script>alert(1)</script>"]]),
    };
    expect(rendered("prep_due", prepDue, "it", hostile).title).toBe(
      "Da preparare oggi: <script>alert(1)</script>",
    );
  });
});
