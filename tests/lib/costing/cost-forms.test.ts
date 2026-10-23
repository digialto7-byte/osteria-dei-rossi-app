import { describe, expect, it } from "vitest";
import {
  emptyFixedCostForm,
  fieldErrors,
  fixedCostsView,
  rulesFormFrom,
  toFixedCostBody,
  toSettingsPatch,
} from "@/lib/costing/cost-forms";

describe("toFixedCostBody", () => {
  it("reads amounts typed with a decimal comma", () => {
    expect(
      toFixedCostBody({ month: "2026-10", rent: "3000", labour: "9000,50", utilities: "1500.25" }),
    ).toEqual({
      ok: true,
      body: { month: "2026-10", rentEur: 3000, labourEur: 9000.5, utilitiesEur: 1500.25 },
    });
  });

  it("names the fields that are empty or not numbers, and sends nothing", () => {
    expect(toFixedCostBody({ month: "", rent: "", labour: "abc", utilities: "1500" })).toEqual({
      ok: false,
      errors: {
        month: "valore obbligatorio",
        rentEur: "Scrivi un numero, ad esempio 1250,00.",
        labourEur: "Scrivi un numero, ad esempio 1250,00.",
      },
    });
  });

  it("starts empty", () => {
    expect(emptyFixedCostForm()).toEqual({ month: "", rent: "", labour: "", utilities: "" });
  });
});

describe("rules form", () => {
  it("fills the form from the settings with decimal commas", () => {
    expect(rulesFormFrom({ avgCostN: 3, priceVariancePct: 7.5, saleVatPct: 10 })).toEqual({
      avgCostN: "3",
      priceVariancePct: "7,5",
      saleVatPct: "10",
    });
  });

  it("turns the form into the three numbers", () => {
    expect(toSettingsPatch({ avgCostN: "4", priceVariancePct: "7,5", saleVatPct: "22" })).toEqual({
      ok: true,
      body: { avgCostN: 4, priceVariancePct: 7.5, saleVatPct: 22 },
    });
  });

  it("refuses a field that is empty or not a number", () => {
    const result = toSettingsPatch({ avgCostN: "", priceVariancePct: "x", saleVatPct: "10" });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(["avgCostN", "priceVariancePct"]);
  });
});

describe("fieldErrors", () => {
  it("words the API's field errors by field", () => {
    expect(
      fieldErrors([
        { field: "labourEur", code: "out_of_range" },
        { field: "month", code: "month_too_far" },
      ]),
    ).toEqual({ labourEur: "fuori dai limiti", month: "mese troppo lontano" });
  });

  it("keeps an unknown code as it is and ignores a detail without a field", () => {
    expect(fieldErrors([{ field: "x", code: "new_code" }, { code: "out_of_range" }])).toEqual({
      x: "new_code",
    });
    expect(fieldErrors(undefined)).toEqual({});
  });
});

describe("fixedCostsView (what the settings page does with GET /api/fixed-costs)", () => {
  const PERIODS = [{ month: "2026-10-01" }] as never;

  it("200 shows the form with the periods", () => {
    expect(fixedCostsView({ ok: true, status: 200, data: { periods: PERIODS } })).toEqual({
      kind: "form",
      periods: PERIODS,
    });
  });

  it("403 hides the form without a message: the fixed costs are not this role's", () => {
    const error = { code: "forbidden", message: "Non hai accesso." };
    expect(fixedCostsView({ ok: false, status: 403, error })).toEqual({ kind: "hidden" });
  });

  it.each([500, 400, 401, 422, 0])("%i shows the generic error and no form", (status) => {
    const error = { code: "internal", message: "dettaglio tecnico" };
    expect(fixedCostsView({ ok: false, status, error })).toEqual({
      kind: "error",
      message: "Qualcosa è andato storto. Riprova tra poco.",
    });
  });
});
