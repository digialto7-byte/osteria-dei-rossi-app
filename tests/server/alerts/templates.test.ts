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
  it("lists exactly the two M6 test kinds, none of them cost-bearing", () => {
    expect([...ALERT_KIND_NAMES].sort()).toEqual(["test_alert", "test_alert_kitchen"]);
    expect(ALERT_KINDS.test_alert.costBearing).toBe(false);
    expect(ALERT_KINDS.test_alert_kitchen.costBearing).toBe(false);
  });

  it("isAlertKind accepts registered kinds only", () => {
    expect(isAlertKind("test_alert")).toBe(true);
    expect(isAlertKind("price_variance")).toBe(false);
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
