import { describe, expect, it } from "vitest";
import { buildLinePatch, initialLineForm } from "@/lib/invoices/line-form";
import { makeLine } from "../../helpers/review-line";

const ING = "1d000000-0000-4000-8000-000000000009";

describe("initialLineForm", () => {
  it("starts from the line as the server sent it", () => {
    const form = initialLineForm(
      makeLine({
        qty: 2.5,
        unitPrice: 12.75,
        vatRate: 10,
        supplierCode: "MAN-1",
        lotCode: "L1",
        expiry: "2026-11-30",
        pack: { count: 6, size: 1, unit: "kg", label: "cassa" },
      }),
    );
    expect(form).toMatchObject({
      qty: "2,5",
      unitPrice: "12,75",
      lineAmount: "25,5",
      vatRate: "10",
      supplierCode: "MAN-1",
      unit: "kg",
      lotCode: "L1",
      expiry: "2026-11-30",
      packCount: "6",
      packSize: "1",
      packUnit: "kg",
      packLabel: "cassa",
      isStock: true,
      creditQty: "",
    });
  });
});

describe("buildLinePatch", () => {
  const line = makeLine();
  const patchFor = (change: Record<string, unknown>, over = {}, opts = {}) =>
    buildLinePatch(makeLine(over), { ...initialLineForm(makeLine(over)), ...change }, opts);

  it("saving an unchanged line only marks it as checked", () => {
    expect(buildLinePatch(line, initialLineForm(line))).toEqual({
      ok: true,
      patch: { reviewed: true },
    });
  });

  it("sends only what changed, numbers read with a decimal comma", () => {
    expect(patchFor({ qty: "3,5", unitPrice: "", vatRate: "22" })).toEqual({
      ok: true,
      patch: { qty: 3.5, unitPrice: null, vatRate: 22, reviewed: true },
    });
  });

  it("clears text fields to null and sets a lot and expiry", () => {
    expect(patchFor({ supplierCode: " ", lotCode: " L-9 ", expiry: "2026-12-01" })).toEqual({
      ok: true,
      patch: { supplierCode: null, lotCode: "L-9", expiry: "2026-12-01", reviewed: true },
    });
  });

  it("a number that is not a number names its field", () => {
    expect(patchFor({ qty: "due" })).toEqual({
      ok: false,
      field: "qty",
      message: "Controlla il valore di «quantità».",
    });
  });

  it("quantity and amount cannot be left empty", () => {
    expect(patchFor({ lineAmount: "" })).toMatchObject({ ok: false, field: "lineAmount" });
  });

  it("maps to an ingredient, or unmaps with an empty choice", () => {
    expect(patchFor({ ingredientId: ING })).toMatchObject({
      ok: true,
      patch: { ingredientId: ING },
    });
    expect(patchFor({ ingredientId: "" })).toMatchObject({
      ok: true,
      patch: { ingredientId: null },
    });
  });

  it("sends a pack only when it is complete and changed", () => {
    expect(patchFor({ packCount: "6", packSize: "1", packUnit: "kg", packLabel: "cassa" })).toEqual(
      {
        ok: true,
        patch: { pack: { count: 6, size: 1, unit: "kg", label: "cassa" }, reviewed: true },
      },
    );
    expect(patchFor({ packCount: "6" })).toMatchObject({ ok: false, field: "pack" });
    expect(
      patchFor({ packCount: "6", packSize: "1", packUnit: "kg", packLabel: "" }),
    ).toMatchObject({
      patch: { pack: { count: 6, size: 1, unit: "kg", label: null } },
    });
  });

  it("non-stock sends the flag with its cost centre; without one the API says no", () => {
    expect(patchFor({ isStock: false, costCentreId: "cc1" })).toEqual({
      ok: true,
      patch: { isStock: false, costCentreId: "cc1", reviewed: true },
    });
    expect(patchFor({ isStock: false })).toEqual({
      ok: true,
      patch: { isStock: false, reviewed: true },
    });
  });

  it("back to stock sends only the flag, and a non-stock line sends no ingredient", () => {
    const nonStock = {
      isStock: false,
      costCentre: { id: "cc1", name: "Pulizie" },
      ingredient: null,
    };
    expect(patchFor({ isStock: true }, nonStock)).toMatchObject({ patch: { isStock: true } });
    expect(patchFor({ ingredientId: ING }, nonStock)).toEqual({
      ok: true,
      patch: { reviewed: true },
    });
  });

  it("a changed cost centre on a non-stock line resends the pair", () => {
    const nonStock = {
      isStock: false,
      costCentre: { id: "cc1", name: "Pulizie" },
      ingredient: null,
    };
    expect(patchFor({ costCentreId: "cc2" }, nonStock)).toMatchObject({
      patch: { isStock: false, costCentreId: "cc2" },
    });
  });

  it("records a credit; an empty field is no credit", () => {
    expect(patchFor({ creditQty: "1" })).toMatchObject({ patch: { creditQty: 1 } });
    expect(patchFor({ creditQty: "" }, { creditQty: 1 })).toMatchObject({
      patch: { creditQty: 0 },
    });
  });

  it("a part of a split line cannot change quantity, amounts, credit, code or pack", () => {
    const result = patchFor(
      {
        qty: "9",
        lineAmount: "9",
        unitPrice: "9",
        creditQty: "1",
        supplierCode: "X",
        packCount: "6",
        packSize: "1",
        packUnit: "kg",
        ingredientId: ING,
        lotCode: "L2",
      },
      { parentLineId: "p", subPosition: 1 },
      { child: true },
    );
    expect(result).toEqual({
      ok: true,
      patch: { ingredientId: ING, lotCode: "L2", reviewed: true },
    });
  });
});
