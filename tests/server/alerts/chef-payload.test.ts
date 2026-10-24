import { describe, expect, it } from "vitest";
import { chefPayloadAllowed } from "@/server/alerts/chef-payload";

const ID = "1a000000-0000-4000-8000-00000000001a";

// The same vector table as supabase/tests/database/091_chef_payload_allowlist.test.sql: keep the two in agreement.
const VECTORS: [string, unknown, boolean][] = [
  ["empty object", {}, true],
  ["ids, quantity and unit", { ingredient_id: ID, on_hand_qty: -1, unit: "kg" }, true],
  [
    "date, instant, count, code",
    {
      x_date: "2026-10-25",
      y_at: "2026-10-25T10:00:00Z",
      n_count: 3,
      reason_key: "over_production",
    },
    true,
  ],
  ["nested allowed keys", { lot_key: { lot_id: ID, left_qty: 1 } }, true],
  ["key without suffix inside an array", { ids: [{ a_id: ID }] }, false],
  ["qty alone", { lot_id: ID, qty: 1 }, false],
  ["name key", { supplier_name: "Quartiere EUR" }, false],
  ["eur", { eur: 12 }, false],
  ["valueEur", { valueEur: 12 }, false],
  ["note", { note: "ok" }, false],
  ["value that is not a token", { ingredient_id: "Manzo" }, false],
  ["41-character code", { reason_key: "a".repeat(41) }, false],
  ["40-character code", { reason_key: "a".repeat(40) }, true],
  ["digit-only code", { reason_key: "1250" }, false],
  ["code starting with an underscore", { reason_key: "_x" }, false],
  ["code with a leading letter and digits", { reason_key: "a1250" }, true],
  ["string in an array", { a_key: ["ok", "12,50 €"] }, false],
  ["bad key at depth", { a_key: { deep_name: "x" } }, false],
  ["null, boolean, number", { a_key: null, b_count: true, c_qty: 1.5 }, true],
  ["upper-case unit", { unit: "Kg" }, false],
];

describe("chefPayloadAllowed (mirror of app.chef_payload_allowed)", () => {
  it.each(VECTORS)("%s", (_label, payload, expected) => {
    expect(chefPayloadAllowed(payload)).toBe(expected);
  });

  it("refuses anything that is not an object", () => {
    for (const value of [null, undefined, [], "x", 1]) {
      expect(chefPayloadAllowed(value)).toBe(false);
    }
  });
});

// The five M16 sample payloads, the same as supabase/tests/database/144_rule_alert_kinds.test.sql.
const M16_SAMPLES: [string, unknown][] = [
  [
    "prep_due",
    {
      recipe_key: "b2000000-0000-4000-8000-000000000001",
      recipe_id: "c2000000-0000-4000-8000-000000000011",
      remaining_portions_qty: 4,
      min_portions_count: 5,
      target_portions_count: 30,
      batches_count: 1,
      prep_hours: 3,
      ingredient_id: ID,
      needed_qty: 5.0,
      on_hand_qty: 12.3,
      unit: "kg",
    },
  ],
  [
    "prep_raw_short",
    {
      recipe_key: "b2000000-0000-4000-8000-000000000002",
      recipe_id: "c2000000-0000-4000-8000-000000000012",
      remaining_portions_qty: 4,
      min_portions_count: 5,
      ingredient_id: ID,
      needed_qty: 5.0,
      on_hand_qty: 3.0,
      unit: "kg",
      short_count: 1,
      supplier_id: "5a000000-0000-4000-8000-00000000005a",
      order_by_at: "2026-11-03T10:00:00Z",
      delivery_date: "2026-11-05",
    },
  ],
  [
    "purchase_due",
    {
      ingredient_id: ID,
      supplier_id: "5a000000-0000-4000-8000-00000000005a",
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
    },
  ],
  [
    "raw_lot_expiring",
    {
      raw_lot_id: "10700000-0000-4000-8000-0000000000a1",
      ingredient_id: ID,
      remaining_qty: 1,
      unit: "kg",
      expiry_date: "2026-11-03",
      state_key: "due_soon",
    },
  ],
  [
    "batch_expiring",
    {
      batch_id: "ba000000-0000-4000-8000-0000000000a1",
      recipe_key: "b2000000-0000-4000-8000-000000000001",
      remaining_portions_qty: 6,
      use_by_at: "2026-11-03T06:00:00Z",
      state_key: "due_soon",
    },
  ],
];

describe("chefPayloadAllowed: the M16 rule payloads", () => {
  it.each(M16_SAMPLES)("%s sample is allowed", (_kind, payload) => {
    expect(chefPayloadAllowed(payload)).toBe(true);
  });

  it.each(M16_SAMPLES)("%s with a free-text name is not", (_kind, payload) => {
    expect(chefPayloadAllowed({ ...(payload as object), recipe_name: "Spezzatino" })).toBe(false);
  });
});
