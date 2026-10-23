import { describe, expect, it } from "vitest";
import { messages } from "@/lib/i18n";
import { STOCK_REASON_CODES, reasonLabel } from "@/server/stock/reasons";
import { UNITS_FOR_BASE } from "@/server/stock/constants";

describe("waste reason codes (src/server/stock/reasons.ts)", () => {
  // The same literal list, in the same order, that supabase/tests/database/090 asserts for app.stock_reason_codes().
  it("are the eight codes of PRD 2.5, in the database order", () => {
    expect([...STOCK_REASON_CODES]).toEqual([
      "spoilage",
      "expired",
      "over_production",
      "plating_error",
      "staff_meal",
      "comp",
      "breakage",
      "count_correction",
    ]);
  });

  it("have an Italian and an English label", () => {
    for (const code of STOCK_REASON_CODES) {
      expect(reasonLabel(code, "it").length, code).toBeGreaterThan(2);
      expect(reasonLabel(code, "en").length, code).toBeGreaterThan(2);
      expect(messages.it[`stock.reason.${code}`]).toBe(reasonLabel(code, "it"));
    }
  });

  it("use the planned Italian wording", () => {
    expect(STOCK_REASON_CODES.map((code) => reasonLabel(code, "it"))).toEqual([
      "Deteriorato",
      "Scaduto",
      "Sovrapproduzione",
      "Errore di impiattamento",
      "Pasto del personale",
      "Omaggio",
      "Rottura",
      "Correzione di conteggio",
    ]);
  });
});

describe("UNITS_FOR_BASE", () => {
  it("lists the input units per base unit", () => {
    expect(UNITS_FOR_BASE).toEqual({ kg: ["kg", "g"], l: ["l", "ml"], pz: ["pz"] });
  });
});
