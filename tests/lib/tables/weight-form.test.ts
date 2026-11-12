import { describe, expect, it } from "vitest";
import { weightBodyFromForm, weightFormFromRead } from "@/lib/tables/weight-form";
import { WEIGHT_SETTINGS } from "../../helpers/menu-tables-data";

describe("weightFormFromRead", () => {
  it("shows the maximum in force as grams", () => {
    expect(weightFormFromRead({ ...WEIGHT_SETTINGS, weightMaxG: 4000 })).toEqual({ value: "4000" });
  });
});

describe("weightBodyFromForm", () => {
  it("sends the grams as an integer", () => {
    expect(weightBodyFromForm({ value: "4000" }, WEIGHT_SETTINGS)).toEqual({
      ok: true,
      body: { weightMaxG: 4000 },
    });
  });
  it("takes the edges of the range from the server's reply", () => {
    expect(weightBodyFromForm({ value: "500" }, WEIGHT_SETTINGS).ok).toBe(true);
    expect(weightBodyFromForm({ value: "10000" }, WEIGHT_SETTINGS).ok).toBe(true);
    expect(weightBodyFromForm({ value: "400" }, { ...WEIGHT_SETTINGS, settingMinG: 400 }).ok).toBe(
      true,
    );
  });
  it.each(["490", "10010", "1005", "", "  ", "abc", "4000.5", "4.000", "-500"])(
    "refuses %j with the Italian rule, no body",
    (value) => {
      const result = weightBodyFromForm({ value }, WEIGHT_SETTINGS);
      expect(result).toEqual({
        ok: false,
        error: "Il peso massimo per riga va da 500 a 10.000 g, a passi di 10.",
      });
    },
  );
});
