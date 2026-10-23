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
