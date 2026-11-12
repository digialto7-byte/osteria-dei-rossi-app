import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// P2-1 A6 (F16): the money-key vectors live in tests/fixtures/money-key-vectors.json (read by templates.test.ts, the TypeScript mirror) and are repeated in
// supabase/tests/database/345_money_keys_eur.test.sql (the database). This test fails when the two lists differ, so the two languages cannot drift apart.
const JSON_VECTORS = JSON.parse(
  readFileSync(new URL("../../fixtures/money-key-vectors.json", import.meta.url), "utf8"),
) as { money: string[]; notMoney: string[] };

function sqlVectors(): { money: string[]; notMoney: string[] } {
  const sql = readFileSync(
    new URL("../../../supabase/tests/database/345_money_keys_eur.test.sql", import.meta.url),
    "utf8",
  );
  const block = sql.slice(sql.indexOf("-- vectors:begin"), sql.indexOf("-- vectors:end"));
  const rows = [...block.matchAll(/\('([^']+)', (true|false)\)/g)];
  return {
    money: rows.filter((m) => m[2] === "true").map((m) => m[1]!),
    notMoney: rows.filter((m) => m[2] === "false").map((m) => m[1]!),
  };
}

describe("money-key vectors: JSON and pgTAP 345", () => {
  it("the SQL table holds exactly the vectors of the JSON file, in the same order", () => {
    expect(sqlVectors()).toEqual(JSON_VECTORS);
  });

  it("covers the cases the plan names", () => {
    for (const key of [
      "eur",
      "EUR",
      "euro",
      "euros",
      "valueEur",
      "priceEuro",
      "totalEUR",
      "costo_euro",
      "eur_total",
      "cost_count",
      "price_id",
    ]) {
      expect(JSON_VECTORS.money, key).toContain(key);
    }
    for (const key of [
      "europe",
      "neuron",
      "queue_ref",
      "total_count",
      "totalCount",
      "amount_qty",
      "importo_id",
      "attiva",
      "IVAN",
      "total_qty",
      "relativa",
    ]) {
      expect(JSON_VECTORS.notMoney, key).toContain(key);
    }
  });

  it("no key is in both lists and none is repeated", () => {
    const all = [...JSON_VECTORS.money, ...JSON_VECTORS.notMoney];
    expect(new Set(all).size).toBe(all.length);
  });
});
